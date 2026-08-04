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
