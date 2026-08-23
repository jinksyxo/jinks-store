async function parseJsonResponse(response) {
  const rawBody = await response.text()
  let payload = {}

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = {}
    }
  }

  if (!response.ok) {
    const errorMessage =
      payload.error ||
      payload.errors?.[0] ||
      rawBody.trim() ||
      'The request could not be completed.'
    throw new Error(errorMessage)
  }

  return payload
}

export async function getStoredProducts() {
  const payload = await parseJsonResponse(await fetch('/api/products'))
  return payload.products ?? []
}

export async function getPublicShirtInventory() {
  const payload = await parseJsonResponse(await fetch('/api/store/shirt-inventory'))
  return payload.inventory
}

export async function subscribeToNewsletter(email) {
  const payload = await parseJsonResponse(
    await fetch('/api/newsletter/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    }),
  )

  return Boolean(payload.subscribed)
}

export async function createCheckoutSession(items, customerEmail, promoCode) {
  const payload = await parseJsonResponse(
    await fetch('/api/checkout/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items,
        customerEmail,
        promoCode,
      }),
    }),
  )

  return payload
}

// Validates a customer-typed promo code against Stripe's active promotion
// codes. Returns { valid: false, error } when the code doesn't exist or has
// expired, or { valid: true, code, description, percentOff, amountOff,
// currency } when it does. This is only ever an estimate for the cart page —
// the code is re-validated server-side again at checkout session creation.
export async function validatePromoCode(code) {
  const payload = await parseJsonResponse(
    await fetch('/api/promo-code/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    }),
  )

  return payload
}

export async function getCheckoutSession(sessionId) {
  const payload = await parseJsonResponse(
    await fetch(`/api/checkout/session/${encodeURIComponent(sessionId)}`),
  )

  return payload
}

// Looks up an order's fulfillment status by its reference (checkout
// reference or Stripe session id) plus the email it was placed under.
// Returns { found: false } rather than throwing when nothing matches, so a
// wrong reference/email pair reads as "not found" instead of an error.
export async function trackOrder(reference, email) {
  const payload = await parseJsonResponse(
    await fetch('/api/orders/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reference, email }),
    }),
  )

  return payload
}

export async function saveStoredProduct(product) {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(product),
    }),
  )

  return payload.product
}

export async function updateStoredProduct(productId, product) {
  const payload = await parseJsonResponse(
    await fetch(`/api/admin/products/${productId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(product),
    }),
  )

  return payload.product
}

export async function getSharedShirtInventory() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/shirt-inventory', {
      credentials: 'include',
    }),
  )

  return payload.inventory
}

export async function getStripeOrders() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/orders', {
      credentials: 'include',
    }),
  )

  return payload.orders ?? []
}

export async function getCustomerEmails() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/customer-emails', {
      credentials: 'include',
    }),
  )

  return payload.emails ?? []
}

export async function getCustomers() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/customers', {
      credentials: 'include',
    }),
  )

  return payload.customers ?? []
}

// Returns { order, shippedEmail }. shippedEmail is null unless this update
// just changed the tracking number to a new value, in which case it's
// { sent, error } describing whether the customer's shipping notification
// email went out.
export async function updateStripeOrder(orderSessionId, updates) {
  const payload = await parseJsonResponse(
    await fetch(`/api/admin/orders/${encodeURIComponent(orderSessionId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(updates),
    }),
  )

  return { order: payload.order, shippedEmail: payload.shippedEmail || null }
}

export async function updateCustomer(customerEmail, updates) {
  const payload = await parseJsonResponse(
    await fetch(`/api/admin/customers/${encodeURIComponent(customerEmail)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(updates),
    }),
  )

  return payload.customer
}

export async function getStoreBackups() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/backups', {
      credentials: 'include',
    }),
  )

  return payload.backups ?? []
}

export async function createStoreBackup() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/backups', {
      method: 'POST',
      credentials: 'include',
    }),
  )

  return payload.backup
}

export async function getShippingSpreadsheets() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/shipping-spreadsheets', {
      credentials: 'include',
    }),
  )

  return {
    spreadsheets: payload.spreadsheets ?? [],
    pendingOrderCount: payload.pendingOrderCount ?? 0,
  }
}

export async function generateShippingSpreadsheet() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/shipping-spreadsheets/generate', {
      method: 'POST',
      credentials: 'include',
    }),
  )

  return payload.result
}

// One-off maintenance pass: resizes/compresses every already-uploaded
// product image to WebP, the same way new uploads are handled
// automatically. Safe to run more than once -- images already converted
// are skipped.
export async function reprocessProductImages() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/products/reprocess-images', {
      method: 'POST',
      credentials: 'include',
    }),
  )

  return payload.result
}

export async function updateSharedShirtInventory(inventory) {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/shirt-inventory', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ inventory }),
    }),
  )

  return payload.inventory
}

export async function downloadAdminFile(url, suggestedFileName) {
  const response = await fetch(url, {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('The requested backup file could not be downloaded.')
  }

  const fileBlob = await response.blob()
  const objectUrl = window.URL.createObjectURL(fileBlob)
  const link = window.document.createElement('a')
  link.href = objectUrl
  link.download = suggestedFileName
  window.document.body.appendChild(link)
  link.click()
  window.document.body.removeChild(link)
  window.URL.revokeObjectURL(objectUrl)
}

export async function deleteStoredProduct(productId) {
  await parseJsonResponse(
    await fetch(`/api/admin/products/${productId}`, {
      method: 'DELETE',
      credentials: 'include',
    }),
  )
}

export async function loginToDevPortal(password) {
  return parseJsonResponse(
    await fetch('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ password }),
    }),
  )
}

export async function verifyDevPortalTwoFactorCode(challengeToken, code) {
  return parseJsonResponse(
    await fetch('/api/admin/login/verify-2fa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ challengeToken, code }),
    }),
  )
}

export async function logoutFromDevPortal() {
  await parseJsonResponse(
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'include',
    }),
  )
}

export async function getDevPortalSession() {
  const payload = await parseJsonResponse(
    await fetch('/api/admin/session', {
      credentials: 'include',
    }),
  )

  return Boolean(payload.authenticated)
}
