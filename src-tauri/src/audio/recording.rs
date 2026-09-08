use super::{patch_wav_sizes, sample_to_pcm16, write_wav_header};
use crate::realtime_metrics;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

const COMMAND_QUEUE_CAPACITY: usize = 64;
const QUEUE_CAPACITY_SECONDS: u64 = 2;

#[derive(Debug, Clone)]
pub(super) struct RecordingSnapshot {
    pub path: PathBuf,
    pub sample_count: u64,
    pub partial: bool,
}

enum RecordingCommand {
    Samples(Box<[f32]>),
    Snapshot {
        path: PathBuf,
        reply: mpsc::SyncSender<Result<Option<RecordingSnapshot>, String>>,
    },
    Finalize {
        path: PathBuf,
        reply: mpsc::SyncSender<Result<Option<RecordingSnapshot>, String>>,
    },
    Discard {
        reply: mpsc::SyncSender<()>,
    },
}

pub(super) struct RecordingSink;

pub(super) struct RecordingHandle {
    sender: mpsc::SyncSender<RecordingCommand>,
    queued_samples: Arc<AtomicU64>,
    partial: Arc<AtomicBool>,
    sample_rate: u32,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
    finished: OnceLock<Result<Option<RecordingSnapshot>, String>>,
}

struct RecordingWorker<W: Write + Seek> {
    notify: Box<dyn Fn(&str, serde_json::Value) + Send>,
    path: PathBuf,
    writer: Option<BufWriter<W>>,
    sample_rate: u32,
    max_samples: u64,
    sample_count: u64,
    samples_since_flush: u64,
    limit_notified: bool,
    partial: Arc<AtomicBool>,
    queued_samples: Arc<AtomicU64>,
    scratch: Vec<u8>,
    failed: bool,
}

impl RecordingSink {
    pub(super) fn start(
        app: AppHandle,
        path: PathBuf,
        sample_rate: u32,
        max_seconds: u64,
    ) -> Result<RecordingHandle, String> {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .read(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        Self::start_writer(path, file, sample_rate, max_seconds, Box::new(move |event, value| {
            let _ = app.emit(event, value);
        }))
    }

    fn start_writer<W: Write + Seek + Send + 'static>(
        path: PathBuf,
        file: W,
        sample_rate: u32,
        max_seconds: u64,
        notify: Box<dyn Fn(&str, serde_json::Value) + Send>,
    ) -> Result<RecordingHandle, String> {
        let mut writer = BufWriter::new(file);
        write_wav_header(&mut writer, sample_rate, 0)?;
        writer.flush().map_err(|error| error.to_string())?;

        let (sender, receiver) = mpsc::sync_channel(COMMAND_QUEUE_CAPACITY);
        let queued_samples = Arc::new(AtomicU64::new(0));
        let partial = Arc::new(AtomicBool::new(false));
        let worker_queued_samples = Arc::clone(&queued_samples);
        let worker_partial = Arc::clone(&partial);
        let worker_path = path.clone();
        let worker = thread::Builder::new()
            .name("recording-writer".into())
            .spawn(move || {
                let mut state = RecordingWorker {
                    notify,
                    path: worker_path,
                    writer: Some(writer),
                    sample_rate,
                    max_samples: u64::from(sample_rate).saturating_mul(max_seconds),
                    sample_count: 0,
                    samples_since_flush: 0,
                    limit_notified: false,
                    partial: worker_partial,
                    queued_samples: worker_queued_samples,
                    scratch: Vec::with_capacity(32 * 1024),
                    failed: false,
                };
                state.run(receiver);
            })
            .map_err(|error| error.to_string())?;

        Ok(RecordingHandle {
            sender,
            queued_samples,
            partial,
            sample_rate,
            worker: Mutex::new(Some(worker)),
            finished: OnceLock::new(),
        })
    }
}

impl RecordingHandle {
    pub(super) fn try_push(&self, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let queue_capacity = u64::from(self.sample_rate).saturating_mul(QUEUE_CAPACITY_SECONDS);
        let count = samples.len() as u64;
        // Reserve before publishing: the worker can receive immediately after try_send.
        if self.queued_samples.fetch_update(Ordering::AcqRel, Ordering::Acquire, |queued| {
            queued.checked_add(count).filter(|next| *next <= queue_capacity)
        }).is_err() {
            self.mark_dropped(samples.len());
            return;
        }

        let payload = samples.to_vec().into_boxed_slice();
        match self.sender.try_send(RecordingCommand::Samples(payload)) {
            Ok(()) => {
                let queued = self.queued_samples.load(Ordering::Acquire);
                realtime_metrics::record_recorder_queue(queued as usize);
            }
            Err(mpsc::TrySendError::Full(_)) | Err(mpsc::TrySendError::Disconnected(_)) => {
                self.queued_samples.fetch_sub(count, Ordering::AcqRel);
                self.mark_dropped(samples.len());
            }
        }
    }

    fn mark_dropped(&self, samples: usize) {
        self.partial.store(true, Ordering::Relaxed);
        realtime_metrics::record_recorder_drop(samples);
    }

