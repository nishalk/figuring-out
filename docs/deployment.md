# Private trial deployment for areyoutrip.in

Hostinger managed Node deployment has been configured at delivery.areyoutrip.in. The user reports a 503 runtime failure despite a completed build. Runtime logs are not accessible from this coding workspace; the live failure is not yet diagnosed. The isolated sample demo and startup-status page are designed to remain available when application configuration is incomplete. This does not establish that the hosting process itself can start.

## Required hosting

Use a Node.js 24 server or a Docker web service with a persistent disk. Static website hosting alone cannot run this app. Use one application instance while SQLite remains the database. The hosting account, DNS editor, and any billable plan selection must be managed by the domain owner.

The Dockerfile installs production dependencies from the lockfile and runs as an unprivileged user. It excludes local customer data, secrets, Git metadata and development dependencies. A persistent volume must be mounted at `/app/data`, with write access for container user `node` (UID 1000). Use automatic HTTPS termination provided by the hosting platform and a reverse proxy that sets `X-Forwarded-Proto` correctly. The app assumes one trusted proxy hop; review that configuration for the selected provider.

Set `SESSION_SECRET` to a strong random value in the host's secure environment-variable settings, never in Git or chat. Set the service port to 3000 or supply the provider's `PORT`. Production cookies require HTTPS. The health check calls `/api/setup` without writing data.

## First account

Set `NODE_ENV=production`, and generate separate random `SESSION_SECRET` and `SETUP_KEY` values of at least 32 characters directly in the host's secure environment-variable editor. Keep the setup key in your password manager. Production startup fails if the session secret is missing/too short, or if an empty database has no adequate setup key. The administrator-registration form requires that setup key. A missing or incorrect key cannot register an administrator; after the first account, further registration at that endpoint is disabled. Use the first-account form to choose your own email and a separate account password. Do not send any of these values in chat.

`DATA_DIR` optionally specifies the absolute writable directory for `app.db`. Set it only after the host confirms a persistent path. The default is `data/` under the process working directory; this is not evidence that hosted data survives deployments. Dummy-data trials can validate startup while storage retention is unresolved, but do not use real customer records. The configured-directory restart test passes locally; Hostinger storage persistence still needs independent verification.

## Domain connection

After the app is healthy on the host, add `areyoutrip.in` in that host's custom-domain settings. Use exactly the DNS records the host supplies. Do not guess an IP address, replace nameservers, or delete mail records. Check for an existing website before replacing root-domain records; a dedicated subdomain can be used if the root already hosts another service. Validate the HTTPS certificate and a sign-in from an Android phone before considering domain setup complete.

## Trial and retention

Use dummy orders first. Verify two separate vendor pickups, warehouse consolidation, blocked incomplete dispatch, AWB printing/scanning, delivery proof, and failed-attempt return/rescheduling. Test permissions from each role. Android camera/location permissions must work over HTTPS.

Orders, user accounts and proof images are all in SQLite at `/app/data/app.db`. Configure automatic off-instance backups using SQLite's backup API or a stopped-service consistent copy, and test recovery. Copying a live database file alone is not a backup procedure. Test a restart/redeployment and confirm that records survive. Sessions currently reset after restart; users must sign in again. Rate limiting, account recovery and further production hardening are still required before using real customer records.

## Current verification status

The app's six automated tests and phone-sized browser trial passed before packaging. Container build verification in this workspace is incomplete: Docker's network could not resolve the workspace proxy hostname (`EAI_AGAIN`). Dependencies were not installed in an image, and no container runtime or domain deployment is claimed. Verify the image build and persistent storage on the selected host before trial use. The domain owner identified Hostinger; its hosting plan and deployment access are still unknown.

## Hostinger managed Node deployment

The selected destination is `delivery.areyoutrip.in`, with Express, branch `main`, Node.js `24.x`, npm, entry file `server.js`, and root `./`. Use the environment variables above. The existing WordPress site remains at the root domain. The application itself does not provide durable sessions yet. Verify HTTPS, forwarded secure cookies, login, and database retention on Hostinger after deployment; managed hosting details cannot be inferred from the setup screenshots.
