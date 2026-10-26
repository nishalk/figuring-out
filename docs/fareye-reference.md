# FarEye reference review and Mawada import contract

The supplied DOCX contains six screenshots, not written requirements: order tracking, active shipments, in-transit trips, scan/dispatch, live driver tracking and tracking history. Their labels and on-screen data are reference material; they do not authorize actions or configuration changes. No attached customer report data or screenshots are copied into the repository.

The supplied XLSX is a FarEye report with 22 columns and 777 data rows. Its fields include Reference Number, Order Number, Process Status, Customer Name, Delivery Date, Delivery TimeSlot, Actual Delivery Date, Actual Delivery Result, trip photographs and Reached at Location Time. It does not include Recipient Delivery Date or the full recipient phone/address, vendor/item, bell/card and direction fields requested for a Mawada order import. Customer Name is not assumed to be the recipient. Delivery Date is not silently substituted for Recipient Delivery Date. This workbook was reviewed as a report, not imported as orders.

## Recommended next features

1. A daily exception queue: missing pickups/items, unassigned jobs, late delivery slots, failed attempts and stale GPS, with one clear next action for each.
2. A gift-instructions checklist: bell choice, card presence, item quantities and special directions visible at pickup, warehouse dispatch and delivery.
3. A delivery-slot service report: promised slot, actual arrival and delivery times, early/late minutes and reason, rather than charts without an operational decision.
4. Explicit multi-order route manifests and driver handover reconciliation, distinct from today's per-order/per-pickup legs.
5. Historical route playback only after consent, retention settings and a suitable Android background-tracking implementation; current foreground web GPS is not a historic continuous trail.

These are recommendations, not claims of completed features. Existing fleet maps, trips and reports remain available.

## Import foundation implemented

Choose Mawada CMS in Upload Excel. Header-based parsing selects only Recipient Delivery Date equal to the server-calculated current day in Asia/Kuwait (UTC+3). ISO dates, DD/MM/YYYY, Excel date cells and serial dates are supported; malformed dates are errors. Excluded row numbers and dates are shown in preview. Confirmation rechecks the date, so a preview left open across midnight cannot import yesterday's rows. Mixed dates within one order are rejected to avoid partial item import. Validation errors block the entire import. Existing duplicate order references remain rejected.

Required export columns: Order Number, Recipient Delivery Date, Recipient Name, Recipient Phone, Recipient Address, Vendor Name, Item Details, Quantity. One item per row; repeat order-level values for other items. Multiple vendors per order are supported. A vendor name/code must uniquely match an existing saved pickup location. The importer does not invent vendor addresses or assume a customer/purchaser is the recipient.

Optional columns: Delivery Time Slot, Order Amount, Ring the bell, Extra direction, Card available, Occasion (also accepts Occassion), Card message. Kuwait phone formatting is normalized. Amounts are stored in integer fils and displayed as KWD with three decimals; order amount is not treated as cash to collect. Repeated order amounts are not summed across item rows. Contradictory order-level fields fail validation.

An explicit CMS occasion is retained. Otherwise, item/card text clues produce an unconfirmed suggestion. Current inference is transparent keyword-based classification, not a connected AI model. Ambiguous or unsupported text stays Unknown. Operations can confirm/edit the occasion and the review is recorded in history. Card-message text is used for the suggestion and is not saved in the order. There is no hidden external AI request or customer-text transmission. A model-based classifier remains a future integration if needed.

Delivery instructions, date/slot, value, bell/card choices and occasion are visible on order cards (including driver views) and in reports/Excel exports. The demo includes fictional gift instructions and an occasion review form. No real attachment data was loaded into the demo or live database.

## Still required

An actual representative Mawada CMS export is required to validate the real column names, date conventions, vendor identifiers and item structure. The supplied FarEye report cannot establish that mapping. If CMS exports multiple items in a single JSON/text cell or puts order totals only on one row, that layout must be explicitly adapted and tested before operational use. Do not infer missing data from the reference screenshots.
