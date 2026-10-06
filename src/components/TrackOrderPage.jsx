import { useEffect, useState } from 'react'
import { trackOrder } from '../lib/devPortalStore'
import { buildCarrierTrackingUrl, FULFILLMENT_STATUS_LABELS } from '../lib/orderTracking'

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function formatDateTime(value) {
  if (!value) {
    return 'Unknown time'
  }

  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    return 'Unknown time'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp)
}

function formatAddress(shippingDetails) {
  const address = shippingDetails?.address

  if (!address) {
    return ''
  }

  return [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
    .filter(Boolean)
    .join(', ')
}

export default function TrackOrderPage({ onNavigate }) {
  const initialParams =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
  const reference = initialParams?.get('ref') || ''
  const email = initialParams?.get('email') || ''
  const [status, setStatus] = useState(reference.trim() && email.trim() ? 'loading' : 'missing')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!reference.trim() || !email.trim()) {
      return
    }

    let cancelled = false

    trackOrder(reference, email)
      .then((payload) => {
        if (cancelled) return
        setResult(payload)
        setStatus('idle')
      })
      .catch((lookupError) => {
        if (cancelled) return
        setResult(null)
        setError(lookupError.message || 'That order could not be looked up right now.')
        setStatus('idle')
      })

    return () => {
      cancelled = true
    }
    // Only ever looks up the reference/email the page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const trackingUrl = result?.found
    ? buildCarrierTrackingUrl(result.shippingCarrier, result.trackingNumber)
    : null

  return (
    <section className="featured-section shop-section page-template checkout-page">
      <div className="section-heading">
        <h2>track your order</h2>
      </div>

      <div className="track-order-layout-centered">
        {status === 'missing' ? (
          <aside className="newsletter-card cart-summary track-order-result-card">
            <p className="panel-label">status</p>
            <h3>No order to show</h3>
            <p>
              This page only works from the link in your order confirmation or shipping emails.
            </p>
          </aside>
        ) : null}

        {status === 'loading' ? (
          <aside className="newsletter-card cart-summary track-order-result-card">
            <p className="panel-label">status</p>
            <h3>Looking up your order…</h3>
          </aside>
        ) : null}

        {error ? (
          <aside className="newsletter-card cart-summary track-order-result-card">
            <p className="panel-label">status</p>
            <h3>Order not found</h3>
            <p>{error}</p>
          </aside>
        ) : null}

        {result && !result.found ? (
          <aside className="newsletter-card cart-summary track-order-result-card">
            <p className="panel-label">status</p>
            <h3>Order not found</h3>
            <p>
              We couldn&apos;t find an order with that reference and email. Wait a minute if you
              just checked out — new orders take a moment to appear here.
            </p>
          </aside>
        ) : null}

        {result?.found ? (
          <aside className="newsletter-card cart-summary track-order-result-card">
            <p className="panel-label">status</p>
            <h3>{FULFILLMENT_STATUS_LABELS[result.fulfillmentStatus] || 'Order received'}</h3>

            <div className="order-summary-breakdown">
              <div className="order-summary-row">
                <span>Reference</span>
                <strong>{result.reference}</strong>
              </div>
              <div className="order-summary-row">
                <span>Placed</span>
                <strong>{formatDateTime(result.createdAt)}</strong>
              </div>
              {result.shippingCarrier ? (
                <div className="order-summary-row">
                  <span>Carrier</span>
                  <strong>{result.shippingCarrier}</strong>
                </div>
              ) : null}
              {result.trackingNumber ? (
                <div className="order-summary-row">
                  <span>Tracking number</span>
                  <strong>
                    {trackingUrl ? (
                      <a href={trackingUrl} target="_blank" rel="noreferrer">
                        {result.trackingNumber}
                      </a>
                    ) : (
                      result.trackingNumber
                    )}
                  </strong>
                </div>
              ) : null}
              {formatAddress(result.shippingDetails) ? (
                <div className="order-summary-row">
                  <span>Ship to</span>
                  <strong>{formatAddress(result.shippingDetails)}</strong>
                </div>
              ) : null}
            </div>

            {result.lineItems?.length ? (
              <div className="order-summary-breakdown">
                {result.lineItems.map((item, index) => (
                  <div className="order-summary-row" key={`${item.productId}-${index}`}>
                    <span>
                      {item.productName}
                      {[item.color, item.size].filter(Boolean).length
                        ? ` (${[item.color, item.size].filter(Boolean).join(', ')})`
                        : ''}{' '}
                      <span className="checkout-line-item-quantity">x {item.quantity}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="order-summary-breakdown">
              <div className="order-summary-row">
                <span>Subtotal</span>
                <strong>{formatCurrency((result.amountSubtotal || 0) / 100)}</strong>
              </div>
              <div className="order-summary-row">
                <span>Shipping</span>
                <strong>{formatCurrency((result.amountShipping || 0) / 100)}</strong>
              </div>
              <div className="order-summary-row">
                <span>Tax</span>
                <strong>{formatCurrency((result.amountTax || 0) / 100)}</strong>
              </div>
              <div className="order-summary-row order-summary-row-total">
                <span>Total</span>
                <strong>{formatCurrency((result.amountTotal || 0) / 100)}</strong>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <div className="page-link-row checkout-page-actions">
        <a className="button button-secondary" href="/" onClick={(event) => onNavigate(event, '/')}>
          Return to map
        </a>
      </div>
    </section>
  )
}