    pub(super) fn snapshot(&self, path: &Path) -> Result<Option<RecordingSnapshot>, String> {
        let (reply, result) = mpsc::sync_channel(1);
        self.sender
            .send(RecordingCommand::Snapshot {
                path: path.to_path_buf(),
                reply,
            })
            .map_err(|_| "Recording worker is unavailable".to_string())?;
        result
            .recv()
            .map_err(|_| "Recording worker stopped before exporting a snapshot".to_string())?
    }

    pub(super) fn finalize(&self, path: &Path) -> Result<Option<RecordingSnapshot>, String> {
        self.finished.get_or_init(|| self.finalize_once(path)).clone()
    }

    fn finalize_once(&self, path: &Path) -> Result<Option<RecordingSnapshot>, String> {
        let (reply, result) = mpsc::sync_channel(1);
        self.sender
            .send(RecordingCommand::Finalize {
                path: path.to_path_buf(),
                reply,
            })
            .map_err(|_| "Recording worker is unavailable".to_string())?;
        let result = result
            .recv()
            .map_err(|_| "Recording worker stopped before finalizing".to_string())?;
        self.join_worker();
        result
    }

    pub(super) fn discard(&self) {
        self.finished.get_or_init(|| {
            let (reply, result) = mpsc::sync_channel(1);
            if self.sender.send(RecordingCommand::Discard { reply }).is_ok() {
                let _ = result.recv();
            }
            self.join_worker();
            Ok(None)
        });
    }

    fn join_worker(&self) {
        if let Some(worker) = self.worker.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = worker.join();
        }
        self.queued_samples.store(0, Ordering::Relaxed);
        realtime_metrics::record_recorder_queue(0);
    }
}

impl<W: Write + Seek> RecordingWorker<W> {
    fn run(&mut self, receiver: mpsc::Receiver<RecordingCommand>) {
        while let Ok(command) = receiver.recv() {
            match command {
                RecordingCommand::Samples(samples) => {
                    self.write_samples(&samples);
                    self.queued_samples.fetch_sub(samples.len() as u64, Ordering::AcqRel);
                    realtime_metrics::record_recorder_queue(self.queued_samples.load(Ordering::Acquire) as usize);
                }
                RecordingCommand::Snapshot { path, reply } => {
                    let _ = reply.send(self.snapshot(&path));
                }
                RecordingCommand::Finalize { path, reply } => {
                    let result = self.finalize(&path);
                    let _ = reply.send(result);
                    return;
                }
                RecordingCommand::Discard { reply } => {
                    self.discard();
                    let _ = reply.send(());
                    return;
                }
            }
        }
        // Preserve the recoverable file if the owner disappears without finalizing.
        self.partial.store(true, Ordering::Relaxed);
        let _ = self.patch_and_flush();
    }

    fn write_samples(&mut self, samples: &[f32]) {
        if self.failed {
            realtime_metrics::record_recorder_drop(samples.len());
            return;
        }
        if samples.is_empty() || self.sample_count >= self.max_samples || self.writer.is_none() {
            self.notify_limit_if_needed();
            return;
        }
        let remaining = (self.max_samples - self.sample_count) as usize;
        let samples = &samples[..samples.len().min(remaining)];
        self.scratch.clear();
        self.scratch.reserve(samples.len().saturating_mul(2));
        for sample in samples {
            self.scratch
                .extend_from_slice(&sample_to_pcm16(*sample).to_le_bytes());
        }

        let write_result = self
            .writer
            .as_mut()
            .expect("writer checked above")
            .write_all(&self.scratch);
        if let Err(error) = write_result {
            self.record_error(format!("Disk write failed for live recording: {error}"));
            return;
        }

        self.sample_count = self.sample_count.saturating_add(samples.len() as u64);
        self.samples_since_flush = self.samples_since_flush.saturating_add(samples.len() as u64);
        if self.samples_since_flush >= u64::from(self.sample_rate) / 2 {
            if let Some(writer) = self.writer.as_mut() {
                if let Err(error) = writer.flush() {
                    self.record_error(format!("Disk flush failed for live recording: {error}"));
                }
            }
            self.samples_since_flush = 0;
        }
        self.notify_limit_if_needed();
    }

    fn notify_limit_if_needed(&mut self) {
        if self.limit_notified || self.sample_count < self.max_samples {
            return;
        }
        self.limit_notified = true;
        if let Some(writer) = self.writer.as_mut() {
            let _ = writer.flush();
        }
        (self.notify)("audio-recording-limit", (self.max_samples / u64::from(self.sample_rate)).into());
    }

    fn record_error(&mut self, message: String) {
        self.partial.store(true, Ordering::Relaxed);
        if !self.failed { (self.notify)("audio-recording-error", message.into()); }
        self.failed = true;
    }

    fn data_size(&self) -> Result<u32, String> {
        self.sample_count
            .checked_mul(2)
            .and_then(|size| u32::try_from(size).ok())
            .ok_or_else(|| "Recording is too large to save as WAV".to_string())
    }

