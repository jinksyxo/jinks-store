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
  const [reference, setReference] = useState(() => initialParams?.get('ref') || '')
  const [email, setEmail] = useState(() => initialParams?.get('email') || '')
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const runLookup = async (lookupReference, lookupEmail) => {
    if (!lookupReference.trim() || !lookupEmail.trim()) {
      return
    }

    setStatus('loading')
    setError('')

    try {
      const payload = await trackOrder(lookupReference, lookupEmail)
      setResult(payload)
      setStatus('idle')
    } catch (lookupError) {
      setResult(null)
      setError(lookupError.message || 'That order could not be looked up right now.')
      setStatus('idle')
    }
  }

  useEffect(() => {
    if (!reference.trim() || !email.trim()) {
      return
    }

    // Defer to a microtask so the lookup's setState calls don't run
    // synchronously within the effect body itself.
    queueMicrotask(() => runLookup(reference, email))
    // Only auto-run once, from whatever the URL handed us on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = (event) => {
    event.preventDefault()
    runLookup(reference, email)
  }

  const trackingUrl = result?.found
    ? buildCarrierTrackingUrl(result.shippingCarrier, result.trackingNumber)
    : null

  return (
    <section className="featured-section shop-section page-template checkout-page">
      <div className="section-heading">
        <h2>track your order</h2>
        <p>Enter the order reference from your receipt and the email you checked out with.</p>
      </div>

      <div className={result ? 'cart-layout' : 'track-order-layout-centered'}>
        <form className="newsletter-card track-order-lookup-card" onSubmit={handleSubmit}>
          <p className="panel-label">order lookup</p>
          <div className="product-form track-order-form">
            <label className="track-order-field">
              <span>Order reference</span>
              <input
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="e.g. a1b2c3d4e5f6"
                required
              />
            </label>
            <label className="track-order-field track-order-field-email">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
          </div>
          <div className="cart-summary-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Looking up…' : 'Track order'}
            </button>
          </div>
          {error ? <p className="checkout-feedback">{error}</p> : null}
        </form>

        {result && !result.found ? (
          <aside className="newsletter-card cart-summary">
            <p className="panel-label">status</p>
            <h3>Order not found</h3>
            <p>
              We couldn&apos;t find an order with that reference and email. Double-check both, or
              wait a minute if you just checked out — new orders take a moment to appear here.
            </p>
          </aside>
        ) : null}

        {result?.found ? (
          <aside className="newsletter-card cart-summary">
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
