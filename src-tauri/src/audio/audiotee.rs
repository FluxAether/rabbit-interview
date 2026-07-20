use std::io::Read;

pub(crate) const AUDIOTEE_SAMPLE_RATE: u32 = 16_000;
const AUDIOTEE_COMMIT: &str = "56ac954369a09318e46b88a6eec33c2d2b0d32a3";

#[derive(Default)]
pub(crate) struct Pcm16LeDecoder {
    pending_byte: Option<u8>,
}

impl Pcm16LeDecoder {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Vec<f32> {
        let mut input = Vec::with_capacity(bytes.len() + usize::from(self.pending_byte.is_some()));
        if let Some(byte) = self.pending_byte.take() {
            input.push(byte);
        }
        input.extend_from_slice(bytes);

        if input.len() % 2 == 1 {
            self.pending_byte = input.pop();
        }

        input
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0)
            .collect()
    }
}

pub(crate) fn integration_version() -> &'static str {
    AUDIOTEE_COMMIT
}

#[cfg(target_os = "macos")]
fn macos_supports_core_audio_taps() -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
        .map_err(|error| format!("Unable to determine macOS version: {error}"))?;
    if !output.status.success() {
        return Err("Unable to determine macOS version".into());
    }
    let version = String::from_utf8_lossy(&output.stdout);
    if parse_macos_version(&version)
        .is_some_and(|(major, minor)| major > 14 || (major == 14 && minor >= 2))
    {
        Ok(())
    } else {
        Err("System audio requires macOS 14.2 or later; microphone-only mode is available".into())
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn system_audio_support() -> Result<(), String> {
    macos_supports_core_audio_taps()?;
    resolve_audiotee_path().map(|_| ())
}

fn parse_macos_version(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.trim().split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next().unwrap_or("0").parse().ok()?,
    ))
}

#[cfg(target_os = "macos")]
fn resolve_audiotee_path() -> Result<std::path::PathBuf, String> {
    if let Some(path) = std::env::var_os("RABBIT_AUDIOTEE_PATH") {
        let path = std::path::PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "RABBIT_AUDIOTEE_PATH does not point to a file: {}",
            path.display()
        ));
    }

    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            let bundled = directory.join("audiotee");
            if bundled.is_file() {
                return Ok(bundled);
            }
        }
    }

    let target_name = if cfg!(target_arch = "aarch64") {
        "audiotee-aarch64-apple-darwin"
    } else {
        "audiotee-x86_64-apple-darwin"
    };
    let development = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(target_name);
    if development.is_file() {
        return Ok(development);
    }

    Err(format!(
        "AudioTee sidecar is missing. Run npm run prepare:audiotee (pinned commit {AUDIOTEE_COMMIT})"
    ))
}

#[cfg(target_os = "macos")]
pub(crate) struct AudioTeeProcess {
    child: std::process::Child,
    stdout_thread: Option<std::thread::JoinHandle<()>>,
    stderr_thread: Option<std::thread::JoinHandle<()>>,
    monitor_thread: Option<std::thread::JoinHandle<()>>,
    stopping: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(target_os = "macos")]
impl AudioTeeProcess {
    pub(crate) fn spawn<Chunk, Error>(on_chunk: Chunk, on_error: Error) -> Result<Self, String>
    where
        Chunk: Fn(Vec<f32>) + Send + 'static,
        Error: Fn(String) + Send + Sync + 'static,
    {
        macos_supports_core_audio_taps()?;
        Self::spawn_at_path(resolve_audiotee_path()?, on_chunk, on_error)
    }