    fn patch_and_flush(&mut self) -> Result<(), String> {
        if self.failed {
            return Err(format!("Recording is partial after a disk error; recovery file retained at {}", self.path.display()));
        }
        let data_size = self.data_size()?;
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| "Recording writer is unavailable".to_string())?;
        writer.flush().map_err(|error| error.to_string())?;
        patch_wav_sizes(writer.get_mut(), data_size)?;
        writer
            .get_mut()
            .seek(SeekFrom::End(0))
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn snapshot(&mut self, path: &Path) -> Result<Option<RecordingSnapshot>, String> {
        if self.sample_count == 0 {
            return Ok(None);
        }
        self.patch_and_flush()?;
        fs::copy(&self.path, path).map_err(|error| error.to_string())?;
        Ok(Some(RecordingSnapshot {
            path: path.to_path_buf(),
            sample_count: self.sample_count,
            partial: self.partial.load(Ordering::Relaxed),
        }))
    }

    fn finalize(&mut self, final_path: &Path) -> Result<Option<RecordingSnapshot>, String> {
        if self.sample_count == 0 {
            self.discard();
            return Ok(None);
        }
        self.patch_and_flush()?;
        let writer = self
            .writer
            .take()
            .ok_or_else(|| "Recording writer is unavailable".to_string())?;
        let file = writer.into_inner().map_err(|error| error.to_string())?;
        drop(file);

        if self.path != final_path {
            if final_path.exists() {
                fs::remove_file(final_path).map_err(|error| error.to_string())?;
            }
            fs::rename(&self.path, final_path)
                .or_else(|_| {
                    fs::copy(&self.path, final_path)
                        .map(|_| ())
                        .and_then(|_| fs::remove_file(&self.path))
                })
                .map_err(|error| error.to_string())?;
        }

        Ok(Some(RecordingSnapshot {
            path: final_path.to_path_buf(),
            sample_count: self.sample_count,
            partial: self.partial.load(Ordering::Relaxed),
        }))
    }

    fn discard(&mut self) {
        self.writer.take();
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    struct SlowFile {
        file: File,
        entered: mpsc::SyncSender<()>,
        resume: mpsc::Receiver<()>,
        blocked: bool,
    }

    impl Write for SlowFile {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if !self.blocked && bytes.len() > 44 {
                self.blocked = true;
                self.entered.send(()).unwrap();
                self.resume.recv().unwrap();
            }
            self.file.write(bytes)
        }
        fn flush(&mut self) -> std::io::Result<()> { self.file.flush() }
    }

    impl Seek for SlowFile {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> { self.file.seek(pos) }
    }

    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("oncue-recorder-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn slow_disk_does_not_block_capture_and_overflow_marks_partial() {
        let dir = directory();
        let path = dir.join("live.wav");
        let (entered, wait) = mpsc::sync_channel(1);
        let (resume, blocked) = mpsc::sync_channel(1);
        let file = SlowFile { file: File::create(&path).unwrap(), entered, resume: blocked, blocked: false };
        let handle = RecordingSink::start_writer(path, file, 16_000, 60, Box::new(|_, _| {})).unwrap();
        handle.try_push(&vec![0.1; 16_000]);
        wait.recv_timeout(Duration::from_secs(2)).unwrap();
        handle.try_push(&vec![0.2; 16_000]);
        handle.try_push(&vec![0.3; 160]);
        assert_eq!(handle.queued_samples.load(Ordering::Acquire), 32_000);
        assert!(handle.partial.load(Ordering::Acquire));
        resume.send(()).unwrap();
        let saved = handle.finalize(&dir.join("saved.wav")).unwrap().unwrap();
        assert!(saved.partial);
        assert_eq!(saved.sample_count, 32_000);
        assert_eq!(handle.queued_samples.load(Ordering::Acquire), 0);
        assert_eq!(handle.finalize(&dir.join("saved.wav")).unwrap().unwrap().path, saved.path);
        let bytes = fs::read(&saved.path).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize, bytes.len() - 44);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn active_snapshot_preserves_append_position_and_queue_accounting() {
        let dir = directory();
        let live = dir.join("live.wav");
        let handle = RecordingSink::start_writer(live.clone(), File::create(&live).unwrap(), 16_000, 60, Box::new(|_, _| {})).unwrap();
        for _ in 0..100 {
            handle.try_push(&[0.1; 160]);
            // A snapshot is a FIFO barrier, including a worker that consumes immediately.
            handle.snapshot(&dir.join("snapshot.wav")).unwrap();
            assert_eq!(handle.queued_samples.load(Ordering::Acquire), 0);
        }
        handle.try_push(&[0.2; 160]);
        let saved = handle.finalize(&dir.join("saved.wav")).unwrap().unwrap();
        assert!(!saved.partial);
        assert_eq!(saved.sample_count, 16_160);
        assert_eq!(fs::metadata(saved.path).unwrap().len(), 44 + 16_160 * 2);
        assert_eq!(fs::metadata(dir.join("snapshot.wav")).unwrap().len(), 44 + 16_000 * 2);
        fs::remove_dir_all(dir).unwrap();
    }
}
