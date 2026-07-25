use std::collections::BTreeMap;

const SYSTEM_GAIN_WHEN_MIXED: f32 = 1.0;
const MICROPHONE_GAIN_WHEN_MIXED: f32 = 0.25;
// Dual-source alignment only needs a short holdback window. Sleep/wake backlog
// otherwise becomes an O(n log n) BTreeMap storm and multi-second silence fill.
const MAX_PENDING_SECONDS: f64 = 0.5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AudioSource {
    System,
    Microphone,
}

#[derive(Default)]
struct MixedFrame {
    system: Option<f32>,
    microphone: Option<f32>,
}

pub(crate) struct TimedAudioMixer {
    system_enabled: bool,
    microphone_enabled: bool,
    sample_rate: u32,
    first_system_frame: Option<i64>,
    first_microphone_frame: Option<i64>,
    system_progress: Option<i64>,
    microphone_progress: Option<i64>,
    next_frame: Option<i64>,
    pending: BTreeMap<i64, MixedFrame>,
}

impl TimedAudioMixer {
    pub(crate) fn new(system_enabled: bool, microphone_enabled: bool, sample_rate: u32) -> Self {
        Self {
            system_enabled,
            microphone_enabled,
            sample_rate,
            first_system_frame: None,
            first_microphone_frame: None,
            system_progress: None,
            microphone_progress: None,
            next_frame: None,
            pending: BTreeMap::new(),
        }
    }

    fn max_source_lag(&self) -> i64 {
        i64::from((self.sample_rate / 2).max(1))
    }

    fn clamp_sample(sample: f32) -> f32 {
        sample.clamp(-0.98, 0.98)
    }

    fn single_source_enabled(&self) -> Option<AudioSource> {
        match (self.system_enabled, self.microphone_enabled) {
            (true, false) => Some(AudioSource::System),
            (false, true) => Some(AudioSource::Microphone),
            _ => None,
        }
    }

    /// Mic-only / system-only never needs timed interleaving storage.
    fn push_single_source(&mut self, source: AudioSource, samples: Vec<f32>) -> Vec<f32> {
        let start_frame = self.next_frame.unwrap_or(0);
        let end_frame = start_frame.saturating_add(samples.len() as i64);
        match source {
            AudioSource::System => {
                self.first_system_frame.get_or_insert(start_frame);
                self.system_progress = Some(end_frame);
            }
            AudioSource::Microphone => {
                self.first_microphone_frame.get_or_insert(start_frame);
                self.microphone_progress = Some(end_frame);
            }
        }
        self.next_frame = Some(end_frame);
        samples.into_iter().map(Self::clamp_sample).collect()
    }

    fn drop_stale_pending(&mut self, completed_through: i64) {
        let max_pending = ((f64::from(self.sample_rate) * MAX_PENDING_SECONDS).round() as i64).max(1);
        let keep_from = completed_through.saturating_sub(max_pending);
        while self
            .pending
            .first_key_value()
            .is_some_and(|(frame, _)| *frame < keep_from)
        {
            self.pending.pop_first();
        }
    }

