export type PaymentProduct = {
  code: 'PRO_MONTH' | 'PRO_QUARTER'
  price_minor: number
  currency: 'CNY'
  duration_days: number
  stt_ms: number
  llm_units: number
}

export const FALLBACK_PRODUCTS: PaymentProduct[] = [
  {
    code: 'PRO_MONTH',
    price_minor: 8_900,
    currency: 'CNY',
    duration_days: 30,
    stt_ms: 54_000_000,
    llm_units: 2_000_000,
  },
  {
    code: 'PRO_QUARTER',
    price_minor: 19_900,
    currency: 'CNY',
    duration_days: 90,
    stt_ms: 180_000_000,
    llm_units: 8_000_000,
  },
]

const env = (import.meta as ImportMeta & {
  readonly env?: { readonly VITE_HOSTED_GATEWAY_URL?: string; readonly DEV?: boolean }
}).env

export const gateway = (env?.DEV ? (typeof window === 'undefined' ? '' : window.location.origin) : (env?.VITE_HOSTED_GATEWAY_URL?.trim() || (typeof window === 'undefined' ? '' : window.location.origin))).replace(/\/$/, '')

export function sttMinutes(ms: number): number {
  return Math.round(Math.max(0, Number(ms) || 0) / 60_000)
}

export function formatYuan(priceMinor: number): string {
  return '¥' + Math.round(priceMinor / 100)
}

export function formatDailyYuan(priceMinor: number, days: number, lang: string): string {
  const daily = (Number(priceMinor) || 0) / 100 / Math.max(1, days)
  return new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(daily)
}

export async function fetchCatalog(): Promise<{ payments_enabled: boolean; products: PaymentProduct[] }> {
  const response = await fetch(gateway + '/account/products', { credentials: 'include' })
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw new Error('GATEWAY_UNREACHABLE')
  const body = await response.json() as { payments_enabled?: boolean; products?: PaymentProduct[] }
  const products = Array.isArray(body.products) && body.products.length ? body.products : FALLBACK_PRODUCTS
  return { payments_enabled: Boolean(body.payments_enabled), products }
}
