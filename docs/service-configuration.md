# Configure customer communication, recovery and backups

Set secrets only in the hosting platform’s secure environment settings. Do not commit them, paste them in chat or put them in browser code. The implementation uses existing server-side records; it does not require a Supabase schema change.

## Shared public address

Set `PUBLIC_APP_URL` to the canonical HTTPS origin, for example `https://delivery.example.com`, with no path, query or credentials. Tracking/reset links are derived from this configured value, never from an incoming Host header. HTTPS and the host’s forwarded cookie settings still require validation.

## WhatsApp Business Cloud API

| Setting                      | Purpose                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN`      | Server-side Meta WhatsApp Business token authorized for sending                                                           |
| `WHATSAPP_PHONE_NUMBER_ID`   | Sender phone-number ID (digits)                                                                                           |
| `WHATSAPP_GRAPH_VERSION`     | Graph API version supported by your Meta account, in `vNN.N` format; explicitly configured rather than assuming a version |
| `WHATSAPP_TEMPLATE`          | An approved utility template name                                                                                         |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Approved template language, defaults to `en`                                                                              |

The approved template must accept exactly three text body parameters in this order: **AWB**, **status label**, **private tracking URL**. Example body for approval: `Mawada {{1}}: {{2}}. Track your delivery: {{3}}`. The app currently sends English status labels; use an English approved template unless you also adapt/localize those labels. It does not create or approve Meta templates or use unrestricted free-form messages outside the customer-service window.

After configuring Meta’s business account, sender, token permissions and template approval:

1. Use your own consented Kuwait number on an isolated operational test order.
2. Record consent in **Operations control → Plan & assign**. Queue the current update in **Customer updates**.
3. Review the exact number/message and choose Send. Verify the returned provider acceptance, then independently verify the actual phone receipt in WhatsApp/provider logs.
4. Test an expired/revoked tracking link and a cancelled queue item. Do not send to real customers until the trial succeeds.

Outbound access to `graph.facebook.com` must be permitted by the hosting network. Credentials/template approval may have cost or business-account requirements. No live sending is claimed by the local tests, which stub the provider API. Receipt callbacks are not implemented; accepted messages remain labelled as accepted, not delivered/read.

## Email password reset

The chosen recovery flow is an email link using the Resend HTTP API:

| Setting                  | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `RECOVERY_EMAIL_API_KEY` | Server-side Resend API key                       |
| `RECOVERY_EMAIL_FROM`    | Sender address/name on a verified sending domain |
| `PUBLIC_APP_URL`         | Canonical HTTPS app origin                       |

The host must permit outbound requests to `api.resend.com`. Verify the sender domain through the provider. The app does not change DNS or provision a provider account.

Use **Forgot your password?** on the login form. Responses do not disclose whether an account exists. A random reset token is stored only as a hash on the account, expires after 30 minutes and is consumed by the password update with a revision check. Successful reset revokes all old login sessions. The reset page removes the fragment token from its address bar. Passwords must have at least 12 characters and fit within bcrypt’s 72 UTF-8 byte limit. Administrator password changes remain available as an operational fallback.

If sending is unavailable or rejected, the token is revoked and the caller receives the same generic response. Contact the administrator if no message arrives. Automated coverage checks single use, expiry paths/input validation, session revocation and hidden recovery material with a stubbed email provider. Verify actual sending, spam placement, provider account access and reset completion with a test mailbox before launch.

Authentication throttles are persistent per source IP: login/setup 30 requests per 15 minutes, recovery requests 5 per 15 minutes, reset submissions 10 per 15 minutes, tracking 120 per minute. People behind a shared network share these limits. Validate the single trusted reverse-proxy hop before production; do not expose the Node port directly behind an untrusted forwarded-header path.

## Sessions

`DATA_DIR/runtime.db` stores sessions and throttles with file permissions limited to the process user. Sessions last up to eight hours. `SESSION_SECRET` must be stable across restarts and at least 32 random characters in production. Losing either the runtime file or the secret signs users out.

Keep one app instance with a persistent writable volume. This applies even if `DATABASE_BACKEND=supabase`: operational data is remote, while sessions/throttles remain in the local runtime database. A shared session service is required before horizontal scaling. Do not copy runtime session data into historical restore environments or expose it in a downloadable backup.

## SQLite backup and restore

Production SQLite startup enables local automatic backups. Defaults:

- Run on startup and every 24 hours while this process runs.
- Store in `DATA_DIR/backups`; keep the newest seven verified backups.
- Verify database integrity/record bodies and rehearse a restore into an isolated directory.
- Publish the last success in `DATA_DIR/backup-status.json`, shown under Operations control → Readiness.

Optional settings: `BACKUP_DIR` (absolute writable path), `BACKUP_INTERVAL_HOURS` (1–168), `BACKUP_KEEP` (2–90), `AUTO_BACKUP=false` to disable the in-process schedule when an external scheduler owns it. A sleeping/stopped hosting process cannot run scheduled work. A successful startup copy does not prove the host will stay alive until the next scheduled backup.

Manual commands run from the app root:

```sh
npm run backup
npm run backup:verify -- /absolute/path/to/mawada-backup.db
npm run backup:restore -- /absolute/path/to/mawada-backup.db /absolute/new-empty-data-directory
```

Restore requires the matching `.db.json` checksum manifest and an empty destination. It refuses to overwrite existing data. A rehearsal reads the backed-up records without replacing the live service. A full recovery still requires stopping the app, choosing the recovered `DATA_DIR`, supplying secrets securely, restarting, signing in and reconciling recent activity. Sessions are deliberately not restored.

Backups include customer/proof data. Restrict filesystem access, encrypt off-host copies, select retention for your actual policy and check disk capacity. The app’s seven-copy retention is local only; it neither copies to another host nor encrypts the backup. For an external scheduler, use an absolute app path and a single job owner; run at an agreed Kuwait time. Do not create a second scheduler until ownership is decided.

For Supabase, the SQLite backup command fails explicitly and the automatic local schedule is disabled. Configure database-provider backups/PITR as appropriate to your plan and perform a provider restore drill. The application readiness screen cannot establish remote backup readiness. No remote schema, provider policy, subscription or hosting configuration was changed by this implementation.

## Acceptance evidence to keep

Record the date, tester and result for: restart retention; successful email reset; WhatsApp receipt on the test number; actual CMS reconciliation; Android offline proof retry; backup checksum verification; and a full restore to a separate test instance. The repository’s automated checks supplement this evidence and do not replace live service checks.
