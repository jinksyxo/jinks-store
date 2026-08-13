import { useEffect, useMemo, useState } from 'react'
import {
  createStoreBackup,
  downloadAdminFile,
  generateShippingSpreadsheet,
  getCustomers,
  getStripeOrders,
  getStoreBackups,
  getShippingSpreadsheets,
  getSharedShirtInventory,
  getDevPortalSession,
  loginToDevPortal,
  logoutFromDevPortal,
  updateCustomer,
  updateStripeOrder,
  updateSharedShirtInventory,
  verifyDevPortalTwoFactorCode,
} from '../lib/devPortalStore'

const DEV_PORTAL_PAGES = [
  { href: '/dev', label: 'upload products' },
  { href: '/dev/orders', label: 'orders' },
  { href: '/dev/customers', label: 'customers' },
  { href: '/dev/backups', label: 'store backups' },
  { href: '/dev/shipping', label: 'shipping spreadsheets' },
]

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_COUNT = 6
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024
const COLOR_OPTIONS = [
  { id: 'black', label: 'black' },
  { id: 'white', label: 'white' },
  { id: 'ash-grey', label: 'ash grey' },
]
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL']
const PRODUCT_TYPE_OPTIONS = [
  { id: 'shirt', label: 'shirt' },
  { id: 'bottoms', label: 'bottoms' },
  { id: 'merch', label: 'merch' },
]
const ORDER_FULFILLMENT_STATUS_OPTIONS = [
  { id: 'unfulfilled', label: 'unfulfilled' },
  { id: 'preparing', label: 'preparing' },
  { id: 'packed', label: 'packed' },
  { id: 'shipped', label: 'shipped' },
  { id: 'delivered', label: 'delivered' },
  { id: 'cancelled', label: 'cancelled' },
]
const ORDER_REFUND_STATUS_OPTIONS = [
  { id: 'not_refunded', label: 'not refunded' },
  { id: 'pending_review', label: 'pending review' },
  { id: 'refunded', label: 'refunded' },
]

function defaultProductTypeForCategory(category) {
  if (category === '/bottoms') {
    return 'bottoms'
  }

  if (category === '/other-merchandise') {
    return 'merch'
  }

  return 'shirt'
}

function defaultAllowedSizesForProductType(productType) {
  return productType === 'merch' ? [] : [...SIZE_OPTIONS]
}

function defaultInventoryScopeForProductType(productType) {
  return productType === 'shirt' ? 'shared-shirt' : 'untracked'
}

function createBlankInventory() {
  return COLOR_OPTIONS.reduce((inventory, color) => {
    inventory[color.id] = SIZE_OPTIONS.reduce((sizes, size) => {
      sizes[size] = ''
      return sizes
    }, {})

    return inventory
  }, {})
}

function normalizeInventoryValues(inventory) {
  return COLOR_OPTIONS.reduce((nextInventory, color) => {
    nextInventory[color.id] = SIZE_OPTIONS.reduce((sizes, size) => {
      sizes[size] = Number(inventory[color.id][size] || 0)
      return sizes
    }, {})
    return nextInventory
  }, {})
}

function formatInventoryValues(inventory) {
  return COLOR_OPTIONS.reduce((nextInventory, color) => {
    nextInventory[color.id] = SIZE_OPTIONS.reduce((sizes, size) => {
      sizes[size] = String(inventory?.[color.id]?.[size] ?? 0)
      return sizes
    }, {})
    return nextInventory
  }, {})
}

function imageUrlFromProductImage(image) {
  return typeof image === 'string' ? image : image?.url || ''
}

function normalizeImageDraft(image, index = 0) {
  const imageUrl = imageUrlFromProductImage(image)

  return {
    name: typeof image === 'string' ? `Current image ${index + 1}` : image?.name || `Current image ${index + 1}`,
    url: imageUrl,
    color: COLOR_OPTIONS.some((color) => color.id === image?.color) ? image.color : '',
    primary: Boolean(image?.primary),
    secondary: Boolean(image?.secondary),
  }
}

function normalizeImageDrafts(images) {
  const drafts = (images || []).map(normalizeImageDraft)
  const primaryIndex = drafts.findIndex((image) => image.primary)
  const resolvedPrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0
  const secondaryIndex = drafts.findIndex((image, index) => index !== resolvedPrimaryIndex && image.secondary)
  const fallbackSecondaryIndex = drafts.findIndex((_, index) => index !== resolvedPrimaryIndex)
  const resolvedSecondaryIndex =
    secondaryIndex >= 0 ? secondaryIndex : fallbackSecondaryIndex >= 0 ? fallbackSecondaryIndex : -1

  return drafts.map((image, index) => ({
    ...image,
    primary: drafts.length > 0 && index === resolvedPrimaryIndex,
    secondary: resolvedSecondaryIndex >= 0 && index === resolvedSecondaryIndex,
  }))
}

function createInitialForm(defaultCategory) {
  const productType = defaultProductTypeForCategory(defaultCategory)

  return {
    category: defaultCategory,
    slug: '',
    active: true,
    productType,
    allowedSizes: defaultAllowedSizesForProductType(productType),
    title: '',
    description: '',
    price: '',
    hasDeal: false,
    addToFeaturedCollection: false,
    addToUtahCollection: false,
    salePrice: '',
    filmInventory: '',
    colors: ['black'],
    existingImages: [],
    newImageColors: [],
    newImagePrimaryIndex: null,
    newImageSecondaryIndex: null,
    files: [],
  }
}

function createFormFromProduct(product) {
  const productType = product.productType || defaultProductTypeForCategory(product.category)

  return {
    category: product.category,
    slug: product.slug || '',
    active: product.active !== false,
    productType,
    allowedSizes: [...(product.allowedSizes || defaultAllowedSizesForProductType(productType))],
    title: product.name,
    description: product.description,
    price: String(product.price),
    hasDeal: Boolean(product.hasDeal),
    addToFeaturedCollection: Boolean(
      product.addToFeaturedCollection ?? product.addToCollection,
    ),
    addToUtahCollection: Boolean(product.addToUtahCollection),
    salePrice: product.salePrice ? String(product.salePrice) : '',
    filmInventory: String(product.filmInventory ?? 0),
    colors: [...(product.colors || ['black'])],
    existingImages: normalizeImageDrafts(product.images || []),
    newImageColors: [],
    newImagePrimaryIndex: null,
    newImageSecondaryIndex: null,
    files: [],
  }
}

function removeImageAtIndex(images, indexToRemove) {
  return images.filter((_, index) => index !== indexToRemove)
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function summarizeInventory(product) {
  const colorSummary = (product.colors || []).map((color) => color.replace('-', ' ')).join(', ')
  const scopeSummary =
    product.inventoryScope === 'shared-shirt'
      ? 'shared shirt stock'
      : 'inventory not tracked yet'
  const filmSummary =
    product.productType === 'shirt' ? `${Number(product.filmInventory || 0)} design film` : ''

  return [colorSummary || 'No colors selected', scopeSummary, filmSummary].filter(Boolean).join(' • ')
}

function formatStripeAmount(amount, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'usd').toUpperCase(),
  }).format(Number(amount || 0) / 100)
}

