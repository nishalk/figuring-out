# Mawada operating playbook

The objective is a dependable delivery operation: clear promises to customers, complete orders at dispatch, accountable recovery when something goes wrong, and evidence that the service is improving. The new **Operations control** workspace supports that routine.

## 1. What the team can use

| Area             | What the app does                                                                                                                                                                      | Who owns it                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Daily exceptions | Shows overdue deliveries, missing windows, unassigned work, pending/failed pickups, unreceived collected items, warehouse holds, failed-delivery returns and stale GPS on active trips | Dispatcher; warehouse owns physical reconciliation |
| Recovery plans   | Records a named owner, next action and follow-up time against each active exception; overdue follow-ups remain visible                                                                 | Dispatcher                                         |
| Planning         | Saves delivery area, date/window, customer WhatsApp consent and vendor pickup deadlines                                                                                                | Dispatcher                                         |
| Bulk assignment  | Filters by delivery date, area/address, vendor and window; previews the driver’s current/projected open legs before confirmation                                                       | Dispatcher                                         |
| Driver work      | Suggests a stop, opens navigation/calling, and retains proof drafts on the device for explicit retry                                                                                   | Driver                                             |
| Customer updates | Creates expiring tracking links and reviewable WhatsApp updates                                                                                                                        | Customer service / dispatcher                      |
| Performance      | Shows first-attempt success, on-time delivery, warehouse dwell, pickup failures/late pickups and missing promises                                                                      | Operations manager                                 |
| Reliability      | Durable sessions, login/recovery throttles, single-use email password reset, verified local SQLite backups and a readiness screen                                                      | Administrator / hosting owner                      |

Fictional demo orders are excluded from the new controls, assignments, customer updates and performance. The isolated `/demo` explains that these controls require the live workspace. Existing dashboards and reports retain their existing scope, including clearly marked sample records where previously supported.

## 2. Daily management rhythm

These are starting procedures, not automatically enforced staffing policies. Adjust the times to Mawada’s actual operating hours. All operational dates and times use Kuwait time.

### Before the first dispatch

1. Import the day’s orders. Reconcile the count of orders and item lines against the CMS source. Review excluded dates, unknown vendors and duplicate references before confirming.
2. Open **Operations control → Daily exceptions**. Review high-priority items first, then issues without recovery owners and overdue follow-ups.
3. Record delivery dates, areas and agreed windows. Record vendor pickup deadlines where agreed. Unknown promises must stay visible; they must not be counted as on-time performance.
4. Confirm driver attendance and vendor readiness. Filter work into sensible geographic groups, preview assignments and check both pickup and delivery legs already held by each driver.
5. Verify that the warehouse can physically consolidate each order. Assignment is not permission to leave with a partial order.

### During operations

- Refresh the exception queue at each dispatch wave and at least every 30 minutes while work is active. The queue is a saved-data snapshot with a visible update time; the existing order/fleet views retain their polling.
- For each problem, name one recovery owner, write the next action and set a follow-up within seven days. Use shorter follow-ups for same-day delivery risks.
- Contact the customer before promising a revised delivery time. Record consent before queuing a WhatsApp update.
- Check the driver’s active trips before adding work. Open-leg counts are a planning aid; they do not establish physical capacity, drive time, shift availability or route feasibility.
- Treat missing GPS as a device/connectivity question. Contact the driver before drawing conclusions about activity.

### End of day / shift handover

1. Reconcile failed attempts and physical returns. The warehouse confirms receipt before operations reschedules.
2. Review every pending proof draft with the driver. A draft stored on the phone has not completed the server workflow.
3. Give every unresolved exception an owner and follow-up. Share the handover through your normal team channel; the app does not automatically message colleagues.
4. Review delivered versus scheduled orders, first-attempt success, late deliveries/pickups and warehouse delays. Investigate causes before ranking individuals.
5. Check the readiness screen for the last successful backup and confirm the separate off-host copy process.

## 3. Exception rules and escalation

