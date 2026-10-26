const { test } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

test("Excel workbooks round-trip extended formatting with the patched UUID dependency", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders");
  sheet.addRows([[1], [2], [3]]);
  sheet.addConditionalFormatting({
    ref: "A1:A3",
    rules: [
      {
        type: "iconSet",
        iconSet: "3Stars",
        cfvo: [
          { type: "percent", value: 0 },
          { type: "percent", value: 33 },
          { type: "percent", value: 67 },
        ],
      },
    ],
  });
  const buffer = await workbook.xlsx.writeBuffer();
  // ExcelJS uses uuid.v4 to assign extended-formatting IDs during serialization.
  assert.match(
    sheet.conditionalFormattings[0].rules[0].x14Id,
    /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/,
  );
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  assert.equal(restored.getWorksheet("Orders").getCell("A3").value, 3);
  assert.equal(
    restored.getWorksheet("Orders").conditionalFormattings[0].rules[0].iconSet,
    "3Stars",
  );
});