    pub(crate) fn push(
        &mut self,
        source: AudioSource,
        timestamp_seconds: f64,
        samples: Vec<f32>,
    ) -> Vec<f32> {
        if samples.is_empty() || !timestamp_seconds.is_finite() {
            return Vec::new();
        }

        let start_frame = (timestamp_seconds * f64::from(self.sample_rate)).round() as i64;
        let Some(end_frame) = start_frame.checked_add(samples.len() as i64) else {
            return Vec::new();
        };

        // Fast path: single-source capture never needs per-frame alignment.
        if let Some(expected) = self.single_source_enabled() {
            if source != expected {
                return Vec::new();
            }
            return self.push_single_source(source, samples);
        }
        match source {
            AudioSource::System => {
                self.first_system_frame.get_or_insert(start_frame);
                self.system_progress = Some(
                    self.system_progress
                        .map_or(end_frame, |value| value.max(end_frame)),
                );
            }
            AudioSource::Microphone => {
                self.first_microphone_frame.get_or_insert(start_frame);
                self.microphone_progress = Some(
                    self.microphone_progress
                        .map_or(end_frame, |value| value.max(end_frame)),
                );
            }
        }

        // After sleep/wake, wall-clock timestamps can jump far ahead of next_frame.
        // Skip the multi-second silence hole instead of filling millions of zeros.
        if let Some(next_frame) = self.next_frame {
            let max_gap = self.max_source_lag().saturating_mul(4).max(1);
            if start_frame.saturating_sub(next_frame) > max_gap {
                self.next_frame = Some(start_frame);
                self.pending.clear();
            }
        }

        for (offset, sample) in samples.into_iter().enumerate() {
            let frame_number = start_frame + offset as i64;
            if self.next_frame.is_some_and(|next| frame_number < next) {
                continue;
            }
            let frame = self.pending.entry(frame_number).or_default();
            match source {
                AudioSource::System => frame.system = Some(sample),
                AudioSource::Microphone => frame.microphone = Some(sample),
            }
        }

        let max_source_lag = self.max_source_lag();
        let first_frame = match (self.system_enabled, self.microphone_enabled) {
            (true, true) => match (self.first_system_frame, self.first_microphone_frame) {
                (Some(system), Some(microphone)) => system
                    .min(microphone)
                    .max(system.max(microphone).saturating_sub(max_source_lag)),
                (Some(system), None)
                    if self.system_progress.unwrap_or(system) - system >= max_source_lag =>
                {
                    system
                }
                (None, Some(microphone))
                    if self.microphone_progress.unwrap_or(microphone) - microphone
                        >= max_source_lag =>
                {
                    microphone
                }
                _ => return Vec::new(),
            },
            (true, false) => self.first_system_frame.unwrap(),
            (false, true) => self.first_microphone_frame.unwrap(),
            (false, false) => return Vec::new(),
        };
        let next_frame = *self.next_frame.get_or_insert(first_frame);

        let completed_through = match (self.system_enabled, self.microphone_enabled) {
            (true, true) => match (self.system_progress, self.microphone_progress) {
                (Some(system), Some(microphone)) => {
                    let lagged_leader = system
                        .max(microphone)
                        .saturating_sub(max_source_lag);
                    system.min(microphone).max(lagged_leader)
                }
                (Some(system), None) => system.saturating_sub(max_source_lag),
                (None, Some(microphone)) => microphone.saturating_sub(max_source_lag),
                (None, None) => return Vec::new(),
            },
            (true, false) => self.system_progress.unwrap(),
            (false, true) => self.microphone_progress.unwrap(),
            (false, false) => return Vec::new(),
        };
        if completed_through <= next_frame {
            self.drop_stale_pending(next_frame);
            return Vec::new();
        }

        let mixed = self.drain_until(completed_through);
        self.drop_stale_pending(completed_through);
        mixed
    }

    pub(crate) fn flush(&mut self) -> Vec<f32> {
        if self.next_frame.is_none() {
            self.next_frame = match (self.first_system_frame, self.first_microphone_frame) {
                (Some(system), Some(microphone)) => Some(system.min(microphone)),
                (Some(system), None) => Some(system),
                (None, Some(microphone)) => Some(microphone),
                (None, None) => None,
            };
        }
        let completed_through = match (self.system_progress, self.microphone_progress) {
            (Some(system), Some(microphone)) => system.max(microphone),
            (Some(system), None) => system,
            (None, Some(microphone)) => microphone,
            (None, None) => return Vec::new(),
        };
        self.drain_until(completed_through)
    }

    fn drain_until(&mut self, completed_through: i64) -> Vec<f32> {
        let Some(next_frame) = self.next_frame else {
            return Vec::new();
        };
        if completed_through <= next_frame {
            return Vec::new();
        }
        let mut mixed = Vec::with_capacity((completed_through - next_frame) as usize);
        for frame_number in next_frame..completed_through {
            let frame = self.pending.remove(&frame_number).unwrap_or_default();
            let sample = match (frame.system, frame.microphone) {
                (Some(system), Some(microphone)) => {
                    system * SYSTEM_GAIN_WHEN_MIXED + microphone * MICROPHONE_GAIN_WHEN_MIXED
                }
                (Some(system), None) => system,
                (None, Some(microphone)) => microphone,
                (None, None) => 0.0,
            };
            mixed.push(Self::clamp_sample(sample));
        }
        self.next_frame = Some(completed_through);
        mixed
    }
}

#[cfg(test)]
mod tests {
    use super::{AudioSource, TimedAudioMixer};

