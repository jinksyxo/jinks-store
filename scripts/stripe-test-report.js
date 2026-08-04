import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createClient } from '@libsql/client'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  try {
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
      const value = trimmedLine.slice(separatorIndex + 1).trim()

      if (key && process.env[key] === undefined) {
        process.env[key] = value
      }
    })
  } catch {}
}

loadEnvFile(path.join(rootDir, '.env'))
loadEnvFile(path.join(rootDir, '.env.local'))

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || ''
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || ''
const targetSessionId = String(process.argv[2] || '').trim()

function parsePayload(rawValue) {
  try {
    return JSON.parse(String(rawValue || '{}'))
  } catch {
    return {}
  }
}

async function readStoreFromTurso() {
  const client = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  })

  try {
    const [ordersResult, customersResult, inventoryResult, eventsResult] = await Promise.all([
      client.execute('SELECT payload FROM stripe_orders ORDER BY updated_at DESC LIMIT 20'),
      client.execute('SELECT payload FROM customers ORDER BY updated_at DESC LIMIT 20'),
      client.execute('SELECT payload FROM shirt_inventory WHERE id = 1'),
      client.execute('SELECT payload FROM stripe_webhook_events ORDER BY created_at DESC LIMIT 20'),
    ])

    return {
      orders: ordersResult.rows.map((row) => parsePayload(Object.fromEntries(Object.entries(row)).payload)),
      customers: customersResult.rows.map((row) =>
        parsePayload(Object.fromEntries(Object.entries(row)).payload),
      ),
      inventory: inventoryResult.rows[0]
        ? parsePayload(Object.fromEntries(Object.entries(inventoryResult.rows[0])).payload)
        : null,
      webhookEvents: eventsResult.rows.map((row) =>
        parsePayload(Object.fromEntries(Object.entries(row)).payload),
      ),
      backend: 'turso',
    }
  } finally {
    client.close()
  }
}

function readStoreFromSqlite() {
  const databaseFilePath = path.join(rootDir, 'server', 'data', 'store.sqlite')
  const db = new DatabaseSync(databaseFilePath)

  try {
    return {
      orders: db
        .prepare('SELECT payload FROM stripe_orders ORDER BY updated_at DESC LIMIT 20')
        .all()
        .map((row) => parsePayload(row.payload)),
      customers: db
        .prepare('SELECT payload FROM customers ORDER BY updated_at DESC LIMIT 20')
        .all()
        .map((row) => parsePayload(row.payload)),
      inventory: (() => {
        const row = db.prepare('SELECT payload FROM shirt_inventory WHERE id = 1').get()
        return row ? parsePayload(row.payload) : null
      })(),
      webhookEvents: db
        .prepare('SELECT payload FROM stripe_webhook_events ORDER BY created_at DESC LIMIT 20')
        .all()
        .map((row) => parsePayload(row.payload)),
      backend: 'sqlite',
    }
  } finally {
    db.close()
  }
}

function summarize(store) {
  const order =
    store.orders.find((candidate) => candidate.sessionId === targetSessionId) || store.orders[0] || null
  const relatedEvents = order
    ? store.webhookEvents.filter((event) => event.sessionId === order.sessionId)
    : store.webhookEvents
  const customer = order
    ? store.customers.find(
        (candidate) =>
          String(candidate.email || '').toLowerCase() ===
          String(order.customerEmail || '').toLowerCase(),
      ) || null
    : null

  return {
    backend: store.backend,
    inspectedSessionId: order?.sessionId || targetSessionId || null,
    order: order
      ? {
          sessionId: order.sessionId,
          status: order.status,
          checkoutStatus: order.checkoutStatus,
          paymentStatus: order.paymentStatus,
          amountSubtotal: order.amountSubtotal,
          amountShipping: order.amountShipping,
          amountTax: order.amountTax,
          amountTotal: order.amountTotal,
          shippingMethod: order.shippingMethod,
          customerEmail: order.customerEmail,
          shippingDetails: order.shippingDetails,
          stockAdjustments: order.stockAdjustments,
          fulfillmentNotes: order.fulfillmentNotes,
          updatedAt: order.updatedAt,
        }
      : null,
    customer: customer
      ? {
          email: customer.email,
          newsletterOptIn: customer.newsletterOptIn,
          tags: customer.tags,
          notes: customer.notes,
          orderCount: customer.orderCount,
          paidOrderCount: customer.paidOrderCount,
          totalSpent: customer.totalSpent,
          lastOrderedAt: customer.lastOrderedAt,
        }
      : null,
    inventoryAfterAdjustments: order
      ? (order.stockAdjustments || []).map((adjustment) => ({
          color: adjustment.color,
          size: adjustment.size,
          quantityAfter: store.inventory?.[adjustment.color]?.[adjustment.size] ?? null,
        }))
      : [],
    webhookEvents: relatedEvents,
  }
}

const store = TURSO_DATABASE_URL ? await readStoreFromTurso() : readStoreFromSqlite()
process.stdout.write(`${JSON.stringify(summarize(store), null, 2)}\n`)