| Signal                      | App rule                                                                                                                | First operational response                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Delivery overdue            | Scheduled date has passed, or a recognized delivery window/explicit deadline has expired, while the order is unfinished | Confirm the current location/state; agree a recovery plan and customer communication |
| Missing delivery commitment | Date missing, or a delivery date exists without a recognized window                                                     | Agree a promise with the customer; do not invent a window                            |
| Unassigned delivery         | No delivery driver on work due today/earlier, including unscheduled work                                                | Check driver availability and assign                                                 |
| Pending vendor pickup       | Incomplete pickup on work due today/earlier, or an agreed pickup deadline has passed                                    | Confirm vendor readiness and driver assignment; investigate a recorded failure       |
| Collected but unreceived    | Vendor pickup completed, but corresponding items are not received                                                       | Warehouse checks the actual items against the manifest                               |
| Warehouse hold              | Complete order ready at warehouse for at least two hours and due today/earlier                                          | Confirm the departure plan or explain the hold                                       |
| Failed delivery             | A failed attempt remains unresolved                                                                                     | Confirm physical return, contact customer, then reschedule                           |
| Stale driver position       | Driver has an active trip and no location within five minutes                                                           | Contact driver and check location permissions/connectivity                           |

The two-hour warehouse threshold and five-minute location threshold are initial product rules. They do not create a contractual SLA. One order can produce several exceptions. Saving a recovery plan does not hide or resolve an exception; the workflow change must remove its cause.

Suggested escalation practice: the dispatcher owns initial recovery; the operations manager reviews missed follow-ups and any risk to the final delivery wave. Agree your actual acknowledgement and recovery targets after measuring the first week.

## 4. Planning and driver capacity

Use **Plan & assign** to record the delivery date, area and same-day window such as `09:00-12:00`. A plan cannot change an order during/after dispatch or bypass the failed-delivery return process. Pickup promises are recorded against individual vendor tasks.

Bulk assignment uses the exact revisions selected at preview. A changed order forces a fresh preview. Delivery assignment covers one order; pickup assignment covers all its incomplete vendor pickups. Replacing an existing assignment is highlighted. Active pickup legs cannot be reassigned through this bulk flow.

The confirmation result lists every saved or failed order. Writes are protected per order; the whole batch is not a distributed transaction. If a storage error or concurrent update causes a partial result, keep the successful changes and retry only the failed orders after refresh. Do not assume that all-or-nothing assignment occurred.

The suggested driver stop prioritizes active trips and then known delivery deadlines. Drivers still follow dispatcher instructions. Navigation uses an external maps link, not a built-in route optimizer. Browser GPS is foreground tracking and cannot guarantee locked-screen Android tracking.

## 5. Driver proof and connectivity

Proof name, selected photo, signature and checked items are saved in browser IndexedDB as the driver works. On submit, the app retains the draft before requesting GPS or uploading. If upload fails, reconnect, sign in with the same account if needed, choose **Review draft**, verify its contents and submit explicitly.

- If device storage is unavailable/full, a clear warning says the draft is only held in memory. Keep the screen open and submit while connected; reload cannot restore an unsaved draft.
- Drafts are scoped to the account in the UI and retained for up to 24 hours. They contain customer/proof information: use a private, managed device.
- The browser is not encrypted application storage. Another person with access to the device/browser profile may inspect local data. Device encryption and screen locks remain essential.
- Expired drafts are removed when draft storage is next accessed. Signing out asks about pending drafts and deletes that account’s drafts. Clearing browser storage also deletes drafts.
- GPS must be captured at the handover location. A restored draft retains its capture coordinates/time; retrying later must not substitute the depot’s location for the handover location.
- The server records when it accepts proof separately from the device’s reported capture time. Current on-time reporting uses server acceptance time; delayed offline uploads can therefore look late and need review.
- No background retry marks work complete. If the server accepted an upload but its response was lost, the order may already be completed; inspect the order and delete the stale local draft after reconciliation.
- A cached application shell helps retain access after a connection loss. The app does not cache authenticated API responses or provide a fully offline order database. Reopening offline may require reconnection before the authenticated workspace is available.

## 6. Import quality

The upload screen supports a saved mapping from supported fields to the exact column headings in the CMS export. It is saved per account. Standard headings remain the default. Duplicate/ambiguous mapped headings and missing required columns fail validation.

Existing references are shown as duplicates and block import by default. Explicitly select **Skip existing order references after review** to exclude them. This does not update existing orders or merge changed customer details. Validation errors prevent the selected new orders from being committed. Kuwait-today date selection and item-level order consistency checks remain in force.

The actual CMS export is still required for acceptance testing. Before using this with real work, compare at least one normal order, one multi-item/multi-vendor order, an excluded date, a duplicate and a row with delivery instructions. A successful template test is not evidence that the real export has been mapped correctly.

