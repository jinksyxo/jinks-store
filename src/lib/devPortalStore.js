async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const errorMessage =
      payload.error || payload.errors?.[0] || 'The request could not be completed.'
    throw new Error(errorMessage)
  }

  return payload
}

export async function getStoredProducts() {
  const payload = await parseJsonResponse(await fetch('/api/products'))
  return payload.products ?? []
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