function formatOrderTimestamp(value) {
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

function formatBytes(value) {
  const size = Number(value || 0)

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`
  }

  return `${size} B`
}

function createOrderDraft(order) {
  return {
    fulfillmentStatus: order.fulfillmentStatus || 'unfulfilled',
    refundStatus: order.refundStatus || 'not_refunded',
    shippingCarrier: order.shippingCarrier || '',
    trackingNumber: order.trackingNumber || '',
    fulfillmentNotes: order.fulfillmentNotes || '',
  }
}

function createCustomerDraft(customer) {
  return {
    newsletterOptIn: Boolean(customer.newsletterOptIn),
    tags: Array.isArray(customer.tags) ? customer.tags.join(', ') : '',
    notes: customer.notes || '',
  }
}

function validateForm(formState, options = {}) {
  const errors = []
  const { allowExistingImages = false } = options
  const trimmedTitle = formState.title.trim()
  const trimmedDescription = formState.description.trim()
  const numericPrice = Number(formState.price)
  const numericSalePrice = Number(formState.salePrice)
  const numericFilmInventory = Number(formState.filmInventory || 0)
  const selectedFiles = formState.files
  const totalImageCount = formState.existingImages.length + selectedFiles.length
  const totalFileBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0)
  const hasExistingImages = allowExistingImages && formState.existingImages.length > 0

  if (!trimmedTitle) {
    errors.push('Enter a product title.')
  }

  if (!trimmedDescription) {
    errors.push('Enter a product description.')
  }

  if (formState.slug && !/[a-z0-9]/i.test(formState.slug)) {
    errors.push('Enter a slug with letters or numbers.')
  }

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    errors.push('Price must be greater than zero.')
  }

  if (
    !formState.active &&
    (formState.addToFeaturedCollection || formState.addToUtahCollection)
  ) {
    errors.push('Inactive products cannot be added to the collection.')
  }

  if (formState.productType !== 'merch' && !formState.allowedSizes.length) {
    errors.push('Select at least one allowed size.')
  }

  if (
    formState.productType === 'shirt' &&
    (!Number.isFinite(numericFilmInventory) ||
      numericFilmInventory < 0 ||
      !Number.isInteger(numericFilmInventory))
  ) {
    errors.push('Design film inventory must be a whole number zero or greater.')
  }

  if (formState.hasDeal) {
    if (!Number.isFinite(numericSalePrice) || numericSalePrice <= 0) {
      errors.push('Enter a valid deal price.')
    }

    if (numericSalePrice >= numericPrice) {
      errors.push('Deal price should be lower than the base price.')
    }
  }

  if (!formState.colors.length) {
    errors.push('Select at least one color.')
  }

  if (!selectedFiles.length && !hasExistingImages) {
    errors.push('Upload at least one product image.')
  }

  if (totalImageCount > MAX_IMAGE_COUNT) {
    errors.push(`Use ${MAX_IMAGE_COUNT} images or fewer.`)
  }

  if (totalFileBytes > MAX_TOTAL_IMAGE_BYTES) {
    errors.push('The combined image payload is too large.')
  }

  selectedFiles.forEach((file) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      errors.push(`${file.name} is not a supported image type.`)
    }

    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`${file.name} is larger than 6 MB.`)
    }
  })

  return errors
}

function ProductInventoryTable({ inventory, onQuantityChange }) {
  return (
    <div className="dev-inventory-wrap">
      <table className="dev-inventory-table">
        <thead>
          <tr>
            <th>Color</th>
            {SIZE_OPTIONS.map((size) => (
              <th key={size}>{size}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COLOR_OPTIONS.map((color) => (
            <tr key={color.id}>
              <th>{color.label}</th>
              {SIZE_OPTIONS.map((size) => (
                <td key={`${color.id}-${size}`}>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={inventory[color.id][size]}
                    onChange={(event) => onQuantityChange(color.id, size, event.target.value)}
                    aria-label={`${color.label} ${size} quantity`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UploadedProductList({
  categories,
  products,
  onDeleteProduct,
  onEditProduct,
  onNavigate,
}) {
  if (!products.length) {
    return (
      <div className="dev-uploaded-empty">
        <p>No uploaded products yet.</p>
      </div>
    )
  }

  return (
    <div className="dev-uploaded-list">
      {products.map((product) => (
        <article className="dev-uploaded-card" key={product.id}>
          <img
            className="dev-uploaded-thumb"
            src={imageUrlFromProductImage(product.images?.[0]) || '/tee-mockup.png'}
            alt={product.name}
          />

          <div className="dev-uploaded-copy">
            <div className="dev-uploaded-heading">
              <h3>{product.name}</h3>
              <span>
                {product.hasDeal && product.salePrice
                  ? `${formatCurrency(product.salePrice)} sale`
                  : formatCurrency(product.price)}
              </span>
            </div>
            <p className="dev-uploaded-meta">
              {categories.find((category) => category.href === product.category)?.label ??
                product.category}
            </p>
            <p>{summarizeInventory(product)}</p>
          </div>

          <div className="dev-uploaded-actions">
            <a
              className="button button-secondary"
              href={product.category}
              onClick={(event) => onNavigate(event, product.category)}
            >
              View
            </a>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onEditProduct(product)}
            >
              Edit
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                if (
                  window.confirm(
                    `Are you sure you want to delete ${product.name}? This cannot be undone.`,
                  )
                ) {
                  onDeleteProduct(product.id)
                }
              }}
            >
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

function OrdersList({ orders, onSaveOrder, savingOrderId }) {
  const [draftOverrides, setDraftOverrides] = useState({})
  const [messages, setMessages] = useState({})
  const orderDrafts = useMemo(
    () =>
      orders.reduce((nextDrafts, order) => {
        nextDrafts[order.sessionId] = {
          ...createOrderDraft(order),
          ...(draftOverrides[order.sessionId] || {}),
        }
        return nextDrafts
      }, {}),
    [draftOverrides, orders],
  )

  const updateDraftField = (sessionId, fieldName, value) => {
    setDraftOverrides((currentDrafts) => ({
      ...currentDrafts,
      [sessionId]: {
        ...(currentDrafts[sessionId] || orderDrafts[sessionId] || {}),
        [fieldName]: value,
      },
    }))
  }

  const handleSave = async (sessionId) => {
    const draft = orderDrafts[sessionId]

    if (!draft) {
      return
    }

    const didSave = await onSaveOrder(sessionId, draft)

    if (didSave) {
      setDraftOverrides((currentDrafts) => {
        const nextDrafts = { ...currentDrafts }
        delete nextDrafts[sessionId]
        return nextDrafts
      })
      setMessages((currentMessages) => ({
        ...currentMessages,
        [sessionId]: 'Fulfillment details saved.',
      }))
    }
  }

  if (!orders.length) {
    return (
      <div className="dev-uploaded-empty">
        <p>No Stripe orders yet.</p>
      </div>
    )
  }

  return (
    <div className="dev-orders-list">
      {orders.map((order) => (
        <article className="dev-order-card" key={order.sessionId}>
          {(() => {
            const draft = orderDrafts[order.sessionId]
            const isSaving = savingOrderId === order.sessionId

            return (
              <>
          <div className="dev-order-heading">
            <div>
              <p className="dev-order-status">{draft.fulfillmentStatus.replace(/_/g, ' ')}</p>
              <h3>{formatStripeAmount(order.amountTotal, order.currency)}</h3>
            </div>
            <span>{formatOrderTimestamp(order.fulfilledAt || order.updatedAt)}</span>
          </div>

          <div className="dev-order-meta">
            <p>{order.customerEmail || 'No customer email provided'}</p>
            <p>{order.paymentStatus}</p>
            <p>{draft.refundStatus.replace(/_/g, ' ')}</p>
          </div>

          <div className="dev-order-lines">
            {order.lineItems.map((item, index) => (
              <p key={`${order.sessionId}-${item.productId}-${index}`}>
                {item.productName} • {item.color} {item.size} • Qty {item.quantity}
              </p>
            ))}
          </div>

          <div className="dev-order-controls">
            <label className="dev-field">
              <span>Fulfillment status</span>
              <select
                value={draft.fulfillmentStatus}
                onChange={(event) =>
                  updateDraftField(order.sessionId, 'fulfillmentStatus', event.target.value)
                }
              >
                {ORDER_FULFILLMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dev-field">
              <span>Carrier</span>
              <input
                type="text"
                value={draft.shippingCarrier}
                onChange={(event) =>
                  updateDraftField(order.sessionId, 'shippingCarrier', event.target.value)
                }
                placeholder="USPS, UPS, DHL"
              />
            </label>

            <label className="dev-field">
              <span>Refund status</span>
              <select
                value={draft.refundStatus}
                onChange={(event) =>
                  updateDraftField(order.sessionId, 'refundStatus', event.target.value)
                }
              >
                {ORDER_REFUND_STATUS_OPTIONS.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dev-field">
              <span>Tracking number</span>
              <input
                type="text"
                value={draft.trackingNumber}
                onChange={(event) =>
                  updateDraftField(order.sessionId, 'trackingNumber', event.target.value)
                }
                placeholder="Tracking reference"
              />
            </label>

            <label className="dev-field dev-field-wide">
              <span>Fulfillment notes</span>
              <textarea
                rows="3"
                value={draft.fulfillmentNotes}
                onChange={(event) =>
                  updateDraftField(order.sessionId, 'fulfillmentNotes', event.target.value)
                }
                placeholder="Packing notes, shipment details, customer follow-up"
              />
            </label>
          </div>

          <div className="dev-order-footer">
            {messages[order.sessionId] ? (
              <p className="dev-form-success">{messages[order.sessionId]}</p>
            ) : null}
            <button
              type="button"
              className="button button-primary"
              onClick={() => handleSave(order.sessionId)}
              disabled={isSaving}
            >
              {isSaving ? 'Saving order...' : 'Save order status'}
            </button>
          </div>
              </>
            )
          })()}
        </article>
      ))}
    </div>
  )
}

function CustomersList({
  customers,
  onExport,
  isExporting,
  onSaveCustomer,
  savingCustomerEmail,
}) {
  const [draftOverrides, setDraftOverrides] = useState({})
  const [messages, setMessages] = useState({})
  const customerDrafts = useMemo(
    () =>
      customers.reduce((nextDrafts, customer) => {
        nextDrafts[customer.email] = {
          ...createCustomerDraft(customer),
          ...(draftOverrides[customer.email] || {}),
        }
        return nextDrafts
      }, {}),
    [customers, draftOverrides],
  )

  const updateDraftField = (customerEmail, fieldName, value) => {
    setDraftOverrides((currentDrafts) => ({
      ...currentDrafts,
      [customerEmail]: {
        ...(currentDrafts[customerEmail] || customerDrafts[customerEmail] || {}),
        [fieldName]: value,
      },
    }))
  }

  const handleSave = async (customerEmail) => {
    const draft = customerDrafts[customerEmail]

    if (!draft) {
      return
    }

    const didSave = await onSaveCustomer(customerEmail, {
      newsletterOptIn: Boolean(draft.newsletterOptIn),
      tags: String(draft.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      notes: String(draft.notes || ''),
    })

    if (didSave) {
      setDraftOverrides((currentDrafts) => {
        const nextDrafts = { ...currentDrafts }
        delete nextDrafts[customerEmail]
        return nextDrafts
      })
      setMessages((currentMessages) => ({
        ...currentMessages,
        [customerEmail]: 'Customer saved.',
      }))
    }
  }

  if (!customers.length) {
    return (
      <div className="dev-uploaded-empty">
        <p>No customers captured yet.</p>
      </div>
    )
  }

  return (
    <>
      <div className="dev-backup-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onExport}
          disabled={isExporting}
        >
          {isExporting ? 'Exporting emails...' : 'Download CSV'}
        </button>
      </div>

      <div className="dev-backup-list">
        {customers.map((customer) => {
          const draft = customerDrafts[customer.email]
          const isSaving = savingCustomerEmail === customer.email

          return (
            <article className="dev-order-card" key={customer.email}>
              <div className="dev-order-heading">
                <div>
                  <p className="dev-order-status">
                    {customer.newsletterOptIn ? 'newsletter opted in' : 'newsletter not opted in'}
                  </p>
                  <h3>{customer.email}</h3>
                </div>
                <span>{formatOrderTimestamp(customer.lastOrderedAt || customer.updatedAt)}</span>
              </div>

              <div className="dev-order-meta">
                <p>
                  {customer.paidOrderCount} paid order{customer.paidOrderCount === 1 ? '' : 's'}
                </p>
                <p>{formatStripeAmount(customer.totalSpent, customer.currency)}</p>
                <p>last session {customer.latestSessionId || 'unknown'}</p>
              </div>

              <div className="dev-order-controls">
                <label className="dev-toggle">
                  <input
                    type="checkbox"
                    checked={draft.newsletterOptIn}
                    onChange={(event) =>
                      updateDraftField(customer.email, 'newsletterOptIn', event.target.checked)
                    }
                  />
                  <span>Newsletter opt-in</span>
                </label>

                <label className="dev-field dev-field-wide">
                  <span>Tags</span>
                  <input
                    type="text"
                    value={draft.tags}
                    onChange={(event) =>
                      updateDraftField(customer.email, 'tags', event.target.value)
                    }
                    placeholder="vip, wholesale, repeat buyer"
                  />
                </label>

                <label className="dev-field dev-field-wide">
                  <span>Notes</span>
                  <textarea
                    rows="3"
                    value={draft.notes}
                    onChange={(event) =>
                      updateDraftField(customer.email, 'notes', event.target.value)
                    }
                    placeholder="Customer notes, sizing feedback, follow-up reminders"
                  />
                </label>
              </div>

              <div className="dev-order-footer">
                {messages[customer.email] ? (
                  <p className="dev-form-success">{messages[customer.email]}</p>
                ) : null}
                <div className="dev-backup-actions">
                  <a className="button button-secondary" href={`mailto:${customer.email}`}>
                    Email
                  </a>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => handleSave(customer.email)}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving customer...' : 'Save customer'}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}

function PasswordGate({
  password,
  onPasswordChange,
  onUnlock,
  error,
  isChecking,
  isSubmitting,
  isPasswordVisible,
  onTogglePasswordVisibility,
  twoFactorChallengeToken,
  twoFactorCode,
  onTwoFactorCodeChange,
  onVerifyTwoFactorCode,
  onCancelTwoFactor,
  twoFactorError,
  isVerifyingTwoFactorCode,
}) {
  const isTwoFactorStep = Boolean(twoFactorChallengeToken)

  return (
    <section className="notes-section route-section dev-lock">
      <div className="notes-copy">
        <p className="eyebrow">dev</p>
        <h2>product portal.</h2>
        <p>
          {isTwoFactorStep
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'This page now uses backend auth and a signed session cookie. Uploaded products and image files are stored on disk by the server.'}
        </p>
      </div>

      <div className="newsletter-card dev-lock-card">
        {isChecking ? (
          <p className="dev-session-note">Checking admin session...</p>
        ) : isTwoFactorStep ? (
          <form className="dev-lock-form" onSubmit={onVerifyTwoFactorCode}>
            <label className="dev-field">
              <span>Authentication code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={twoFactorCode}
                onChange={(event) =>
                  onTwoFactorCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                autoFocus
              />
            </label>
            {twoFactorError ? <p className="dev-form-error">{twoFactorError}</p> : null}
            <button
              className="button button-primary"
              type="submit"
              disabled={isVerifyingTwoFactorCode || twoFactorCode.length !== 6}
            >
              {isVerifyingTwoFactorCode ? 'Verifying...' : 'Verify code'}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={onCancelTwoFactor}
              disabled={isVerifyingTwoFactorCode}
            >
              Use a different password
            </button>
          </form>
        ) : (
          <form className="dev-lock-form" onSubmit={onUnlock}>
            <label className="dev-field">
              <span>Password</span>
              <div className="dev-password-row">
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="button button-secondary dev-password-toggle"
                  onClick={onTogglePasswordVisibility}
                >
                  {isPasswordVisible ? 'Hide password' : 'View password'}
                </button>
              </div>
            </label>
            {error ? <p className="dev-form-error">{error}</p> : null}
            <button className="button button-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Unlocking...' : 'Unlock dev page'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}

function DevPortalNav({ pathname, onNavigate }) {
  return (
    <div className="dev-portal-nav" aria-label="Dev portal pages">
      {DEV_PORTAL_PAGES.map((page) => (
        <a
          key={page.href}
          className={`button ${
            pathname === page.href ? 'button-primary dev-portal-nav-active' : 'button-secondary'
          }`}
          href={page.href}
          onClick={(event) => onNavigate(event, page.href)}
          aria-current={pathname === page.href ? 'page' : undefined}
        >
          {page.label}
        </a>
      ))}
    </div>
  )
}

function DevPage({
  categories,
  products,
  onSaveProduct,
  onUpdateProduct,
  onDeleteProduct,
  onNavigate,
  pathname,
  storageError,
}) {
  const defaultCategory = categories[0]?.href || '/tees'
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [twoFactorChallengeToken, setTwoFactorChallengeToken] = useState(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorError, setTwoFactorError] = useState('')
  const [isVerifyingTwoFactorCode, setIsVerifyingTwoFactorCode] = useState(false)
  const [formState, setFormState] = useState(() => createInitialForm(defaultCategory))
  const [editingProductId, setEditingProductId] = useState(null)
  const [shirtInventory, setShirtInventory] = useState(() => createBlankInventory())
  const [formErrors, setFormErrors] = useState([])
  const [saveMessage, setSaveMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [inventoryMessage, setInventoryMessage] = useState('')
  const [isInventorySaving, setIsInventorySaving] = useState(false)
  const [orders, setOrders] = useState([])
  const [ordersError, setOrdersError] = useState('')
  const [savingOrderId, setSavingOrderId] = useState('')
  const [customers, setCustomers] = useState([])
  const [customersError, setCustomersError] = useState('')
  const [savingCustomerEmail, setSavingCustomerEmail] = useState('')
  const [isExportingCustomers, setIsExportingCustomers] = useState(false)
  const [backups, setBackups] = useState([])
  const [backupError, setBackupError] = useState('')
  const [backupMessage, setBackupMessage] = useState('')
  const [isCreatingBackup, setIsCreatingBackup] = useState(false)
  const [isExportingStore, setIsExportingStore] = useState(false)
  const [shippingSpreadsheets, setShippingSpreadsheets] = useState([])
  const [pendingShippingOrderCount, setPendingShippingOrderCount] = useState(0)
  const [shippingSpreadsheetError, setShippingSpreadsheetError] = useState('')
  const [shippingSpreadsheetMessage, setShippingSpreadsheetMessage] = useState('')
  const [isGeneratingShippingSpreadsheet, setIsGeneratingShippingSpreadsheet] = useState(false)

  const newImagePreviews = useMemo(
    () =>
      formState.files.map((file, index) => ({
        name: file.name,
        url: URL.createObjectURL(file),
        color: formState.newImageColors[index] || '',
        primary: formState.newImagePrimaryIndex === index,
        secondary: formState.newImageSecondaryIndex === index,
      })),
    [formState.files, formState.newImageColors, formState.newImagePrimaryIndex, formState.newImageSecondaryIndex],
  )

  const imagePreviews = useMemo(
    () => [
      ...formState.existingImages.map((image, index) => ({
        id: `existing-${image.url}-${index}`,
        kind: 'existing',
        index,
        name: image.name || `Current image ${index + 1}`,
        url: image.url,
        color: image.color || '',
        primary: Boolean(image.primary),
        secondary: Boolean(image.secondary),
      })),
      ...newImagePreviews.map((preview, index) => ({
        ...preview,
        id: `new-${preview.url}`,
        kind: 'new',
        index,
      })),
    ],
    [formState.existingImages, newImagePreviews],
  )

  useEffect(() => {
    let isActive = true

    getDevPortalSession()
      .then((authenticated) => {
        if (!isActive) {
          return
        }

        setIsUnlocked(authenticated)
      })
      .catch(() => {
        if (!isActive) {
          return
        }

        setPasswordError('The admin session check failed. Make sure the backend server is running.')
      })
      .finally(() => {
        if (!isActive) {
          return
        }

        setIsCheckingSession(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!isUnlocked) {
      return undefined
    }

    let isActive = true

    getSharedShirtInventory()
      .then((inventory) => {
        if (!isActive) {
          return
        }

        setShirtInventory(
          COLOR_OPTIONS.reduce((nextInventory, color) => {
            nextInventory[color.id] = SIZE_OPTIONS.reduce((sizes, size) => {
              sizes[size] = String(inventory?.[color.id]?.[size] ?? 0)
              return sizes
            }, {})
            return nextInventory
          }, {}),
        )
      })
      .catch((error) => {
        if (!isActive) {
          return
        }

        setFormErrors([error.message || 'The shared shirt inventory could not be loaded.'])
      })

    return () => {
      isActive = false
    }
  }, [isUnlocked])

  useEffect(() => {
    if (!isUnlocked) {
      return undefined
    }

    let isActive = true

    getStripeOrders()
      .then((loadedOrders) => {
        if (!isActive) {
          return
        }

        setOrders(loadedOrders)
        setOrdersError('')
      })
      .catch((error) => {
        if (!isActive) {
          return
        }

        setOrdersError(error.message || 'Stripe orders could not be loaded.')
      })

    return () => {
      isActive = false
    }
  }, [isUnlocked, products])

  useEffect(() => {
    if (!isUnlocked) {
      return undefined
    }

    let isActive = true

    getCustomers()
      .then((loadedCustomers) => {
        if (!isActive) {
          return
        }

        setCustomers(loadedCustomers)
        setCustomersError('')
      })
      .catch((error) => {
        if (!isActive) {
          return
        }

        setCustomersError(error.message || 'Customers could not be loaded.')
      })

    return () => {
      isActive = false
    }
  }, [isUnlocked, orders])

  useEffect(() => {
    if (!isUnlocked) {
      return undefined
    }

    let isActive = true

    getStoreBackups()
      .then((loadedBackups) => {
        if (!isActive) {
          return
        }

        setBackups(loadedBackups)
        setBackupError('')
      })
      .catch((error) => {
        if (!isActive) {
          return
        }

        setBackupError(error.message || 'Store backups could not be loaded.')
      })

    return () => {
      isActive = false
    }
  }, [isUnlocked])

  useEffect(() => {
    if (!isUnlocked) {
      return undefined
    }

    let isActive = true

    getShippingSpreadsheets()
      .then(({ spreadsheets, pendingOrderCount }) => {
        if (!isActive) {
          return
        }

        setShippingSpreadsheets(spreadsheets)
        setPendingShippingOrderCount(pendingOrderCount)
        setShippingSpreadsheetError('')
      })
      .catch((error) => {
        if (!isActive) {
          return
        }

        setShippingSpreadsheetError(error.message || 'Shipping spreadsheets could not be loaded.')
      })

    return () => {
      isActive = false
    }
  }, [isUnlocked])

  useEffect(() => {
    return () => {
      newImagePreviews.forEach((preview) => URL.revokeObjectURL(preview.url))
    }
  }, [newImagePreviews])

  const updateField = (fieldName, nextValue) => {
    setFormState((currentState) => ({
      ...currentState,
      [fieldName]: nextValue,
    }))
  }

  const toggleColor = (colorId) => {
    setFormState((currentState) => {
      const colorExists = currentState.colors.includes(colorId)

      return {
        ...currentState,
        colors: colorExists
          ? currentState.colors.filter((color) => color !== colorId)
          : [...currentState.colors, colorId],
      }
    })
  }

  const handleInventoryQuantityChange = (color, size, value) => {
    setShirtInventory((currentInventory) => ({
      ...currentInventory,
      [color]: {
        ...currentInventory[color],
        [size]: value === '' ? '' : String(Math.max(0, Number(value))),
      },
    }))
  }

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    setFormState((currentState) => ({
      ...currentState,
      files: selectedFiles,
      newImageColors: selectedFiles.map((_, index) => currentState.newImageColors[index] || ''),
      newImagePrimaryIndex:
        currentState.existingImages.some((image) => image.primary) ||
        !selectedFiles.length
          ? null
          : 0,
      newImageSecondaryIndex:
        currentState.existingImages.some((image) => image.secondary) ||
        selectedFiles.length < 2
          ? null
          : 1,
    }))
  }

  const handleCategoryChange = (nextCategory) => {
    setFormState((currentState) => {
      const currentDefaultType = defaultProductTypeForCategory(currentState.category)
      const nextDefaultType = defaultProductTypeForCategory(nextCategory)
      const nextProductType =
        currentState.productType === currentDefaultType ? nextDefaultType : currentState.productType
      const currentDefaultSizes = defaultAllowedSizesForProductType(currentState.productType)
      const nextAllowedSizes =
        currentState.allowedSizes.join('|') === currentDefaultSizes.join('|')
          ? defaultAllowedSizesForProductType(nextProductType)
          : currentState.allowedSizes

      return {
        ...currentState,
        category: nextCategory,
        productType: nextProductType,
        allowedSizes: nextAllowedSizes,
      }
    })
  }

  const handleProductTypeChange = (nextProductType) => {
    setFormState((currentState) => {
      const currentDefaultSizes = defaultAllowedSizesForProductType(currentState.productType)
      const nextAllowedSizes =
        currentState.allowedSizes.join('|') === currentDefaultSizes.join('|') ||
        !currentState.allowedSizes.length
          ? defaultAllowedSizesForProductType(nextProductType)
          : currentState.allowedSizes

      return {
        ...currentState,
        productType: nextProductType,
        allowedSizes: nextAllowedSizes,
      }
    })
  }

  const toggleAllowedSize = (size) => {
    setFormState((currentState) => {
      const sizeExists = currentState.allowedSizes.includes(size)

      return {
        ...currentState,
        allowedSizes: sizeExists
          ? currentState.allowedSizes.filter((allowedSize) => allowedSize !== size)
          : [...currentState.allowedSizes, size],
      }
    })
  }

  const handleRemoveExistingImage = (imageIndex) => {
    setFormState((currentState) => {
      const nextExistingImages = normalizeImageDrafts(
        removeImageAtIndex(currentState.existingImages, imageIndex),
      )

      return {
        ...currentState,
        existingImages: nextExistingImages,
        newImagePrimaryIndex:
          nextExistingImages.length || !currentState.files.length
            ? currentState.newImagePrimaryIndex
            : 0,
        newImageSecondaryIndex:
          nextExistingImages.length || currentState.files.length < 2
            ? currentState.newImageSecondaryIndex
            : 1,
      }
    })
  }

  const handleRemoveNewImage = (imageIndex) => {
    setFormState((currentState) => {
      const nextFiles = removeImageAtIndex(currentState.files, imageIndex)
      const nextColors = removeImageAtIndex(currentState.newImageColors, imageIndex)
      const shiftIndex = (currentIndex) => {
        if (!Number.isInteger(currentIndex)) {
          return null
        }

        if (currentIndex === imageIndex) {
          return null
        }

        return currentIndex > imageIndex ? currentIndex - 1 : currentIndex
      }

      return {
        ...currentState,
        files: nextFiles,
        newImageColors: nextColors,
        newImagePrimaryIndex: shiftIndex(currentState.newImagePrimaryIndex),
        newImageSecondaryIndex: shiftIndex(currentState.newImageSecondaryIndex),
      }
    })
  }

  const handleImageColorChange = (imageKind, imageIndex, color) => {
    setFormState((currentState) => {
      if (imageKind === 'existing') {
        return {
          ...currentState,
          existingImages: currentState.existingImages.map((image, index) =>
            index === imageIndex ? { ...image, color } : image,
          ),
        }
      }

      return {
        ...currentState,
        newImageColors: currentState.files.map((_, index) =>
          index === imageIndex ? color : currentState.newImageColors[index] || '',
        ),
      }
    })
  }

  const handlePrimaryImageChange = (imageKind, imageIndex) => {
    setFormState((currentState) => ({
      ...currentState,
      existingImages: currentState.existingImages.map((image, index) => ({
        ...image,
        primary: imageKind === 'existing' && index === imageIndex,
      })),
      newImagePrimaryIndex: imageKind === 'new' ? imageIndex : null,
    }))
  }

  const handleSecondaryImageChange = (imageKind, imageIndex) => {
    setFormState((currentState) => ({
      ...currentState,
      existingImages: currentState.existingImages.map((image, index) => ({
        ...image,
        secondary: imageKind === 'existing' && index === imageIndex,
      })),
      newImageSecondaryIndex: imageKind === 'new' ? imageIndex : null,
    }))
  }

  const resetForm = (category = defaultCategory) => {
    setEditingProductId(null)
    setFormState(createInitialForm(category))
  }

  const handleUnlock = async (event) => {
    event.preventDefault()
    setPasswordError('')
    setIsAuthenticating(true)

    try {
      const result = await loginToDevPortal(password)

      if (result.requiresTwoFactor) {
        setTwoFactorChallengeToken(result.challengeToken)
        setTwoFactorError('')
        setTwoFactorCode('')
        setPassword('')
        return
      }

      setIsUnlocked(true)
      setPassword('')
    } catch (error) {
      setPasswordError(error.message || 'Password does not match.')
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleVerifyTwoFactorCode = async (event) => {
    event.preventDefault()
    setTwoFactorError('')
    setIsVerifyingTwoFactorCode(true)

    try {
      const result = await verifyDevPortalTwoFactorCode(twoFactorChallengeToken, twoFactorCode)

      if (result.verified) {
        setIsUnlocked(true)
        setTwoFactorChallengeToken(null)
        setTwoFactorCode('')
        return
      }

      setTwoFactorChallengeToken(result.challengeToken)
      setTwoFactorCode('')
      setTwoFactorError(
        result.attemptsRemaining > 0
          ? `${result.error} ${result.attemptsRemaining} attempt${
              result.attemptsRemaining === 1 ? '' : 's'
            } left.`
          : result.error,
      )
    } catch (error) {
      setTwoFactorChallengeToken(null)
      setTwoFactorCode('')
      setPasswordError(error.message || 'That code entry expired. Enter the password again.')
    } finally {
      setIsVerifyingTwoFactorCode(false)
    }
  }

  const handleCancelTwoFactor = () => {
    setTwoFactorChallengeToken(null)
    setTwoFactorCode('')
    setTwoFactorError('')
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)

    try {
      await logoutFromDevPortal()
    } finally {
      setIsUnlocked(false)
      setIsLoggingOut(false)
      setSaveMessage('')
      setFormErrors([])
      setTwoFactorChallengeToken(null)
      setTwoFactorCode('')
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaveMessage('')

    const validationErrors = validateForm(formState, {
      allowExistingImages: editingProductId !== null,
    })

    if (validationErrors.length) {
      setFormErrors(validationErrors)
      return
    }

    setFormErrors([])
    setIsSaving(true)

    try {
      const savedInventory = await updateSharedShirtInventory(
        normalizeInventoryValues(shirtInventory),
      )
      setShirtInventory(formatInventoryValues(savedInventory))
      setInventoryMessage('Shared shirt inventory updated.')

      const images = await Promise.all(
        formState.files.map(async (file, index) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          color: formState.newImageColors[index] || '',
          primary: formState.newImagePrimaryIndex === index,
          secondary: formState.newImageSecondaryIndex === index,
          dataUrl: await readFileAsDataUrl(file),
        })),
      )

      const payload = {
        category: formState.category,
        slug: formState.slug.trim(),
        active: formState.active,
        productType: formState.productType,
        inventoryScope: defaultInventoryScopeForProductType(formState.productType),
        allowedSizes: [...formState.allowedSizes],
        title: formState.title.trim(),
        description: formState.description.trim(),
        price: Number(formState.price),
        hasDeal: formState.hasDeal,
        addToFeaturedCollection: formState.addToFeaturedCollection,
        addToUtahCollection: formState.addToUtahCollection,
        salePrice: formState.hasDeal ? Number(formState.salePrice) : null,
        filmInventory: formState.productType === 'shirt' ? Number(formState.filmInventory || 0) : 0,
        colors: [...formState.colors],
        existingImages: formState.existingImages.map((image) => ({
          url: image.url,
          color: image.color || '',
          primary: Boolean(image.primary),
          secondary: Boolean(image.secondary),
        })),
        images,
      }

      const storedProduct =
        editingProductId !== null
          ? await onUpdateProduct(editingProductId, payload)
          : await onSaveProduct(payload)

      setSaveMessage(
        editingProductId !== null
          ? `${storedProduct.name} updated.`
          : `${storedProduct.name} saved to the site.`,
      )
      resetForm(formState.category)
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('unauthorized')) {
        setIsUnlocked(false)
        setPasswordError('Your admin session expired. Log in again.')
      } else {
        setFormErrors([error.message || 'The upload could not be saved.'])
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveInventory = async () => {
    setInventoryMessage('')
    setIsInventorySaving(true)

    try {
      const savedInventory = await updateSharedShirtInventory(
        normalizeInventoryValues(shirtInventory),
      )
      setShirtInventory(formatInventoryValues(savedInventory))
      setInventoryMessage('Shared shirt inventory updated.')
    } catch (error) {
      setFormErrors([error.message || 'The shared shirt inventory could not be saved.'])
    } finally {
      setIsInventorySaving(false)
    }
  }

  const handleDelete = async (productId) => {
    try {
      await onDeleteProduct(productId)
      if (editingProductId === productId) {
        resetForm()
      }
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('unauthorized')) {
        setIsUnlocked(false)
        setPasswordError('Your admin session expired. Log in again.')
      } else {
        setFormErrors([error.message || 'The product could not be deleted.'])
      }
    }
  }

  const handleEdit = (product) => {
    setEditingProductId(product.id)
    setSaveMessage('')
    setFormErrors([])
    setFormState(createFormFromProduct(product))
  }

  const handleSaveOrder = async (sessionId, draft) => {
    setSavingOrderId(sessionId)
    setOrdersError('')

    try {
      const updatedOrder = await updateStripeOrder(sessionId, draft)
      setOrders((currentOrders) =>
        currentOrders.map((order) => (order.sessionId === sessionId ? updatedOrder : order)),
      )
      return true
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('unauthorized')) {
        setIsUnlocked(false)
        setPasswordError('Your admin session expired. Log in again.')
      } else {
        setOrdersError(error.message || 'The order could not be updated.')
      }
      return false
    } finally {
      setSavingOrderId('')
    }
  }

  const handleExportStore = async () => {
    setIsExportingStore(true)
    setBackupError('')
    setBackupMessage('')

    try {
      await downloadAdminFile('/api/admin/store-export', `matsumoto-store-export.json`)
      setBackupMessage('Store export downloaded.')
    } catch (error) {
      setBackupError(error.message || 'Store export failed.')
    } finally {
      setIsExportingStore(false)
    }
  }

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true)
    setBackupError('')
    setBackupMessage('')

    try {
      const backup = await createStoreBackup()
      setBackups((currentBackups) => [backup, ...currentBackups])
      setBackupMessage(`${backup.fileName} created.`)
    } catch (error) {
      setBackupError(error.message || 'SQLite backup failed.')
    } finally {
      setIsCreatingBackup(false)
    }
  }

  const handleGenerateShippingSpreadsheet = async () => {
    setIsGeneratingShippingSpreadsheet(true)
    setShippingSpreadsheetError('')
    setShippingSpreadsheetMessage('')

    try {
      const result = await generateShippingSpreadsheet()

      if (!result.created) {
        setShippingSpreadsheetMessage(
          result.email?.sent
            ? 'No new paid orders to include yet. Email alert sent.'
            : `No new paid orders to include yet. Email alert was not sent${
                result.email?.error ? ` (${result.email.error})` : ''
              }.`,
        )
        return
      }

      const { spreadsheets, pendingOrderCount } = await getShippingSpreadsheets()
      setShippingSpreadsheets(spreadsheets)
      setPendingShippingOrderCount(pendingOrderCount)

      const orderNoun = result.orderCount === 1 ? 'order' : 'orders'

      if (result.email?.sent) {
        setShippingSpreadsheetMessage(
          `${result.fileName} created with ${result.orderCount} ${orderNoun}. Email alert sent.`,
        )
      } else {
        setShippingSpreadsheetMessage(
          `${result.fileName} created with ${result.orderCount} ${orderNoun}. Email alert was not sent${
            result.email?.error ? ` (${result.email.error})` : ''
          }.`,
        )
      }
    } catch (error) {
      setShippingSpreadsheetError(error.message || 'The shipping spreadsheet could not be generated.')
    } finally {
      setIsGeneratingShippingSpreadsheet(false)
    }
  }

  const handleExportCustomers = async () => {
    setIsExportingCustomers(true)
    setCustomersError('')

    try {
      await downloadAdminFile(
        '/api/admin/customers/export',
        'matsumoto-customers.csv',
      )
    } catch (error) {
      setCustomersError(error.message || 'Customer export failed.')
    } finally {
      setIsExportingCustomers(false)
    }
  }

  const handleSaveCustomer = async (customerEmail, draft) => {
    setSavingCustomerEmail(customerEmail)
    setCustomersError('')

    try {
      const updatedCustomer = await updateCustomer(customerEmail, draft)
      setCustomers((currentCustomers) =>
        currentCustomers.map((customer) =>
          customer.email === customerEmail ? updatedCustomer : customer,
        ),
      )
      return true
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('unauthorized')) {
        setIsUnlocked(false)
        setPasswordError('Your admin session expired. Log in again.')
      } else {
        setCustomersError(error.message || 'The customer could not be updated.')
      }
      return false
    } finally {
      setSavingCustomerEmail('')
    }
  }

  const isOrdersPage = pathname === '/dev/orders'
  const isCustomersPage = pathname === '/dev/customers'
  const isBackupsPage = pathname === '/dev/backups'
  const isShippingPage = pathname === '/dev/shipping'
  const isProductsPage = !isOrdersPage && !isCustomersPage && !isBackupsPage && !isShippingPage

  const pageTitle = isOrdersPage
    ? 'orders.'
    : isCustomersPage
      ? 'customers.'
      : isBackupsPage
        ? 'store backups.'
        : isShippingPage
          ? 'shipping spreadsheets.'
          : editingProductId !== null
            ? 'edit product.'
            : 'upload products.'

  const pageDescription = isOrdersPage
    ? 'Paid checkout sessions recorded by the fulfillment webhook appear here so you can review sales and update shipping progress.'
    : isCustomersPage
      ? 'Stripe checkout emails are stored as customer records with editable notes, tags, and newsletter preference.'
      : isBackupsPage
        ? 'Download a JSON snapshot of the current store or create a timestamped SQLite backup under the server data folder.'
        : isShippingPage
          ? 'A bulk-upload spreadsheet of new paid orders is generated automatically every Monday, Wednesday, and Friday morning, and emailed to jinks@matsumotoshop.com. Each order appears on exactly one spreadsheet.'
          : 'Uploads are now handled by the backend. Images are stored on disk, product data is written to a JSON store, and the admin session is kept in a signed cookie.'

  if (!isUnlocked) {
    return (
      <PasswordGate
        password={password}
        onPasswordChange={setPassword}
        onUnlock={handleUnlock}
        error={passwordError}
        isChecking={isCheckingSession}
        isSubmitting={isAuthenticating}
        isPasswordVisible={isPasswordVisible}
        onTogglePasswordVisibility={() => setIsPasswordVisible((current) => !current)}
        twoFactorChallengeToken={twoFactorChallengeToken}
        twoFactorCode={twoFactorCode}
        onTwoFactorCodeChange={setTwoFactorCode}
        onVerifyTwoFactorCode={handleVerifyTwoFactorCode}
        onCancelTwoFactor={handleCancelTwoFactor}
        twoFactorError={twoFactorError}
        isVerifyingTwoFactorCode={isVerifyingTwoFactorCode}
      />
    )
  }

  return (
    <section className="featured-section page-template dev-page">
      <div className="section-heading dev-section-heading">
        <p className="eyebrow">dev</p>
        <h2>{pageTitle}</h2>
        <p>{pageDescription}</p>
      </div>

      <div className="page-link-row dev-page-actions">
        <a
          className="button button-secondary"
          href="/"
          onClick={(event) => onNavigate(event, '/')}
        >
          Back to map
        </a>
        <button
          type="button"
          className="button button-secondary"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? 'Logging out...' : 'Log out'}
        </button>
        {isProductsPage ? <DevPortalNav pathname={pathname} onNavigate={onNavigate} /> : null}
        {isProductsPage && editingProductId !== null ? (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => resetForm(formState.category)}
          >
            Cancel edit
          </button>
        ) : null}
      </div>
      {!isProductsPage ? <DevPortalNav pathname={pathname} onNavigate={onNavigate} /> : null}

      {isOrdersPage ? (
        <div className="newsletter-card dev-orders-hero">
          <div className="dev-inventory-copy">
            <p className="panel-label">recent orders</p>
            <h3>{orders.length} Stripe order{orders.length === 1 ? '' : 's'}</h3>
            <p>
              Paid checkout sessions recorded by the fulfillment webhook appear here first
              so you can check new sales before editing the catalog.
            </p>
          </div>
          {ordersError ? <p className="dev-form-error">{ordersError}</p> : null}
          <OrdersList
            orders={orders}
            onSaveOrder={handleSaveOrder}
            savingOrderId={savingOrderId}
          />
        </div>
      ) : null}

      {isCustomersPage ? (
        <div className="newsletter-card dev-backups-hero">
          <div className="dev-inventory-copy">
            <p className="panel-label">customers</p>
            <h3>{customers.length} customer{customers.length === 1 ? '' : 's'}</h3>
            <p>
              Stripe checkout emails are now stored as customer records with editable
              notes, tags, and newsletter preference.
            </p>
          </div>
          {customersError ? <p className="dev-form-error">{customersError}</p> : null}
          <CustomersList
            customers={customers}
            onExport={handleExportCustomers}
            isExporting={isExportingCustomers}
            onSaveCustomer={handleSaveCustomer}
            savingCustomerEmail={savingCustomerEmail}
          />
        </div>
      ) : null}

      {isBackupsPage ? (
        <div className="newsletter-card dev-backups-hero">
          <div className="dev-inventory-copy">
            <p className="panel-label">store backups</p>
            <h3>Export the live SQLite store</h3>
            <p>
              Download a JSON snapshot of the current store or create a timestamped SQLite
              backup under the server data folder.
            </p>
          </div>

          <div className="dev-backup-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={handleExportStore}
              disabled={isExportingStore}
            >
              {isExportingStore ? 'Exporting store...' : 'Download JSON export'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleCreateBackup}
              disabled={isCreatingBackup}
            >
              {isCreatingBackup ? 'Creating backup...' : 'Create SQLite backup'}
            </button>
          </div>

          {backupError ? <p className="dev-form-error">{backupError}</p> : null}
          {backupMessage ? <p className="dev-form-success">{backupMessage}</p> : null}

          <div className="dev-backup-list">
            {backups.length ? (
              backups.map((backup) => (
                <div className="dev-backup-item" key={backup.fileName}>
                  <div>
                    <strong>{backup.fileName}</strong>
                    <p>
                      {formatOrderTimestamp(backup.updatedAt)} • {formatBytes(backup.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => downloadAdminFile(backup.downloadUrl, backup.fileName)}
                  >
                    Download
                  </button>
                </div>
              ))
            ) : (
              <div className="dev-uploaded-empty">
                <p>No SQLite backups created yet.</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isShippingPage ? (
        <div className="newsletter-card dev-backups-hero">
          <div className="dev-inventory-copy">
            <p className="panel-label">shipping spreadsheets</p>
            <h3>Bulk label upload files</h3>
            <p>
              A new spreadsheet generates automatically every Monday, Wednesday, and Friday
              morning with any paid orders not already on a previous spreadsheet. Use "Generate
              now" to test on demand instead of waiting for the schedule.
            </p>
            <p>
              {pendingShippingOrderCount} new paid order{pendingShippingOrderCount === 1 ? '' : 's'}{' '}
              waiting for the next spreadsheet.
            </p>
          </div>

          <div className="dev-backup-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={handleGenerateShippingSpreadsheet}
              disabled={isGeneratingShippingSpreadsheet}
            >
              {isGeneratingShippingSpreadsheet ? 'Generating...' : 'Generate now'}
            </button>
          </div>

          {shippingSpreadsheetError ? (
            <p className="dev-form-error">{shippingSpreadsheetError}</p>
          ) : null}
          {shippingSpreadsheetMessage ? (
            <p className="dev-form-success">{shippingSpreadsheetMessage}</p>
          ) : null}

          <div className="dev-backup-list">
            {shippingSpreadsheets.length ? (
              shippingSpreadsheets.map((spreadsheet) => (
                <div className="dev-backup-item" key={spreadsheet.fileName}>
                  <div>
                    <strong>{spreadsheet.fileName}</strong>
                    <p>
                      {formatOrderTimestamp(spreadsheet.createdAt)} • {spreadsheet.orderCount} order
                      {spreadsheet.orderCount === 1 ? '' : 's'} • {formatBytes(spreadsheet.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => downloadAdminFile(spreadsheet.downloadUrl, spreadsheet.fileName)}
                  >
                    Download
                  </button>
                </div>
              ))
            ) : (
              <div className="dev-uploaded-empty">
                <p>No shipping spreadsheets created yet.</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isProductsPage ? (
        <div className="dev-page-grid">
          <form className="dev-form" onSubmit={handleSubmit}>
            <div className="dev-form-grid">
              <label className="dev-field">
                <span>Category</span>
                <select
                  value={formState.category}
                  onChange={(event) => handleCategoryChange(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category.href} value={category.href}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="dev-field">
                <span>Title</span>
                <input
                  type="text"
                  value={formState.title}
                  onChange={(event) => updateField('title', event.target.value)}
                />
              </label>

              <label className="dev-field">
                <span>Slug</span>
                <input
                  type="text"
                  value={formState.slug}
                  onChange={(event) => updateField('slug', event.target.value)}
                  placeholder="auto-generated-from-title"
                />
              </label>

              <label className="dev-field">
                <span>Product type</span>
                <select
                  value={formState.productType}
                  onChange={(event) => handleProductTypeChange(event.target.value)}
                >
                  {PRODUCT_TYPE_OPTIONS.map((productType) => (
                    <option key={productType.id} value={productType.id}>
                      {productType.label}
                    </option>
                  ))}
                </select>
              </label>

              {formState.productType === 'shirt' ? (
                <label className="dev-field">
                  <span>Design film inventory</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={formState.filmInventory}
                    onChange={(event) => updateField('filmInventory', event.target.value)}
                  />
                  <small>Each tee purchase uses one film for this design.</small>
                </label>
              ) : null}

              <label className="dev-field dev-field-wide">
                <span>Description</span>
                <textarea
                  rows="5"
                  value={formState.description}
                  onChange={(event) => updateField('description', event.target.value)}
                />
              </label>

              <label className="dev-field">
                <span>Price</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={formState.price}
                  onChange={(event) => updateField('price', event.target.value)}
                />
              </label>

              <label className="dev-toggle">
                <input
                  type="checkbox"
                  checked={formState.active}
                  onChange={(event) => updateField('active', event.target.checked)}
                />
                <span>Active on storefront</span>
              </label>

              <label className="dev-toggle">
                <input
                  type="checkbox"
                  checked={formState.hasDeal}
                  onChange={(event) => updateField('hasDeal', event.target.checked)}
                />
                <span>Active deal</span>
              </label>

              <label className="dev-toggle">
                <input
                  type="checkbox"
                  checked={formState.addToFeaturedCollection}
                  onChange={(event) =>
                    updateField('addToFeaturedCollection', event.target.checked)
                  }
                />
                <span>Add to featured collection?</span>
              </label>

              <label className="dev-toggle">
                <input
                  type="checkbox"
                  checked={formState.addToUtahCollection}
                  onChange={(event) =>
                    updateField('addToUtahCollection', event.target.checked)
                  }
                />
                <span>Add to Utah local collection?</span>
              </label>

              {formState.hasDeal ? (
                <label className="dev-field">
                  <span>Deal price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={formState.salePrice}
                    onChange={(event) => updateField('salePrice', event.target.value)}
                  />
                </label>
              ) : null}

              <fieldset className="dev-fieldset dev-field-wide">
                <legend>Colors available</legend>
                <div className="dev-checkbox-list">
                  {COLOR_OPTIONS.map((color) => (
                    <label className="dev-toggle" key={color.id}>
                      <input
                        type="checkbox"
                        checked={formState.colors.includes(color.id)}
                        onChange={() => toggleColor(color.id)}
                      />
                      <span>{color.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="dev-fieldset dev-field-wide">
                <legend>Allowed sizes</legend>
                <div className="dev-checkbox-list">
                  {SIZE_OPTIONS.map((size) => (
                    <label className="dev-toggle" key={size}>
                      <input
                        type="checkbox"
                        checked={formState.allowedSizes.includes(size)}
                        disabled={formState.productType === 'merch'}
                        onChange={() => toggleAllowedSize(size)}
                      />
                      <span>{size}</span>
                    </label>
                  ))}
                </div>
                {formState.productType === 'merch' ? (
                  <small>Merch items can skip shirt sizing.</small>
                ) : formState.productType === 'shirt' ? (
                  <small>Shirt products use the shared shirt inventory table below.</small>
                ) : (
                  <small>Bottoms are currently untracked for inventory until checkout logic is added.</small>
                )}
              </fieldset>

              <label className="dev-field dev-field-wide">
                <span>Product images</span>
                <input
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  multiple
                  onChange={handleFileChange}
                />
                <small>
                  JPEG, PNG, and WebP only. Max 6 files, 6 MB each, 24 MB total.
                  {editingProductId !== null
                    ? ' Keep or remove current images below, and add new files if needed.'
                    : ''}
                </small>
              </label>
            </div>

            <div className="dev-image-preview-list">
              {imagePreviews.map((preview) => (
                <div className="dev-image-preview" key={preview.id}>
                  <img src={preview.url} alt={preview.name} />
                  <span>{preview.name}</span>
                  <label className="dev-field dev-image-color-field">
                    <span>Image color</span>
                    <select
                      value={preview.color || ''}
                      onChange={(event) =>
                        handleImageColorChange(preview.kind, preview.index, event.target.value)
                      }
                    >
                      <option value="">unassigned</option>
                      {COLOR_OPTIONS.map((color) => (
                        <option key={color.id} value={color.id}>
                          {color.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="dev-image-role-controls">
                    <label className="dev-toggle">
                      <input
                        type="radio"
                        name="primary-product-image"
                        checked={preview.primary}
                        onChange={() => handlePrimaryImageChange(preview.kind, preview.index)}
                      />
                      <span>Primary preview</span>
                    </label>
                    <label className="dev-toggle">
                      <input
                        type="radio"
                        name="secondary-product-image"
                        checked={preview.secondary}
                        onChange={() => handleSecondaryImageChange(preview.kind, preview.index)}
                      />
                      <span>Hover preview</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      preview.kind === 'existing'
                        ? handleRemoveExistingImage(preview.index)
                        : handleRemoveNewImage(preview.index)
                    }
                  >
                    Remove image
                  </button>
                </div>
              ))}
            </div>

            {formErrors.length ? (
              <div className="dev-form-errors">
                {formErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            {saveMessage ? <p className="dev-form-success">{saveMessage}</p> : null}
            {storageError ? <p className="dev-form-error">{storageError}</p> : null}

            <button className="button button-primary" type="submit" disabled={isSaving}>
              {isSaving
                ? editingProductId !== null
                  ? 'Updating product...'
                  : 'Saving product...'
                : editingProductId !== null
                  ? 'Update product'
                  : 'Save product'}
            </button>
          </form>

          <aside className="dev-sidebar">
            <div className="newsletter-card dev-sidebar-card">
              <p className="panel-label">current uploads</p>
              <h3>{products.length} saved product{products.length === 1 ? '' : 's'}</h3>
              <p>
                Uploaded products are now shared by the backend, so they persist outside
                this browser and can be revisited after reload.
              </p>
            </div>

            <div className="newsletter-card dev-sidebar-card">
              <div className="dev-inventory-section">
                <div className="dev-inventory-copy">
                  <p className="panel-label">shirt inventory</p>
                  <h3>Universal color and size stock</h3>
                  <p>
                    This stock counter is shared across shirts globally and is no longer
                    tied to individual product listings.
                  </p>
                </div>
                <ProductInventoryTable
                  inventory={shirtInventory}
                  onQuantityChange={handleInventoryQuantityChange}
                />
                {inventoryMessage ? <p className="dev-form-success">{inventoryMessage}</p> : null}
                <button
                  type="button"
                  className="button button-primary"
                  onClick={handleSaveInventory}
                  disabled={isInventorySaving}
                >
                  {isInventorySaving ? 'Saving inventory...' : 'Save shirt inventory'}
                </button>
              </div>
            </div>

            <UploadedProductList
              categories={categories}
              products={products}
              onDeleteProduct={handleDelete}
              onEditProduct={handleEdit}
              onNavigate={onNavigate}
            />
          </aside>
        </div>
      ) : null}
    </section>
  )
}

export default DevPage
