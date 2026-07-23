import { useEffect, useMemo, useState } from 'react'
import {
  getDevPortalSession,
  loginToDevPortal,
  logoutFromDevPortal,
} from '../lib/devPortalStore'

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_COUNT = 6
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024
const COLOR_OPTIONS = [
  { id: 'black', label: 'black' },
  { id: 'white', label: 'white' },
  { id: 'ash-grey', label: 'ash grey' },
]
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL']

function createBlankInventory() {
  return COLOR_OPTIONS.reduce((inventory, color) => {
    inventory[color.id] = SIZE_OPTIONS.reduce((sizes, size) => {
      sizes[size] = ''
      return sizes
    }, {})

    return inventory
  }, {})
}

function createInitialForm(defaultCategory) {
  return {
    category: defaultCategory,
    title: '',
    description: '',
    price: '',
    hasDeal: false,
    salePrice: '',
    colors: ['black'],
    inventory: createBlankInventory(),
    files: [],
  }
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
  const totalUnits = Object.values(product.inventory ?? {}).reduce((sum, sizes) => {
    const sizeCount = Object.values(sizes ?? {}).reduce(
      (sizeSum, quantity) => sizeSum + Number(quantity || 0),
      0,
    )

    return sum + sizeCount
  }, 0)

  return `${colorSummary} · ${totalUnits} units`
}

function validateForm(formState) {
  const errors = []
  const trimmedTitle = formState.title.trim()
  const trimmedDescription = formState.description.trim()
  const numericPrice = Number(formState.price)
  const numericSalePrice = Number(formState.salePrice)
  const selectedFiles = formState.files
  const totalFileBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0)
  const hasInventory = formState.colors.some((color) =>
    SIZE_OPTIONS.some((size) => Number(formState.inventory[color][size] || 0) > 0),
  )

  if (!trimmedTitle) {
    errors.push('Enter a product title.')
  }

  if (!trimmedDescription) {
    errors.push('Enter a product description.')
  }

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    errors.push('Price must be greater than zero.')
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

  if (!hasInventory) {
    errors.push('Add at least one quantity greater than zero in the inventory grid.')
  }

  if (!selectedFiles.length) {
    errors.push('Upload at least one product image.')
  }

  if (selectedFiles.length > MAX_IMAGE_COUNT) {
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
      errors.push(`${file.name} is larger than 2.5 MB.`)
    }
  })

  return errors
}

