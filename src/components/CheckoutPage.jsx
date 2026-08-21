import { useEffect, useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  BillingAddressElement,
  CheckoutElementsProvider,
  ContactDetailsElement,
  PaymentElement,
  ShippingAddressElement,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout'
import { createCheckoutSession, getCheckoutSession } from '../lib/devPortalStore'
import { estimateStandardShippingCents } from '../lib/orderSummary'

function buildCheckoutItems(cart) {
  return cart.map((item) => ({
    productId: item.productId,
    color: item.color || '',
    size: item.size || '',
    quantity: item.quantity,
  }))
}

function cartSubtotal(cart) {
  return cart.reduce((sum, item) => {
    const unitPrice = item.hasDeal && item.salePrice ? item.salePrice : item.price
    return sum + unitPrice * item.quantity
  }, 0)
}

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
    hour: 'numeric',
    minute: '2-digit',
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

function getMissingAddressFields(addressValue) {
  const address = addressValue?.address || {}
  const missingFields = []

  if (!String(addressValue?.name || '').trim()) {
    missingFields.push('full name')
  }

  if (!String(address.line1 || '').trim()) {
    missingFields.push('address line 1')
  }

  if (!String(address.city || '').trim()) {
    missingFields.push('city')
  }

  if (!String(address.state || '').trim()) {
    missingFields.push('state')
  }

  if (!String(address.postal_code || '').trim()) {
    missingFields.push('zip code')
  }

  return missingFields
}

function CheckoutStatus({ title, message, onNavigate, actions = null, eyebrow = 'checkout', summary = null }) {
  return (
    <section className="notes-section route-section checkout-page">
      <div className="notes-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="page-link-row checkout-page-actions">
          {actions || (
            <>
              <a
                className="button button-secondary"
                href="/cart"
                onClick={(event) => onNavigate(event, '/cart')}
              >
                Back to cart
              </a>
              <a
                className="button button-primary"
                href="/tees"
                onClick={(event) => onNavigate(event, '/tees')}
              >
                Browse tees
              </a>
            </>
          )}
        </div>
      </div>

      <div className="newsletter-card checkout-status-card">
        <p className="panel-label">status</p>
        <p>{message}</p>
        {summary ? (
          <div className="checkout-status-summary">
            {summary.map((item) => (
              <p key={item.label}>
                <strong>{item.label}:</strong> {item.value}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function CheckoutElementsForm({ onNavigate, onPaymentComplete, subtotal }) {
  const checkoutState = useCheckoutElements()
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [isBillingSameAsShipping, setIsBillingSameAsShipping] = useState(true)
  const [addressValues, setAddressValues] = useState({
    shipping: null,
    billing: null,
  })
  const [sectionStatus, setSectionStatus] = useState({
    contact: { empty: true, complete: false },
    shipping: { empty: true, complete: false },
    billing: { empty: true, complete: false },
    payment: { empty: true, complete: false },
  })

  if (checkoutState.type === 'loading') {
    return (
      <div className="checkout-elements-loading">
        <p>Loading checkout…</p>
      </div>
    )
  }

  if (checkoutState.type === 'error') {
    return (
      <div className="checkout-elements-loading">
        <p>{checkoutState.error.message}</p>
      </div>
    )
  }

  const { checkout } = checkoutState
  const missingShippingFields = getMissingAddressFields(addressValues.shipping)
  const missingBillingFields = getMissingAddressFields(addressValues.billing)
  const subtotalCents = Number(checkout.total?.subtotal?.minorUnitsAmount || 0)
  const discountCents = Number(checkout.total?.discount?.minorUnitsAmount || 0)
  const selectedShippingCents =
    Number(checkout.shipping?.shippingOption?.minorUnitsAmount || 0) ||
    estimateStandardShippingCents(subtotalCents)
  const taxCents = Number(
    checkout.total?.taxExclusive?.minorUnitsAmount || checkout.total?.taxInclusive?.minorUnitsAmount || 0,
  )
  const totalCents =
    Number(checkout.total?.total?.minorUnitsAmount || 0) ||
    subtotalCents + selectedShippingCents + taxCents
  const shippingLabel =
    checkout.shipping?.shippingOption?.displayName ||
    (selectedShippingCents === 0 ? 'Free domestic shipping' : 'Standard shipping')
  const sectionErrors = {
    contact: 'Enter an email address to continue.',
    shipping:
      missingShippingFields.length > 0
        ? `Shipping is missing: ${missingShippingFields.join(', ')}.`
        : 'Enter a full shipping address to continue.',
    billing:
      missingBillingFields.length > 0
        ? `Billing is missing: ${missingBillingFields.join(', ')}.`
        : 'Enter a full billing address to continue.',
    payment: 'Enter payment details to continue.',
  }
  const incompleteSections = Object.entries(sectionStatus)
    .filter(([sectionName, section]) => {
      if (sectionName === 'billing' && isBillingSameAsShipping) {
        return false
      }

      if (sectionName === 'shipping') {
        return missingShippingFields.length > 0 || !section.complete
      }

      if (sectionName === 'billing') {
        return missingBillingFields.length > 0 || !section.complete
      }

      return !section.complete
    })
    .map(([sectionName]) => sectionName)
  const showSectionErrors = hasAttemptedSubmit && incompleteSections.length > 0
  const hasIncompleteSection = (sectionName) => incompleteSections.includes(sectionName)

  const updateSectionStatus = (sectionName, event) => {
    setSectionStatus((currentStatus) => ({
      ...currentStatus,
      [sectionName]: {
        empty: Boolean(event.empty),
        complete: Boolean(event.complete),
      },
    }))

    if (sectionName === 'shipping' || sectionName === 'billing') {
      setAddressValues((currentValues) => ({
        ...currentValues,
        [sectionName]: event.value || null,
      }))
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    setSubmitError('')

    if (incompleteSections.length > 0) {
      setSubmitError('Complete the highlighted checkout sections before paying.')
      return
    }

    setIsSubmitting(true)

    try {
      // When "billing is the same as shipping" is checked, the Billing
      // Address Element never mounts, so Stripe has no billing address to
      // confirm with unless we hand it the shipping address explicitly.
      const confirmArgs = { redirect: 'if_required' }

      if (isBillingSameAsShipping && addressValues.shipping) {
        confirmArgs.billingAddress = addressValues.shipping
      }

      const result = await checkout.confirm(confirmArgs)

      if (result.type === 'error') {
        setSubmitError(result.error.message || 'Payment could not be completed.')
        return
      }

      if (result.session.status.type === 'complete') {
        onPaymentComplete(result.session)
        return
      }

      setSubmitError('Additional payment steps are still in progress. Follow any prompts to finish.')
    } catch (error) {
      console.error('checkout.confirm failed', error)
      setSubmitError('Payment could not be completed. Check your connection and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="checkout-elements-layout">
      <div className="checkout-main-column">
        <div className="checkout-shell-header">
          <div>
            <p className="panel-label">cart subtotal</p>
            <h3>{formatCurrency(subtotal)}</h3>
          </div>
          <a
            className="button button-secondary"
            href="/cart"
            onClick={(event) => onNavigate(event, '/cart')}
          >
            Back to cart
          </a>
        </div>

        <form className="checkout-form-panel" onSubmit={handleSubmit}>
          <div className="checkout-element-stack">
          <div className="checkout-element-block">
            <div className="checkout-element-heading">
              <p className="panel-label">contact</p>
              {showSectionErrors && hasIncompleteSection('contact') ? (
                <p className="checkout-element-error">{sectionErrors.contact}</p>
              ) : null}
            </div>
            <div className="checkout-element-frame">
              <ContactDetailsElement onChange={(event) => updateSectionStatus('contact', event)} />
            </div>
          </div>

          <div className="checkout-element-block">
            <div className="checkout-element-heading">
              <p className="panel-label">shipping</p>
              {showSectionErrors && hasIncompleteSection('shipping') ? (
                <p className="checkout-element-error">{sectionErrors.shipping}</p>
              ) : null}
            </div>
            <div className="checkout-element-frame">
              <ShippingAddressElement
                onChange={(event) => updateSectionStatus('shipping', event)}
                options={{
                  display: {
                    name: 'full',
                  },
                }}
              />
            </div>
            <label className="checkout-address-toggle">
              <input
                type="checkbox"
                checked={isBillingSameAsShipping}
                onChange={(event) => setIsBillingSameAsShipping(event.target.checked)}
              />
              <span>billing address is the same as shipping address</span>
            </label>
          </div>

          {!isBillingSameAsShipping ? (
            <div className="checkout-element-block">
              <div className="checkout-element-heading">
                <p className="panel-label">billing</p>
                {showSectionErrors && hasIncompleteSection('billing') ? (
                  <p className="checkout-element-error">{sectionErrors.billing}</p>
                ) : null}
                <span>Full billing address for payment verification and invoicing</span>
              </div>
              <div className="checkout-element-frame">
                <BillingAddressElement
                  onChange={(event) => updateSectionStatus('billing', event)}
                  options={{
                    display: {
                      name: 'full',
                    },
                  }}
                />
              </div>
            </div>
          ) : null}

          <div className="checkout-element-block">
            <div className="checkout-element-heading">
              <p className="panel-label">payment</p>
              {showSectionErrors && hasIncompleteSection('payment') ? (
                <p className="checkout-element-error">{sectionErrors.payment}</p>
              ) : null}
            </div>
            <div className="checkout-element-frame">
              <PaymentElement
                onChange={(event) => updateSectionStatus('payment', event)}
                options={{
                  layout: 'tabs',
                }}
              />
            </div>
          </div>
        </div>

          {submitError ? <p className="checkout-feedback">{submitError}</p> : null}

          <div className="checkout-submit-row">
            <button
              className="button button-primary checkout-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing…' : 'Pay now'}
            </button>
          </div>
        </form>
      </div>

      <aside className="newsletter-card checkout-summary-panel">
        <p className="panel-label">order summary</p>
        <div className="checkout-summary-total">
          <strong>{formatCurrency(totalCents / 100)}</strong>
          <span>{checkout.lineItems.length} item{checkout.lineItems.length === 1 ? '' : 's'}</span>
        </div>
        <div className="checkout-line-items">
          {checkout.lineItems.map((item) => (
            <div className="checkout-line-item" key={item.id}>
              <div>
                <strong>
                  {item.name} <span className="checkout-line-item-quantity">x {item.quantity}</span>
                </strong>
              </div>
              <span>{item.total.amount}</span>
            </div>
          ))}
        </div>
        <div className="order-summary-breakdown">
          <div className="order-summary-row">
            <span>Subtotal</span>
            <strong>{formatCurrency(subtotalCents / 100)}</strong>
          </div>
          {discountCents > 0 ? (
            <div className="order-summary-row order-summary-row-discount">
              <span>Discount</span>
              <strong>-{formatCurrency(discountCents / 100)}</strong>
            </div>
          ) : null}
          <div className="order-summary-row">
            <span>{shippingLabel}</span>
            <strong>{formatCurrency(selectedShippingCents / 100)}</strong>
          </div>
          <div className="order-summary-row">
            <span>Tax</span>
            <strong>{formatCurrency(taxCents / 100)}</strong>
          </div>
          <div className="order-summary-row order-summary-row-total">
            <span>Total</span>
            <strong>{formatCurrency(totalCents / 100)}</strong>
          </div>
        </div>
      </aside>
    </div>
  )
}

function CheckoutReturnPage({ onNavigate, onCheckoutComplete }) {
  const [sessionState, setSessionState] = useState({
    requestKey: '',
    session: null,
    error: '',
  })
  const onCheckoutCompleteRef = useRef(onCheckoutComplete)
  const hasCompletedRef = useRef(false)
  const sessionId =
    typeof window === 'undefined'
      ? ''
      : new URLSearchParams(window.location.search).get('session_id') || ''
  const requestKey = sessionId || '__missing__'
  const resolvedState = sessionState.requestKey === requestKey ? sessionState : null
  const session = resolvedState?.session || null
  const error = !sessionId
    ? 'A Stripe session id was not found in the return URL.'
    : resolvedState?.error || ''
  const isLoading = Boolean(sessionId) && !error && !session
  const [currentTimestamp] = useState(() => Date.now())

  useEffect(() => {
    onCheckoutCompleteRef.current = onCheckoutComplete
  }, [onCheckoutComplete])

  useEffect(() => {
    if (!sessionId) {
      return
    }

    let isActive = true

    getCheckoutSession(sessionId)
      .then((loadedSession) => {
        if (!isActive) {
          return
        }

        setSessionState({
          requestKey,
          session: loadedSession,
          error: '',
        })

        const isPaid =
          loadedSession.status === 'complete' &&
          (loadedSession.paymentStatus === 'paid' ||
            loadedSession.paymentStatus === 'no_payment_required')

        if (isPaid && !hasCompletedRef.current) {
          hasCompletedRef.current = true
          onCheckoutCompleteRef.current?.()
        }
      })
      .catch((sessionError) => {
        if (!isActive) {
          return
        }

        setSessionState({
          requestKey,
          session: null,
          error: sessionError.message || 'Checkout status could not be loaded.',
        })
      })

    return () => {
      isActive = false
    }
  }, [requestKey, sessionId])

  if (isLoading) {
    return (
      <CheckoutStatus
        title="checking payment status."
        message="Stripe is loading the final state of this checkout session."
        onNavigate={onNavigate}
        eyebrow="return"
      />
    )
  }

  if (error || !session) {
    return (
      <CheckoutStatus
        title="checkout state unavailable."
        message={error || 'Stripe did not return a valid checkout session.'}
        onNavigate={onNavigate}
        eyebrow="return"
      />
    )
  }

  const summary = [
    { label: 'Session', value: session.sessionId },
    { label: 'Total', value: formatCurrency((session.amountTotal || 0) / 100) },
    { label: 'Shipping', value: formatCurrency((session.amountShipping || 0) / 100) },
    { label: 'Tax', value: formatCurrency((session.amountTax || 0) / 100) },
  ]

  if (session.shippingMethod) {
    summary.push({ label: 'Method', value: session.shippingMethod })
  }

  if (session.shippingDetails?.name) {
    summary.push({ label: 'Ship to', value: session.shippingDetails.name })
  }

  const formattedAddress = formatAddress(session.shippingDetails)
  if (formattedAddress) {
    summary.push({ label: 'Address', value: formattedAddress })
  }

  const isPaid =
    session.status === 'complete' &&
    (session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required')

  if (session.orderStatus === 'inventory_shortfall') {
    return (
      <CheckoutStatus
        title="payment received, stock needs review."
        message="The payment succeeded, but inventory changed before fulfillment completed. Follow up from the dev portal and contact the customer before shipping."
        onNavigate={onNavigate}
        eyebrow="review"
        summary={summary}
        actions={
          <>
            <a
              className="button button-primary"
              href="/dev"
              onClick={(event) => onNavigate(event, '/dev')}
            >
              Open dev portal
            </a>
            <a
              className="button button-secondary"
              href="/"
              onClick={(event) => onNavigate(event, '/')}
            >
              Return to map
            </a>
          </>
        }
      />
    )
  }

  if (isPaid) {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/checkout/return')
    }

    return (
      <CheckoutStatus
        title="payment received."
        message="The order is in. Stripe now has the shipping address, tax details, and the email destination for the paid receipt and invoice."
        onNavigate={onNavigate}
        eyebrow="confirmed"
        summary={summary}
        actions={
          <>
            <a
              className="button button-primary"
              href="/tees"
              onClick={(event) => onNavigate(event, '/tees')}
            >
              Continue shopping
            </a>
            <a
              className="button button-secondary"
              href="/"
              onClick={(event) => onNavigate(event, '/')}
            >
              Return to map
            </a>
          </>
        }
      />
    )
  }

  if (session.orderStatus === 'payment_failed') {
    return (
      <CheckoutStatus
        title="payment failed."
        message="The payment was not completed. Return to the live checkout form and try the payment method again or start a fresh checkout."
        onNavigate={onNavigate}
        eyebrow="retry"
        summary={summary}
        actions={
          <>
            <a
              className="button button-primary"
              href={`/checkout?resume_session_id=${encodeURIComponent(session.sessionId)}`}
              onClick={(event) =>
                onNavigate(
                  event,
                  `/checkout?resume_session_id=${encodeURIComponent(session.sessionId)}`,
                )
              }
            >
              Resume checkout
            </a>
            <a
              className="button button-secondary"
              href="/cart"
              onClick={(event) => onNavigate(event, '/cart')}
            >
              Back to cart
            </a>
          </>
        }
      />
    )
  }

  const hasExpired =
    session.status === 'expired' || (session.expiresAt && session.expiresAt <= currentTimestamp)

  if (hasExpired) {
    return (
      <CheckoutStatus
        title="checkout expired."
        message="This Stripe session is no longer open. Return to the cart and start a new checkout."
        onNavigate={onNavigate}
        eyebrow="expired"
        summary={[
          ...summary,
          { label: 'Expired', value: formatDateTime(session.expiresAt) },
        ]}
        actions={
          <>
            <a
              className="button button-primary"
              href="/cart"
              onClick={(event) => onNavigate(event, '/cart')}
            >
              Back to cart
            </a>
            <a
              className="button button-secondary"
              href="/checkout"
              onClick={(event) => onNavigate(event, '/checkout')}
            >
              Start new checkout
            </a>
          </>
        }
      />
    )
  }

  return (
    <CheckoutStatus
      title="checkout still open."
      message="The payment session is still active. Resume the same Stripe checkout to finish payment, shipping selection, and tax calculation."
      onNavigate={onNavigate}
      eyebrow="open"
      summary={summary}
      actions={
        <>
          <a
            className="button button-primary"
            href={`/checkout?resume_session_id=${encodeURIComponent(session.sessionId)}`}
            onClick={(event) =>
              onNavigate(event, `/checkout?resume_session_id=${encodeURIComponent(session.sessionId)}`)
            }
          >
            Resume checkout
          </a>
          <a
            className="button button-secondary"
            href="/cart"
            onClick={(event) => onNavigate(event, '/cart')}
          >
            Back to cart
          </a>
        </>
      }
    />
  )
}

export default function CheckoutPage({ cart, onNavigate, onCheckoutComplete, mode = 'live', promoCode }) {
  const [checkoutState, setCheckoutState] = useState({
    requestKey: '',
    session: null,
    error: '',
  })
  const [completion, setCompletion] = useState(null)
  const onCheckoutCompleteRef = useRef(onCheckoutComplete)
  const hasCompletedRef = useRef(false)
  const subtotal = cartSubtotal(cart)
  const resumeSessionId =
    typeof window === 'undefined'
      ? ''
      : new URLSearchParams(window.location.search).get('resume_session_id') ||
        new URLSearchParams(window.location.search).get('session_id') ||
        ''
  const checkoutItems = buildCheckoutItems(cart)
  const checkoutItemsKey = JSON.stringify(checkoutItems)
  const requestKey =
    mode !== 'live' || completion
      ? ''
      : resumeSessionId
        ? `resume:${resumeSessionId}`
        : cart.length
          ? `new:${checkoutItemsKey}:${promoCode?.code || ''}`
          : ''
  const resolvedCheckoutState = checkoutState.requestKey === requestKey ? checkoutState : null
  const checkoutSession = resolvedCheckoutState?.session || null
  const error = resolvedCheckoutState?.error || ''
  const isPreparing = Boolean(requestKey) && !error && !checkoutSession
  const stripePromise = checkoutSession?.publishableKey
    ? loadStripe(checkoutSession.publishableKey)
    : null

  useEffect(() => {
    onCheckoutCompleteRef.current = onCheckoutComplete
  }, [onCheckoutComplete])

  useEffect(() => {
    if (mode !== 'live' || !resumeSessionId) {
      return
    }

    let isActive = true

    getCheckoutSession(resumeSessionId)
      .then((session) => {
        if (!isActive) {
          return
        }

        const isPaid =
          session.status === 'complete' &&
          (session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required')

        if (isPaid) {
          setCompletion(session)

          if (!hasCompletedRef.current) {
            hasCompletedRef.current = true
            onCheckoutCompleteRef.current?.()
          }

          window.history.replaceState({}, '', '/checkout')
          return
        }

        if (session.status !== 'open' || !session.clientSecret || !session.publishableKey) {
          setCheckoutState({
            requestKey,
            session: null,
            error: 'This checkout session can no longer be resumed. Return to the cart and start again.',
          })
          return
        }

        setCheckoutState({
          requestKey,
          session: {
            sessionId: session.sessionId,
            clientSecret: session.clientSecret,
            publishableKey: session.publishableKey,
          },
          error: '',
        })
      })
      .catch((sessionError) => {
        if (!isActive) {
          return
        }

        setCheckoutState({
          requestKey,
          session: null,
          error: sessionError.message || 'Checkout status could not be loaded.',
        })
      })

    return () => {
      isActive = false
    }
  }, [mode, requestKey, resumeSessionId])

  useEffect(() => {
    if (mode !== 'live' || !cart.length || resumeSessionId || completion) {
      return
    }

    const items = JSON.parse(checkoutItemsKey)
    let isActive = true

    createCheckoutSession(items, undefined, promoCode?.code)
      .then((session) => {
        if (!isActive) {
          return
        }

        setCheckoutState({
          requestKey,
          session,
          error: '',
        })
      })
      .catch((checkoutError) => {
        if (!isActive) {
          return
        }

        setCheckoutState({
          requestKey,
          session: null,
          error: checkoutError.message || 'Checkout could not be initialized.',
        })
      })

    return () => {
      isActive = false
    }
  }, [cart.length, checkoutItemsKey, completion, mode, promoCode, requestKey, resumeSessionId])

  const handlePaymentComplete = (session) => {
    setCompletion({
      sessionId: session.id,
      status: session.status.type,
      paymentStatus: session.status.type === 'complete' ? session.status.paymentStatus : null,
      customerEmail: session.email,
    })

    if (!hasCompletedRef.current) {
      hasCompletedRef.current = true
      onCheckoutCompleteRef.current?.()
    }

    window.history.replaceState({}, '', '/checkout')
  }

  if (mode === 'return') {
    return <CheckoutReturnPage onNavigate={onNavigate} onCheckoutComplete={onCheckoutComplete} />
  }

  if (completion) {
    return (
      <CheckoutStatus
        title="payment received."
        message="The order is in. Stripe has the final shipping, tax, and receipt details for this session."
        onNavigate={onNavigate}
        eyebrow="confirmed"
        actions={
          <>
            <a
              className="button button-primary"
              href="/tees"
              onClick={(event) => onNavigate(event, '/tees')}
            >
              Continue shopping
            </a>
            <a
              className="button button-secondary"
              href="/checkout/return"
              onClick={(event) => onNavigate(event, '/checkout/return')}
            >
              View return page
            </a>
          </>
        }
      />
    )
  }

  if (!cart.length && !resumeSessionId) {
    return (
      <CheckoutStatus
        title="your cart is empty."
        message="Add a product before opening the payment form."
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <section className="featured-section shop-section page-template checkout-live-page">
      <div className="section-heading checkout-heading">
        <h2>checkout</h2>
      </div>

      <div className="checkout-shell">
        {isPreparing ? (
          <div className="checkout-elements-loading">
            <p>Preparing Checkout...</p>
          </div>
        ) : null}

        {error ? <p className="checkout-feedback">{error}</p> : null}

        {!isPreparing && !error && checkoutSession?.clientSecret && stripePromise ? (
          <CheckoutElementsProvider
            key={checkoutSession.clientSecret}
            stripe={stripePromise}
            options={{
              clientSecret: checkoutSession.clientSecret,
              elementsOptions: {
                syncAddressCheckbox: 'none',
                appearance: {
                  theme: 'stripe',
                  variables: {
                    colorPrimary: '#003bd1',
                    colorText: '#111111',
                    colorBackground: '#ffffff',
                    colorDanger: '#e30b5c',
                    fontFamily: 'Instrument Serif, serif',
                    borderRadius: '0px',
                  },
                },
              },
            }}
          >
            <CheckoutElementsForm
              onNavigate={onNavigate}
              onPaymentComplete={handlePaymentComplete}
              subtotal={subtotal}
            />
          </CheckoutElementsProvider>
        ) : null}
      </div>
    </section>
  )
}
