export const MAX_LAMPS = 5;

export function recordingDuration(lamp) {
  return lamp.recording ? (lamp.recording.samples.length - 1) / lamp.recording.sampleRateHz : 0;
}

export function recordingSample(lamp) {
  if (lamp.mode !== 'recorded' || !lamp.recording) return 0;
  const { samples, sampleRateHz } = lamp.recording;
  const sample = Math.max(0, Math.min(lamp.elapsed * sampleRateHz, samples.length - 1));
  const index = Math.floor(sample);
  return samples[index] + (sample - index) * (samples[Math.min(index + 1, samples.length - 1)] - samples[index]);
}

export function advanceRecording(lamp, now) {
  if (!lamp.running || !lamp.recording) return false;
  const seconds = Math.max(0, now - lamp.lastFrame) / 1000;
  const nativeRate = lamp.source === 'fire' ? 1 : lamp.recording.nativePeakHz;
  const playbackRate = lamp.selectedFrequency === null ? 1 : lamp.selectedFrequency / nativeRate;
  lamp.elapsed = Math.min(lamp.elapsed + seconds * playbackRate, recordingDuration(lamp));
  lamp.lastFrame = now;
  if (lamp.elapsed >= recordingDuration(lamp)) lamp.running = false;
  return true;
}

export function selectRecording(lamp, index) {
  lamp.traceIndex = index;
  lamp.recording = lamp.traces[index];
  const amplitudes = lamp.recording.samples.map(Math.abs).sort((a, b) => a - b);
  const upper = amplitudes[Math.floor((amplitudes.length - 1) * 0.95)];
  lamp.traceScaleUv = Math.max(1, Math.min(lamp.previewScaleUv, upper || lamp.previewScaleUv));
}

export function installRecordings(lamp, recordings, scaleUv) {
  const fire = lamp.source === 'fire';
  if (!Number.isFinite(scaleUv) || scaleUv <= 0 ||
      !Array.isArray(recordings) || !recordings.length || recordings.some(trace =>
      !trace || typeof trace.label !== 'string' || (!fire &&
      (!Number.isFinite(trace.nativePeakHz) || trace.nativePeakHz < 0.5 || trace.nativePeakHz > 12)) ||
      !Number.isFinite(trace.sampleRateHz) || trace.sampleRateHz <= 0 ||
      !Array.isArray(trace.samples) || trace.samples.length < 2 || !trace.samples.every(Number.isFinite))) {
    throw new Error('Invalid lamp recordings');
  }
  if (lamp.traces === recordings && lamp.recording) return;
  lamp.traces = recordings;
  lamp.previewScaleUv = scaleUv;
  selectRecording(lamp, lamp.traceIndex % recordings.length);
  // Each additional source starts at another point in its selected recording.
  // Playback itself still requires the visitor to press Play for that lamp.
  lamp.elapsed = Math.min(lamp.elapsed || lamp.index * 2.37, recordingDuration(lamp));
  lamp.recordingUnavailable = false;
}