## 7. Customer communication

The chosen channel is **WhatsApp**. The app queues updates for assignment, departure, failure, rescheduling and completion only when the order has customer consent, is not fictional demo data and the public HTTPS origin is configured. Operators can also queue the current status. Queueing is not sending.

Each queued update can be reviewed, sent or cancelled. A stored claim prevents concurrent requests from sending the same queued update twice. Updates whose order status or link expiry has changed are blocked. A request with an uncertain provider outcome stays in **Needs provider review**; a process interruption can leave **Sending**. Inspect provider logs, then use **Record provider-log review** to save the verified outcome and log reference. Only queue a replacement after confirming the original was not sent. The app deliberately does not automatically resend these outcomes.

**Accepted by provider** means the WhatsApp API returned a message ID. It does not confirm phone delivery or reading; receipt webhooks are not implemented. Use provider logs for receipt checks. The provider setup is in [service configuration](service-configuration.md).

Tracking links are random, expire after seven days and expose only AWB, current status, scheduled date/window and last update time. They do not show names, addresses, phone numbers, proof images or live driver GPS. The token travels in the URL fragment and is removed from the address bar after opening. Anyone with the link can view that limited status; share privately. Revoking links invalidates all issued links on that order and cancels its queued updates. Up to 30 active tokens per order are retained, so issuing more invalidates the oldest.

## 8. Understand the scorecard

| Measure               | How it is calculated                                                                                               | What to investigate                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Scheduled             | Orders whose current delivery date is in the selected range                                                        | Reconcile against the source order book                                |
| First-attempt success | Delivered without a recorded prior failure / orders with a recorded completed or failed delivery attempt           | Address quality, customer availability, driver/customer coordination   |
| On-time delivery      | Delivered by a recognized promise / orders with a known window that are delivered or already overdue               | Late pickup, consolidation delay, assignment timing, route feasibility |
| Warehouse dwell       | Last full receipt/return-ready timestamp to last dispatch, averaged across delivered orders with usable timestamps | Dispatch waves, missing assignments, picking/loading delay             |
| Late pickups          | Completed after an agreed pickup deadline, or still incomplete after it                                            | Vendor readiness and pickup planning                                   |
| Unknown promises      | Orders/tasks lacking a measurable delivery window/pickup deadline                                                  | Data quality; do not present these as punctual                         |

Fictional orders are excluded. No measurable denominator produces **No measured records**, rather than an invented percentage. On-time calculations count open overdue orders as late. Dates select the current scheduled cohort; rescheduling moves an order between cohorts. This is not a frozen historical SLA ledger. Historical attempts and timestamps may be incomplete. CSV exports contain the selected order cohort, not proof images or customer details.

For the first week, establish a baseline rather than imposing arbitrary targets. Then agree targets for first-attempt success, on-time delivery, warehouse dwell and data completeness. Review causes by vendor/area/shift using the existing order history and export tools before deciding whether more drivers or process changes are needed.

## 9. Reliability and rollout

Sessions and authentication throttles are stored in `DATA_DIR/runtime.db`. A stable `SESSION_SECRET` and verified persistent volume are required for session survival across redeploys. This is a single-instance deployment design, including when operational data uses Supabase. Password reset and account access changes revoke old sessions through the existing authentication version checks.

Production SQLite deployments automatically attempt a local verified backup on startup and every 24 hours by default, keeping seven copies. Each backup uses SQLite’s online backup API, checks integrity and records, rehearses restoration in a separate directory and records its checksum. A local copy on the application host is not disaster recovery: configure encrypted off-host copies and rehearse a full service restore. Remote Supabase data requires the provider’s backup workflow. See [service configuration](service-configuration.md).

Roll out in this order:

1. **Administrator trial:** configure persistent storage, public origin, email and WhatsApp; verify backup/restart/recovery with fictional test orders and your own consented contacts.
2. **One-driver trial:** test actual Android camera, GPS, signature, navigation, printer/scanner and interrupted uploads over HTTPS.
3. **Dispatcher trial:** reconcile a real CMS sample, preview bulk assignments and work the exception queue through a full day.
4. **Limited live operation:** agree owners, handover rules and support coverage; review the first week daily before increasing volume.

Code and automated tests do not establish live Hostinger access, real provider delivery, Android reliability or successful off-host recovery. Those acceptance checks remain operational launch requirements.
