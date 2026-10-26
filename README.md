# Relay — Kuwait delivery prototype

A cloud-hostable prototype for one warehouse, online Android drivers, multi-vendor orders, and complete-order delivery. Node.js 24 is required (built-in SQLite).

## Run

```sh
npm ci --cache /workspace/.npm-cache
npm test
npm start
```

Open the app and create the first administrator account. Create driver and warehouse users, register vendors, then create orders. Excel imports use one item per row; columns are `reference, recipient, phone, address, vendorCode, name, quantity`. Phone cells must be text (`+965` and eight digits). Validate the preview before confirming.

Operational data and proof images are stored in `data/app.db`; keep this on a persistent volume and back it up. Never commit it. A running cloud development workspace is not public production hosting. HTTPS is required for phone GPS and secure cookies. For HTTPS deployment set `NODE_ENV=production` and a securely supplied `SESSION_SECRET`. The first-administrator setup must be completed privately before making the service public.

## Current scope and limitations

Implemented: user roles, vendor address snapshots, itemized orders, Excel validation and confirmation, driver assignment/reassignment, aggregate pickup proof, warehouse item receipt, complete-order dispatch restriction, delivery photo/signature/name/GPS, audit history, and printable order references.

This is a prototype, not production-ready dispatch software. Pickup completion currently applies to the whole order: separate vendor pickup tasks/proofs still need implementation. Add-to-existing-order warehouse consolidation, barcode/QR AWB labels, failed delivery/rescheduling, customer messaging/tracking, API integrations, account recovery, rate limiting, persistent session storage, pagination, production hosting and automated backups remain outstanding. Current print action prints the order board; it is not a finished AWB layout. No public tracking URLs are exposed. Session memory resets on restart. Camera, signature usability and GPS require validation on a real Android phone over HTTPS.

## Tests

`npm test` verifies complete-order dispatch rules. The onboarding smoke test separately exercises authentication, role access, vendor creation and the full pickup/warehouse/delivery lifecycle against an isolated temporary database.
