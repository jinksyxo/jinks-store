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

export async function createCheckoutSession(items, customerEmail) {
  const payload = await parseJsonResponse(
    await fetch('/api/checkout/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items,
        customerEmail,
      }),
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

  return payload.order
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
  await parseJsonResponse(
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
