# Stripe local testing

Use this checklist before any live Stripe rollout.

## Start the app

1. Run the storefront and backend:
   - `npm run dev`
2. In a second terminal, forward Stripe webhooks:
   - `stripe listen --forward-to localhost:3001/api/stripe/webhook`

Keep the webhook signing secret from the Stripe CLI output in `.env.local` as `STRIPE_WEBHOOK_SECRET`.

## Session state report

After each test payment, inspect the stored result with:

```bash
npm run stripe:test:report -- <checkout_session_id>
```

If you omit the session id, the script reports the newest stored order.

The report confirms:

- order status
- checkout status
- shipping and tax totals
- customer record
- webhook events seen for that session
- inventory after any stock adjustment

## Test 1: successful payment

1. Add an in-stock product to the cart.
2. Open `/checkout`.
3. Enter contact, shipping, and payment details.
4. Use a Stripe success test card such as `4242 4242 4242 4242`.
5. Confirm the return page lands on `/checkout/return`.

Expected result:

- return page shows `payment received`
- `npm run stripe:test:report -- <session_id>` shows:
  - `status: fulfilled`
  - `paymentStatus: paid`
  - shipping/tax totals present
  - webhook event recorded
  - shared shirt inventory decremented for tracked shirt SKUs

## Test 2: failed payment

1. Open `/checkout`.
2. Use a declining test card such as `4000 0000 0000 9995`.
3. Confirm Stripe rejects the payment or returns to `/checkout/return`.

Expected result:

- return page shows `payment failed` or the checkout stays resumable
- `npm run stripe:test:report -- <session_id>` shows:
  - `status: payment_failed` when the failure webhook lands
  - no stock decrement

## Test 3: duplicate webhook delivery

1. Complete a successful test payment.
2. Copy the webhook event id from your Stripe CLI terminal.
3. Resend it:

```bash
stripe events resend <event_id>
```

Expected result:

- backend returns success for the duplicate delivery
- no second stock decrement
- no duplicated order record
- `npm run stripe:test:report -- <session_id>` still shows the same inventory quantities

The app now stores processed webhook event ids, so duplicate deliveries are acknowledged and ignored.

## Test 4: last-item inventory edge case

1. In `/dev`, set a tracked shirt size/color inventory to `1`.
2. Start two checkout sessions for that same SKU in two browser windows.
3. Complete the first payment successfully.
4. Complete the second payment after the first webhook has already reduced stock to `0`.

Expected result:

- first order is `fulfilled`
- second order is stored as `inventory_shortfall`
- second order does not decrement stock below zero
- `/checkout/return` shows that manual stock review is needed

## Notes

- `/checkout/return` is the dedicated return page for `complete`, `open`, `expired`, `payment_failed`, and `inventory_shortfall` states.
- `/checkout?resume_session_id=<id>` resumes an open Stripe session instead of forcing a new one.
- Stripe now calculates shipping and tax inside Checkout, and invoice creation is enabled for one-time orders.
