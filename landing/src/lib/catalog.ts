export type PaymentProduct = {
  code: 'CREDITS_2900' | 'CREDITS_11000' | 'BYOK_LIFETIME'
  price_minor: number
  currency: 'CNY'
  kind: 'CREDITS' | 'BYOK'
  credit_units: number
  credit_unit_scale: number
}

export const FALLBACK_PRODUCTS: PaymentProduct[] = [
  {
    code: 'CREDITS_2900',
    price_minor: 8_900,
    currency: 'CNY',
    kind: 'CREDITS',
    credit_units: 2_900 * 60_000,
    credit_unit_scale: 60_000,
  },
  {
    code: 'CREDITS_11000',
    price_minor: 19_900,
    currency: 'CNY',
    kind: 'CREDITS',
    credit_units: 11_000 * 60_000,
    credit_unit_scale: 60_000,
  },
  {
    code: 'BYOK_LIFETIME',
    price_minor: 700,
    currency: 'CNY',
    kind: 'BYOK',
    credit_units: 0,
    credit_unit_scale: 60_000,
  },
]

export function isPaymentProduct(value: unknown): value is PaymentProduct {
  const product = value as PaymentProduct | null
  return Boolean(product && FALLBACK_PRODUCTS.some(item => item.code === product.code && item.kind === product.kind)
    && product.currency === 'CNY' && product.credit_unit_scale === 60_000
    && Number.isSafeInteger(product.price_minor) && product.price_minor > 0
    && Number.isSafeInteger(product.credit_units)
    && (product.kind === 'BYOK' ? product.credit_units === 0 : product.credit_units > 0))
}

const env = (import.meta as ImportMeta & {
  readonly env?: { readonly VITE_HOSTED_GATEWAY_URL?: string; readonly DEV?: boolean }
}).env

export const gateway = (env?.DEV ? (typeof window === 'undefined' ? '' : window.location.origin) : (env?.VITE_HOSTED_GATEWAY_URL?.trim() || (typeof window === 'undefined' ? '' : window.location.origin))).replace(/\/$/, '')

export function formatCredits(units: number, scale: number, lang: string): string {
  return (units / scale).toLocaleString(lang, { maximumFractionDigits: 4 })
}

export function formatYuan(priceMinor: number): string {
  return '¥' + Math.round(priceMinor / 100)
}

export async function fetchCatalog(): Promise<{ payments_enabled: boolean; products: PaymentProduct[] }> {
  const response = await fetch(gateway + '/account/products', { credentials: 'include' })
  if (!response.ok) throw new Error('GATEWAY_UNREACHABLE')
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw new Error('GATEWAY_UNREACHABLE')
  const body = await response.json() as { payments_enabled?: boolean; products?: PaymentProduct[] }
  if (!Array.isArray(body.products) || !body.products.every(isPaymentProduct)) throw new Error('GATEWAY_UNREACHABLE')
  const products = Array.isArray(body.products) && body.products.length ? body.products : FALLBACK_PRODUCTS
  return { payments_enabled: Boolean(body.payments_enabled), products }
}
