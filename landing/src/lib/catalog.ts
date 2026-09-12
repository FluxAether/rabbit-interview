import { formatCreditsDisplay } from './credits'

export const CREDIT_UNIT_SCALE = 60_000

export type PaymentProduct = {
  code: 'CREDITS_700' | 'CREDITS_2900' | 'CREDITS_3000' | 'CREDITS_11000' | 'PASS_WEEK_7D' | 'BYOK_LIFETIME'
  price_minor: number
  currency: 'CNY'
  kind: 'CREDITS' | 'BYOK'
  credit_units: number
  credit_unit_scale: number
}

export const FALLBACK_PRODUCTS: PaymentProduct[] = [
  {
    code: 'CREDITS_700',
    price_minor: 1_990,
    currency: 'CNY',
    kind: 'CREDITS',
    credit_units: 700 * CREDIT_UNIT_SCALE,
    credit_unit_scale: CREDIT_UNIT_SCALE,
  },
  {
    code: 'CREDITS_3000',
    price_minor: 7_900,
    currency: 'CNY',
    kind: 'CREDITS',
    credit_units: 3_000 * CREDIT_UNIT_SCALE,
    credit_unit_scale: CREDIT_UNIT_SCALE,
  },
  {
    code: 'CREDITS_11000',
    price_minor: 17_900,
    currency: 'CNY',
    kind: 'CREDITS',
    credit_units: 11_000 * CREDIT_UNIT_SCALE,
    credit_unit_scale: CREDIT_UNIT_SCALE,
  },
  {
    code: 'PASS_WEEK_7D',
    price_minor: 5_900,
    currency: 'CNY',
    kind: 'CREDITS',
    credit_units: 2_800 * CREDIT_UNIT_SCALE,
    credit_unit_scale: CREDIT_UNIT_SCALE,
  },
  {
    code: 'BYOK_LIFETIME',
    price_minor: 3_900,
    currency: 'CNY',
    kind: 'BYOK',
    credit_units: 0,
    credit_unit_scale: CREDIT_UNIT_SCALE,
  },
]

export function isPaymentProduct(value: unknown): value is PaymentProduct {
  const product = value as PaymentProduct | null
  return Boolean(product && (
    FALLBACK_PRODUCTS.some(item => item.code === product.code && item.kind === product.kind) ||
    product.code === 'CREDITS_2900'
  )
    && product.currency === 'CNY' && product.credit_unit_scale === CREDIT_UNIT_SCALE
    && Number.isSafeInteger(product.price_minor) && product.price_minor > 0
    && Number.isSafeInteger(product.credit_units)
    && (product.kind === 'BYOK' ? product.credit_units === 0 : product.credit_units > 0))
}

const env = (import.meta as ImportMeta & {
  readonly env?: { readonly VITE_HOSTED_GATEWAY_URL?: string; readonly DEV?: boolean }
}).env

export const gateway = (env?.DEV ? (typeof window === 'undefined' ? '' : window.location.origin) : (env?.VITE_HOSTED_GATEWAY_URL?.trim() || (typeof window === 'undefined' ? '' : window.location.origin))).replace(/\/$/, '')

export function formatCredits(units: number, scale: number, lang: string): string {
  return formatCreditsDisplay(units, scale, lang)
}

export function formatYuan(priceMinor: number): string {
  return priceMinor % 100 === 0 ? '¥' + (priceMinor / 100) : '¥' + (priceMinor / 100).toFixed(1)
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
