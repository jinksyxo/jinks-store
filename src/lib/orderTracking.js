// Shared between the post-order confirmation page and the standalone
// /track-order lookup page, so a fulfillment status always reads the same
// way and a tracking number always links the same way no matter where a
// customer sees it.

export const FULFILLMENT_STATUS_LABELS = {
  unfulfilled: 'Order received',
  preparing: 'Preparing',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export function buildCarrierTrackingUrl(carrier, trackingNumber) {
  if (!trackingNumber) {
    return null
  }

  const normalizedCarrier = String(carrier || '').trim().toLowerCase()
  const encodedNumber = encodeURIComponent(trackingNumber)

  if (normalizedCarrier.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedNumber}`
  }

  if (normalizedCarrier.includes('ups')) {
    return `https://www.ups.com/track?loc=en_US&tracknum=${encodedNumber}`
  }

  if (normalizedCarrier.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodedNumber}`
  }

  if (normalizedCarrier.includes('dhl')) {
    return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodedNumber}`
  }

  return null
}