    fn spawn_at_path<Chunk, Error>(
        path: std::path::PathBuf,
        on_chunk: Chunk,
        on_error: Error,
    ) -> Result<Self, String>
    where
        Chunk: Fn(Vec<f32>) + Send + 'static,
        Error: Fn(String) + Send + Sync + 'static,
    {
        use std::process::{Command, Stdio};
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use std::time::Duration;

        let mut child = Command::new(path)
            .args(["--sample-rate", "16000", "--chunk-duration", "0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Unable to launch AudioTee: {error}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or("AudioTee stdout pipe is unavailable")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("AudioTee stderr pipe is unavailable")?;
        let stopping = Arc::new(AtomicBool::new(false));
        let stdout_stopping = Arc::clone(&stopping);
        let first_pcm = Arc::new(AtomicBool::new(false));
        let stdout_first_pcm = Arc::clone(&first_pcm);
        let on_error: Arc<dyn Fn(String) + Send + Sync> = Arc::new(on_error);
        let stdout_error = Arc::clone(&on_error);

        let stdout_thread = std::thread::spawn(move || {
            let mut reader = stdout;
            let mut decoder = Pcm16LeDecoder::default();
            let mut buffer = [0_u8; 8 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        if !stdout_stopping.load(Ordering::SeqCst) {
                            stdout_error(if stdout_first_pcm.load(Ordering::SeqCst) {
                                "AudioTee exited unexpectedly".into()
                            } else {
                                "AudioTee exited before producing PCM audio".into()
                            });
                        }
                        break;
                    }
                    Ok(length) => {
                        let samples = decoder.push(&buffer[..length]);
                        if !samples.is_empty() {
                            stdout_first_pcm.store(true, Ordering::SeqCst);
                            on_chunk(samples);
                        }
                    }
                    Err(error) => {
                        let message = format!("Unable to read AudioTee PCM stream: {error}");
                        if !stdout_stopping.load(Ordering::SeqCst) {
                            stdout_error(message);
                        }
                        break;
                    }
                }
            }
        });

        let stderr_thread = std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[AudioTee] {line}");
            }
        });

        let monitor_stopping = Arc::clone(&stopping);
        let monitor_first_pcm = Arc::clone(&first_pcm);
        let monitor_error = Arc::clone(&on_error);
        let monitor_thread = std::thread::spawn(move || {
            for _ in 0..450 {
                if monitor_stopping.load(Ordering::SeqCst)
                    || monitor_first_pcm.load(Ordering::SeqCst)
                {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if !monitor_stopping.load(Ordering::SeqCst) {
                monitor_error(
                    "AudioTee produced no PCM within 45 seconds; check System Audio Recording permission"
                        .into(),
                );
            }
        });

        let startup_deadline = std::time::Instant::now() + Duration::from_millis(500);
        let startup_status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None)
                    if first_pcm.load(Ordering::SeqCst)
                        || std::time::Instant::now() >= startup_deadline =>
                {
                    break None;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(error) => {
                    stopping.store(true, Ordering::SeqCst);
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    let _ = monitor_thread.join();
                    return Err(format!("Unable to inspect AudioTee process: {error}"));
                }
            }
        };
        if let Some(status) = startup_status {
            stopping.store(true, Ordering::SeqCst);
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            let _ = monitor_thread.join();
            return Err(format!("AudioTee exited during startup with {status}"));
        }

        Ok(Self {
            child,
            stdout_thread: Some(stdout_thread),
            stderr_thread: Some(stderr_thread),
            monitor_thread: Some(monitor_thread),
            stopping,
        })
    }

    pub(crate) fn stop(mut self) {
        use std::sync::atomic::Ordering;
        self.stopping.store(true, Ordering::SeqCst);
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(thread) = self.stdout_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.stderr_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.monitor_thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_macos_version, Pcm16LeDecoder};

    #[test]
    fn pcm16_decoder_preserves_an_odd_tail_byte() {
        let mut decoder = Pcm16LeDecoder::default();
        assert!(decoder.push(&[0x00]).is_empty());
        let samples = decoder.push(&[0x80, 0xff, 0x7f]);
        assert_eq!(samples, vec![-1.0, 32767.0 / 32768.0]);
    }

    #[test]
    fn pcm16_decoder_handles_arbitrary_read_boundaries() {
        let mut decoder = Pcm16LeDecoder::default();
        let mut samples = decoder.push(&[0x00, 0x00, 0x00]);
        samples.extend(decoder.push(&[0x40, 0x00, 0xc0]));
        assert_eq!(samples, vec![0.0, 0.5, -0.5]);
    }

    #[test]
    fn parses_macos_versions_for_capability_checks() {
        assert_eq!(parse_macos_version("14.2.1\n"), Some((14, 2)));
        assert_eq!(parse_macos_version("15.0"), Some((15, 0)));
        assert_eq!(parse_macos_version("invalid"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reports_a_sidecar_that_exits_during_startup() {
        let result = super::AudioTeeProcess::spawn_at_path("/usr/bin/false".into(), |_| {}, |_| {});
        assert!(result.is_err());
    }
}
