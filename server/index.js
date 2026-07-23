import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { promises as fsPromises } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = path.join(rootDir, 'server', 'data')
const uploadsDir = path.join(dataDir, 'uploads')
const productsFilePath = path.join(dataDir, 'products.json')
const PORT = Number(process.env.PORT || 3001)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'matsumoto-dev'
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-this-session-secret'
const COOKIE_NAME = 'matsumoto_admin'
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_COUNT = 6
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024
const SESSION_TTL_MS = 1000 * 60 * 60 * 12
const COLOR_OPTIONS = ['black', 'white', 'ash-grey']
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL']

mkdirSync(dataDir, { recursive: true })
mkdirSync(uploadsDir, { recursive: true })

if (!existsSync(productsFilePath)) {
  writeFileSync(productsFilePath, '[]\n')
}

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

function normalizeProducts(products) {
  return [...products].sort((left, right) => {
    const leftTime = new Date(left.createdAt ?? 0).getTime()
    const rightTime = new Date(right.createdAt ?? 0).getTime()
    return rightTime - leftTime
  })
}

async function readProducts() {
  const fileContents = await fsPromises.readFile(productsFilePath, 'utf8')
  return normalizeProducts(JSON.parse(fileContents))
}

async function writeProducts(products) {
  await fsPromises.writeFile(
    productsFilePath,
    `${JSON.stringify(normalizeProducts(products), null, 2)}\n`,
  )
}

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

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk.toString('utf8')

      if (body.length > MAX_TOTAL_IMAGE_BYTES * 10) {
        reject(new Error('Request body is too large.'))
        request.destroy()
      }
    })

    request.on('end', () => {
      if (!body) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Request body is not valid JSON.'))
      }
    })

    request.on('error', reject)
  })
}

function validateInventory(inventory, selectedColors) {
  if (!selectedColors.length) {
    return 'Select at least one color.'
  }

  const hasInventory = selectedColors.some((color) =>
    SIZE_OPTIONS.some((size) => Number(inventory?.[color]?.[size] || 0) > 0),
  )

  if (!hasInventory) {
    return 'Add at least one inventory quantity greater than zero.'
  }

  return null
}

function validateProductPayload(payload) {
  const errors = []
  const {
    category,
    title,
    description,
    price,
    hasDeal,
    salePrice,
    colors,
    inventory,
    images,
  } = payload

  if (!['/tees', '/dress-shirts', '/bottoms', '/other-merchandise'].includes(category)) {
    errors.push('Category is invalid.')
  }

  if (!String(title || '').trim()) {
    errors.push('Title is required.')
  }

  if (!String(description || '').trim()) {
    errors.push('Description is required.')
  }

  if (!Number.isFinite(Number(price)) || Number(price) <= 0) {
    errors.push('Price must be greater than zero.')
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
    ? colors.filter((color) => COLOR_OPTIONS.includes(color))
    : []

  if (normalizedColors.length !== (colors || []).length) {
    errors.push('One or more selected colors are invalid.')
  }

  const inventoryError = validateInventory(inventory, normalizedColors)

  if (inventoryError) {
    errors.push(inventoryError)
  }

  if (!Array.isArray(images) || !images.length) {
    errors.push('At least one image is required.')
  } else {
    if (images.length > MAX_IMAGE_COUNT) {
      errors.push(`Use ${MAX_IMAGE_COUNT} images or fewer.`)
    }

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
        errors.push(`${image.name} exceeds the 2.5 MB limit.`)
      }
    })

    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      errors.push('The combined image payload is too large.')
    }
  }

  return errors
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
    const safeBaseName = `${productId}-${savedImages.length + 1}${extension}`
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
  const normalizedInventory = COLOR_OPTIONS.reduce((inventory, color) => {
    inventory[color] = SIZE_OPTIONS.reduce((sizes, size) => {
      sizes[size] = Number(payload.inventory?.[color]?.[size] || 0)
      return sizes
    }, {})
    return inventory
  }, {})

  const availableSizes = SIZE_OPTIONS.filter((size) =>
    payload.colors.some((color) => normalizedInventory[color][size] > 0),
  )

  return {
    id: randomBytes(12).toString('hex'),
    category: payload.category,
    name: String(payload.title).trim(),
    description: String(payload.description).trim(),
    price: Number(payload.price),
    hasDeal: Boolean(payload.hasDeal),
    salePrice: payload.hasDeal ? Number(payload.salePrice) : null,
    tag: payload.hasDeal ? 'Active Deal' : 'New Upload',
    tint: '#f4f4f4',
    images: savedImages,
    colors: payload.colors,
    inventory: normalizedInventory,
    availableSizes,
    createdAt: new Date().toISOString(),
    type: 'uploaded',
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
    if (request.method === 'GET' && pathname === '/api/products') {
      const products = await readProducts()
      jsonResponse(response, 200, { products: products.map(publicProduct) })
      return
    }

    if (request.method === 'GET' && pathname === '/api/admin/session') {
      const cookies = parseCookies(request)
      jsonResponse(response, 200, { authenticated: validateSessionCookie(cookies[COOKIE_NAME]) })
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

      const productId = randomBytes(12).toString('hex')
      const savedImages = await persistImages(productId, body.images)
      const product = {
        ...buildStoredProduct(body, savedImages),
        id: productId,
      }
      const products = await readProducts()
      await writeProducts([product, ...products])

      jsonResponse(response, 201, { product: publicProduct(product) })
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
  process.stdout.write(`Matsumoto server listening on http://localhost:${PORT}\n`)
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
