import { createClient as createLibsqlClient } from '@libsql/client'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { promises as fsPromises } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import Stripe from 'stripe'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = path.join(rootDir, 'server', 'data')
const uploadsDir = path.join(dataDir, 'uploads')
const backupsDir = path.join(dataDir, 'backups')
const shippingSpreadsheetsDir = path.join(dataDir, 'shipping-spreadsheets')
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
// Optional. When unset, admin login stays password-only (unchanged behavior).
// Generate one with `npm run setup-2fa`.
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || ''
const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000
const TWO_FACTOR_MAX_ATTEMPTS = 5
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
const STRIPE_FREE_SHIPPING_THRESHOLD = Math.max(
  0,
  Number(process.env.STRIPE_FREE_SHIPPING_THRESHOLD || 6500),
)
const STRIPE_TAX_BEHAVIOR = ['exclusive', 'inclusive', 'unspecified'].includes(
  String(process.env.STRIPE_TAX_BEHAVIOR || 'exclusive').trim(),
)
  ? String(process.env.STRIPE_TAX_BEHAVIOR || 'exclusive').trim()
  : 'exclusive'
const STRIPE_DEFAULT_TAX_CODE = String(process.env.STRIPE_DEFAULT_TAX_CODE || '').trim()
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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NEWSLETTER_TAG = 'newsletter'
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
const SHIPPING_SPREADSHEET_ALERT_EMAIL =
  process.env.SHIPPING_SPREADSHEET_ALERT_EMAIL || 'jinks@matsumotoshop.com'
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || SHIPPING_SPREADSHEET_ALERT_EMAIL
// Utah store hours. Override with SHIPPING_SPREADSHEET_TIMEZONE if that ever changes.
const SHIPPING_SPREADSHEET_TIMEZONE =
  process.env.SHIPPING_SPREADSHEET_TIMEZONE || 'America/Denver'
const SHIPPING_SPREADSHEET_HOUR = Math.min(
  23,
  Math.max(0, Number(process.env.SHIPPING_SPREADSHEET_HOUR ?? 7)),
)
// Monday, Wednesday, Friday (JS getDay: Sun=0 ... Sat=6).
const SHIPPING_SPREADSHEET_WEEKDAYS = new Set([1, 3, 5])
const SHIPPING_SPREADSHEET_SCHEDULE_CHECK_MS = 5 * 60 * 1000
const SHIPPING_FROM_NAME = process.env.SHIPPING_FROM_NAME || 'Ethan Jinks'
const SHIPPING_FROM_ADDRESS =
  process.env.SHIPPING_FROM_ADDRESS || '1233 W Trimble Ln, West Jordan Utah, 84088-9082'
// Flat per-unit weight assumption for standard tees. Other categories (1-of-1 dress
// shirts, bottoms, other merchandise) don't have a reliable per-unit weight yet, so
// their orders are left blank on purpose for manual entry rather than guessed at.
const TEE_WEIGHT_OZ_PER_UNIT = 5.3
const TEE_CATEGORY_PATH = '/tees'
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

