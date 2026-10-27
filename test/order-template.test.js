const { test } = require("node:test");
const assert = require("node:assert/strict");
const { workbook, fields } = require("../order-template");
const { parseMawada } = require("../mawada-import");
const ExcelJS = require("exceljs");
test("download template round-trips through real importer with fictional multi-item examples", async () => {
  const now = new Date("2026-10-27T09:00:00Z");
  const book = await workbook(now);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await book.xlsx.writeBuffer());
  assert.equal(loaded.worksheets[0].name, "Orders");
  assert.equal(loaded.worksheets[0].getRow(1).cellCount, fields.length);
  const result = parseMawada(loaded.worksheets[0], {
    now,
    vendors: [
      {
        id: "v1",
        name: "SAMPLE-VENDOR",
        code: "SAMPLE-VENDOR",
        address: "Fictional pickup",
      },
    ],
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].items.length, 2);
  assert.equal(result.orders[0].amountFils, 25500);
  assert.equal(result.orders[0].ringBell, false);
});
