# matsumoto*

Local storefront and admin workflow for Matsumoto.

## Run it

1. Create `.env.local` from `.env.example`.
2. Set `ADMIN_PASSWORD` and `SESSION_SECRET`.
3. Run `npm run dev`.

That starts:

- the Vite frontend at `http://localhost:5173`
- the Node backend at `http://localhost:3001`

## Admin portal

The admin page lives at `/dev`.

- Auth is handled by the backend with a signed session cookie.
- Products are stored in `server/data/products.json`.
- Uploaded images are stored in `server/data/uploads/`.

Those runtime files are ignored by git.

## Build

- `npm run build` builds the frontend into `dist/`
- `npm run start` serves the built frontend, API, and uploaded images from the Node server

## Stripe checkout

- `/checkout` renders the live Stripe Checkout Elements form
- `/checkout/return` handles final session states after redirects or async payment steps
- `docs/stripe-testing.md` contains the local Stripe CLI checklist for success, failure, duplicate webhook delivery, and last-item stock tests
- `npm run stripe:test:report -- <checkout_session_id>` inspects the stored order, customer, inventory, and webhook state for a test session

## Shipping spreadsheets

The `/dev/shipping` tab generates a CSV of new paid orders for bulk upload to a shipping
label provider (opens fine in Google Sheets).

- Runs automatically every Monday, Wednesday, and Friday morning (7 AM `America/Denver` by
  default — override with `SHIPPING_SPREADSHEET_HOUR` / `SHIPPING_SPREADSHEET_TIMEZONE`).
  The server checks every 5 minutes while it's running and catches up immediately after a
  restart if it missed the window.
- Each order is claimed by the spreadsheet it appears on and is never included again, so an
  order that comes in Saturday shows up on Monday's file, not Wednesday's.
- Only paid, non-refunded orders **with a shipping address on file** are included. Orders
  missing an address stay unclaimed until one is added, rather than shipping with blanks.
- Use the "Generate now" button on `/dev/shipping` to create one on demand instead of waiting
  for the schedule — handy for testing.
- Set `RESEND_API_KEY` (from [resend.com](https://resend.com)) to email an alert to
  `jinks@matsumotoshop.com` (override with `SHIPPING_SPREADSHEET_ALERT_EMAIL`) whenever a new
  spreadsheet is created, with a link back to `/dev/shipping`. Without a key, spreadsheets
  still generate normally — the email step is just skipped.
- Files live in `server/data/shipping-spreadsheets/` (git-ignored, same as backups).
