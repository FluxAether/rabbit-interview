use std::collections::BTreeMap;

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
        let end_frame = start_frame + samples.len() as i64;
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

        let max_source_lag = i64::from((self.sample_rate / 10).max(1));
        let first_frame = match (self.system_enabled, self.microphone_enabled) {
            (true, true) => match (self.first_system_frame, self.first_microphone_frame) {
                (Some(system), Some(microphone)) => system.min(microphone),
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
                (Some(system), Some(microphone)) => system
                    .min(microphone)
                    .max(system.max(microphone).saturating_sub(max_source_lag)),
                (Some(system), None) => system.saturating_sub(max_source_lag),
                (None, Some(microphone)) => microphone.saturating_sub(max_source_lag),
                (None, None) => return Vec::new(),
            },
            (true, false) => self.system_progress.unwrap(),
            (false, true) => self.microphone_progress.unwrap(),
            (false, false) => return Vec::new(),
        };
        if completed_through <= next_frame {
            return Vec::new();
        }

        self.drain_until(completed_through)
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
                (Some(system), Some(microphone)) => (system + microphone) * 0.5,
                (Some(system), None) => system,
                (None, Some(microphone)) => microphone,
                (None, None) => 0.0,
            };
            mixed.push(sample.clamp(-0.98, 0.98));
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
        assert_eq!(mixed, vec![0.6, 0.6]);
    }

    #[test]
    fn flushes_a_single_enabled_source() {
        let mut mixer = TimedAudioMixer::new(true, false, 10);
        let output = mixer.push(AudioSource::System, 0.0, vec![0.25, -0.25]);
        assert_eq!(output, vec![0.25, -0.25]);
        assert!(mixer.flush().is_empty());
    }
}
