export function mergeContinuationText(existing: string, continuation: string): string {
  if (!existing) return continuation
  const next = continuation.trimStart()
  if (!next) return existing
  if (next.startsWith(existing)) return next

  const maxOverlap = Math.min(400, existing.length, next.length)
  for (let overlap = maxOverlap; overlap >= 4; overlap -= 1) {
    if (existing.slice(-overlap) === next.slice(0, overlap)) {
      return existing + next.slice(overlap)
    }
  }
  return existing + next
}

function normalizedText(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function textSimilarity(left: string, right: string): number {
  const a = normalizedText(left)
  const b = normalizedText(right)
  if (!a || !b) return 0
  if (a.includes(b) || b.includes(a)) return 1

  const grams = (value: string) => {
    const result = new Set<string>()
    for (let index = 0; index < value.length - 1; index += 1) {
      result.add(value.slice(index, index + 2))
    }
    return result
  }
  const aGrams = grams(a)
  const bGrams = grams(b)
  if (aGrams.size === 0 || bGrams.size === 0) return 0

  let intersection = 0
  aGrams.forEach((gram) => {
    if (bGrams.has(gram)) intersection += 1
  })
  return (2 * intersection) / (aGrams.size + bGrams.size)
}
