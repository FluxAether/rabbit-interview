export interface ResumeDiffBlock {
  type: 'same' | 'change'
  before: string
  after: string
  start: number
  end: number
}

export function computeResumeDiff(original: string, optimized: string): ResumeDiffBlock[] {
  const before = original.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const after = optimized.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const blocks: ResumeDiffBlock[] = []
  let offset = 0
  const append = (type: ResumeDiffBlock['type'], oldText: string, newText: string) => {
    const last = blocks[blocks.length - 1]
    if (last?.type === type) {
      last.before += oldText
      last.after += newText
      last.end += newText.length
    } else blocks.push({ type, before: oldText, after: newText, start: offset, end: offset + newText.length })
    offset += newText.length
  }
  // ponytail: bound quadratic line alignment; very long line lists use one exact middle block.
  if ((before.length + 1) * (after.length + 1) > 1_000_000) {
    let first = 0
    while (first < Math.min(before.length, after.length) && before[first] === after[first]) first++
    let suffix = 0
    while (suffix < Math.min(before.length, after.length) - first
      && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
    if (first) append('same', before.slice(0, first).join(''), after.slice(0, first).join(''))
    append('change', before.slice(first, before.length - suffix).join(''), after.slice(first, after.length - suffix).join(''))
    if (suffix) append('same', before.slice(-suffix).join(''), after.slice(-suffix).join(''))
    return blocks
  }
  const width = after.length + 1
  const lcs = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lcs[i * width + j] = before[i] === after[j]
        ? 1 + lcs[(i + 1) * width + j + 1]
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) append('same', before[i++], after[j++])
    else if (i < before.length && (j === after.length || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) append('change', before[i++], '')
    else append('change', '', after[j++])
  }
  return blocks
}

export function revertResumeDiff(optimized: string, block: ResumeDiffBlock): string {
  if (optimized.slice(block.start, block.end) !== block.after) throw new Error('Stale resume change')
  return optimized.slice(0, block.start) + block.before + optimized.slice(block.end)
}
