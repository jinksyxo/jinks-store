export const FREE_SHIPPING_THRESHOLD_CENTS = 6500
export const STANDARD_SHIPPING_CENTS = 800
export const PLACEHOLDER_TAX_RATE = 0.0725

export function estimateStandardShippingCents(subtotalCents) {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : STANDARD_SHIPPING_CENTS
}

export function estimatePlaceholderTaxCents(subtotalCents) {
  return Math.round(subtotalCents * PLACEHOLDER_TAX_RATE)
}

export function buildEstimatedOrderSummary(subtotalCents, shippingCents = estimateStandardShippingCents(subtotalCents)) {
  const taxCents = estimatePlaceholderTaxCents(subtotalCents)

  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
  }
}
