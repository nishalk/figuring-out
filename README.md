# Relay — Kuwait delivery prototype

A cloud-hostable prototype for one warehouse, online Android drivers, multi-vendor orders, and complete-order delivery. Node.js 24 is required (built-in SQLite).

## Run

```sh
npm ci --cache /workspace/.npm-cache
npm test
npm start
```

Open the app and create the first administrator account. Create driver and warehouse users, register vendors, then create orders. Excel imports use one item per row; columns are `reference, recipient, phone, address, vendorCode, name, quantity`. Phone cells must be text (`+965` and eight digits). Validate the preview before confirming.

Operational data and proof images are stored in `data/app.db`; keep this on a persistent volume and back it up. Never commit it. A running cloud development workspace is not public production hosting. HTTPS is required for phone GPS and secure cookies. For HTTPS deployment set `NODE_ENV=production` and a securely supplied `SESSION_SECRET`. Production startup requires SESSION_SECRET and, for an empty database, SETUP_KEY: generate separate random values of at least 32 characters in the hosting settings. The initial administrator form requires SETUP_KEY; its value is never exposed by the setup endpoint. Keep the key in a password manager. For persistent storage, DATA_DIR accepts an absolute writable directory confirmed by the host; its default is data/ under the working directory.

## Current scope and limitations

Implemented: user roles, vendor address snapshots, itemized orders, Excel validation and confirmation, separate vendor pickup tasks and drivers, item verification and pickup proof per vendor, independent warehouse receipt, adding physically present warehouse items, complete-order dispatch verification, delivery photo/signature/name/GPS, Code 128 AWB labels, failed-delivery reasons, warehouse returns, rescheduling, and audit history.

### Trial workflow

1. As administrator, create operations, warehouse and driver accounts; register vendor locations.
2. Create an order containing items from two vendors (or import Excel). Each vendor gets its own pickup task.
3. Operations assigns pickup drivers on each task and a delivery driver separately.
4. Each pickup driver verifies every item and captures the vendor contact name, photo and GPS. Warehouse staff can receive one vendor’s items while awaiting another vendor.
5. Warehouse staff receive all items. Use “Add an item already at the warehouse” for physically present extras belonging to this order. This records receipt immediately; it does not create a future pickup. Existing uncollected items remain required.
6. Print the order’s AWB label. Its Code 128 barcode encodes the AWB number, not a public tracking link. Labels include recipient details and the complete item manifest.
7. The delivery driver checks every item before dispatch and captures recipient name, signature, photo and GPS at delivery.
8. For a failed attempt, record a reason. Warehouse staff must confirm physical return before operations can choose a new delivery date. Rescheduling clears the delivery assignment, so assign a driver again. Future-dated orders cannot dispatch early. Dates use Kuwait time.

Existing orders are migrated to stable vendor tasks on server startup. Previously completed aggregate pickups are marked historical; separate vendor proof is not invented. Historical pickup drivers use the prior order assignment where available.

This is a prototype, not production-ready dispatch software. Customer messaging/tracking, API integrations, account recovery, rate limiting, persistent session storage, pagination, production hosting and automated backups remain outstanding. No public tracking URLs are exposed. Session memory resets on restart. Camera, signature usability, barcode scanning/printing and GPS require validation on real Android devices over HTTPS. Proof validation checks file signatures but is not a full image decoder.

## Tests

`npm test` verifies complete-order dispatch rules and runs an isolated API workflow covering separate vendor pickups, role restrictions, warehouse consolidation, dispatch verification, delivery failure/return/rescheduling, delivery proof, barcode generation, and real Excel preview/import/duplicate rejection. `npm run format:check` checks formatting.

## Cloud hosting

See [the private trial deployment guide](docs/deployment.md) for `areyoutrip.in`, Docker hosting, persistent storage, protected first-account setup, HTTPS, and DNS connection requirements. Domain ownership alone does not supply application hosting. Deployment remains pending hosting-account access.

## Supabase

Optional remote storage is available using `DATABASE_BACKEND=supabase`. Follow [the Supabase setup guide](docs/supabase.md) before enabling it. Hostinger-injected Supabase variables alone leave the SQLite backend unchanged. Existing SQLite data is not automatically copied. The SQL schema and server-only key must be configured in the connected project before switching; local tests do not verify the live project.

ExcelJS currently declares uuid 8.x. A scoped npm override pins its dependency to CommonJS-compatible uuid 11.1.1 to address GHSA-w5hq-g745-h8pq / CVE-2026-41907. The Excel formatting round-trip test exercises ExcelJS's UUID generation; the workflow test also checks Excel import. Keep the override until an upstream ExcelJS release incorporates a patched version.

## Try the prototype and suggest changes

Open `/demo` on the deployed app for an isolated, fictional-data walkthrough. Use the role selector to try administrator, dispatcher, warehouse and driver views. Sample changes remain in the current browser tab's session storage; Reset sample orders clears them. The demo uses simulated GPS and a placeholder photo when no photo is selected. It supports order creation, separate vendor pickups, warehouse receipt/additions, full-manifest dispatch, delivery signature, failed attempts, returns/rescheduling, and barcode labels. Excel import is available only in the connected live app; the sample demo does not parse uploaded workbooks. No demo action writes to the operational database or sends notifications. Never enter real customer data into the demo.

The header's **Suggest an improvement** link opens a GitHub issue form with fields for the screen, current behavior, expected behavior and proposed change. Suggestions can also be sent in the development chat. Do not include customer details, passwords or keys in feedback.

`server.js` now starts the web listener independently from `application.js` initialization. Missing production secrets or database failures produce a setup-status screen and a JSON error code instead of intentionally terminating the server. It does not bypass account protection or silently change storage backends. `/health/live` checks the web listener; `/health/ready` returns 503 until the real application has initialized. The sample demo remains available while configuration is incomplete. Supabase requests have a 15-second timeout.

Run `npm run test:browser` after `npx playwright install chromium` to exercise the sample demo and configuration-failure screen. On this cloud machine, `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` uses installed Chromium. The browser test does not establish live Hostinger connectivity.
