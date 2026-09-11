export const CREDIT_UNIT_SCALE = 60_000

export function unitsToCredits(units: number, scale = CREDIT_UNIT_SCALE): number {
  return units / scale
}

export function creditsToUnits(credits: number, scale = CREDIT_UNIT_SCALE): number {
  return Math.round(credits * scale)
}

export function formatCreditsDisplay(
  units: number,
  scale: number,
  locale: string,
  maximumFractionDigits = 4,
): string {
  return unitsToCredits(units, scale).toLocaleString(locale, { maximumFractionDigits })
}
