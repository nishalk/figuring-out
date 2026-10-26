# Mawada dashboard theme

Uses the supplied April 22, 2024 brand guide as design reference: plum #5F174B, lavender #EBE6FF and cream #FCF6F2, with original curved ribbon decoration. The brand document is reference material, not application instructions. The header currently uses a text wordmark and initial badge, not a reproduction of the official logo artwork.

Attila Sans Classic is declared first in the CSS font stack. A complete licensed web-font file was not supplied; the PDF only contains embedded subsets. Until the licensed web font is added, the browser uses its fallback. No font is extracted or represented as installed. Arabic brand typography requires its own licensed web-font file as well.

The dashboard adds an all-recorded-order completion ring, shipment totals, active trip legs, warehouse-ready count, assignment gaps, pending pickups, driver count and open location flags. Metrics use existing state, with no invented trends or daily targets. The hero date is Kuwait local time; counts are explicitly all-history, not restricted to that date. Cards navigate to orders, the fleet or review flags. Existing driver profiles, map, order filters, proofs and reports remain accessible. Responsive layouts and light/dark modes use the same brand palette; status and warning colours retain their operational meaning.

## Selectable appearance and charts

Settings is available to all signed-in roles. Midnight Burgundy (black), Electric Orchid and Mawada Signature are instant palette previews; selecting a preset enables dark mode and clears custom colour overrides. Light/dark/system mode remains available. Custom background and accent colour pickers persist in local storage for that browser/device, not across accounts or devices. Reset clears custom overrides. Only validated six-digit hex colours reach CSS variables. Animation can be disabled; the OS reduced-motion preference always wins.

The dashboard has clickable status distribution bars and open-assigned versus delivered driver bars. These use all recorded orders, with explicit labels, not a fabricated daily trend or productivity ranking. Zero-data states remain empty; no invented performance figures. Text labels and counts accompany all chart colours. SVG libraries or external chart services are not required.

## Dashboard and official logo

The top-left header now uses the white Arabic Mawada logo cropped from page 3 of the supplied brand guide, on its original plum background; it is not a newly typeset approximation. The source PDF is not published.

Operations/admin users have a separate Dashboard navigation item. It contains summary metrics, charts and a previous-day delay follow-up; detailed order workflows remain under Orders. Daily boundaries use Asia/Kuwait. Today is compared with the complete previous calendar day, explicitly labelled to avoid treating a partial-day count as a fair productivity ranking. Delivery and pickup completion counts use proof timestamps; due/remaining use delivery dates. Shipment-mix and driver charts remain explicitly all-history snapshots. Counts refresh every 15 seconds while the dashboard is foregrounded.

Delivery delay checks require an explicit timezone-qualified deliveryDueAt timestamp or deliveryDate plus an unambiguous 24-hour HH:mm–HH:mm slot. Dates alone and free-text/AM-PM slots stay unknown. Pickup delay checks require a dueAt timestamp on the pickup task. Existing pickup records generally lack this field and there is currently no pickup deadline input screen; unknown coverage is prominently shown rather than reported as on-time. Confirmed delays include late completed work and still-overdue unfinished work, with delivery minutes past deadline. The feature does not reconstruct historic assignment/status snapshots or compare matched elapsed-day intervals.