    #[test]
    fn mixes_aligned_sources_with_headroom() {
        let mut mixer = TimedAudioMixer::new(true, true, 100);
        assert!(mixer
            .push(AudioSource::System, 0.0, vec![0.8, 0.8])
            .is_empty());
        let mixed = mixer.push(AudioSource::Microphone, 0.0, vec![0.4, 0.4]);
        assert!(mixed.iter().all(|sample| (*sample - 0.9).abs() < 0.000_001));
    }

    #[test]
    fn audio_quality_preserves_microphone_contribution() {
        fn mixed_sample(microphone: f32) -> f32 {
            let mut mixer = TimedAudioMixer::new(true, true, 100);
            assert!(mixer.push(AudioSource::System, 0.0, vec![0.8]).is_empty());
            mixer.push(AudioSource::Microphone, 0.0, vec![microphone])[0]
        }

        let microphone_contribution = mixed_sample(0.2) - mixed_sample(0.0);
        assert!((microphone_contribution - 0.05).abs() < 0.000_001);
    }

    #[test]
    fn delayed_system_audio_is_not_dropped_from_an_active_mix() {
        let mut mixer = TimedAudioMixer::new(true, true, 100);
        assert!(mixer
            .push(AudioSource::System, 0.0, vec![0.5; 10])
            .is_empty());
        assert_eq!(
            mixer.push(AudioSource::Microphone, 0.0, vec![0.0; 10]),
            vec![0.5; 10]
        );

        assert!(mixer
            .push(AudioSource::Microphone, 0.1, vec![0.0; 20])
            .is_empty());
        assert_eq!(
            mixer.push(AudioSource::System, 0.1, vec![0.5; 20]),
            vec![0.5; 20]
        );
    }

    #[test]
    fn bounds_pending_audio_when_one_source_stalls() {
        let mut mixer = TimedAudioMixer::new(true, true, 100);
        assert!(mixer
            .push(AudioSource::System, 0.0, vec![0.5; 10])
            .is_empty());
        assert_eq!(
            mixer.push(AudioSource::Microphone, 0.0, vec![0.0; 10]),
            vec![0.5; 10]
        );

        let output = mixer.push(AudioSource::System, 0.1, vec![0.5; 200]);

        assert_eq!(output.len(), 150);
        assert!(mixer.pending.len() <= 50);
    }

    #[test]
    fn flushes_a_single_enabled_source() {
        let mut mixer = TimedAudioMixer::new(true, false, 10);
        let output = mixer.push(AudioSource::System, 0.0, vec![0.25, -0.25]);
        assert_eq!(output, vec![0.25, -0.25]);
        assert!(mixer.flush().is_empty());
    }

    #[test]
    fn rejects_a_timestamp_that_would_overflow_the_frame_range() {
        let mut mixer = TimedAudioMixer::new(true, false, 16_000);
        assert!(mixer
            .push(AudioSource::System, f64::MAX, vec![0.25])
            .is_empty());
    }

    #[test]
    fn skips_large_timestamp_gaps_after_sleep_wake() {
        let mut mixer = TimedAudioMixer::new(true, true, 100);
        assert!(mixer
            .push(AudioSource::System, 0.0, vec![0.5; 10])
            .is_empty());
        assert_eq!(
            mixer.push(AudioSource::Microphone, 0.0, vec![0.0; 10]),
            vec![0.5; 10]
        );

        // 30s wall-clock jump should not generate 3000 silence samples.
        let mixed = mixer.push(AudioSource::System, 30.0, vec![0.25; 10]);
        assert!(mixed.len() <= 10);
        assert!(mixer.pending.len() <= 50);
        let mixed = mixer.push(AudioSource::Microphone, 30.0, vec![0.0; 10]);
        assert_eq!(mixed.len(), 10);
        assert!(mixed.iter().all(|sample| (*sample - 0.25).abs() < 0.000_001));
    }

    #[test]
    fn single_source_ignores_timestamp_jumps() {
        let mut mixer = TimedAudioMixer::new(false, true, 16_000);
        let first = mixer.push(AudioSource::Microphone, 0.0, vec![0.1, 0.2]);
        let second = mixer.push(AudioSource::Microphone, 120.0, vec![0.3, 0.4]);
        assert_eq!(first, vec![0.1, 0.2]);
        assert_eq!(second, vec![0.3, 0.4]);
    }
}
