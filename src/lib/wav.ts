// Pure WAV (PCM16 mono) builder extracted from Stealth Copilot export logic.
// Shipped code uses this; tests drive the real implementation with floating data + rate.
export function chunksToWavBuffer(chunks: number[][], sampleRate: number): ArrayBuffer {
  // Flatten
  const flatLength = chunks.reduce((sum, arr) => sum + arr.length, 0)
  const flat = new Float32Array(flatLength)
  let offset = 0
  for (const chunk of chunks) {
    flat.set(chunk, offset)
    offset += chunk.length
  }

  const numChannels = 1
  const bytesPerSample = 2

  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = flat.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // fmt
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)

  // data
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // PCM16 samples
  let pos = 44
  for (let i = 0; i < flat.length; i++) {
    const s = Math.max(-1, Math.min(1, flat[i]))
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    pos += 2
  }

  return buffer
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

// Helper to inspect rate from a WAV buffer (for tests)
export function readWavSampleRate(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  return view.getUint32(24, true)
}
