# Private trial deployment for areyoutrip.in

Deployment is pending selection of and access to a hosting provider. No DNS records have been changed and no website has been deployed.

## Required hosting

Use a Node.js 24 server or a Docker web service with a persistent disk. Static website hosting alone cannot run this app. Use one application instance while SQLite remains the database. The hosting account, DNS editor, and any billable plan selection must be managed by the domain owner.

The Dockerfile installs production dependencies from the lockfile and runs as an unprivileged user. It excludes local customer data, secrets, Git metadata and development dependencies. A persistent volume must be mounted at `/app/data`, with write access for container user `node` (UID 1000). Use automatic HTTPS termination provided by the hosting platform and a reverse proxy that sets `X-Forwarded-Proto` correctly. The app assumes one trusted proxy hop; review that configuration for the selected provider.

Set `SESSION_SECRET` to a strong random value in the host's secure environment-variable settings, never in Git or chat. Set the service port to 3000 or supply the provider's `PORT`. Production cookies require HTTPS. The health check calls `/api/setup` without writing data.

## First account

Do not expose the empty app's administrator-registration endpoint to the public. Restrict the service using the host's private access or temporary access control, create the administrator account over HTTPS, and verify that GET `/api/setup` returns `{"required":false}` before opening access to testers. If the provider has no way to protect initial registration, implement an invitation/bootstrap mechanism before deploying. Do not reuse development accounts or copy a database with test credentials to the public service.

## Domain connection

After the app is healthy on the host, add `areyoutrip.in` in that host's custom-domain settings. Use exactly the DNS records the host supplies. Do not guess an IP address, replace nameservers, or delete mail records. Check for an existing website before replacing root-domain records; a dedicated subdomain can be used if the root already hosts another service. Validate the HTTPS certificate and a sign-in from an Android phone before considering domain setup complete.

## Trial and retention

Use dummy orders first. Verify two separate vendor pickups, warehouse consolidation, blocked incomplete dispatch, AWB printing/scanning, delivery proof, and failed-attempt return/rescheduling. Test permissions from each role. Android camera/location permissions must work over HTTPS.

Orders, user accounts and proof images are all in SQLite at `/app/data/app.db`. Configure automatic off-instance backups using SQLite's backup API or a stopped-service consistent copy, and test recovery. Copying a live database file alone is not a backup procedure. Test a restart/redeployment and confirm that records survive. Sessions currently reset after restart; users must sign in again. Rate limiting, account recovery and further production hardening are still required before using real customer records.

## Current verification status

The app's six automated tests and phone-sized browser trial passed before packaging. Container build verification in this workspace is incomplete: Docker's network could not resolve the workspace proxy hostname (`EAI_AGAIN`). Dependencies were not installed in an image, and no container runtime or domain deployment is claimed. Verify the image build and persistent storage on the selected host before trial use. The domain owner identified Hostinger; its hosting plan and deployment access are still unknown.