function ProductInventoryTable({ colors, inventory, onQuantityChange }) {
  if (!colors.length) {
    return <p className="dev-inventory-empty">Select a color to unlock the inventory grid.</p>
  }

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
          {colors.map((color) => (
            <tr key={color}>
              <th>{COLOR_OPTIONS.find((option) => option.id === color)?.label ?? color}</th>
              {SIZE_OPTIONS.map((size) => (
                <td key={`${color}-${size}`}>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={inventory[color][size]}
                    onChange={(event) => onQuantityChange(color, size, event.target.value)}
                    aria-label={`${color} ${size} quantity`}
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

function UploadedProductList({ categories, products, onDeleteProduct, onNavigate }) {
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
            src={product.images?.[0] || '/tee-mockup.png'}
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
              onClick={() => {
                if (window.confirm(`Delete ${product.name}?`)) {
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

function PasswordGate({ password, onPasswordChange, onUnlock, error, isChecking, isSubmitting }) {
  return (
    <section className="notes-section route-section dev-lock">
      <div className="notes-copy">
        <p className="eyebrow">dev</p>
        <h2>product portal.</h2>
        <p>
          This page now uses backend auth and a signed session cookie. Uploaded
          products and image files are stored on disk by the server.
        </p>
      </div>

      <div className="newsletter-card dev-lock-card">
        {isChecking ? (
          <p className="dev-session-note">Checking admin session...</p>
        ) : (
          <form className="dev-lock-form" onSubmit={onUnlock}>
            <label className="dev-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                autoComplete="current-password"
              />
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

function DevPage({
  categories,
  products,
  onSaveProduct,
  onDeleteProduct,
  onNavigate,
  storageError,
}) {
  const defaultCategory = categories[0]?.href || '/tees'
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [formState, setFormState] = useState(() => createInitialForm(defaultCategory))
  const [formErrors, setFormErrors] = useState([])
  const [saveMessage, setSaveMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const imagePreviews = useMemo(
    () =>
      formState.files.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [formState.files],
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
    return () => {
      imagePreviews.forEach((preview) => URL.revokeObjectURL(preview.url))
    }
  }, [imagePreviews])

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

  const handleQuantityChange = (color, size, value) => {
    setFormState((currentState) => ({
      ...currentState,
      inventory: {
        ...currentState.inventory,
        [color]: {
          ...currentState.inventory[color],
          [size]: value === '' ? '' : String(Math.max(0, Number(value))),
        },
      },
    }))
  }

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    updateField('files', selectedFiles)
  }

  const handleUnlock = async (event) => {
    event.preventDefault()
    setPasswordError('')
    setIsAuthenticating(true)

    try {
      await loginToDevPortal(password)
      setIsUnlocked(true)
      setPassword('')
    } catch (error) {
      setPasswordError(error.message || 'Password does not match.')
    } finally {
      setIsAuthenticating(false)
    }
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
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaveMessage('')

    const validationErrors = validateForm(formState)

    if (validationErrors.length) {
      setFormErrors(validationErrors)
      return
    }

    setFormErrors([])
    setIsSaving(true)

    try {
      const images = await Promise.all(
        formState.files.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        })),
      )

      const storedProduct = await onSaveProduct({
        category: formState.category,
        title: formState.title.trim(),
        description: formState.description.trim(),
        price: Number(formState.price),
        hasDeal: formState.hasDeal,
        salePrice: formState.hasDeal ? Number(formState.salePrice) : null,
        colors: [...formState.colors],
        inventory: formState.inventory,
        images,
      })

      setSaveMessage(`${storedProduct.name} saved to the site.`)
      setFormState(createInitialForm(formState.category))
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

  const handleDelete = async (productId) => {
    try {
      await onDeleteProduct(productId)
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('unauthorized')) {
        setIsUnlocked(false)
        setPasswordError('Your admin session expired. Log in again.')
      } else {
        setFormErrors([error.message || 'The product could not be deleted.'])
      }
    }
  }

  if (!isUnlocked) {
    return (
      <PasswordGate
        password={password}
        onPasswordChange={setPassword}
        onUnlock={handleUnlock}
        error={passwordError}
        isChecking={isCheckingSession}
        isSubmitting={isAuthenticating}
      />
    )
  }

  return (
    <section className="featured-section page-template dev-page">
      <div className="section-heading dev-section-heading">
        <p className="eyebrow">dev</p>
        <h2>upload products.</h2>
        <p>
          Uploads are now handled by the backend. Images are stored on disk, product
          data is written to a JSON store, and the admin session is kept in a signed
          cookie.
        </p>
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
      </div>

      <div className="dev-page-grid">
        <form className="dev-form" onSubmit={handleSubmit}>
          <div className="dev-form-grid">
            <label className="dev-field">
              <span>Category</span>
              <select
                value={formState.category}
                onChange={(event) => updateField('category', event.target.value)}
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
                checked={formState.hasDeal}
                onChange={(event) => updateField('hasDeal', event.target.checked)}
              />
              <span>Active deal</span>
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

            <label className="dev-field dev-field-wide">
              <span>Product images</span>
              <input
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                multiple
                onChange={handleFileChange}
              />
              <small>JPEG, PNG, and WebP only. Max 6 files, 2.5 MB each, 10 MB total.</small>
            </label>
          </div>

          <div className="dev-image-preview-list">
            {imagePreviews.map((preview) => (
              <div className="dev-image-preview" key={preview.url}>
                <img src={preview.url} alt={preview.name} />
                <span>{preview.name}</span>
              </div>
            ))}
          </div>

          <div className="dev-inventory-section">
            <div className="dev-inventory-copy">
              <p className="eyebrow">inventory</p>
              <h3>Color and size quantities</h3>
            </div>
            <ProductInventoryTable
              colors={formState.colors}
              inventory={formState.inventory}
              onQuantityChange={handleQuantityChange}
            />
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
            {isSaving ? 'Saving product...' : 'Save product'}
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

          <UploadedProductList
            categories={categories}
            products={products}
            onDeleteProduct={handleDelete}
            onNavigate={onNavigate}
          />
        </aside>
      </div>
    </section>
  )
}

export default DevPage
