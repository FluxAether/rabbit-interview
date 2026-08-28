export function waveformSampleLevel(
  index: number,
  count: number,
  amplitude: number,
  active: boolean,
): number {
  const position = count > 1 ? index / (count - 1) : 0.5
  const distanceFromPeak = Math.abs(position - 0.52)
  const envelope = Math.max(0, 1 - distanceFromPeak / 0.52)
  const texture = 0.34
    + Math.abs(Math.sin(index * 1.37)) * 0.38
    + Math.abs(Math.cos(index * 0.53 + 0.8)) * 0.28
  const signal = active ? Math.sqrt(Math.max(0, Math.min(1, amplitude))) : 0
  const energy = active ? 0.08 + signal * 0.92 : 0.025

  return Math.max(0, Math.min(1, Math.pow(envelope, 1.9) * texture * energy))
}
