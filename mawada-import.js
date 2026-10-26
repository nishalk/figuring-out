const key = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");
const text = (value) =>
  value?.text ??
  value?.result ??
  (value?.richText ? value.richText.map((x) => x.text).join("") : value);
function kuwaitDay(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}
function deliveryDay(value) {
  value = text(value);
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw Error("Invalid delivery date");
    return value.getUTCHours() === 0 && value.getUTCMinutes() === 0
      ? value.toISOString().slice(0, 10)
      : kuwaitDay(value);
  }
  if (typeof value === "number")
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
      .toISOString()
      .slice(0, 10);
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) throw Error("Invalid delivery date");
    return kuwaitDay(d);
  }
  let iso = s;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(s)) {
    const [d, m, y] = s.split(/[/-]/);
    iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    throw Error("Use YYYY-MM-DD or DD/MM/YYYY delivery dates");
  return iso;
}
function yn(value) {
  const v = key(text(value));
  if (!v) return null;
  if (["y", "yes", "true", "1", "نعم"].includes(v)) return true;
  if (["n", "no", "false", "0", "لا"].includes(v)) return false;
  throw Error("Use Y/N for bell and card fields");
}
function occasionSuggestion(value) {
  const s = key(value);
  const rules = [
    ["Birthday", /birthday|happy bday|ميلاد/],
    ["Anniversary", /anniversary|ذكرى/],
    ["Wedding", /wedding|marriage|زفاف|زواج/],
    ["Graduation", /graduation|graduate|تخرج/],
    ["New baby", /new baby|newborn|مولود|مبروك المولود/],
    ["Get well", /get well|شفاء|سلامتك/],
    ["Condolences", /condolence|sympathy|عزاء|البقاء لله/],
    ["Eid", /eid|عيد مبارك/],
    ["Ramadan", /ramadan|رمضان/],
    ["Congratulations", /congratulations|مبروك/],
  ];
  const matches = rules
    .filter(([, pattern]) => pattern.test(s))
    .map(([label]) => label);
  return {
    value: matches.length === 1 ? matches[0] : null,
    source: "Text clues (rules, not an AI model)",
    needsReview: true,
    candidates: matches,
  };
}
function parseMawada(sheet, { now = new Date(), vendors = [] } = {}) {
  const headers = sheet.getRow(1).values.map((v) => key(text(v)));
  const find = (names, required = false) => {
    const index = headers.findIndex((h) => names.includes(h));
    if (index < 0 && required)
      throw Error("Missing Mawada column: " + names[0]);
    return index;
  };
  const col = {
    date: find(["recipient delivery date"], true),
    reference: find(["order number", "order reference", "order id"], true),
    recipient: find(["recipient name", "receiver name"], true),
    phone: find(
      [
        "recipient phone",
        "receiver phone",
        "recipient mobile",
        "receiver mobile",
      ],
      true,
    ),
    address: find(["recipient address", "delivery address", "address"], true),
    vendor: find(["vendor name", "vendor"], true),
    item: find(["item details", "item name", "product name"], true),
    quantity: find(["quantity", "item quantity"], true),
    slot: find(["delivery time slot", "delivery timeslot", "time slot"]),
    amount: find(["order amount", "order total"]),
    bell: find(["ring the bell", "ring the bell y/n", "ring bell"]),
    directions: find([
      "extra direction",
      "extra directions",
      "delivery instructions",
    ]),
    card: find(["card available", "card available y/n"]),
    occasion: find(["occasion", "occassion"]),
    message: find(["card message", "gift message"]),
  };
  const today = kuwaitDay(now),
    groups = new Map(),
    excluded = [],
    errors = [],
    datesByOrder = new Map();
  const value = (row, column) =>
    column < 0 ? "" : text(row.getCell(column).value);
  const str = (row, column) => String(value(row, column) ?? "").trim();
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    try {
      const day = deliveryDay(value(row, col.date));
      const ref = str(row, col.reference);
      if (ref) {
        if (!datesByOrder.has(ref)) datesByOrder.set(ref, new Set());
        datesByOrder.get(ref).add(day);
      }
      if (day !== today) {
        excluded.push({
          row: n,
          reason: day
            ? "Delivery date is " + day
            : "Missing Recipient Delivery Date",
        });
        return;
      }
      const reference = str(row, col.reference),
        recipient = str(row, col.recipient),
        address = str(row, col.address);
      let phone = str(row, col.phone).replace(/[\s()-]/g, "");
      if (/^\d{8}$/.test(phone)) phone = "+965" + phone;
      if (/^00965\d{8}$/.test(phone)) phone = "+" + phone.slice(2);
      if (!reference || !recipient || !address || !/^\+965\d{8}$/.test(phone))
        throw Error(
          "Order reference, recipient, address and a Kuwait recipient phone are required",
        );
      const name = str(row, col.vendor),
        matches = vendors.filter(
          (v) => key(v.name) === key(name) || key(v.code) === key(name),
        );
      if (matches.length !== 1)
        throw Error("Vendor must match one saved pickup location: " + name);
      const item = str(row, col.item),
        quantity = col.quantity < 0 ? 1 : Number(value(row, col.quantity));
      if (!item || !Number.isInteger(quantity) || quantity < 1)
        throw Error("Item details and a positive whole quantity are required");
      const rawAmount = str(row, col.amount);
      let amount = null;
      if (rawAmount) {
        if (!/^\d+(?:\.\d{1,3})?$/.test(rawAmount))
          throw Error(
            "Order amount must be a non-negative KWD number with at most 3 decimal places",
          );
        amount = Math.round(Number(rawAmount) * 1000);
        if (!Number.isSafeInteger(amount))
          throw Error("Order amount is too large");
      }
      const explicit = str(row, col.occasion),
        suggestion = explicit
          ? {
              value: explicit,
              source: "CMS occasion field",
              needsReview: false,
              candidates: [],
            }
          : occasionSuggestion([item, str(row, col.message)].join(" "));
      const order = {
        reference,
        recipient,
        phone,
        address,
        deliveryDate: day,
        timeSlot: str(row, col.slot),
        amountFils: amount,
        currency: "KWD",
        ringBell: yn(value(row, col.bell)),
        extraDirections: str(row, col.directions),
        cardAvailable: yn(value(row, col.card)),
        occasion: suggestion,
        source: "Mawada CMS",
        items: [],
      };
      if (groups.has(reference)) {
        const prior = groups.get(reference);
        for (const field of [
          "recipient",
          "phone",
          "address",
          "deliveryDate",
          "timeSlot",
          "amountFils",
          "ringBell",
          "extraDirections",
          "cardAvailable",
        ])
          if (prior[field] !== order[field])
            throw Error("Conflicting order-level fields for " + reference);
        if (prior.occasion.value !== suggestion.value)
          prior.occasion = {
            value: null,
            source: "Conflicting item text clues",
            needsReview: true,
            candidates: [
              ...new Set(
                [
                  ...prior.occasion.candidates,
                  prior.occasion.value,
                  ...suggestion.candidates,
                  suggestion.value,
                ].filter(Boolean),
              ),
            ],
          };
      } else groups.set(reference, order);
      groups
        .get(reference)
        .items.push({ vendorCode: matches[0].code, name: item, quantity });
    } catch (error) {
      errors.push({ row: n, error: error.message });
    }
  });
  for (const [reference, days] of datesByOrder)
    if (groups.has(reference) && days.size > 1)
      errors.push({
        row: null,
        error:
          "Conflicting delivery dates within order " +
          reference +
          "; review all items before import.",
      });
  return {
    orders: [...groups.values()],
    today,
    excluded,
    errors,
    selectedRows: [...groups.values()].reduce(
      (sum, o) => sum + o.items.length,
      0,
    ),
    totalRows: sheet.rowCount - 1,
  };
}
module.exports = { parseMawada, deliveryDay, kuwaitDay, occasionSuggestion };