function normalizePrimaryImages(images) {
  const primaryIndex = images.findIndex((image) => image.primary === true || image.isPrimary === true)
  const resolvedPrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0
  const secondaryIndex = images.findIndex(
    (image, index) =>
      index !== resolvedPrimaryIndex && (image.secondary === true || image.isSecondary === true),
  )
  const fallbackSecondaryIndex = images.findIndex((_, index) => index !== resolvedPrimaryIndex)
  const resolvedSecondaryIndex =
    secondaryIndex >= 0 ? secondaryIndex : fallbackSecondaryIndex >= 0 ? fallbackSecondaryIndex : -1

  return images.map((image, index) => ({
    ...image,
    primary: images.length > 0 && index === resolvedPrimaryIndex,
    secondary: resolvedSecondaryIndex >= 0 && index === resolvedSecondaryIndex,
  }))
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
  const images = normalizePrimaryImages(
    Array.isArray(product.images)
      ? product.images
          .filter((image) => image && typeof image.url === 'string')
          .map((image) => ({
            name: image.name || path.basename(image.url),
            type: image.type || 'image/jpeg',
            url: image.url,
            fileName: image.fileName || path.basename(image.url),
            color: COLOR_OPTIONS.includes(image.color) ? image.color : '',
            primary: Boolean(image.primary ?? image.isPrimary),
            secondary: Boolean(image.secondary ?? image.isSecondary),
          }))
      : [],
  )
  const filmInventory = Number(product.filmInventory ?? product.designInventory ?? 0)

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
    filmInventory:
      productType === 'shirt' && Number.isFinite(filmInventory) && filmInventory >= 0
        ? Math.floor(filmInventory)
        : 0,
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

function normalizeStoredImageUrl(value) {
  const rawValue = String(value || '').trim()

  if (!rawValue) {
    return ''
  }

  try {
    return new URL(rawValue, APP_URL).pathname
  } catch {
    return rawValue
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
mkdirSync(shippingSpreadsheetsDir, { recursive: true })

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
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

// Secure is derived from APP_URL rather than hardcoded so local http:// dev
// (including LAN testing on a phone) still works, while a live https:// deploy
// gets the cookie locked to secure transport automatically.
const SESSION_COOKIE_SECURE_ATTR = APP_URL.startsWith('https://') ? '; Secure' : ''

function sessionCookieHeader(cookieValue, expiresAt) {
  return `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; SameSite=Strict${SESSION_COOKIE_SECURE_ATTR}; Max-Age=${Math.max(
    0,
    Math.floor((expiresAt - Date.now()) / 1000),
  )}`
}

function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict${SESSION_COOKIE_SECURE_ATTR}; Max-Age=0`
}

// RFC 4648 base32, used by every authenticator app for TOTP secrets/keys.
// (Only decode is needed server-side — encoding a fresh secret happens once,
// in scripts/setup-2fa.js, which keeps its own copy of this.)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(base32String) {
  const cleaned = String(base32String || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '')
  let bits = ''

  for (const char of cleaned) {
    const value = BASE32_ALPHABET.indexOf(char)

    if (value === -1) {
      continue
    }

    bits += value.toString(2).padStart(5, '0')
  }

  const bytes = []

  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }

  return Buffer.from(bytes)
}

// RFC 6238 TOTP: HMAC-SHA1 over a 30-second time counter, truncated to a
// 6-digit code. Same algorithm every authenticator app already implements.
function generateTotpCode(secretBase32, timestampMs = Date.now(), timeStepSeconds = 30) {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(timestampMs / 1000 / timeStepSeconds)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))

  const hmac = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return String(binaryCode % 1000000).padStart(6, '0')
}

// Accepts the current 30s step plus one step on either side, so a code
// entered right at a rollover boundary (or a slightly-off device clock)
// still works.
function verifyTotpCode(secretBase32, submittedCode) {
  const normalizedCode = String(submittedCode || '').trim()

  if (!/^\d{6}$/.test(normalizedCode)) {
    return false
  }

  const now = Date.now()
  const submittedBuffer = Buffer.from(normalizedCode)

  for (let stepOffset = -1; stepOffset <= 1; stepOffset += 1) {
    const expectedCode = generateTotpCode(secretBase32, now + stepOffset * 30 * 1000)
    const expectedBuffer = Buffer.from(expectedCode)

    if (
      expectedBuffer.length === submittedBuffer.length &&
      timingSafeEqual(expectedBuffer, submittedBuffer)
    ) {
      return true
    }
  }

  return false
}

// A signed, stateless "waiting for a 2FA code" token — same sign/verify
// pattern as the session cookie, just scoped with a distinct prefix so a
// session cookie's signature can never double as a valid challenge token.
function buildTwoFactorChallengeToken({ expiresAt, attempts }) {
  const payload = JSON.stringify({
    expiresAt,
    attempts,
    nonce: randomBytes(12).toString('hex'),
  })
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url')
  const signature = createSignature(`2fa:${encodedPayload}`)

  return `${encodedPayload}.${signature}`
}

function readTwoFactorChallengeToken(token) {
  if (!token || !token.includes('.')) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')
  const expectedSignature = createSignature(`2fa:${encodedPayload}`)

  try {
    const actualBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))

    if (!(Number(payload.expiresAt) > Date.now())) {
      return null
    }

    return payload
  } catch {
    return null
  }
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

// Small durable key/value store for one-off app state (e.g. "did the
// scheduled shipping spreadsheet already run today") that must survive
// process restarts -- unlike a plain module-level variable, which resets on
// every deploy.
async function readAppSetting(key) {
  if (USE_HOSTED_DATABASE) {
    if (!remoteStoreClient) {
      throw new Error('Hosted database client is not configured.')
    }

    const result = await remoteStoreClient.execute({
      sql: 'SELECT value FROM app_settings WHERE key = ?',
      args: [key],
    })
    const row = result.rows[0] ? readLibsqlRow(result.rows[0]) : null
    return row ? row.value : null
  }

  const row = localStoreDb.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  return row ? row.value : null
}

async function writeAppSetting(key, value) {
  if (USE_HOSTED_DATABASE) {
    if (!remoteStoreClient) {
      throw new Error('Hosted database client is not configured.')
    }

    await remoteStoreClient.execute({
      sql: `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      args: [key, value],
    })
    return
  }

  localStoreDb
    .prepare(
      `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
    )
    .run(key, value)
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
          type: adjustment?.type ? String(adjustment.type).trim() : 'blank-shirt',
          productId: adjustment?.productId ? String(adjustment.productId).trim() : '',
          productName: adjustment?.productName ? String(adjustment.productName).trim() : '',
          color: adjustment?.color ? String(adjustment.color).trim() : '',
          size: adjustment?.size ? String(adjustment.size).trim() : '',
          quantity: Number(adjustment?.quantity || 0),
        }))
      : [],
    createdAt: order?.createdAt ? String(order.createdAt).trim() : new Date(0).toISOString(),
    updatedAt: order?.updatedAt ? String(order.updatedAt).trim() : new Date(0).toISOString(),
    shippingSpreadsheetFileName: order?.shippingSpreadsheetFileName
      ? String(order.shippingSpreadsheetFileName).trim()
      : null,
    shippingSpreadsheetGeneratedAt: order?.shippingSpreadsheetGeneratedAt
      ? String(order.shippingSpreadsheetGeneratedAt).trim()
      : null,
  }
}

// Custom Checkout (ui_mode: 'custom', built with ShippingAddressElement) stores the
// address a customer entered under collected_information.shipping_details — the legacy
// top-level shipping_details field used by hosted Checkout is not populated for it. Read
// both so this keeps working if a session was ever created a different way.
function getCollectedShippingDetails(checkoutSession) {
  return checkoutSession?.collected_information?.shipping_details || checkoutSession?.shipping_details || null
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

  return [standardOption]
}

function buildCheckoutSessionOrderFields(checkoutSession) {
  const shippingDetails = getCollectedShippingDetails(checkoutSession)

  return {
    checkoutReference: checkoutSession.metadata?.checkout_reference || null,
    paymentIntentId:
      typeof checkoutSession.payment_intent === 'string'
        ? checkoutSession.payment_intent
        : checkoutSession.payment_intent?.id || null,
    customerEmail:
      checkoutSession.customer_details?.email || checkoutSession.customer_email || null,
    customerName: checkoutSession.customer_details?.name || shippingDetails?.name || '',
    customerPhone: checkoutSession.customer_details?.phone || shippingDetails?.phone || '',
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
    shippingDetails: serializeShippingDetails(shippingDetails),
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

const SHIPPING_SPREADSHEET_WEEKDAY_NUMBERS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function formatDateOnly(date, timeZone = SHIPPING_SPREADSHEET_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date)
}

function getZonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  })
    .formatToParts(date)
    .reduce((accumulator, part) => {
      accumulator[part.type] = part.value
      return accumulator
    }, {})

  return {
    weekday: SHIPPING_SPREADSHEET_WEEKDAY_NUMBERS[parts.weekday] ?? null,
    // Some locales render midnight as "24" instead of "0".
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    dateKey: formatDateOnly(date, timeZone),
  }
}

function isShippableOrder(order) {
  return (
    order.paymentStatus === 'paid' &&
    order.refundStatus !== 'refunded' &&
    Boolean(order.shippingDetails?.address?.line1) &&
    !order.shippingSpreadsheetFileName
  )
}

function getUnclaimedShippableOrders(orders) {
  return orders
    .filter(isShippableOrder)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
}

function summarizeOrderLineItems(order) {
  return order.lineItems
    .map((item) => {
      const variant = [item.color, item.size].filter(Boolean).join(' / ')
      return `${item.productName || 'item'}${variant ? ` (${variant})` : ''} x${item.quantity}`
    })
    .join('; ')
}

// Returns the total package weight in ounces for orders made up entirely of standard
// tees (5.3oz each). Returns null — left blank in the spreadsheet for manual entry —
// the moment any line item isn't a recognized tee, rather than report a partial weight.
function calculateOrderWeightOz(order, productsById) {
  if (!order.lineItems.length) {
    return null
  }

  let totalOz = 0

  for (const item of order.lineItems) {
    const product = productsById.get(item.productId)

    if (!product || product.category !== TEE_CATEGORY_PATH) {
      return null
    }

    totalOz += TEE_WEIGHT_OZ_PER_UNIT * Number(item.quantity || 0)
  }

  return totalOz
}

function buildShippingSpreadsheetCsv(orders, generatedAt, productsById) {
  const spreadsheetDate = formatDateOnly(generatedAt)
  const rows = [
    [
      'order_date',
      'spreadsheet_date',
      'shipper_name',
      'shipping_from',
      'customer_name',
      'address_line1',
      'address_line2',
      'city',
      'state',
      'zip',
      'country',
      'phone',
      'email',
      'order_id',
      'items',
      'weight_oz',
    ],
    ...orders.map((order) => {
      const address = order.shippingDetails?.address
      const weightOz = calculateOrderWeightOz(order, productsById)

      return [
        formatDateOnly(new Date(order.createdAt)),
        spreadsheetDate,
        SHIPPING_FROM_NAME,
        SHIPPING_FROM_ADDRESS,
        order.shippingDetails?.name || order.customerName || '',
        address?.line1 || '',
        address?.line2 || '',
        address?.city || '',
        address?.state || '',
        address?.postalCode || '',
        address?.country || '',
        order.shippingDetails?.phone || order.customerPhone || '',
        order.customerEmail || '',
        order.sessionId,
        summarizeOrderLineItems(order),
        weightOz === null ? '' : Math.round(weightOz * 10) / 10,
      ]
    }),
  ]

  return `${rows.map((row) => row.map(escapeCsvField).join(',')).join('\n')}\n`
}

async function listShippingSpreadsheets() {
  const fileNames = await fsPromises.readdir(shippingSpreadsheetsDir)
  const entries = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.csv'))
      .map(async (fileName) => {
        const filePath = path.join(shippingSpreadsheetsDir, fileName)
        const [stats, contents] = await Promise.all([
          fsPromises.stat(filePath),
          fsPromises.readFile(filePath, 'utf8'),
        ])
        const orderCount = Math.max(0, contents.trim().split('\n').length - 1)

        return {
          fileName,
          size: stats.size,
          orderCount,
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
          downloadUrl: `/api/admin/shipping-spreadsheets/${encodeURIComponent(fileName)}`,
        }
      }),
  )

  return entries.sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

// Shared by every transactional email this server sends (shipping
// spreadsheet alerts, shipped-order notices, error alerts) so the Resend
// call, auth header, and error handling only live in one place.
// Throttle so a crash loop or a repeatedly-hit broken route can't flood the
// inbox -- at most one alert email per cooldown window, regardless of how
// many errors fire in that window. Every error still goes to the console
// (Railway logs) no matter what; this only throttles the email side.
const ERROR_ALERT_COOLDOWN_MS = 5 * 60 * 1000
let lastErrorAlertSentAt = 0

// Node's fetch() (undici) wraps network-level failures in a generic
// `TypeError: fetch failed` with a `.stack` that's often just that one line
// -- the actually useful bit (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc.)
// lives on `.cause`, potentially several levels deep. Walk the chain so
// alert emails carry the real reason instead of a repeat of the message.
function describeErrorCauseChain(error) {
  const lines = []
  let current = error?.cause

  while (current) {
    const details = ['code', 'errno', 'syscall', 'hostname', 'address', 'port']
      .filter((key) => current[key] !== undefined)
      .map((key) => `${key}=${current[key]}`)
    const label = current instanceof Error ? `${current.name}: ${current.message}` : String(current)
    lines.push(details.length ? `${label} (${details.join(', ')})` : label)
    current = current instanceof Error ? current.cause : undefined
  }

  return lines
}

async function sendErrorAlertEmail(error, context = {}) {
  const now = Date.now()

  if (now - lastErrorAlertSentAt < ERROR_ALERT_COOLDOWN_MS) {
    return { sent: false, error: 'Throttled (another alert was sent recently).' }
  }

  lastErrorAlertSentAt = now

  const message = error instanceof Error ? error.message : String(error)
  const rawStack = error instanceof Error && error.stack ? error.stack : ''
  // Only worth showing if it has actual call frames beyond the one-line
  // header -- a bare "TypeError: fetch failed" with nothing else is noise.
  const stack = rawStack.includes('\n') ? rawStack : ''
  const causeChain = error instanceof Error ? describeErrorCauseChain(error) : []
  const contextLines = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${value}`)
  const timestamp = new Date().toISOString()
  const subject = `matsumoto* server error: ${message}`.slice(0, 140)
  const text = [
    `An unexpected error occurred at ${timestamp}.`,
    contextLines.length ? contextLines.join('\n') : null,
    message,
    causeChain.length ? `Caused by:\n${causeChain.join('\n')}` : null,
    stack,
  ]
    .filter(Boolean)
    .join('\n\n')
  const html = [
    `<p>An unexpected error occurred at ${timestamp}.</p>`,
    contextLines.length
      ? `<p>${contextLines.map((line) => line.replace(/</g, '&lt;')).join('<br>')}</p>`
      : '',
    `<p><strong>${message.replace(/</g, '&lt;')}</strong></p>`,
    causeChain.length
      ? `<p>Caused by:<br>${causeChain.map((line) => line.replace(/</g, '&lt;')).join('<br>')}</p>`
      : '',
    stack ? `<pre>${stack.replace(/</g, '&lt;').slice(0, 4000)}</pre>` : '',
  ]
    .filter(Boolean)
    .join('')

  return sendResendEmail({ to: ADMIN_ALERT_EMAIL, subject, text, html })
}

