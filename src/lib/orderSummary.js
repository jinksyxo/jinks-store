export const FREE_SHIPPING_THRESHOLD_CENTS = 6500
export const STANDARD_SHIPPING_CENTS = 800
export const PLACEHOLDER_TAX_RATE = 0.0725

export function estimateStandardShippingCents(subtotalCents) {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : STANDARD_SHIPPING_CENTS
}

export function estimatePlaceholderTaxCents(subtotalCents) {
  return Math.round(subtotalCents * PLACEHOLDER_TAX_RATE)
}

// Estimates the cents a promo code discounts off a subtotal. This mirrors
// Stripe's own coupon math closely enough for a cart-page estimate — the
// real, authoritative discount is always applied server-side by Stripe at
// checkout.
export function estimateDiscountCents(subtotalCents, promo) {
  if (!promo) {
    return 0
  }

  if (promo.percentOff) {
    return Math.round(subtotalCents * (promo.percentOff / 100))
  }

  if (promo.amountOff) {
    return Math.min(promo.amountOff, subtotalCents)
  }

  return 0
}

export function buildEstimatedOrderSummary(
  subtotalCents,
  shippingCents = estimateStandardShippingCents(subtotalCents),
  promo = null,
) {
  // Shipping is priced off the undiscounted subtotal — that's what the
  // server does too, since shipping options are computed before discounts
  // are applied to the Stripe checkout session.
  const discountCents = estimateDiscountCents(subtotalCents, promo)
  const discountedSubtotalCents = subtotalCents - discountCents
  const taxCents = estimatePlaceholderTaxCents(discountedSubtotalCents)

  return {
    subtotalCents,
    discountCents,
    shippingCents,
    taxCents,
    totalCents: discountedSubtotalCents + shippingCents + taxCents,
  }
}
