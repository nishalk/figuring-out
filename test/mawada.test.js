const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  ExcelJS = require("exceljs");
const {
  parseMawada,
  deliveryDay,
  kuwaitDay,
  occasionSuggestion,
} = require("../mawada-import");
const headers = [
  "Order Number",
  "Recipient Delivery Date",
  "Recipient Name",
  "Recipient Phone",
  "Recipient Address",
  "Vendor Name",
  "Item Details",
  "Quantity",
  "Delivery Time Slot",
  "Order Amount",
  "Ring the bell",
  "Extra direction",
  "Card available",
  "Card message",
];
function sheet(rows) {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("Orders");
  s.addRow(headers);
  rows.forEach((r) => s.addRow(r));
  return s;
}
const row = (id, date) => [
  id,
  date,
  "Sample receiver",
  "50000000",
  "Sample address",
  "Sample vendor",
  "Birthday bouquet",
  2,
  "14:00–17:00",
  "12.345",
  "N",
  "Do not call before arrival",
  "Y",
  "Happy birthday",
];
const options = {
  now: new Date("2026-10-25T22:30:00Z"),
  vendors: [{ code: "V1", name: "Sample vendor" }],
};
test("Mawada selects only Kuwait-today rows and preserves recipient instructions, money and reviewable occasion", () => {
  const result = parseMawada(
    sheet([
      row("A", "2026-10-26"),
      row("B", "2026-10-25"),
      row("C", "2026-10-27"),
    ]),
    options,
  );
  assert.equal(result.today, "2026-10-26");
  assert.equal(result.orders.length, 1);
  assert.equal(result.excluded.length, 2);
  assert.equal(result.errors.length, 0);
  const o = result.orders[0];
  assert.equal(o.phone, "+96550000000");
  assert.equal(o.amountFils, 12345);
  assert.equal(o.ringBell, false);
  assert.equal(o.cardAvailable, true);
  assert.equal(o.items[0].vendorCode, "V1");
  assert.equal(o.occasion.value, "Birthday");
  assert.equal(o.occasion.needsReview, true);
});
test("a multi-vendor order with inconsistent delivery dates cannot be partially imported", () => {
  const result = parseMawada(
    sheet([row("A", "2026-10-26"), row("A", "2026-10-27")]),
    options,
  );
  assert.ok(
    result.errors.some((e) => e.error.includes("Conflicting delivery dates")),
  );
});
test("invalid or ambiguous vendor/date/boolean fields are returned as row errors", () => {
  const r = row("A", "2026-10-26");
  r[10] = "maybe";
  assert.equal(parseMawada(sheet([r]), options).errors.length, 1);
  assert.equal(
    parseMawada(sheet([row("A", "2026-10-26")]), { ...options, vendors: [] })
      .errors.length,
    1,
  );
  assert.throws(() => deliveryDay("2026-02-31"));
  assert.equal(deliveryDay("26/10/2026"), "2026-10-26");
  assert.equal(deliveryDay(new Date("2026-10-26T00:00:00Z")), "2026-10-26");
  assert.equal(kuwaitDay(options.now), "2026-10-26");
});
test("occasion inference leaves ambiguous or unsupported text unconfirmed", () => {
  assert.equal(occasionSuggestion("Birthday and graduation").value, null);
  assert.equal(occasionSuggestion("A beautiful bouquet").value, null);
  assert.equal(occasionSuggestion("عيد ميلاد سعيد").value, "Birthday");
});
test("a FarEye report without Recipient Delivery Date is not accepted as a Mawada export", () => {
  const b = new ExcelJS.Workbook(),
    s = b.addWorksheet("Report");
  s.addRow(["Reference Number", "Customer Name", "Delivery Date"]);
  assert.throws(() => parseMawada(s, options), /recipient delivery date/);
});