async function sendResendEmail({ to, subject, text, html }) {
  if (!RESEND_API_KEY) {
    return { sent: false, error: 'RESEND_API_KEY is not configured.' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        html,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      return {
        sent: false,
        error: `Resend responded with ${response.status}: ${errorBody.slice(0, 300)}`,
      }
    }

    return { sent: true, error: null }
  } catch (error) {
    return { sent: false, error: error.message || 'Email request failed.' }
  }
}

async function sendShippingSpreadsheetEmail({ fileName, orderCount, generatedAt }) {
  const dashboardUrl = `${APP_URL.replace(/\/$/, '')}/dev/shipping`
  const orderNoun = orderCount === 1 ? 'order' : 'orders'
  const generatedAtLabel = new Date(generatedAt).toLocaleString('en-US', {
    timeZone: SHIPPING_SPREADSHEET_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const subject = fileName
    ? `New shipping spreadsheet ready — ${orderCount} ${orderNoun}`
    : 'Shipping spreadsheet check — no new orders'
  const text = fileName
    ? `A new shipping spreadsheet (${fileName}) with ${orderCount} ${orderNoun} was generated at ${generatedAtLabel}.\n\nDownload it from the dev site: ${dashboardUrl}`
    : `Checked for new orders at ${generatedAtLabel} — there weren't any since the last spreadsheet. Nothing to ship this cycle.\n\nDev site: ${dashboardUrl}`
  const html = fileName
    ? `<p>A new shipping spreadsheet was generated at ${generatedAtLabel}.</p><p><strong>${orderCount}</strong> ${orderNoun} — <code>${fileName}</code></p><p><a href="${dashboardUrl}">Open the shipping spreadsheets tab</a></p>`
    : `<p>Checked for new orders at ${generatedAtLabel} — there weren't any since the last spreadsheet. Nothing to ship this cycle.</p><p><a href="${dashboardUrl}">Open the shipping spreadsheets tab</a></p>`

  return sendResendEmail({ to: SHIPPING_SPREADSHEET_ALERT_EMAIL, subject, text, html })
}

// Builds a direct link to a carrier's own tracking page. Returns null for
// carriers we don't recognize (the raw tracking number is still shown, just
// without a clickable link).
function buildCarrierTrackingUrl(carrier, trackingNumber) {
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

async function sendOrderShippedEmail(order) {
  if (!order.customerEmail) {
    return { sent: false, error: 'Order has no customer email on file.' }
  }

  const trackOrderUrl = `${APP_URL.replace(/\/$/, '')}/track-order?ref=${encodeURIComponent(
    order.checkoutReference || order.sessionId,
  )}&email=${encodeURIComponent(order.customerEmail)}`
  const carrierTrackingUrl = buildCarrierTrackingUrl(order.shippingCarrier, order.trackingNumber)
  const carrierLabel = order.shippingCarrier ? ` via ${order.shippingCarrier}` : ''
  const subject = 'Your matsumoto* order has shipped'
  const text = [
    `Your order is on its way${carrierLabel}.`,
    order.trackingNumber ? `Tracking number: ${order.trackingNumber}` : null,
    carrierTrackingUrl ? `Track it: ${carrierTrackingUrl}` : null,
    `Order status: ${trackOrderUrl}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const html = [
    `<p>Your order is on its way${carrierLabel}.</p>`,
    order.trackingNumber
      ? `<p><strong>Tracking number:</strong> ${
          carrierTrackingUrl
            ? `<a href="${carrierTrackingUrl}">${order.trackingNumber}</a>`
            : order.trackingNumber
        }</p>`
      : '',
    `<p><a href="${trackOrderUrl}">View your order status</a></p>`,
  ]
    .filter(Boolean)
    .join('')

  return sendResendEmail({ to: order.customerEmail, subject, text, html })
}

async function generateShippingSpreadsheet({ trigger = 'manual' } = {}) {
  const orders = await readStripeOrders()
  const shippableOrders = getUnclaimedShippableOrders(orders)

  if (!shippableOrders.length) {
    const emailResult = await sendShippingSpreadsheetEmail({
      fileName: null,
      orderCount: 0,
      generatedAt: new Date().toISOString(),
    })

    return { created: false, reason: 'no-new-orders', orderCount: 0, trigger, email: emailResult }
  }

  const products = await readProducts()
  const productsById = new Map(products.map((product) => [product.id, product]))

  const generatedAt = new Date()
  const fileName = `matsumoto-shipping-${formatBackupTimestamp(generatedAt)}-${randomBytes(3).toString('hex')}.csv`
  const filePath = path.join(shippingSpreadsheetsDir, fileName)
  const csvContent = buildShippingSpreadsheetCsv(shippableOrders, generatedAt, productsById)

  await fsPromises.writeFile(filePath, csvContent, 'utf8')

  const claimedSessionIds = new Set(shippableOrders.map((order) => order.sessionId))
  const updatedOrders = orders.map((order) =>
    claimedSessionIds.has(order.sessionId)
      ? normalizeStripeOrderRecord({
          ...order,
          shippingSpreadsheetFileName: fileName,
          shippingSpreadsheetGeneratedAt: generatedAt.toISOString(),
          updatedAt: generatedAt.toISOString(),
        })
      : order,
  )

  await writeStripeOrders(updatedOrders)

  const emailResult = await sendShippingSpreadsheetEmail({
    fileName,
    orderCount: shippableOrders.length,
    generatedAt: generatedAt.toISOString(),
  })

  return {
    created: true,
    fileName,
    orderCount: shippableOrders.length,
    trigger,
    generatedAt: generatedAt.toISOString(),
    email: emailResult,
  }
}

const SHIPPING_SPREADSHEET_LAST_RUN_SETTING_KEY = 'shipping_spreadsheet_last_run_date'

async function maybeRunScheduledShippingSpreadsheet() {
  const { weekday, hour, dateKey } = getZonedDateParts(new Date(), SHIPPING_SPREADSHEET_TIMEZONE)

  if (!SHIPPING_SPREADSHEET_WEEKDAYS.has(weekday) || hour < SHIPPING_SPREADSHEET_HOUR) {
    return
  }

  // Persisted in the database, not a module-level variable -- a plain
  // in-memory flag resets on every process restart, so a redeploy during the
  // trigger window on a scheduled day would re-send the email every time.
  const lastRunDateKey = await readAppSetting(SHIPPING_SPREADSHEET_LAST_RUN_SETTING_KEY)

  if (lastRunDateKey === dateKey) {
    return
  }

  await writeAppSetting(SHIPPING_SPREADSHEET_LAST_RUN_SETTING_KEY, dateKey)

  try {
    const result = await generateShippingSpreadsheet({ trigger: 'scheduled' })

    if (result.created) {
      console.log(
        `[shipping-spreadsheet] generated ${result.fileName} with ${result.orderCount} order(s).`,
      )
    }
  } catch (error) {
    console.error('[shipping-spreadsheet] scheduled generation failed:', error)
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
    images: product.images.map((image) => ({
      name: image.name,
      url: image.url,
      color: image.color || '',
      primary: Boolean(image.primary),
      secondary: Boolean(image.secondary),
    })),
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

function validateNewsletterSubscribePayload(payload) {
  const errors = []
  const email = String(payload?.email || '').trim()

  if (!email) {
    errors.push('Email is required.')
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push('Enter a valid email address.')
  }

  return errors
}

async function subscribeCustomerToNewsletter(email) {
  const normalizedEmail = email.trim().toLowerCase()
  const customers = await readCustomers()
  const existingCustomer = customers.find((customer) => customer.email === normalizedEmail)
  const now = new Date().toISOString()

  const updatedCustomer = normalizeCustomerRecord({
    ...existingCustomer,
    email: normalizedEmail,
    newsletterOptIn: true,
    tags: [...(existingCustomer?.tags || []), NEWSLETTER_TAG],
    createdAt: existingCustomer?.createdAt || now,
    updatedAt: now,
  })

  await writeCustomers(
    existingCustomer
      ? customers.map((customer) => (customer.email === normalizedEmail ? updatedCustomer : customer))
      : [...customers, updatedCustomer],
  )

  return updatedCustomer
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
  const nextProducts = products.map((product) => ({ ...product }))
  const stockAdjustments = []

  purchasedItems.forEach((item) => {
    const product = nextProducts.find((candidateProduct) => candidateProduct.id === item.productId)

    if (!product || product.inventoryScope !== 'shared-shirt') {
      return
    }

    if (!item.color || !item.size) {
      throw new Error(`Missing size or color metadata for ${product.name}.`)
    }

    const availableQuantity = Number(nextInventory?.[item.color]?.[item.size] ?? 0)
    const availableFilmQuantity = Number(product.filmInventory || 0)

    if (availableQuantity < item.quantity) {
      throw new InventoryConflictError(
        `Cannot fulfill ${product.name}: only ${availableQuantity} left in ${item.color} ${item.size}.`,
      )
    }

    if (availableFilmQuantity < item.quantity) {
      throw new InventoryConflictError(
        `Cannot fulfill ${product.name}: only ${availableFilmQuantity} design film left.`,
      )
    }

    nextInventory[item.color][item.size] = availableQuantity - item.quantity
    stockAdjustments.push({
      type: 'blank-shirt',
      productId: product.id,
      productName: product.name,
      color: item.color,
      size: item.size,
      quantity: item.quantity,
    })

    product.filmInventory = availableFilmQuantity - item.quantity
    stockAdjustments.push({
      type: 'design-film',
      productId: product.id,
      productName: product.name,
      color: '',
      size: '',
      quantity: item.quantity,
    })
  })

  return {
    nextInventory,
    nextProducts,
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
  await writeProducts(inventoryUpdate.nextProducts)
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
    filmInventory,
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

  if (productType === 'shirt') {
    const numericFilmInventory = Number(filmInventory)

    if (
      !Number.isFinite(numericFilmInventory) ||
      numericFilmInventory < 0 ||
      !Number.isInteger(numericFilmInventory)
    ) {
      errors.push('Design film inventory must be a whole number zero or greater.')
    }
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
      if (image.color && !COLOR_OPTIONS.includes(image.color)) {
        errors.push(`${image.name} has an invalid assigned color.`)
      }

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

function imageForSelectedColor(product, color) {
  return (
    product.images.find((image) => image.color && image.color === color) ||
    product.images[0] ||
    null
  )
}

function resolveCheckoutLineItems(products, shirtInventory, requestedItems) {
  const errors = []
  const lineItems = []
  const reservedFilmByProduct = new Map()

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
      const availableFilmQuantity = Number(product.filmInventory || 0)
      const reservedFilmQuantity = Number(reservedFilmByProduct.get(product.id) || 0)
      const remainingFilmQuantity = availableFilmQuantity - reservedFilmQuantity

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

      if (remainingFilmQuantity <= 0) {
        errors.push(`${product.name} is out of design film stock.`)
        return
      }

      if (item.quantity > remainingFilmQuantity) {
        errors.push(
          `${product.name} only has ${remainingFilmQuantity} design film available.`,
        )
        return
      }

      reservedFilmByProduct.set(product.id, reservedFilmQuantity + item.quantity)
    }

    const unitAmount = Math.round(
      (product.hasDeal && product.salePrice ? product.salePrice : product.price) * 100,
    )
    const imageUrl = absoluteAssetUrl(imageForSelectedColor(product, item.color)?.url)
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
        tax_behavior: STRIPE_TAX_BEHAVIOR,
        product_data: {
          name: product.name,
          description: product.description,
          ...(imageUrl ? { images: [imageUrl] } : {}),
          ...(STRIPE_DEFAULT_TAX_CODE ? { tax_code: STRIPE_DEFAULT_TAX_CODE } : {}),
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

// Looks up a customer-facing promo code (e.g. "SAVE20") and returns the
// active Stripe Promotion Code object, or null if it doesn't exist, isn't
// active, or its underlying coupon is no longer valid (expired, maxed out
// on redemptions, etc). Always re-run this server-side right before using a
// code — never trust a promotion code id handed back by the client.
async function findActivePromotionCode(code) {
  const normalizedCode = String(code || '').trim()

  if (!normalizedCode || !stripeClient) {
    return null
  }

  const result = await stripeClient.promotionCodes.list({
    code: normalizedCode,
    active: true,
    limit: 1,
  })

  const promotionCode = result.data[0]

  if (!promotionCode || !promotionCode.coupon?.valid) {
    return null
  }

  return promotionCode
}

function formatCouponDescription(coupon) {
  if (!coupon) {
    return ''
  }

  if (coupon.percent_off) {
    return `${coupon.percent_off}% off`
  }

  if (coupon.amount_off) {
    const currency = String(coupon.currency || 'usd').toUpperCase()
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(coupon.amount_off / 100)
    return `${formattedAmount} off`
  }

  return 'Discount applied'
}

function imageExtensionFromType(type) {
  if (type === 'image/png') return '.png'
  if (type === 'image/webp') return '.webp'
  return '.jpg'
}

// Uploaded product photos routinely come in around 2200x2800px straight off
// a phone/camera, but the site only ever displays them at a few hundred px
// wide -- max ~350px CSS width even accounting for retina. Downscaling to a
// generous cap and converting to WebP cuts file size dramatically (~97% in
// testing vs. ~54% from just resizing PNG) with no visible quality loss and
// alpha transparency fully intact -- WebP has been supported everywhere
// that matters (Safari 14+/iOS 14+, all modern browsers) since 2020.
const UPLOADED_IMAGE_MAX_WIDTH = 1200

// Always converts to WebP regardless of the source format. On any failure
// (corrupt upload, unsupported edge case) falls back to the original bytes
// and format so an upload never hard-fails because of optimization.
async function optimizeUploadedImage(buffer, originalExtension) {
  try {
    const metadata = await sharp(buffer).metadata()
    let pipeline = sharp(buffer).rotate() // auto-orient from EXIF, then strip it

    if (metadata.width && metadata.width > UPLOADED_IMAGE_MAX_WIDTH) {
      pipeline = pipeline.resize({ width: UPLOADED_IMAGE_MAX_WIDTH })
    }

    const webpBuffer = await pipeline.webp({ quality: 82 }).toBuffer()
    return { buffer: webpBuffer, extension: '.webp', type: 'image/webp' }
  } catch (error) {
    console.error('[image-optimize] falling back to original upload:', error.message)
    return { buffer, extension: originalExtension, type: null }
  }
}

async function persistImages(productId, images) {
  const savedImages = []

  for (const image of images) {
    const originalExtension = imageExtensionFromType(image.type)
    const [, base64Body = ''] = String(image.dataUrl).split(',')
    const rawBuffer = Buffer.from(base64Body, 'base64')
    const optimized = await optimizeUploadedImage(rawBuffer, originalExtension)
    const safeBaseName = `${productId}-${Date.now()}-${savedImages.length + 1}${optimized.extension}`
    const filePath = path.join(uploadsDir, safeBaseName)

    await fsPromises.writeFile(filePath, optimized.buffer)

    savedImages.push({
      name: image.name,
      type: optimized.type || image.type,
      url: `/uploads/${safeBaseName}`,
      fileName: safeBaseName,
      color: COLOR_OPTIONS.includes(image.color) ? image.color : '',
      primary: Boolean(image.primary),
      secondary: Boolean(image.secondary),
    })
  }

  return normalizePrimaryImages(savedImages)
}

// One-off maintenance pass over every already-uploaded product image --
// resizes/compresses to WebP the same way new uploads do automatically.
// Images that are already .webp are left alone (either already ran through
// this, or through this same pipeline on upload). Runs product-by-product
// so a failure partway through still leaves everything processed so far
// persisted, rather than losing all progress.
async function reprocessExistingProductImages() {
  const products = await readProducts()
  let imagesReprocessed = 0
  let imagesSkipped = 0
  let imagesFailed = 0
  let bytesBefore = 0
  let bytesAfter = 0
  let productsChanged = 0

  for (const product of products) {
    if (!Array.isArray(product.images) || !product.images.length) {
      continue
    }

    let productChanged = false
    const nextImages = []

    for (const image of product.images) {
      const currentFileName = image.fileName || path.basename(image.url || '')
      const currentExtension = path.extname(currentFileName).toLowerCase()

      if (!currentFileName || currentExtension === '.webp') {
        imagesSkipped += 1
        nextImages.push(image)
        continue
      }

      const currentFilePath = path.join(uploadsDir, currentFileName)

      if (!existsSync(currentFilePath)) {
        imagesSkipped += 1
        nextImages.push(image)
        continue
      }

      try {
        const rawBuffer = await fsPromises.readFile(currentFilePath)
        const optimized = await optimizeUploadedImage(rawBuffer, currentExtension)

        if (optimized.extension === currentExtension) {
          // Optimization silently fell back to the original format --
          // nothing usefully changed, leave the file as-is.
          imagesSkipped += 1
          nextImages.push(image)
          continue
        }

        const newFileName = currentFileName.replace(/\.[^.]+$/, optimized.extension)
        const newFilePath = path.join(uploadsDir, newFileName)

        await fsPromises.writeFile(newFilePath, optimized.buffer)
        await fsPromises.unlink(currentFilePath)

        bytesBefore += rawBuffer.length
        bytesAfter += optimized.buffer.length
        imagesReprocessed += 1
        productChanged = true

        nextImages.push({
          ...image,
          type: optimized.type || image.type,
          url: `/uploads/${newFileName}`,
          fileName: newFileName,
        })
      } catch (error) {
        console.error(`[reprocess-images] failed for ${currentFileName}:`, error.message)
        imagesFailed += 1
        nextImages.push(image)
      }
    }

    if (productChanged) {
      product.images = normalizePrimaryImages(nextImages)
      productsChanged += 1
    }
  }

  if (productsChanged) {
    await writeProducts(products)
  }

  return {
    productsChanged,
    imagesReprocessed,
    imagesSkipped,
    imagesFailed,
    bytesBefore,
    bytesAfter,
  }
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
    filmInventory:
      payload.productType === 'shirt' ? Math.max(0, Math.floor(Number(payload.filmInventory))) : 0,
    tag: payload.hasDeal ? 'Active Deal' : 'New Upload',
    tint: '#f4f4f4',
    images: normalizePrimaryImages(savedImages),
    colors: payload.colors,
    createdAt: new Date().toISOString(),
    type: 'uploaded',
  }
}

function mergeUpdatedProduct(existingProduct, payload, savedImages) {
  const existingImageRefs = Array.isArray(payload.existingImages)
    ? payload.existingImages
        .map((image) =>
          typeof image === 'string' ? { url: image, color: '' } : image,
        )
        .map((image) => ({
          ...image,
          url: normalizeStoredImageUrl(image?.url),
        }))
        .filter((image) => image.url)
    : null
  const keptExistingImages = Array.isArray(existingImageRefs)
    ? existingProduct.images
        .filter((image) =>
          existingImageRefs.some((imageRef) => imageRef.url === normalizeStoredImageUrl(image.url)),
        )
        .map((image) => {
          const imageRef = existingImageRefs.find(
            (candidateRef) => candidateRef.url === normalizeStoredImageUrl(image.url),
          )
          return {
            ...image,
            color: COLOR_OPTIONS.includes(imageRef?.color) ? imageRef.color : '',
            primary: Boolean(imageRef?.primary),
            secondary: Boolean(imageRef?.secondary),
          }
        })
    : existingProduct.images
  const mergedImages = normalizePrimaryImages([...keptExistingImages, ...(savedImages ?? [])])

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
    filmInventory:
      payload.productType === 'shirt' ? Math.max(0, Math.floor(Number(payload.filmInventory))) : 0,
    tag: payload.hasDeal ? 'Active Deal' : 'New Upload',
    images: mergedImages,
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

const STATIC_MIME_TYPES_BY_EXTENSION = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

// `request` is optional so existing callers that don't have one handy still
// work, but without it Range requests can't be honored -- always pass it
// when serving anything a <video> or <audio> tag might load. iOS Safari in
// particular refuses to play video that isn't served with proper 206
// Partial Content responses to its Range probes.
function serveStaticFile(response, filePath, request) {
  if (!existsSync(filePath)) {
    textResponse(response, 404, 'Not found.')
    return
  }

  const extension = path.extname(filePath).toLowerCase()
  const contentType = STATIC_MIME_TYPES_BY_EXTENSION[extension] || 'application/octet-stream'
  const fileSize = statSync(filePath).size
  const rangeHeader = request?.headers?.range
  const rangeMatch = typeof rangeHeader === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null

  if (rangeMatch) {
    const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0
    const end = rangeMatch[2] ? Number(rangeMatch[2]) : fileSize - 1

    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end < fileSize) {
      response.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
      })
      createReadStream(filePath, { start, end }).pipe(response)
      return
    }

    // Malformed or unsatisfiable range -- fall through and serve the whole
    // file rather than erroring, so playback still works either way.
  }

  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': fileSize,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(filePath).pipe(response)
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

    if (request.method === 'POST' && pathname === '/api/newsletter/subscribe') {
      const body = await readJsonBody(request)
      const validationErrors = validateNewsletterSubscribePayload(body)

      if (validationErrors.length) {
        jsonResponse(response, 400, { errors: validationErrors })
        return
      }

      await subscribeCustomerToNewsletter(String(body.email))
      jsonResponse(response, 200, { subscribed: true })
      return
    }

    if (request.method === 'POST' && pathname === '/api/promo-code/validate') {
      if (!stripeClient) {
        jsonResponse(response, 503, { valid: false, error: 'Stripe secret key is not configured.' })
        return
      }

      const body = await readJsonBody(request)
      const code = String(body.code || '').trim()

      if (!code) {
        jsonResponse(response, 400, { valid: false, error: 'Enter a promo code.' })
        return
      }

      const promotionCode = await findActivePromotionCode(code)

      if (!promotionCode) {
        jsonResponse(response, 200, { valid: false, error: 'That code is not valid or has expired.' })
        return
      }

      jsonResponse(response, 200, {
        valid: true,
        code: promotionCode.code,
        description: formatCouponDescription(promotionCode.coupon),
        percentOff: promotionCode.coupon.percent_off || null,
        amountOff: promotionCode.coupon.amount_off || null,
        currency: promotionCode.coupon.currency || null,
      })
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

      // Re-validate the promo code right before creating the session — never trust
      // a promotion code id handed back by the client, and codes are only
      // applicable at session creation (the Update Session API can't change
      // discounts afterward), so this is the last chance to attach it.
      let discounts
      if (typeof body.promoCode === 'string' && body.promoCode.trim()) {
        const promotionCode = await findActivePromotionCode(body.promoCode)
        if (!promotionCode) {
          jsonResponse(response, 400, { errors: ['That promo code is no longer valid.'] })
          return
        }
        discounts = [{ promotion_code: promotionCode.id }]
      }

      const session = await stripeClient.checkout.sessions.create({
        mode: 'payment',
        ui_mode: 'custom',
        return_url: `${APP_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        line_items: lineItems,
        ...(discounts ? { discounts } : {}),
        customer_creation: 'always',
        shipping_address_collection: {
          allowed_countries: STRIPE_ALLOWED_SHIPPING_COUNTRIES,
        },
        shipping_options: shippingOptionsForSubtotal(amountSubtotal),
        automatic_tax: {
          enabled: true,
        },
        billing_address_collection: 'required',
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description: `Matsumoto order ${checkoutReference}`,
            metadata: {
              checkout_reference: checkoutReference,
            },
            rendering_options: {
              amount_tax_display: 'exclude_tax',
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
      const sessionShippingDetails = getCollectedShippingDetails(session)

      jsonResponse(response, 200, {
        sessionId: session.id,
        checkoutReference: session.metadata?.checkout_reference || null,
        status: session.status,
        paymentStatus: session.payment_status,
        customerEmail: session.customer_details?.email || session.customer_email || null,
        customerName: session.customer_details?.name || sessionShippingDetails?.name || '',
        customerPhone: session.customer_details?.phone || sessionShippingDetails?.phone || '',
        amountSubtotal: Number(session.amount_subtotal || 0),
        amountTotal: Number(session.amount_total || 0),
        amountShipping: Number(session.shipping_cost?.amount_total || 0),
        amountTax: Number(session.total_details?.amount_tax || 0),
        shippingMethod: session.shipping_cost?.shipping_rate?.display_name || '',
        shippingDetails: serializeShippingDetails(sessionShippingDetails),
        expiresAt: Number(session.expires_at || 0) * 1000 || null,
        clientSecret: session.status === 'open' ? session.client_secret || null : null,
        publishableKey: session.status === 'open' ? STRIPE_PUBLISHABLE_KEY : null,
        orderStatus: matchedOrder?.status || null,
        fulfillmentStatus: matchedOrder?.fulfillmentStatus || null,
        shippingCarrier: matchedOrder?.shippingCarrier || '',
        trackingNumber: matchedOrder?.trackingNumber || '',
      })
      return
    }

    if (request.method === 'POST' && pathname === '/api/orders/track') {
      const body = await readJsonBody(request)
      const reference = String(body.reference || '').trim().toLowerCase()
      const email = String(body.email || '').trim().toLowerCase()

      if (!reference || !email) {
        jsonResponse(response, 400, { found: false, error: 'Enter your order reference and email.' })
        return
      }

      // Looked up from our own order records (populated once the Stripe
      // webhook fulfills the session), not live from Stripe -- this is what
      // carries the fulfillment status, carrier, and tracking number an
      // admin sets later, none of which exist on the Checkout Session
      // itself. A brand-new order may not show up here for a few seconds
      // until the webhook finishes.
      const orders = await readStripeOrders()
      const matchedOrder = orders.find((order) => {
        const orderEmail = String(order.customerEmail || '').trim().toLowerCase()

        if (orderEmail !== email) {
          return false
        }

        const orderReference = String(order.checkoutReference || '').trim().toLowerCase()
        const orderSessionId = String(order.sessionId || '').trim().toLowerCase()

        return orderReference === reference || orderSessionId === reference
      })

      if (!matchedOrder) {
        jsonResponse(response, 200, { found: false })
        return
      }

      jsonResponse(response, 200, {
        found: true,
        reference: matchedOrder.checkoutReference || matchedOrder.sessionId,
        status: matchedOrder.status,
        fulfillmentStatus: matchedOrder.fulfillmentStatus,
        refundStatus: matchedOrder.refundStatus,
        shippingCarrier: matchedOrder.shippingCarrier,
        trackingNumber: matchedOrder.trackingNumber,
        shippingMethod: matchedOrder.shippingMethod,
        shippingDetails: matchedOrder.shippingDetails,
        amountTotal: matchedOrder.amountTotal,
        amountSubtotal: matchedOrder.amountSubtotal,
        amountShipping: matchedOrder.amountShipping,
        amountTax: matchedOrder.amountTax,
        lineItems: matchedOrder.lineItems,
        createdAt: matchedOrder.createdAt,
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

    if (request.method === 'GET' && pathname === '/api/admin/shipping-spreadsheets') {
      if (!requireAdmin(request, response)) {
        return
      }

      const spreadsheets = await listShippingSpreadsheets()
      const pendingOrders = getUnclaimedShippableOrders(await readStripeOrders())
      jsonResponse(response, 200, { spreadsheets, pendingOrderCount: pendingOrders.length })
      return
    }

    if (request.method === 'POST' && pathname === '/api/admin/shipping-spreadsheets/generate') {
      if (!requireAdmin(request, response)) {
        return
      }

      const result = await generateShippingSpreadsheet({ trigger: 'manual' })
      jsonResponse(response, 200, { result })
      return
    }

    if (request.method === 'GET' && pathname.startsWith('/api/admin/shipping-spreadsheets/')) {
      if (!requireAdmin(request, response)) {
        return
      }

      const fileName = decodeURIComponent(
        pathname.replace('/api/admin/shipping-spreadsheets/', ''),
      )

      if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
        textResponse(response, 400, 'Invalid spreadsheet file name.')
        return
      }

      const targetPath = path.join(shippingSpreadsheetsDir, fileName)
      const resolvedTarget = path.resolve(targetPath)

      if (
        !resolvedTarget.startsWith(path.resolve(shippingSpreadsheetsDir)) ||
        !existsSync(resolvedTarget)
      ) {
        textResponse(response, 404, 'Not found.')
        return
      }

      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
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

      // Email the customer their tracking info the moment a tracking number
      // is newly added or changed to something different -- not on every
      // save, so editing fulfillment notes or refund status doesn't spam a
      // repeat "shipped" email.
      let shippedEmail = null
      const trackingNumberChanged =
        updatedOrder.trackingNumber && updatedOrder.trackingNumber !== existingOrder.trackingNumber

      if (trackingNumberChanged) {
        shippedEmail = await sendOrderShippedEmail(updatedOrder)
      }

      jsonResponse(response, 200, { order: publicStripeOrder(updatedOrder), shippedEmail })
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
      const submittedPassword = Buffer.from(String(body.password || ''))
      const expectedPassword = Buffer.from(ADMIN_PASSWORD)
      const passwordMatches =
        submittedPassword.length === expectedPassword.length &&
        timingSafeEqual(submittedPassword, expectedPassword)

      if (!passwordMatches) {
        jsonResponse(response, 401, { error: 'Password does not match.' })
        return
      }

      if (!ADMIN_TOTP_SECRET) {
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

      const challengeToken = buildTwoFactorChallengeToken({
        expiresAt: Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS,
        attempts: 0,
      })

      jsonResponse(response, 200, {
        authenticated: false,
        requiresTwoFactor: true,
        challengeToken,
      })
      return
    }

    if (request.method === 'POST' && pathname === '/api/admin/login/verify-2fa') {
      if (!ADMIN_TOTP_SECRET) {
        jsonResponse(response, 400, { error: 'Two-factor authentication is not configured.' })
        return
      }

      const body = await readJsonBody(request)
      const challenge = readTwoFactorChallengeToken(String(body.challengeToken || ''))

      if (!challenge) {
        jsonResponse(response, 401, {
          error: 'That code entry expired. Enter the password again.',
        })
        return
      }

      if (Number(challenge.attempts) >= TWO_FACTOR_MAX_ATTEMPTS) {
        jsonResponse(response, 401, {
          error: 'Too many incorrect codes. Enter the password again.',
        })
        return
      }

      if (!verifyTotpCode(ADMIN_TOTP_SECRET, body.code)) {
        const attempts = Number(challenge.attempts) + 1
        const nextChallengeToken = buildTwoFactorChallengeToken({
          expiresAt: Number(challenge.expiresAt),
          attempts,
        })

        jsonResponse(response, 200, {
          verified: false,
          error: 'Incorrect code.',
          challengeToken: nextChallengeToken,
          attemptsRemaining: TWO_FACTOR_MAX_ATTEMPTS - attempts,
        })
        return
      }

      const expiresAt = Date.now() + SESSION_TTL_MS
      const cookieValue = buildSessionCookie(expiresAt)

      jsonResponse(
        response,
        200,
        { verified: true, authenticated: true },
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
      const requestedExistingImages = Array.isArray(body.existingImages)
        ? body.existingImages
            .map((image) =>
              typeof image === 'string' ? { url: image, color: '' } : image,
            )
            .map((image) => ({
              ...image,
              url: normalizeStoredImageUrl(image?.url),
            }))
            .filter((image) => image.url)
        : []
      const keptExistingImages = existingProduct.images.filter((image) =>
        requestedExistingImages.some(
          (imageRef) => imageRef.url === normalizeStoredImageUrl(image.url),
        ),
      )

      if (requestedExistingImages.length !== keptExistingImages.length) {
        jsonResponse(response, 400, { errors: ['One or more existing images are invalid.'] })
        return
      }

      const invalidExistingImageColor = requestedExistingImages.some(
        (image) => image.color && !COLOR_OPTIONS.includes(image.color),
      )

      if (invalidExistingImageColor) {
        jsonResponse(response, 400, { errors: ['One or more image colors are invalid.'] })
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

    if (request.method === 'POST' && pathname === '/api/admin/products/reprocess-images') {
      if (!requireAdmin(request, response)) {
        return
      }

      const result = await reprocessExistingProductImages()
      jsonResponse(response, 200, { result })
      return
    }

    // One-off diagnostic: confirms a real Stripe Tax registration is active
    // and actually calculating tax for a given address, without needing a
    // full checkout. Uses the real Tax Calculations API, so -- like a real
    // order -- it only incurs Stripe's (tiny) tax calculation fee when a
    // registration actually covers the address; calling it repeatedly for
    // the same reason is why this stays admin-gated rather than public.
    if (request.method === 'POST' && pathname === '/api/admin/tax/check') {
      if (!requireAdmin(request, response)) {
        return
      }

      if (!stripeClient) {
        jsonResponse(response, 503, { error: 'Stripe secret key is not configured.' })
        return
      }

      const body = await readJsonBody(request)
      const address = {
        line1: String(body.line1 || '').trim(),
        city: String(body.city || '').trim(),
        state: String(body.state || '').trim(),
        postal_code: String(body.postalCode || '').trim(),
        country: String(body.country || 'US').trim(),
      }
      const amount = Math.max(1, Math.round(Number(body.amount) || 2500))

      if (!address.line1 || !address.city || !address.state || !address.postal_code) {
        jsonResponse(response, 400, { error: 'A full address (line1, city, state, postal code) is required.' })
        return
      }

      try {
        const calculation = await stripeClient.tax.calculations.create({
          currency: 'usd',
          customer_details: {
            address,
            address_source: 'shipping',
          },
          line_items: [
            {
              amount,
              reference: 'tax-check-test-item',
              ...(STRIPE_DEFAULT_TAX_CODE ? { tax_code: STRIPE_DEFAULT_TAX_CODE } : {}),
            },
          ],
        })

        jsonResponse(response, 200, {
          address,
          amount,
          taxAmount: calculation.tax_amount_exclusive,
          totalWithTax: calculation.amount_total,
          breakdown: calculation.tax_breakdown,
        })
      } catch (error) {
        jsonResponse(response, 400, {
          error: error instanceof Error ? error.message : 'Tax calculation failed.',
        })
      }

      return
    }

    if (request.method === 'GET' && pathname.startsWith('/uploads/')) {
      const targetPath = path.join(uploadsDir, pathname.replace('/uploads/', ''))
      const resolvedTarget = path.resolve(targetPath)

      if (!resolvedTarget.startsWith(path.resolve(uploadsDir))) {
        textResponse(response, 403, 'Forbidden.')
        return
      }

      serveStaticFile(response, resolvedTarget, request)
      return
    }

    const distExists = existsSync(distDir) && statSync(distDir).isDirectory()

    if (request.method === 'GET' && distExists) {
      const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1)
      const candidatePath = path.join(distDir, requestedPath)

      if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
        serveStaticFile(response, candidatePath, request)
        return
      }

      serveStaticFile(response, path.join(distDir, 'index.html'))
      return
    }

    textResponse(response, 404, 'Not found.')
  } catch (error) {
    console.error('[request-error]', request.method, pathname, error)
    // Fire-and-forget -- don't hold up the error response on an email send,
    // and don't let a Resend hiccup turn into an unhandled rejection.
    sendErrorAlertEmail(error, { route: `${request.method} ${pathname}` }).catch(() => {})

    jsonResponse(response, 500, {
      error: error instanceof Error ? error.message : 'Server error.',
    })
  }
})

// Errors that escape every try/catch (a bad async callback, a broken
// timer/interval, etc.) would otherwise crash the process with nothing but
// whatever Railway happens to capture in its own logs. Alert on these too,
// and exit deliberately after an uncaughtException -- process state may be
// corrupted at that point, so let Railway restart cleanly rather than limp
// along.
process.on('uncaughtException', (error) => {
  console.error('[uncaught-exception]', error)
  sendErrorAlertEmail(error, { source: 'uncaughtException' })
    .catch(() => {})
    .finally(() => {
      process.exit(1)
    })
})

process.on('unhandledRejection', (reason) => {
  console.error('[unhandled-rejection]', reason)
  sendErrorAlertEmail(reason, { source: 'unhandledRejection' }).catch(() => {})
})

server.listen(PORT, () => {
  process.stdout.write(
    `Matsumoto server listening on http://localhost:${PORT} using ${
      USE_HOSTED_DATABASE ? 'Turso/libSQL' : 'local SQLite'
    }\n`,
  )

  // Catch up immediately in case the server started mid-window (e.g. after a
  // restart), then keep checking on an interval for as long as it stays up.
  maybeRunScheduledShippingSpreadsheet()
  setInterval(maybeRunScheduledShippingSpreadsheet, SHIPPING_SPREADSHEET_SCHEDULE_CHECK_MS)
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
