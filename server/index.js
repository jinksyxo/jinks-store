import { createClient as createLibsqlClient } from '@libsql/client'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { promises as fsPromises } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import Stripe from 'stripe'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = path.join(rootDir, 'server', 'data')
const uploadsDir = path.join(dataDir, 'uploads')
const backupsDir = path.join(dataDir, 'backups')
const productsFilePath = path.join(dataDir, 'products.json')
const shirtInventoryFilePath = path.join(dataDir, 'shirt-inventory.json')
const stripeOrdersFilePath = path.join(dataDir, 'stripe-orders.json')
const databaseFilePath = path.join(dataDir, 'store.sqlite')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return
  }

  const fileContents = readFileSync(filePath, 'utf8')

  fileContents.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return
    }

    const separatorIndex = trimmedLine.indexOf('=')

    if (separatorIndex === -1) {
      return
    }

    const key = trimmedLine.slice(0, separatorIndex).trim()
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim()
    const unquotedValue =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue

    if (key && process.env[key] === undefined) {
      process.env[key] = unquotedValue
    }
  })
}

loadEnvFile(path.join(rootDir, '.env'))
loadEnvFile(path.join(rootDir, '.env.local'))

const PORT = Number(process.env.PORT || 3001)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'matsumoto-dev'
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-session-secret'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const STRIPE_PUBLISHABLE_KEY = process.env.VITE_STRIPE_PUBLISHABLE_KEY || ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || ''
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || ''
const STRIPE_API_VERSION = '2025-03-31.basil'
const STRIPE_ALLOWED_SHIPPING_COUNTRIES = String(
  process.env.STRIPE_ALLOWED_SHIPPING_COUNTRIES || 'US',
)
  .split(',')
  .map((country) => country.trim().toUpperCase())
  .filter(Boolean)
const STRIPE_STANDARD_SHIPPING_AMOUNT = Math.max(
  0,
  Number(process.env.STRIPE_STANDARD_SHIPPING_AMOUNT || 800),
)
const STRIPE_EXPRESS_SHIPPING_AMOUNT = Math.max(
  0,
  Number(process.env.STRIPE_EXPRESS_SHIPPING_AMOUNT || 1500),
)
const STRIPE_FREE_SHIPPING_THRESHOLD = Math.max(
  0,
  Number(process.env.STRIPE_FREE_SHIPPING_THRESHOLD || 10000),
)
const COOKIE_NAME = 'matsumoto_admin'
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_COUNT = 6
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024
const SESSION_TTL_MS = 1000 * 60 * 60 * 12
const COLOR_OPTIONS = ['black', 'white', 'ash-grey']
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL']
const PRODUCT_TYPE_OPTIONS = ['shirt', 'bottoms', 'merch']
const CATEGORY_OPTIONS = ['/tees', '/dress-shirts', '/bottoms', '/other-merchandise']
const INVENTORY_SCOPE_OPTIONS = ['shared-shirt', 'untracked']
const ORDER_FULFILLMENT_STATUS_OPTIONS = [
  'unfulfilled',
  'preparing',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
]
const ORDER_REFUND_STATUS_OPTIONS = [
  'not_refunded',
  'pending_review',
  'refunded',
]
const MAX_CHECKOUT_ITEMS = 25
const USE_HOSTED_DATABASE = Boolean(TURSO_DATABASE_URL)
const stripeClient = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
    })
  : null

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

class InventoryConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InventoryConflictError'
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeSizeSelection(sizes, productType, options = {}) {
  const { fallbackToDefaults = false } = options
  const source = Array.isArray(sizes) ? sizes : []
  const normalizedSizes = SIZE_OPTIONS.filter((size) => source.includes(size))

  if (!normalizedSizes.length && fallbackToDefaults) {
    return defaultAllowedSizesForProductType(productType)
  }

  return normalizedSizes
}

function normalizeColorSelection(colors) {
  return COLOR_OPTIONS.filter((color) => Array.isArray(colors) && colors.includes(color))
}

function normalizeProductRecord(product, index) {
  const category = CATEGORY_OPTIONS.includes(product.category) ? product.category : '/tees'
  const productType = PRODUCT_TYPE_OPTIONS.includes(product.productType)
    ? product.productType
    : defaultProductTypeForCategory(category)
  const allowedSizesSource = Array.isArray(product.allowedSizes)
    ? product.allowedSizes
    : Array.isArray(product.availableSizes)
      ? product.availableSizes
      : defaultAllowedSizesForProductType(productType)
  const inventoryScope = INVENTORY_SCOPE_OPTIONS.includes(product.inventoryScope)
    ? product.inventoryScope
    : defaultInventoryScopeForProductType(productType)
  const name = String(product.name || product.title || '').trim()
  const description = String(product.description || '').trim()
  const slug = slugify(product.slug || name || `${productType}-${index + 1}`)
  const images = Array.isArray(product.images)
    ? product.images
        .filter((image) => image && typeof image.url === 'string')
        .map((image) => ({
          name: image.name || path.basename(image.url),
          type: image.type || 'image/jpeg',
          url: image.url,
          fileName: image.fileName || path.basename(image.url),
        }))
    : []

  return {
    id: product.id,
    category,
    slug,
    active: product.active !== false,
    productType,
    inventoryScope,
    allowedSizes: normalizeSizeSelection(allowedSizesSource, productType, {
      fallbackToDefaults: true,
    }),
    name,
    description,
    price: Number(product.price) || 0,
    hasDeal: Boolean(product.hasDeal),
    addToFeaturedCollection: Boolean(
      product.addToFeaturedCollection ?? product.addToCollection,
    ),
    addToUtahCollection: Boolean(product.addToUtahCollection),
    salePrice: product.hasDeal ? Number(product.salePrice) || null : null,
    tag: product.hasDeal ? 'Active Deal' : 'New Upload',
    tint: product.tint || '#f4f4f4',
    images,
    colors: normalizeColorSelection(product.colors),
    createdAt: product.createdAt || new Date(0).toISOString(),
    type: product.type || 'uploaded',
  }
}

function ensureUniqueSlug(baseSlug, products, excludedProductId = null) {
  const normalizedBaseSlug = slugify(baseSlug) || 'product'
  const existingSlugs = new Set(
    products
      .filter((product) => product.id !== excludedProductId)
      .map((product) => product.slug)
      .filter(Boolean),
  )

  if (!existingSlugs.has(normalizedBaseSlug)) {
    return normalizedBaseSlug
  }

  let suffix = 2
  let candidate = `${normalizedBaseSlug}-${suffix}`

  while (existingSlugs.has(candidate)) {
    suffix += 1
    candidate = `${normalizedBaseSlug}-${suffix}`
  }

  return candidate
}

function absoluteAssetUrl(urlPath) {
  try {
    return new URL(urlPath, APP_URL).toString()
  } catch {
    return null
  }
}

function createDefaultShirtInventory() {
  return COLOR_OPTIONS.reduce((inventory, color) => {
    inventory[color] = SIZE_OPTIONS.reduce((sizes, size) => {
      sizes[size] = 0
      return sizes
    }, {})
    return inventory
  }, {})
}

mkdirSync(dataDir, { recursive: true })
mkdirSync(uploadsDir, { recursive: true })
mkdirSync(backupsDir, { recursive: true })

if (!existsSync(productsFilePath)) {
  writeFileSync(productsFilePath, '[]\n')
}

if (!existsSync(shirtInventoryFilePath)) {
  writeFileSync(
    shirtInventoryFilePath,
    `${JSON.stringify(createDefaultShirtInventory(), null, 2)}\n`,
  )
}

if (!existsSync(stripeOrdersFilePath)) {
  writeFileSync(stripeOrdersFilePath, '[]\n')
}

if (!existsSync(databaseFilePath)) {
  writeFileSync(databaseFilePath, '')
}

const STORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shirt_inventory (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stripe_orders (
    session_id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS customers (
    email TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
`

if (USE_HOSTED_DATABASE && !TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is configured.')
}

const localStoreDb = new DatabaseSync(databaseFilePath)
localStoreDb.exec(`
  PRAGMA journal_mode = WAL;
  ${STORE_SCHEMA_SQL}
`)

const remoteStoreClient = USE_HOSTED_DATABASE
  ? createLibsqlClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN,
    })
  : null

function jsonResponse(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

function textResponse(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  })
  response.end(body)
}

function createSignature(value) {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('hex')
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie

  if (!cookieHeader) {
    return {}
  }

  return cookieHeader.split(';').reduce((cookies, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=')
    cookies[rawKey] = decodeURIComponent(rawValue.join('='))
    return cookies
  }, {})
}

function buildSessionCookie(expiresAt) {
  const payload = JSON.stringify({
    expiresAt,
    nonce: randomBytes(12).toString('hex'),
  })
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url')
  const signature = createSignature(encodedPayload)

  return `${encodedPayload}.${signature}`
}

function validateSessionCookie(cookieValue) {
  if (!cookieValue || !cookieValue.includes('.')) {
    return false
  }

  const [encodedPayload, signature] = cookieValue.split('.')
  const expectedSignature = createSignature(encodedPayload)

  try {
    const actualBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return false
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))

    return Number(payload.expiresAt) > Date.now()
  } catch {
    return false
  }
}

function sessionCookieHeader(cookieValue, expiresAt) {
  return `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(
    0,
    Math.floor((expiresAt - Date.now()) / 1000),
  )}`
}

function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
}

function formatBackupTimestamp(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  const seconds = String(value.getSeconds()).padStart(2, '0')

  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function escapeSqliteString(value) {
  return String(value).replaceAll("'", "''")
}

function normalizeProducts(products) {
  return [...products].map(normalizeProductRecord).sort((left, right) => {
    const leftTime = new Date(left.createdAt ?? 0).getTime()
    const rightTime = new Date(right.createdAt ?? 0).getTime()
    return rightTime - leftTime
  })
}

function parseStoredJson(rawValue, fallback) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return fallback
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return fallback
  }
}

function readLibsqlRow(row) {
  if (!row || typeof row !== 'object') {
    return {}
  }

  return Object.fromEntries(Object.entries(row))
}

async function initializeRemoteStore() {
  if (!remoteStoreClient) {
    return
  }

  await remoteStoreClient.executeMultiple(STORE_SCHEMA_SQL)
}

async function readLocalProducts() {
  const rows = localStoreDb
    .prepare('SELECT payload FROM products ORDER BY created_at DESC')
    .all()

  return normalizeProducts(rows.map((row) => parseStoredJson(row.payload, {})))
}

async function writeLocalProducts(products) {
  const normalizedProducts = normalizeProducts(products)
  const insertProductStatement = localStoreDb.prepare(
    'INSERT INTO products (id, created_at, payload) VALUES (?, ?, ?)',
  )

  localStoreDb.exec('BEGIN')

  try {
    localStoreDb.exec('DELETE FROM products')

    normalizedProducts.forEach((product) => {
      insertProductStatement.run(
        product.id,
        product.createdAt || new Date(0).toISOString(),
        JSON.stringify(product),
      )
    })

    localStoreDb.exec('COMMIT')
  } catch (error) {
    localStoreDb.exec('ROLLBACK')
    throw error
  }
}

async function readRemoteProducts() {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  const result = await remoteStoreClient.execute(
    'SELECT payload FROM products ORDER BY created_at DESC',
  )

  return normalizeProducts(
    result.rows.map((row) => parseStoredJson(readLibsqlRow(row).payload, {})),
  )
}

async function writeRemoteProducts(products) {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  const normalizedProducts = normalizeProducts(products)
  const transaction = await remoteStoreClient.transaction('write')

  try {
    await transaction.execute('DELETE FROM products')

    if (normalizedProducts.length) {
      await transaction.batch(
        normalizedProducts.map((product) => ({
          sql: 'INSERT INTO products (id, created_at, payload) VALUES (?, ?, ?)',
          args: [
            product.id,
            product.createdAt || new Date(0).toISOString(),
            JSON.stringify(product),
          ],
        })),
      )
    }

    await transaction.commit()
  } catch (error) {
    if (!transaction.closed) {
      await transaction.rollback().catch(() => {})
    }
    throw error
  } finally {
    transaction.close()
  }
}

async function readProducts() {
  return USE_HOSTED_DATABASE ? readRemoteProducts() : readLocalProducts()
}

async function writeProducts(products) {
  if (USE_HOSTED_DATABASE) {
    await writeRemoteProducts(products)
    return
  }

  await writeLocalProducts(products)
}

async function readLocalShirtInventory() {
  const row = localStoreDb
    .prepare('SELECT payload FROM shirt_inventory WHERE id = 1')
    .get()

  if (!row) {
    const defaultInventory = createDefaultShirtInventory()
    await writeLocalShirtInventory(defaultInventory)
    return defaultInventory
  }

  return normalizeShirtInventory(parseStoredJson(row.payload, createDefaultShirtInventory()))
}

async function writeLocalShirtInventory(inventory) {
  localStoreDb
    .prepare(
      `
        INSERT INTO shirt_inventory (id, payload)
        VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
      `,
    )
    .run(JSON.stringify(normalizeShirtInventory(inventory)))
}

async function readRemoteShirtInventory() {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  const result = await remoteStoreClient.execute(
    'SELECT payload FROM shirt_inventory WHERE id = 1',
  )
  const row = result.rows[0] ? readLibsqlRow(result.rows[0]) : null

  if (!row) {
    const defaultInventory = createDefaultShirtInventory()
    await writeRemoteShirtInventory(defaultInventory)
    return defaultInventory
  }

  return normalizeShirtInventory(parseStoredJson(row.payload, createDefaultShirtInventory()))
}

async function writeRemoteShirtInventory(inventory) {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  await remoteStoreClient.execute({
    sql: `
      INSERT INTO shirt_inventory (id, payload)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
    `,
    args: [JSON.stringify(normalizeShirtInventory(inventory))],
  })
}

async function readShirtInventory() {
  return USE_HOSTED_DATABASE ? readRemoteShirtInventory() : readLocalShirtInventory()
}

async function writeShirtInventory(inventory) {
  if (USE_HOSTED_DATABASE) {
    await writeRemoteShirtInventory(inventory)
    return
  }

  await writeLocalShirtInventory(inventory)
}

function normalizeStripeOrderRecord(order) {
  const normalizedStatus = order?.status ? String(order.status).trim() : 'pending'
  const normalizedFulfillmentStatus = order?.fulfillmentStatus
    ? String(order.fulfillmentStatus).trim()
    : normalizedStatus === 'fulfilled'
      ? 'unfulfilled'
      : normalizedStatus === 'payment_failed'
        ? 'cancelled'
        : 'unfulfilled'
  const normalizedRefundStatus = order?.refundStatus
    ? String(order.refundStatus).trim()
    : 'not_refunded'

  return {
    sessionId: String(order?.sessionId || '').trim(),
    eventId: order?.eventId ? String(order.eventId).trim() : null,
    checkoutReference: order?.checkoutReference ? String(order.checkoutReference).trim() : null,
    paymentIntentId: order?.paymentIntentId ? String(order.paymentIntentId).trim() : null,
    customerEmail: order?.customerEmail ? String(order.customerEmail).trim() : null,
    currency: order?.currency ? String(order.currency).trim().toLowerCase() : 'usd',
    customerName: order?.customerName ? String(order.customerName).trim() : '',
    customerPhone: order?.customerPhone ? String(order.customerPhone).trim() : '',
    amountTotal: Number(order?.amountTotal || 0),
    amountSubtotal: Number(order?.amountSubtotal || 0),
    amountShipping: Number(order?.amountShipping || 0),
    amountTax: Number(order?.amountTax || 0),
    paymentStatus: order?.paymentStatus ? String(order.paymentStatus).trim() : 'unpaid',
    status: normalizedStatus,
    fulfillmentStatus: ORDER_FULFILLMENT_STATUS_OPTIONS.includes(normalizedFulfillmentStatus)
      ? normalizedFulfillmentStatus
      : 'unfulfilled',
    refundStatus: ORDER_REFUND_STATUS_OPTIONS.includes(normalizedRefundStatus)
      ? normalizedRefundStatus
      : 'not_refunded',
    checkoutStatus: order?.checkoutStatus ? String(order.checkoutStatus).trim() : 'open',
    shippingCarrier: order?.shippingCarrier ? String(order.shippingCarrier).trim() : '',
    trackingNumber: order?.trackingNumber ? String(order.trackingNumber).trim() : '',
    shippingMethod: order?.shippingMethod ? String(order.shippingMethod).trim() : '',
    fulfillmentNotes: order?.fulfillmentNotes ? String(order.fulfillmentNotes).trim() : '',
    fulfilledAt: order?.fulfilledAt ? String(order.fulfilledAt).trim() : null,
    invoiceId: order?.invoiceId ? String(order.invoiceId).trim() : null,
    shippingDetails:
      order?.shippingDetails && typeof order.shippingDetails === 'object'
        ? {
            name: order.shippingDetails.name ? String(order.shippingDetails.name).trim() : '',
            phone: order.shippingDetails.phone ? String(order.shippingDetails.phone).trim() : '',
            address:
              order.shippingDetails.address && typeof order.shippingDetails.address === 'object'
                ? {
                    line1: order.shippingDetails.address.line1
                      ? String(order.shippingDetails.address.line1).trim()
                      : '',
                    line2: order.shippingDetails.address.line2
                      ? String(order.shippingDetails.address.line2).trim()
                      : '',
                    city: order.shippingDetails.address.city
                      ? String(order.shippingDetails.address.city).trim()
                      : '',
                    state: order.shippingDetails.address.state
                      ? String(order.shippingDetails.address.state).trim()
                      : '',
                    postalCode: order.shippingDetails.address.postalCode
                      ? String(order.shippingDetails.address.postalCode).trim()
                      : '',
                    country: order.shippingDetails.address.country
                      ? String(order.shippingDetails.address.country).trim().toUpperCase()
                      : '',
                  }
                : null,
          }
        : null,
    lineItems: Array.isArray(order?.lineItems)
      ? order.lineItems.map((item) => ({
          productId: item?.productId ? String(item.productId).trim() : '',
          productName: item?.productName ? String(item.productName).trim() : '',
          color: item?.color ? String(item.color).trim() : '',
          size: item?.size ? String(item.size).trim() : '',
          quantity: Number(item?.quantity || 0),
        }))
      : [],
    stockAdjustments: Array.isArray(order?.stockAdjustments)
      ? order.stockAdjustments.map((adjustment) => ({
          color: adjustment?.color ? String(adjustment.color).trim() : '',
          size: adjustment?.size ? String(adjustment.size).trim() : '',
          quantity: Number(adjustment?.quantity || 0),
        }))
      : [],
    createdAt: order?.createdAt ? String(order.createdAt).trim() : new Date(0).toISOString(),
    updatedAt: order?.updatedAt ? String(order.updatedAt).trim() : new Date(0).toISOString(),
  }
}

function serializeShippingDetails(shippingDetails) {
  if (!shippingDetails || typeof shippingDetails !== 'object') {
    return null
  }

  const address = shippingDetails.address && typeof shippingDetails.address === 'object'
    ? {
        line1: shippingDetails.address.line1 ? String(shippingDetails.address.line1).trim() : '',
        line2: shippingDetails.address.line2 ? String(shippingDetails.address.line2).trim() : '',
        city: shippingDetails.address.city ? String(shippingDetails.address.city).trim() : '',
        state: shippingDetails.address.state ? String(shippingDetails.address.state).trim() : '',
        postalCode: shippingDetails.address.postal_code
          ? String(shippingDetails.address.postal_code).trim()
          : shippingDetails.address.postalCode
            ? String(shippingDetails.address.postalCode).trim()
            : '',
        country: shippingDetails.address.country
          ? String(shippingDetails.address.country).trim().toUpperCase()
          : '',
      }
    : null

  return {
    name: shippingDetails.name ? String(shippingDetails.name).trim() : '',
    phone: shippingDetails.phone ? String(shippingDetails.phone).trim() : '',
    address,
  }
}

function shippingOptionsForSubtotal(amountSubtotal) {
  const standardOption = {
    shipping_rate_data: {
      display_name:
        amountSubtotal >= STRIPE_FREE_SHIPPING_THRESHOLD ? 'Free domestic shipping' : 'Standard shipping',
      type: 'fixed_amount',
      fixed_amount: {
        amount: amountSubtotal >= STRIPE_FREE_SHIPPING_THRESHOLD ? 0 : STRIPE_STANDARD_SHIPPING_AMOUNT,
        currency: 'usd',
      },
      delivery_estimate: {
        minimum: {
          unit: 'business_day',
          value: 5,
        },
        maximum: {
          unit: 'business_day',
          value: 7,
        },
      },
    },
  }

  const expressOption = {
    shipping_rate_data: {
      display_name: 'Express shipping',
      type: 'fixed_amount',
      fixed_amount: {
        amount: STRIPE_EXPRESS_SHIPPING_AMOUNT,
        currency: 'usd',
      },
      delivery_estimate: {
        minimum: {
          unit: 'business_day',
          value: 1,
        },
        maximum: {
          unit: 'business_day',
          value: 2,
        },
      },
    },
  }

  return [standardOption, expressOption]
}

function buildCheckoutSessionOrderFields(checkoutSession) {
  return {
    checkoutReference: checkoutSession.metadata?.checkout_reference || null,
    paymentIntentId:
      typeof checkoutSession.payment_intent === 'string'
        ? checkoutSession.payment_intent
        : checkoutSession.payment_intent?.id || null,
    customerEmail:
      checkoutSession.customer_details?.email || checkoutSession.customer_email || null,
    customerName: checkoutSession.customer_details?.name || checkoutSession.shipping_details?.name || '',
    customerPhone:
      checkoutSession.customer_details?.phone || checkoutSession.shipping_details?.phone || '',
    currency: checkoutSession.currency || 'usd',
    amountTotal: Number(checkoutSession.amount_total || 0),
    amountSubtotal: Number(checkoutSession.amount_subtotal || 0),
    amountShipping: Number(checkoutSession.shipping_cost?.amount_total || 0),
    amountTax: Number(checkoutSession.total_details?.amount_tax || 0),
    paymentStatus: checkoutSession.payment_status,
    checkoutStatus: checkoutSession.status || 'open',
    shippingMethod: checkoutSession.shipping_cost?.shipping_rate?.display_name || '',
    invoiceId:
      typeof checkoutSession.invoice === 'string'
        ? checkoutSession.invoice
        : checkoutSession.invoice?.id || null,
    shippingDetails: serializeShippingDetails(checkoutSession.shipping_details),
  }
}

function normalizeCustomerTags(tags) {
  if (!Array.isArray(tags)) {
    return []
  }

  const seenTags = new Set()

  return tags.reduce((normalizedTags, tag) => {
    const trimmedTag = String(tag || '').trim()

    if (!trimmedTag) {
      return normalizedTags
    }

    const normalizedKey = trimmedTag.toLowerCase()

    if (seenTags.has(normalizedKey)) {
      return normalizedTags
    }

    seenTags.add(normalizedKey)
    normalizedTags.push(trimmedTag)
    return normalizedTags
  }, [])
}

function sortCustomers(customers) {
  return [...customers].sort((left, right) => {
    const rightTime = new Date(right.lastOrderedAt || right.updatedAt || 0).getTime()
    const leftTime = new Date(left.lastOrderedAt || left.updatedAt || 0).getTime()

    if (rightTime !== leftTime) {
      return rightTime - leftTime
    }

    return left.email.localeCompare(right.email)
  })
}

function normalizeCustomerRecord(customer) {
  const email = String(customer?.email || '').trim().toLowerCase()
  const now = new Date().toISOString()

  return {
    email,
    newsletterOptIn: Boolean(customer?.newsletterOptIn),
    tags: normalizeCustomerTags(customer?.tags),
    notes: customer?.notes ? String(customer.notes).trim() : '',
    orderCount: Math.max(0, Number(customer?.orderCount || 0)),
    paidOrderCount: Math.max(0, Number(customer?.paidOrderCount || 0)),
    totalSpent: Math.max(0, Number(customer?.totalSpent || 0)),
    currency: customer?.currency ? String(customer.currency).trim().toLowerCase() : 'usd',
    firstOrderedAt: customer?.firstOrderedAt ? String(customer.firstOrderedAt).trim() : null,
    lastOrderedAt: customer?.lastOrderedAt ? String(customer.lastOrderedAt).trim() : null,
    latestSessionId: customer?.latestSessionId ? String(customer.latestSessionId).trim() : null,
    createdAt: customer?.createdAt ? String(customer.createdAt).trim() : now,
    updatedAt: customer?.updatedAt ? String(customer.updatedAt).trim() : now,
  }
}

function buildDerivedCustomerRecords(orders) {
  const customers = new Map()

  orders.forEach((order) => {
    const rawEmail = String(order?.customerEmail || '').trim()

    if (!rawEmail) {
      return
    }

    const email = rawEmail.toLowerCase()
    const createdAt = order?.createdAt ? String(order.createdAt).trim() : null
    const updatedAt = order?.updatedAt ? String(order.updatedAt).trim() : null
    const fulfilledAt = order?.fulfilledAt ? String(order.fulfilledAt).trim() : null
    const orderTimestamp = fulfilledAt || updatedAt || createdAt || null
    const isPaidOrder =
      String(order?.paymentStatus || '').trim().toLowerCase() === 'paid' ||
      String(order?.status || '').trim().toLowerCase() === 'fulfilled'

    if (!customers.has(email)) {
      customers.set(email, {
        email,
        newsletterOptIn: false,
        tags: [],
        notes: '',
        orderCount: 0,
        paidOrderCount: 0,
        totalSpent: 0,
        currency: String(order?.currency || 'usd').trim().toLowerCase() || 'usd',
        firstOrderedAt: orderTimestamp,
        lastOrderedAt: orderTimestamp,
        latestSessionId: String(order?.sessionId || '').trim() || null,
        createdAt: orderTimestamp || new Date().toISOString(),
        updatedAt: orderTimestamp || new Date().toISOString(),
      })
    }

    const customer = customers.get(email)
    customer.orderCount += 1

    if (isPaidOrder) {
      customer.paidOrderCount += 1
      customer.totalSpent += Number(order?.amountTotal || 0)
    }

    if (orderTimestamp) {
      if (
        !customer.firstOrderedAt ||
        new Date(orderTimestamp).getTime() < new Date(customer.firstOrderedAt).getTime()
      ) {
        customer.firstOrderedAt = orderTimestamp
      }

      if (
        !customer.lastOrderedAt ||
        new Date(orderTimestamp).getTime() > new Date(customer.lastOrderedAt).getTime()
      ) {
        customer.lastOrderedAt = orderTimestamp
        customer.latestSessionId = String(order?.sessionId || '').trim() || customer.latestSessionId
      }
    }
  })

  return sortCustomers([...customers.values()].map(normalizeCustomerRecord))
}

function mergeCustomersWithOrderData(existingCustomers, orders) {
  const derivedCustomers = buildDerivedCustomerRecords(orders)
  const derivedCustomerMap = new Map(
    derivedCustomers.map((customer) => [customer.email, normalizeCustomerRecord(customer)]),
  )
  const mergedCustomers = []
  const existingCustomerMap = new Map(
    existingCustomers
      .map(normalizeCustomerRecord)
      .filter((customer) => customer.email)
      .map((customer) => [customer.email, customer]),
  )

  existingCustomerMap.forEach((existingCustomer, email) => {
    const derivedCustomer = derivedCustomerMap.get(email)

    if (derivedCustomer) {
      mergedCustomers.push(
        normalizeCustomerRecord({
          ...derivedCustomer,
          newsletterOptIn: existingCustomer.newsletterOptIn,
          tags: existingCustomer.tags,
          notes: existingCustomer.notes,
          createdAt: existingCustomer.createdAt || derivedCustomer.createdAt,
          updatedAt: existingCustomer.updatedAt || derivedCustomer.updatedAt,
        }),
      )
      derivedCustomerMap.delete(email)
      return
    }

    mergedCustomers.push(existingCustomer)
  })

  derivedCustomerMap.forEach((customer) => {
    mergedCustomers.push(customer)
  })

  return sortCustomers(mergedCustomers)
}

async function readLocalStripeOrders() {
  const rows = localStoreDb
    .prepare('SELECT payload FROM stripe_orders ORDER BY updated_at DESC')
    .all()

  return rows.map((row) => normalizeStripeOrderRecord(parseStoredJson(row.payload, {})))
}

async function writeLocalStripeOrders(orders) {
  const normalizedOrders = orders.map(normalizeStripeOrderRecord)
  const insertOrderStatement = localStoreDb.prepare(
    'INSERT INTO stripe_orders (session_id, updated_at, payload) VALUES (?, ?, ?)',
  )

  localStoreDb.exec('BEGIN')

  try {
    localStoreDb.exec('DELETE FROM stripe_orders')

    normalizedOrders.forEach((order) => {
      insertOrderStatement.run(
        order.sessionId,
        order.updatedAt || order.fulfilledAt || order.createdAt || new Date(0).toISOString(),
        JSON.stringify(order),
      )
    })

    localStoreDb.exec('COMMIT')
  } catch (error) {
    localStoreDb.exec('ROLLBACK')
    throw error
  }
}

async function readRemoteStripeOrders() {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  const result = await remoteStoreClient.execute(
    'SELECT payload FROM stripe_orders ORDER BY updated_at DESC',
  )

  return result.rows.map((row) =>
    normalizeStripeOrderRecord(parseStoredJson(readLibsqlRow(row).payload, {})),
  )
}

async function writeRemoteStripeOrders(orders) {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  const normalizedOrders = orders.map(normalizeStripeOrderRecord)
  const transaction = await remoteStoreClient.transaction('write')

  try {
    await transaction.execute('DELETE FROM stripe_orders')

    if (normalizedOrders.length) {
      await transaction.batch(
        normalizedOrders.map((order) => ({
          sql: 'INSERT INTO stripe_orders (session_id, updated_at, payload) VALUES (?, ?, ?)',
          args: [
            order.sessionId,
            order.updatedAt || order.fulfilledAt || order.createdAt || new Date(0).toISOString(),
            JSON.stringify(order),
          ],
        })),
      )
    }

    await transaction.commit()
  } catch (error) {
    if (!transaction.closed) {
      await transaction.rollback().catch(() => {})
    }
    throw error
  } finally {
    transaction.close()
  }
}

async function readStripeOrders() {
  return USE_HOSTED_DATABASE ? readRemoteStripeOrders() : readLocalStripeOrders()
}

async function writeStripeOrders(orders) {
  const normalizedOrders = orders.map(normalizeStripeOrderRecord)

  if (USE_HOSTED_DATABASE) {
    await writeRemoteStripeOrders(normalizedOrders)
  } else {
    await writeLocalStripeOrders(normalizedOrders)
  }

  await syncCustomersFromOrders(normalizedOrders)
}

async function readLocalCustomers() {
  const rows = localStoreDb.prepare('SELECT payload FROM customers ORDER BY updated_at DESC').all()

  return sortCustomers(
    rows.map((row) => normalizeCustomerRecord(parseStoredJson(row.payload, {}))).filter((customer) =>
      customer.email,
    ),
  )
}

async function writeLocalCustomers(customers) {
  const normalizedCustomers = sortCustomers(
    customers.map(normalizeCustomerRecord).filter((customer) => customer.email),
  )
  const insertCustomerStatement = localStoreDb.prepare(
    'INSERT INTO customers (email, updated_at, payload) VALUES (?, ?, ?)',
  )

  localStoreDb.exec('BEGIN')

  try {
    localStoreDb.exec('DELETE FROM customers')

    normalizedCustomers.forEach((customer) => {
      insertCustomerStatement.run(
        customer.email,
        customer.updatedAt || customer.lastOrderedAt || customer.createdAt || new Date(0).toISOString(),
        JSON.stringify(customer),
      )
    })

    localStoreDb.exec('COMMIT')
  } catch (error) {
    localStoreDb.exec('ROLLBACK')
    throw error
  }
}

async function readRemoteCustomers() {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  const result = await remoteStoreClient.execute(
    'SELECT payload FROM customers ORDER BY updated_at DESC',
  )

  return sortCustomers(
    result.rows
      .map((row) => normalizeCustomerRecord(parseStoredJson(readLibsqlRow(row).payload, {})))
      .filter((customer) => customer.email),
  )
}

async function writeRemoteCustomers(customers) {
  if (!remoteStoreClient) {
    throw new Error('Hosted database client is not configured.')
  }

  const normalizedCustomers = sortCustomers(
    customers.map(normalizeCustomerRecord).filter((customer) => customer.email),
  )
  const transaction = await remoteStoreClient.transaction('write')

  try {
    await transaction.execute('DELETE FROM customers')

    if (normalizedCustomers.length) {
      await transaction.batch(
        normalizedCustomers.map((customer) => ({
          sql: 'INSERT INTO customers (email, updated_at, payload) VALUES (?, ?, ?)',
          args: [
            customer.email,
            customer.updatedAt || customer.lastOrderedAt || customer.createdAt || new Date(0).toISOString(),
            JSON.stringify(customer),
          ],
        })),
      )
    }

    await transaction.commit()
  } catch (error) {
    if (!transaction.closed) {
      await transaction.rollback().catch(() => {})
    }
    throw error
  } finally {
    transaction.close()
  }
}

async function readCustomers() {
  return USE_HOSTED_DATABASE ? readRemoteCustomers() : readLocalCustomers()
}

async function writeCustomers(customers) {
  if (USE_HOSTED_DATABASE) {
    await writeRemoteCustomers(customers)
    return
  }

  await writeLocalCustomers(customers)
}

async function syncCustomersFromOrders(orders) {
  const existingCustomers = await readCustomers()
  const mergedCustomers = mergeCustomersWithOrderData(existingCustomers, orders)
  await writeCustomers(mergedCustomers)
  return mergedCustomers
}

async function hasProcessedWebhookEvent(eventId) {
  if (!eventId) {
    return false
  }

  if (USE_HOSTED_DATABASE) {
    if (!remoteStoreClient) {
      throw new Error('Hosted database client is not configured.')
    }

    const result = await remoteStoreClient.execute({
      sql: 'SELECT event_id FROM stripe_webhook_events WHERE event_id = ? LIMIT 1',
      args: [eventId],
    })

    return Boolean(result.rows[0])
  }

  return Boolean(
    localStoreDb
      .prepare('SELECT event_id FROM stripe_webhook_events WHERE event_id = ? LIMIT 1')
      .get(eventId),
  )
}

async function recordWebhookEvent(event) {
  if (!event?.id) {
    return
  }

  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    sessionId: String(event.data?.object?.id || '').trim() || null,
    created: Number(event.created || 0),
  })
  const createdAt = new Date(Number(event.created || 0) * 1000 || Date.now()).toISOString()

  if (USE_HOSTED_DATABASE) {
    if (!remoteStoreClient) {
      throw new Error('Hosted database client is not configured.')
    }

    await remoteStoreClient.execute({
      sql: `
        INSERT INTO stripe_webhook_events (event_id, created_at, payload)
        VALUES (?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `,
      args: [event.id, createdAt, payload],
    })
    return
  }

  localStoreDb
    .prepare(
      `
        INSERT INTO stripe_webhook_events (event_id, created_at, payload)
        VALUES (?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `,
    )
    .run(event.id, createdAt, payload)
}

function escapeCsvField(value) {
  const stringValue = String(value ?? '')
  return /[",\n]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue
}

function buildCustomerEmailCsv(records) {
  const rows = [
    [
      'email',
      'newsletter_opt_in',
      'tags',
      'notes',
      'order_count',
      'paid_order_count',
      'total_spent_cents',
      'currency',
      'first_ordered_at',
      'last_ordered_at',
      'latest_session_id',
    ],
    ...records.map((record) => [
      record.email,
      record.newsletterOptIn ? 'yes' : 'no',
      record.tags.join(' | '),
      record.notes,
      record.orderCount,
      record.paidOrderCount,
      record.totalSpent,
      record.currency,
      record.firstOrderedAt || '',
      record.lastOrderedAt || '',
      record.latestSessionId || '',
    ]),
  ]

  return `${rows.map((row) => row.map(escapeCsvField).join(',')).join('\n')}\n`
}

async function buildStoreExportPayload() {
  const stripeOrders = await readStripeOrders()
  const customers = await readCustomers()

  return {
    exportedAt: new Date().toISOString(),
    source: USE_HOSTED_DATABASE ? 'turso' : 'store.sqlite',
    products: await readProducts(),
    shirtInventory: await readShirtInventory(),
    stripeOrders,
    customers,
    customerEmails: customers,
  }
}

async function listStoreBackups() {
  const fileNames = await fsPromises.readdir(backupsDir)
  const backupEntries = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.sqlite') || fileName.endsWith('.json'))
      .map(async (fileName) => {
        const filePath = path.join(backupsDir, fileName)
        const stats = await fsPromises.stat(filePath)

        return {
          fileName,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
          downloadUrl: `/api/admin/backups/${encodeURIComponent(fileName)}`,
        }
      }),
  )

  return backupEntries.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )
}

async function createSqliteBackup() {
  const fileName = `matsumoto-store-${formatBackupTimestamp()}-${randomBytes(3).toString('hex')}.sqlite`
  const filePath = path.join(backupsDir, fileName)

  if (existsSync(filePath)) {
    await fsPromises.unlink(filePath)
  }

  localStoreDb.exec(`VACUUM INTO '${escapeSqliteString(filePath)}'`)

  const stats = await fsPromises.stat(filePath)

  return {
    fileName,
    size: stats.size,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
    downloadUrl: `/api/admin/backups/${encodeURIComponent(fileName)}`,
  }
}

async function createStoreBackup() {
  if (!USE_HOSTED_DATABASE) {
    return createSqliteBackup()
  }

  const fileName = `matsumoto-store-${formatBackupTimestamp()}-${randomBytes(3).toString('hex')}.json`
  const filePath = path.join(backupsDir, fileName)
  const exportPayload = await buildStoreExportPayload()

  await fsPromises.writeFile(filePath, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8')

  const stats = await fsPromises.stat(filePath)

  return {
    fileName,
    size: stats.size,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
    downloadUrl: `/api/admin/backups/${encodeURIComponent(fileName)}`,
  }
}

async function bootstrapLocalStoreFromLegacyJson() {
  const productCount = Number(
    localStoreDb.prepare('SELECT COUNT(*) AS count FROM products').get()?.count || 0,
  )
  const inventoryCount = Number(
    localStoreDb.prepare('SELECT COUNT(*) AS count FROM shirt_inventory').get()?.count || 0,
  )
  const orderCount = Number(
    localStoreDb.prepare('SELECT COUNT(*) AS count FROM stripe_orders').get()?.count || 0,
  )
  const customerCount = Number(
    localStoreDb.prepare('SELECT COUNT(*) AS count FROM customers').get()?.count || 0,
  )

  if (productCount === 0 && existsSync(productsFilePath)) {
    const legacyProducts = normalizeProducts(parseStoredJson(readFileSync(productsFilePath, 'utf8'), []))
    const insertProductStatement = localStoreDb.prepare(
      'INSERT INTO products (id, created_at, payload) VALUES (?, ?, ?)',
    )

    localStoreDb.exec('BEGIN')

    try {
      legacyProducts.forEach((product) => {
        insertProductStatement.run(
          product.id,
          product.createdAt || new Date(0).toISOString(),
          JSON.stringify(product),
        )
      })
      localStoreDb.exec('COMMIT')
    } catch (error) {
      localStoreDb.exec('ROLLBACK')
      throw error
    }
  }

  if (inventoryCount === 0) {
    const legacyInventory = existsSync(shirtInventoryFilePath)
      ? normalizeShirtInventory(
          parseStoredJson(readFileSync(shirtInventoryFilePath, 'utf8'), createDefaultShirtInventory()),
        )
      : createDefaultShirtInventory()

    localStoreDb
      .prepare(
        `
          INSERT INTO shirt_inventory (id, payload)
          VALUES (1, ?)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
        `,
      )
      .run(JSON.stringify(legacyInventory))
  }

  if (orderCount === 0 && existsSync(stripeOrdersFilePath)) {
    const legacyOrders = parseStoredJson(readFileSync(stripeOrdersFilePath, 'utf8'), [])
      .map(normalizeStripeOrderRecord)
    const insertOrderStatement = localStoreDb.prepare(
      'INSERT INTO stripe_orders (session_id, updated_at, payload) VALUES (?, ?, ?)',
    )

    localStoreDb.exec('BEGIN')

    try {
      legacyOrders.forEach((order) => {
        insertOrderStatement.run(
          order.sessionId,
          order.updatedAt || order.fulfilledAt || order.createdAt || new Date(0).toISOString(),
          JSON.stringify(order),
        )
      })
      localStoreDb.exec('COMMIT')
    } catch (error) {
      localStoreDb.exec('ROLLBACK')
      throw error
    }
  }

  if (customerCount === 0) {
    await writeLocalCustomers(
      mergeCustomersWithOrderData([], await readLocalStripeOrders()),
    )
  }
}

async function bootstrapHostedStoreFromLocal() {
  if (!remoteStoreClient) {
    return
  }

  const [productResult, inventoryResult, orderResult, customerResult] = await Promise.all([
    remoteStoreClient.execute('SELECT COUNT(*) AS count FROM products'),
    remoteStoreClient.execute('SELECT COUNT(*) AS count FROM shirt_inventory'),
    remoteStoreClient.execute('SELECT COUNT(*) AS count FROM stripe_orders'),
    remoteStoreClient.execute('SELECT COUNT(*) AS count FROM customers'),
  ])

  const remoteProductCount = Number(readLibsqlRow(productResult.rows[0]).count || 0)
  const remoteInventoryCount = Number(readLibsqlRow(inventoryResult.rows[0]).count || 0)
  const remoteOrderCount = Number(readLibsqlRow(orderResult.rows[0]).count || 0)
  const remoteCustomerCount = Number(readLibsqlRow(customerResult.rows[0]).count || 0)

  if (remoteProductCount === 0) {
    await writeRemoteProducts(await readLocalProducts())
  }

  if (remoteInventoryCount === 0) {
    await writeRemoteShirtInventory(await readLocalShirtInventory())
  }

  if (remoteOrderCount === 0) {
    await writeRemoteStripeOrders(await readLocalStripeOrders())
  }

  if (remoteCustomerCount === 0) {
    await writeRemoteCustomers(await readLocalCustomers())
  }
}

async function initializeStore() {
  await bootstrapLocalStoreFromLegacyJson()

  if (!USE_HOSTED_DATABASE) {
    await syncCustomersFromOrders(await readStripeOrders())
    return
  }

  await initializeRemoteStore()
  await bootstrapHostedStoreFromLocal()
  await syncCustomersFromOrders(await readStripeOrders())
}

await initializeStore()

function publicProduct(product) {
  return {
    ...product,
    images: product.images.map((image) => image.url),
  }
}

function requireAdmin(request, response) {
  const cookies = parseCookies(request)

  if (!validateSessionCookie(cookies[COOKIE_NAME])) {
    jsonResponse(response, 401, { error: 'Unauthorized.' }, {
      'Set-Cookie': clearSessionCookieHeader(),
    })
    return false
  }

  return true
}

function publicStripeOrder(order) {
  return normalizeStripeOrderRecord(order)
}

function publicCustomer(customer) {
  return normalizeCustomerRecord(customer)
}

function validateAdminOrderUpdatePayload(payload) {
  const errors = []

  if (!ORDER_FULFILLMENT_STATUS_OPTIONS.includes(payload?.fulfillmentStatus)) {
    errors.push('Fulfillment status is invalid.')
  }

  if (!ORDER_REFUND_STATUS_OPTIONS.includes(payload?.refundStatus)) {
    errors.push('Refund status is invalid.')
  }

  if (
    payload?.shippingCarrier !== undefined &&
    typeof payload.shippingCarrier !== 'string'
  ) {
    errors.push('Shipping carrier must be text.')
  }

  if (
    payload?.trackingNumber !== undefined &&
    typeof payload.trackingNumber !== 'string'
  ) {
    errors.push('Tracking number must be text.')
  }

  if (
    payload?.fulfillmentNotes !== undefined &&
    typeof payload.fulfillmentNotes !== 'string'
  ) {
    errors.push('Fulfillment notes must be text.')
  }

  return errors
}

function validateAdminCustomerUpdatePayload(payload) {
  const errors = []

  if (payload?.newsletterOptIn !== undefined && typeof payload.newsletterOptIn !== 'boolean') {
    errors.push('Newsletter opt-in must be true or false.')
  }

  if (payload?.notes !== undefined && typeof payload.notes !== 'string') {
    errors.push('Customer notes must be text.')
  }

  if (payload?.tags !== undefined) {
    if (!Array.isArray(payload.tags)) {
      errors.push('Customer tags must be a list.')
    } else if (payload.tags.some((tag) => typeof tag !== 'string')) {
      errors.push('Each customer tag must be text.')
    }
  }

  return errors
}

async function readJsonBody(request) {
  const rawBody = await readRawBody(request)

  if (!rawBody.length) {
    return {}
  }

  try {
    return JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw new Error('Request body is not valid JSON.')
  }
}

async function readRawBody(request, maxBytes = MAX_TOTAL_IMAGE_BYTES * 10) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0

    request.on('data', (chunk) => {
      totalBytes += chunk.length

      if (totalBytes > maxBytes) {
        reject(new Error('Request body is too large.'))
        request.destroy()
        return
      }

      chunks.push(chunk)
    })

    request.on('end', () => {
      resolve(Buffer.concat(chunks))
    })

    request.on('error', reject)
  })
}

function updateStripeOrderRecord(orders, nextRecord) {
  const existingIndex = orders.findIndex((order) => order.sessionId === nextRecord.sessionId)

  if (existingIndex === -1) {
    return [...orders, normalizeStripeOrderRecord(nextRecord)]
  }

  const updatedOrders = [...orders]
  updatedOrders[existingIndex] = normalizeStripeOrderRecord({
    ...updatedOrders[existingIndex],
    ...nextRecord,
  })

  return updatedOrders
}

async function listCheckoutSessionLineItems(sessionId) {
  const collectedItems = []
  let startingAfter = null

  while (true) {
    const page = await stripeClient.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    collectedItems.push(...page.data)

    if (!page.has_more || !page.data.length) {
      break
    }

    startingAfter = page.data[page.data.length - 1].id
  }

  return collectedItems
}

function normalizePurchasedLineItems(lineItems) {
  return lineItems.map((lineItem) => {
    const metadata = lineItem.metadata || {}

    return {
      productId: String(metadata.product_id || '').trim(),
      productName: String(lineItem.description || '').trim(),
      color: String(metadata.color || '').trim(),
      size: String(metadata.size || '').trim(),
      quantity: Number(lineItem.quantity || 0),
    }
  })
}

function applyInventoryAdjustments(currentInventory, purchasedItems, products) {
  const nextInventory = normalizeShirtInventory(currentInventory)
  const stockAdjustments = []

  purchasedItems.forEach((item) => {
    const product = products.find((candidateProduct) => candidateProduct.id === item.productId)

    if (!product || product.inventoryScope !== 'shared-shirt') {
      return
    }

    if (!item.color || !item.size) {
      throw new Error(`Missing size or color metadata for ${product.name}.`)
    }

    const availableQuantity = Number(nextInventory?.[item.color]?.[item.size] ?? 0)

    if (availableQuantity < item.quantity) {
      throw new InventoryConflictError(
        `Cannot fulfill ${product.name}: only ${availableQuantity} left in ${item.color} ${item.size}.`,
      )
    }

    nextInventory[item.color][item.size] = availableQuantity - item.quantity
    stockAdjustments.push({
      color: item.color,
      size: item.size,
      quantity: item.quantity,
    })
  })

  return {
    nextInventory,
    stockAdjustments,
  }
}

let stripeFulfillmentQueue = Promise.resolve()

function enqueueStripeFulfillment(task) {
  const queuedTask = stripeFulfillmentQueue.then(task, task)
  stripeFulfillmentQueue = queuedTask.catch(() => {})
  return queuedTask
}

async function fulfillCheckoutSession(sessionId, event) {
  if (!stripeClient) {
    throw new Error('Stripe secret key is not configured.')
  }

  const checkoutSession = await stripeClient.checkout.sessions.retrieve(sessionId, {
    expand: ['shipping_cost.shipping_rate'],
  })

  if (checkoutSession.payment_status === 'unpaid') {
    return {
      sessionId,
      status: 'pending',
      paymentStatus: checkoutSession.payment_status,
      fulfilled: false,
    }
  }

  const existingOrders = await readStripeOrders()
  const existingOrder = existingOrders.find((order) => order.sessionId === sessionId)

  if (existingOrder?.status === 'fulfilled') {
    return {
      sessionId,
      status: existingOrder.status,
      paymentStatus: existingOrder.paymentStatus,
      fulfilled: false,
      duplicate: true,
    }
  }

  const lineItems = await listCheckoutSessionLineItems(sessionId)
  const purchasedItems = normalizePurchasedLineItems(lineItems)
  const products = await readProducts()
  const currentInventory = await readShirtInventory()
  const now = new Date().toISOString()
  const baseOrderFields = {
    ...buildCheckoutSessionOrderFields(checkoutSession),
    sessionId,
    eventId: event.id,
    lineItems: purchasedItems,
    createdAt: existingOrder?.createdAt || now,
    updatedAt: now,
  }

  let inventoryUpdate

  try {
    inventoryUpdate = applyInventoryAdjustments(currentInventory, purchasedItems, products)
  } catch (error) {
    if (!(error instanceof InventoryConflictError)) {
      throw error
    }

    await writeStripeOrders(
      updateStripeOrderRecord(existingOrders, {
        ...baseOrderFields,
        status: 'inventory_shortfall',
        fulfillmentNotes: error.message,
        stockAdjustments: [],
      }),
    )

    return {
      sessionId,
      status: 'inventory_shortfall',
      paymentStatus: checkoutSession.payment_status,
      fulfilled: false,
    }
  }

  await writeShirtInventory(inventoryUpdate.nextInventory)
  await writeStripeOrders(
    updateStripeOrderRecord(existingOrders, {
      ...baseOrderFields,
      status: 'fulfilled',
      fulfilledAt: now,
      stockAdjustments: inventoryUpdate.stockAdjustments,
    }),
  )

  return {
    sessionId,
    status: 'fulfilled',
    paymentStatus: checkoutSession.payment_status,
    fulfilled: true,
  }
}

async function markCheckoutSessionPaymentFailed(sessionId, event) {
  const existingOrders = await readStripeOrders()
  const existingOrder = existingOrders.find((order) => order.sessionId === sessionId)
  const checkoutSession = stripeClient
    ? await stripeClient.checkout.sessions.retrieve(sessionId, {
        expand: ['shipping_cost.shipping_rate'],
      })
    : null
  const now = new Date().toISOString()

  await writeStripeOrders(
    updateStripeOrderRecord(existingOrders, {
      sessionId,
      eventId: event.id,
      ...(checkoutSession ? buildCheckoutSessionOrderFields(checkoutSession) : {}),
      status: existingOrder?.status === 'fulfilled' ? 'fulfilled' : 'payment_failed',
      paymentStatus: 'unpaid',
      updatedAt: now,
      createdAt: existingOrder?.createdAt || now,
    }),
  )
}

function validateProductPayload(payload) {
  return validateProductPayloadForMode(payload, {
    allowEmptyImages: false,
    existingImageCount: 0,
  })
}

function validateProductPayloadForMode(payload, options = {}) {
  const errors = []
  const { allowEmptyImages = false, existingImageCount = 0 } = options
  const {
    category,
    slug,
    active,
    productType,
    inventoryScope,
    allowedSizes,
    title,
    description,
    price,
    hasDeal,
    addToFeaturedCollection,
    addToUtahCollection,
    salePrice,
    colors,
    images,
  } = payload
  const totalImageCount = existingImageCount + (Array.isArray(images) ? images.length : 0)
  const expectedInventoryScope = PRODUCT_TYPE_OPTIONS.includes(productType)
    ? defaultInventoryScopeForProductType(productType)
    : null

  if (!CATEGORY_OPTIONS.includes(category)) {
    errors.push('Category is invalid.')
  }

  if (typeof active !== 'boolean') {
    errors.push('Active flag must be true or false.')
  }

  if (!PRODUCT_TYPE_OPTIONS.includes(productType)) {
    errors.push('Product type is invalid.')
  }

  if (
    inventoryScope !== undefined &&
    (!INVENTORY_SCOPE_OPTIONS.includes(inventoryScope) ||
      (expectedInventoryScope !== null && inventoryScope !== expectedInventoryScope))
  ) {
    errors.push('Inventory scope is invalid for this product type.')
  }

  if (!String(title || '').trim()) {
    errors.push('Title is required.')
  }

  if (slug && !slugify(slug)) {
    errors.push('Slug must include letters or numbers.')
  }

  if (!String(description || '').trim()) {
    errors.push('Description is required.')
  }

  if (!Number.isFinite(Number(price)) || Number(price) <= 0) {
    errors.push('Price must be greater than zero.')
  }

  if (typeof addToFeaturedCollection !== 'boolean') {
    errors.push('Featured collection flag must be true or false.')
  }

  if (typeof addToUtahCollection !== 'boolean') {
    errors.push('Utah collection flag must be true or false.')
  }

  if (hasDeal) {
    if (!Number.isFinite(Number(salePrice)) || Number(salePrice) <= 0) {
      errors.push('Sale price must be greater than zero.')
    }

    if (Number(salePrice) >= Number(price)) {
      errors.push('Sale price must be less than the base price.')
    }
  }

  const normalizedColors = Array.isArray(colors)
    ? normalizeColorSelection(colors)
    : []

  if (normalizedColors.length !== (colors || []).length) {
    errors.push('One or more selected colors are invalid.')
  }

  const normalizedAllowedSizes = Array.isArray(allowedSizes)
    ? normalizeSizeSelection(allowedSizes, productType)
    : []

  if (normalizedAllowedSizes.length !== (allowedSizes || []).length) {
    errors.push('One or more selected sizes are invalid.')
  }

  if (productType !== 'merch' && !normalizedAllowedSizes.length) {
    errors.push('Select at least one allowed size.')
  }

  if (inventoryScope === 'shared-shirt' && productType !== 'shirt') {
    errors.push('Only shirt products can use shared shirt inventory.')
  }

  if (totalImageCount > MAX_IMAGE_COUNT) {
    errors.push(`Use ${MAX_IMAGE_COUNT} images or fewer.`)
  }

  if (!Array.isArray(images) || !images.length) {
    if (!allowEmptyImages) {
      errors.push('At least one image is required.')
    }
  } else {
    let totalBytes = 0

    images.forEach((image) => {
      if (!ACCEPTED_IMAGE_TYPES.has(image.type)) {
        errors.push(`${image.name} is not a supported image type.`)
        return
      }

      const [, base64Body = ''] = String(image.dataUrl || '').split(',')
      const byteLength = Buffer.byteLength(base64Body, 'base64')
      totalBytes += byteLength

      if (byteLength > MAX_IMAGE_BYTES) {
        errors.push(`${image.name} exceeds the 6 MB limit.`)
      }
    })

    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      errors.push('The combined image payload is too large.')
    }
  }

  return errors
}

function normalizeShirtInventory(payload) {
  return COLOR_OPTIONS.reduce((inventory, color) => {
    inventory[color] = SIZE_OPTIONS.reduce((sizes, size) => {
      const nextValue = Number(payload?.[color]?.[size] || 0)
      sizes[size] = Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : 0
      return sizes
    }, {})
    return inventory
  }, {})
}

function validateShirtInventory(payload) {
  const errors = []

  COLOR_OPTIONS.forEach((color) => {
    SIZE_OPTIONS.forEach((size) => {
      const numericValue = Number(payload?.[color]?.[size])

      if (!Number.isFinite(numericValue) || numericValue < 0) {
        errors.push(`${color} ${size} inventory must be zero or greater.`)
      }
    })
  })

  return errors
}

function validateCheckoutPayload(payload) {
  const errors = []
  const items = Array.isArray(payload?.items) ? payload.items : []

  if (!STRIPE_SECRET_KEY || !stripeClient) {
    errors.push('Stripe secret key is not configured.')
  }

  if (!STRIPE_PUBLISHABLE_KEY) {
    errors.push('Stripe publishable key is not configured.')
  }

  if (!APP_URL) {
    errors.push('APP_URL is not configured.')
  }

  if (!items.length) {
    errors.push('Add at least one cart item before checkout.')
  }

  if (items.length > MAX_CHECKOUT_ITEMS) {
    errors.push(`Use ${MAX_CHECKOUT_ITEMS} checkout items or fewer.`)
  }

  items.forEach((item, index) => {
    if (!String(item?.productId || '').trim()) {
      errors.push(`Cart item ${index + 1} is missing a product id.`)
    }

    const quantity = Number(item?.quantity)

    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push(`Cart item ${index + 1} must have a quantity greater than zero.`)
    }
  })

  return errors
}

function normalizeCheckoutItems(items) {
  const groupedItems = new Map()

  items.forEach((item) => {
    const normalizedItem = {
      productId: String(item.productId).trim(),
      color: item.color ? String(item.color).trim() : null,
      size: item.size ? String(item.size).trim() : null,
      quantity: Number(item.quantity),
    }
    const key = [
      normalizedItem.productId,
      normalizedItem.color || 'no-color',
      normalizedItem.size || 'no-size',
    ].join('::')
    const existingItem = groupedItems.get(key)

    if (existingItem) {
      existingItem.quantity += normalizedItem.quantity
      return
    }

    groupedItems.set(key, normalizedItem)
  })

  return [...groupedItems.values()]
}

function resolveCheckoutLineItems(products, shirtInventory, requestedItems) {
  const errors = []
  const lineItems = []

  requestedItems.forEach((item) => {
    const product = products.find((candidateProduct) => candidateProduct.id === item.productId)

    if (!product) {
      errors.push(`Product ${item.productId} was not found.`)
      return
    }

    if (product.active === false) {
      errors.push(`${product.name} is not currently available.`)
      return
    }

    if (product.type !== 'uploaded') {
      errors.push(`${product.name} is still a placeholder and cannot be checked out.`)
      return
    }

    if (product.colors.length && !product.colors.includes(item.color)) {
      errors.push(`Selected color is invalid for ${product.name}.`)
      return
    }

    if (product.allowedSizes.length && !product.allowedSizes.includes(item.size)) {
      errors.push(`Selected size is invalid for ${product.name}.`)
      return
    }

    if (product.inventoryScope === 'shared-shirt') {
      const availableQuantity = Number(shirtInventory?.[item.color]?.[item.size] ?? 0)

      if (availableQuantity <= 0) {
        errors.push(`${product.name} is out of stock in ${item.color} ${item.size}.`)
        return
      }

      if (item.quantity > availableQuantity) {
        errors.push(
          `${product.name} only has ${availableQuantity} available in ${item.color} ${item.size}.`,
        )
        return
      }
    }

    const unitAmount = Math.round(
      (product.hasDeal && product.salePrice ? product.salePrice : product.price) * 100,
    )
    const imageUrl = absoluteAssetUrl(product.images?.[0]?.url)
    const lineItem = {
      quantity: item.quantity,
      metadata: {
        product_id: product.id,
        product_slug: product.slug,
        color: item.color || '',
        size: item.size || '',
      },
      price_data: {
        currency: 'usd',
        unit_amount: unitAmount,
        product_data: {
          name: product.name,
          description: product.description,
          ...(imageUrl ? { images: [imageUrl] } : {}),
          metadata: {
            product_id: product.id,
            product_slug: product.slug,
            product_category: product.category,
            product_type: product.productType,
            inventory_scope: product.inventoryScope,
            color: item.color || '',
            size: item.size || '',
          },
        },
      },
    }

    lineItems.push(lineItem)
  })

  return { errors, lineItems }
}

function imageExtensionFromType(type) {
  if (type === 'image/png') return '.png'
  if (type === 'image/webp') return '.webp'
  return '.jpg'
}

async function persistImages(productId, images) {
  const savedImages = []

  for (const image of images) {
    const extension = imageExtensionFromType(image.type)
    const safeBaseName = `${productId}-${Date.now()}-${savedImages.length + 1}${extension}`
    const filePath = path.join(uploadsDir, safeBaseName)
    const [, base64Body = ''] = String(image.dataUrl).split(',')
    const buffer = Buffer.from(base64Body, 'base64')

    await fsPromises.writeFile(filePath, buffer)

    savedImages.push({
      name: image.name,
      type: image.type,
      url: `/uploads/${safeBaseName}`,
      fileName: safeBaseName,
    })
  }

  return savedImages
}

function buildStoredProduct(payload, savedImages) {
  return {
    id: randomBytes(12).toString('hex'),
    category: payload.category,
    slug: payload.slug,
    active: Boolean(payload.active),
    productType: payload.productType,
    inventoryScope: payload.inventoryScope,
    allowedSizes: payload.allowedSizes,
    name: String(payload.title).trim(),
    description: String(payload.description).trim(),
    price: Number(payload.price),
    hasDeal: Boolean(payload.hasDeal),
    addToFeaturedCollection: Boolean(payload.addToFeaturedCollection),
    addToUtahCollection: Boolean(payload.addToUtahCollection),
    salePrice: payload.hasDeal ? Number(payload.salePrice) : null,
    tag: payload.hasDeal ? 'Active Deal' : 'New Upload',
    tint: '#f4f4f4',
    images: savedImages,
    colors: payload.colors,
    createdAt: new Date().toISOString(),
    type: 'uploaded',
  }
}

function mergeUpdatedProduct(existingProduct, payload, savedImages) {
  const keptExistingImages = Array.isArray(payload.existingImages)
    ? existingProduct.images.filter((image) => payload.existingImages.includes(image.url))
    : existingProduct.images

  return {
    id: existingProduct.id,
    createdAt: existingProduct.createdAt,
    type: existingProduct.type,
    tint: existingProduct.tint,
    category: payload.category,
    slug: payload.slug,
    active: Boolean(payload.active),
    productType: payload.productType,
    inventoryScope: payload.inventoryScope,
    allowedSizes: payload.allowedSizes,
    name: String(payload.title).trim(),
    description: String(payload.description).trim(),
    price: Number(payload.price),
    hasDeal: Boolean(payload.hasDeal),
    addToFeaturedCollection: Boolean(payload.addToFeaturedCollection),
    addToUtahCollection: Boolean(payload.addToUtahCollection),
    salePrice: payload.hasDeal ? Number(payload.salePrice) : null,
    tag: payload.hasDeal ? 'Active Deal' : 'New Upload',
    images: [...keptExistingImages, ...(savedImages ?? [])],
    colors: payload.colors,
  }
}

async function removeProductFiles(product) {
  await Promise.all(
    (product.images || []).map(async (image) => {
      const targetPath = path.join(uploadsDir, image.fileName || path.basename(image.url))
      if (existsSync(targetPath)) {
        await fsPromises.unlink(targetPath)
      }
    }),
  )
}

function serveStaticFile(response, filePath) {
  if (!existsSync(filePath)) {
    textResponse(response, 404, 'Not found.')
    return
  }

  const extension = path.extname(filePath)
  const contentType =
    extension === '.html'
      ? 'text/html; charset=utf-8'
      : extension === '.css'
        ? 'text/css; charset=utf-8'
        : extension === '.js'
          ? 'application/javascript; charset=utf-8'
          : extension === '.svg'
            ? 'image/svg+xml'
            : extension === '.png'
              ? 'image/png'
              : extension === '.jpg' || extension === '.jpeg'
                ? 'image/jpeg'
                : extension === '.webp'
                  ? 'image/webp'
                  : 'application/octet-stream'

  response.writeHead(200, { 'Content-Type': contentType })
  response.end(readFileSync(filePath))
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host}`)
  const { pathname } = requestUrl

  try {
    if (request.method === 'POST' && pathname === '/api/stripe/webhook') {
      if (!STRIPE_SECRET_KEY || !stripeClient) {
        jsonResponse(response, 503, { error: 'Stripe secret key is not configured.' })
        return
      }

      if (!STRIPE_WEBHOOK_SECRET) {
        jsonResponse(response, 503, { error: 'Stripe webhook secret is not configured.' })
        return
      }

      const signatureHeader = request.headers['stripe-signature']

      if (typeof signatureHeader !== 'string' || !signatureHeader.trim()) {
        jsonResponse(response, 400, { error: 'Stripe signature header is missing.' })
        return
      }

      const rawBody = await readRawBody(request, 1024 * 1024)
      let event

      try {
        event = stripeClient.webhooks.constructEvent(
          rawBody,
          signatureHeader,
          STRIPE_WEBHOOK_SECRET,
        )
      } catch (error) {
        jsonResponse(response, 400, {
          error:
            error instanceof Error
              ? `Webhook signature verification failed: ${error.message}`
              : 'Webhook signature verification failed.',
        })
        return
      }

      if (await hasProcessedWebhookEvent(event.id)) {
        jsonResponse(response, 200, { received: true, duplicate: true })
        return
      }

      if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        const checkoutSessionId = String(event.data.object?.id || '').trim()

        if (!checkoutSessionId) {
          jsonResponse(response, 400, { error: 'Checkout session id is missing from the event.' })
          return
        }

        await enqueueStripeFulfillment(() => fulfillCheckoutSession(checkoutSessionId, event))
      } else if (event.type === 'checkout.session.async_payment_failed') {
        const checkoutSessionId = String(event.data.object?.id || '').trim()

        if (checkoutSessionId) {
          await enqueueStripeFulfillment(() =>
            markCheckoutSessionPaymentFailed(checkoutSessionId, event),
          )
        }
      }

      await recordWebhookEvent(event)

      jsonResponse(response, 200, { received: true })
      return
    }

    if (request.method === 'GET' && pathname === '/api/products') {
      const products = await readProducts()
      jsonResponse(response, 200, { products: products.map(publicProduct) })
      return
    }

    if (request.method === 'GET' && pathname === '/api/store/shirt-inventory') {
      const inventory = await readShirtInventory()
      jsonResponse(response, 200, { inventory })
      return
    }

    if (request.method === 'POST' && pathname === '/api/checkout/session') {
      const body = await readJsonBody(request)
      const payloadErrors = validateCheckoutPayload(body)

      if (payloadErrors.length) {
        jsonResponse(response, 400, { errors: payloadErrors })
        return
      }

      const normalizedItems = normalizeCheckoutItems(body.items)
      const products = await readProducts()
      const shirtInventory = await readShirtInventory()
      const { errors: lineItemErrors, lineItems } = resolveCheckoutLineItems(
        products,
        shirtInventory,
        normalizedItems,
      )

      if (lineItemErrors.length) {
        jsonResponse(response, 400, { errors: lineItemErrors })
        return
      }

      const checkoutReference = randomBytes(12).toString('hex')
      const amountSubtotal = lineItems.reduce(
        (sum, lineItem) => sum + Number(lineItem.price_data?.unit_amount || 0) * Number(lineItem.quantity || 0),
        0,
      )
      const session = await stripeClient.checkout.sessions.create({
        mode: 'payment',
        ui_mode: 'custom',
        return_url: `${APP_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        line_items: lineItems,
        shipping_address_collection: {
          allowed_countries: STRIPE_ALLOWED_SHIPPING_COUNTRIES,
        },
        shipping_options: shippingOptionsForSubtotal(amountSubtotal),
        automatic_tax: {
          enabled: true,
        },
        billing_address_collection: 'auto',
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description: `Matsumoto order ${checkoutReference}`,
            metadata: {
              checkout_reference: checkoutReference,
            },
          },
        },
        customer_email:
          typeof body.customerEmail === 'string' && body.customerEmail.trim()
            ? body.customerEmail.trim()
            : undefined,
        metadata: {
          checkout_reference: checkoutReference,
          item_count: String(
            normalizedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          ),
        },
        payment_intent_data: {
          description: `Matsumoto order ${checkoutReference}`,
          metadata: {
            checkout_reference: checkoutReference,
          },
        },
      })

      jsonResponse(response, 200, {
        sessionId: session.id,
        clientSecret: session.client_secret,
        publishableKey: STRIPE_PUBLISHABLE_KEY,
      })
      return
    }

    if (request.method === 'GET' && pathname.startsWith('/api/checkout/session/')) {
      if (!STRIPE_SECRET_KEY || !stripeClient) {
        jsonResponse(response, 503, { error: 'Stripe secret key is not configured.' })
        return
      }

      const sessionId = pathname.replace('/api/checkout/session/', '')

      if (!sessionId) {
        jsonResponse(response, 400, { error: 'Checkout session id is required.' })
        return
      }

      const session = await stripeClient.checkout.sessions.retrieve(sessionId, {
        expand: ['shipping_cost.shipping_rate'],
      })
      const orders = await readStripeOrders()
      const matchedOrder = orders.find((order) => order.sessionId === session.id)

      jsonResponse(response, 200, {
        sessionId: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        customerEmail: session.customer_details?.email || session.customer_email || null,
        customerName: session.customer_details?.name || session.shipping_details?.name || '',
        customerPhone: session.customer_details?.phone || session.shipping_details?.phone || '',
        amountSubtotal: Number(session.amount_subtotal || 0),
        amountTotal: Number(session.amount_total || 0),
        amountShipping: Number(session.shipping_cost?.amount_total || 0),
        amountTax: Number(session.total_details?.amount_tax || 0),
        shippingMethod: session.shipping_cost?.shipping_rate?.display_name || '',
        shippingDetails: serializeShippingDetails(session.shipping_details),
        expiresAt: Number(session.expires_at || 0) * 1000 || null,
        clientSecret: session.status === 'open' ? session.client_secret || null : null,
        publishableKey: session.status === 'open' ? STRIPE_PUBLISHABLE_KEY : null,
        orderStatus: matchedOrder?.status || null,
      })
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/session') {
      const cookies = parseCookies(request)
      jsonResponse(response, 200, { authenticated: validateSessionCookie(cookies[COOKIE_NAME]) })
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/orders') {
      if (!requireAdmin(request, response)) {
        return
      }

      const orders = await readStripeOrders()
      jsonResponse(response, 200, {
        orders: [...orders]
          .sort(
            (left, right) =>
              new Date(right.fulfilledAt || right.updatedAt || 0).getTime() -
              new Date(left.fulfilledAt || left.updatedAt || 0).getTime(),
          )
          .map(publicStripeOrder),
      })
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/customer-emails') {
      if (!requireAdmin(request, response)) {
        return
      }

      const emails = await readCustomers()
      jsonResponse(response, 200, { emails: emails.map(publicCustomer) })
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/customer-emails/export') {
      if (!requireAdmin(request, response)) {
        return
      }

      const emails = await readCustomers()
      const fileName = `matsumoto-customer-emails-${formatBackupTimestamp()}.csv`

      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      })
      response.end(buildCustomerEmailCsv(emails))
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/customers') {
      if (!requireAdmin(request, response)) {
        return
      }

      const customers = await readCustomers()
      jsonResponse(response, 200, { customers: customers.map(publicCustomer) })
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/customers/export') {
      if (!requireAdmin(request, response)) {
        return
      }

      const customers = await readCustomers()
      const fileName = `matsumoto-customers-${formatBackupTimestamp()}.csv`

      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      })
      response.end(buildCustomerEmailCsv(customers))
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/store-export') {
      if (!requireAdmin(request, response)) {
        return
      }

      const exportPayload = await buildStoreExportPayload()
      const fileName = `matsumoto-store-export-${formatBackupTimestamp()}.json`

      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      })
      response.end(`${JSON.stringify(exportPayload, null, 2)}\n`)
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/backups') {
      if (!requireAdmin(request, response)) {
        return
      }

      const backups = await listStoreBackups()
      jsonResponse(response, 200, { backups })
      return
    }

    if (request.method === 'POST' && pathname === '/api/admin/backups') {
      if (!requireAdmin(request, response)) {
        return
      }

      const backup = await createStoreBackup()
      jsonResponse(response, 201, { backup })
      return
    }

    if (request.method === 'GET' && pathname.startsWith('/api/admin/backups/')) {
      if (!requireAdmin(request, response)) {
        return
      }

      const fileName = decodeURIComponent(pathname.replace('/api/admin/backups/', ''))

      if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
        textResponse(response, 400, 'Invalid backup file name.')
        return
      }

      const targetPath = path.join(backupsDir, fileName)
      const resolvedTarget = path.resolve(targetPath)

      if (!resolvedTarget.startsWith(path.resolve(backupsDir)) || !existsSync(resolvedTarget)) {
        textResponse(response, 404, 'Not found.')
        return
      }

      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      })
      response.end(readFileSync(resolvedTarget))
      return
    }

    if (request.method === 'PUT' && pathname.startsWith('/api/admin/orders/')) {
      if (!requireAdmin(request, response)) {
        return
      }

      const sessionId = pathname.replace('/api/admin/orders/', '')
      const orders = await readStripeOrders()
      const existingOrder = orders.find((order) => order.sessionId === sessionId)

      if (!existingOrder) {
        jsonResponse(response, 404, { error: 'Order not found.' })
        return
      }

      const body = await readJsonBody(request)
      const validationErrors = validateAdminOrderUpdatePayload(body)

      if (validationErrors.length) {
        jsonResponse(response, 400, { errors: validationErrors })
        return
      }

      const updatedOrder = normalizeStripeOrderRecord({
        ...existingOrder,
        fulfillmentStatus: body.fulfillmentStatus,
        refundStatus: body.refundStatus,
        shippingCarrier: String(body.shippingCarrier || '').trim(),
        trackingNumber: String(body.trackingNumber || '').trim(),
        fulfillmentNotes: String(body.fulfillmentNotes || '').trim(),
        updatedAt: new Date().toISOString(),
      })

      await writeStripeOrders(
        orders.map((order) => (order.sessionId === sessionId ? updatedOrder : order)),
      )

      jsonResponse(response, 200, { order: publicStripeOrder(updatedOrder) })
      return
    }

    if (request.method === 'PUT' && pathname.startsWith('/api/admin/customers/')) {
      if (!requireAdmin(request, response)) {
        return
      }

      const encodedEmail = pathname.replace('/api/admin/customers/', '')
      const customerEmail = decodeURIComponent(encodedEmail).trim().toLowerCase()

      if (!customerEmail) {
        jsonResponse(response, 400, { error: 'Customer email is required.' })
        return
      }

      const customers = await readCustomers()
      const existingCustomer = customers.find((customer) => customer.email === customerEmail)

      if (!existingCustomer) {
        jsonResponse(response, 404, { error: 'Customer not found.' })
        return
      }

      const body = await readJsonBody(request)
      const validationErrors = validateAdminCustomerUpdatePayload(body)

      if (validationErrors.length) {
        jsonResponse(response, 400, { errors: validationErrors })
        return
      }

      const updatedCustomer = normalizeCustomerRecord({
        ...existingCustomer,
        newsletterOptIn:
          body.newsletterOptIn !== undefined
            ? body.newsletterOptIn
            : existingCustomer.newsletterOptIn,
        tags: body.tags !== undefined ? body.tags : existingCustomer.tags,
        notes: body.notes !== undefined ? body.notes : existingCustomer.notes,
        updatedAt: new Date().toISOString(),
      })

      await writeCustomers(
        customers.map((customer) => (customer.email === customerEmail ? updatedCustomer : customer)),
      )

      jsonResponse(response, 200, { customer: publicCustomer(updatedCustomer) })
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/shirt-inventory') {
      if (!requireAdmin(request, response)) {
        return
      }

      const inventory = await readShirtInventory()
      jsonResponse(response, 200, { inventory })
      return
    }

    if (request.method === 'POST' && pathname === '/api/admin/login') {
      const body = await readJsonBody(request)

      if (String(body.password || '') !== ADMIN_PASSWORD) {
        jsonResponse(response, 401, { error: 'Password does not match.' })
        return
      }

      const expiresAt = Date.now() + SESSION_TTL_MS
      const cookieValue = buildSessionCookie(expiresAt)

      jsonResponse(
        response,
        200,
        { authenticated: true },
        { 'Set-Cookie': sessionCookieHeader(cookieValue, expiresAt) },
      )
      return
    }

    if (request.method === 'POST' && pathname === '/api/admin/logout') {
      jsonResponse(
        response,
        200,
        { authenticated: false },
        { 'Set-Cookie': clearSessionCookieHeader() },
      )
      return
    }

    if (request.method === 'PUT' && pathname === '/api/admin/shirt-inventory') {
      if (!requireAdmin(request, response)) {
        return
      }

      const body = await readJsonBody(request)
      const validationErrors = validateShirtInventory(body.inventory)

      if (validationErrors.length) {
        jsonResponse(response, 400, { errors: validationErrors })
        return
      }

      const inventory = normalizeShirtInventory(body.inventory)
      await writeShirtInventory(inventory)
      jsonResponse(response, 200, { inventory })
      return
    }

    if (request.method === 'POST' && pathname === '/api/admin/products') {
      if (!requireAdmin(request, response)) {
        return
      }

      const body = await readJsonBody(request)
      const validationErrors = validateProductPayload(body)

      if (validationErrors.length) {
        jsonResponse(response, 400, { errors: validationErrors })
        return
      }

      const products = await readProducts()
      const productId = randomBytes(12).toString('hex')
      const normalizedPayload = {
        ...body,
        slug: ensureUniqueSlug(body.slug || body.title, products),
        active: body.active !== false,
        productType: body.productType,
        inventoryScope: defaultInventoryScopeForProductType(body.productType),
        allowedSizes: normalizeSizeSelection(body.allowedSizes, body.productType, {
          fallbackToDefaults: true,
        }),
        colors: normalizeColorSelection(body.colors),
      }
      const savedImages = await persistImages(productId, normalizedPayload.images)
      const product = {
        ...buildStoredProduct(normalizedPayload, savedImages),
        id: productId,
      }
      await writeProducts([product, ...products])

      jsonResponse(response, 201, { product: publicProduct(product) })
      return
    }

    if (request.method === 'PUT' && pathname.startsWith('/api/admin/products/')) {
      if (!requireAdmin(request, response)) {
        return
      }

      const productId = pathname.replace('/api/admin/products/', '')
      const products = await readProducts()
      const existingProduct = products.find((product) => product.id === productId)

      if (!existingProduct) {
        jsonResponse(response, 404, { error: 'Product not found.' })
        return
      }

      const body = await readJsonBody(request)
      const requestedExistingImages = Array.isArray(body.existingImages) ? body.existingImages : []
      const keptExistingImages = existingProduct.images.filter((image) =>
        requestedExistingImages.includes(image.url),
      )

      if (requestedExistingImages.length !== keptExistingImages.length) {
        jsonResponse(response, 400, { errors: ['One or more existing images are invalid.'] })
        return
      }

      const validationErrors = validateProductPayloadForMode(body, {
        allowEmptyImages: keptExistingImages.length > 0,
        existingImageCount: keptExistingImages.length,
      })

      if (validationErrors.length) {
        jsonResponse(response, 400, { errors: validationErrors })
        return
      }

      const normalizedPayload = {
        ...body,
        slug: ensureUniqueSlug(body.slug || existingProduct.slug || body.title, products, productId),
        active: body.active !== false,
        productType: body.productType,
        inventoryScope: defaultInventoryScopeForProductType(body.productType),
        allowedSizes: normalizeSizeSelection(body.allowedSizes, body.productType, {
          fallbackToDefaults: true,
        }),
        colors: normalizeColorSelection(body.colors),
      }
      let savedImages = null

      if (Array.isArray(normalizedPayload.images) && normalizedPayload.images.length) {
        savedImages = await persistImages(productId, normalizedPayload.images)
      }

      const updatedProduct = mergeUpdatedProduct(existingProduct, normalizedPayload, savedImages)
      const removedImages = existingProduct.images.filter(
        (image) => !updatedProduct.images.some((updatedImage) => updatedImage.url === image.url),
      )

      if (removedImages.length) {
        await removeProductFiles({ images: removedImages })
      }

      await writeProducts(
        products.map((product) => (product.id === productId ? updatedProduct : product)),
      )

      jsonResponse(response, 200, { product: publicProduct(updatedProduct) })
      return
    }

    if (request.method === 'DELETE' && pathname.startsWith('/api/admin/products/')) {
      if (!requireAdmin(request, response)) {
        return
      }

      const productId = pathname.replace('/api/admin/products/', '')
      const products = await readProducts()
      const productToDelete = products.find((product) => product.id === productId)

      if (!productToDelete) {
        jsonResponse(response, 404, { error: 'Product not found.' })
        return
      }

      await removeProductFiles(productToDelete)
      await writeProducts(products.filter((product) => product.id !== productId))

      jsonResponse(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && pathname.startsWith('/uploads/')) {
      const targetPath = path.join(uploadsDir, pathname.replace('/uploads/', ''))
      const resolvedTarget = path.resolve(targetPath)

      if (!resolvedTarget.startsWith(path.resolve(uploadsDir))) {
        textResponse(response, 403, 'Forbidden.')
        return
      }

      serveStaticFile(response, resolvedTarget)
      return
    }

    const distExists = existsSync(distDir) && statSync(distDir).isDirectory()

    if (request.method === 'GET' && distExists) {
      const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1)
      const candidatePath = path.join(distDir, requestedPath)

      if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
        serveStaticFile(response, candidatePath)
        return
      }

      serveStaticFile(response, path.join(distDir, 'index.html'))
      return
    }

    textResponse(response, 404, 'Not found.')
  } catch (error) {
    jsonResponse(response, 500, {
      error: error instanceof Error ? error.message : 'Server error.',
    })
  }
})

server.listen(PORT, () => {
  process.stdout.write(
    `Matsumoto server listening on http://localhost:${PORT} using ${
      USE_HOSTED_DATABASE ? 'Turso/libSQL' : 'local SQLite'
    }\n`,
  )
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
