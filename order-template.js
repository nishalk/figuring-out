const ExcelJS = require("exceljs");
const { kuwaitDay } = require("./mawada-import");
const fields = [
  [
    "Order Number",
    "Required",
    "Stable delivery-order reference. Repeat for every item of the same order.",
  ],
  [
    "Recipient Delivery Date",
    "Required",
    "YYYY-MM-DD, Kuwait date. Only today is imported; other dates appear as excluded.",
  ],
  ["Recipient Name", "Required", "Receiver, not purchaser/sender."],
  ["Recipient Phone", "Required", "Text: +965 followed by 8 digits."],
  [
    "Recipient Address",
    "Required",
    "Area, block, street, building/house, floor, flat, landmark as available. Area alone is insufficient.",
  ],
  [
    "Vendor Name",
    "Required",
    "Must match a registered vendor name or code with its saved pickup address.",
  ],
  [
    "Item Details",
    "Required",
    "One item per row. Useful description for verification.",
  ],
  [
    "Quantity",
    "Required",
    "Positive whole-number item quantity, not package count unless equivalent.",
  ],
  [
    "Delivery Time Slot",
    "Optional",
    "24-hour HH:mm–HH:mm in Kuwait time, e.g. 10:00–12:00.",
  ],
  [
    "Order Amount",
    "Optional",
    "Full order total in KWD, up to 3 decimals. Repeat same amount on each item row; never sum it per item. Not assumed COD.",
  ],
  ["Ring the bell", "Optional", "Y or N; blank means unknown."],
  [
    "Extra direction",
    "Optional",
    "Delivery/access instructions. Do not include unnecessary private information.",
  ],
  [
    "Card available",
    "Optional",
    "Y or N. A card price does not establish whether a card is present.",
  ],
  [
    "Occasion",
    "Optional",
    "Explicit occasion if known; otherwise leave blank for an unconfirmed suggestion.",
  ],
  [
    "Card message",
    "Optional",
    "Optional sensitive text used for occasion suggestion; current app does not retain the message. Leave out if unnecessary.",
  ],
];
async function workbook(now = new Date()) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Orders");
  sheet.addRow(fields.map((f) => f[0]));
  const day = kuwaitDay(now);
  for (const item of ["Fictional flower arrangement", "Fictional gift box"])
    sheet.addRow([
      "SAMPLE-ORDER-001",
      day,
      "Sample recipient",
      "+96500000000",
      "Fictional Kuwait City address; replace before use",
      "SAMPLE-VENDOR",
      item,
      1,
      "10:00–12:00",
      25.5,
      "N",
      "Fictional example — replace before import",
      "Y",
      "Birthday",
      "",
    ]);
  const guide = book.addWorksheet("CMS field guide");
  guide.addRow(["Field", "Requirement", "Format / meaning"]);
  fields.forEach((f) => guide.addRow(f));
  const notes = book.addWorksheet("Read first");
  [
    ["Mawada Experience Managers — CMS export template"],
    [
      "Orders must be the FIRST worksheet; row 1 must contain the exact column names.",
    ],
    [
      "The two rows are fictional examples for ONE multi-item order. Delete/replace them before importing.",
    ],
    [
      "A real export can contain other dates. The app selects only today in Asia/Kuwait.",
    ],
    [
      "Use one item per row. Repeat consistent order-level details, including total amount, for all items.",
    ],
    [
      "Use different registered vendor names on rows when one order needs multiple vendor pickups.",
    ],
    [
      "No partial delivery: every item must arrive at the warehouse before dispatch.",
    ],
    ["Do not substitute purchaser/sender details for receiver details."],
    [
      "Dates should be ISO date text, phone/reference columns should be text, and money should not have currency symbols.",
    ],
    [
      "Register vendor pickup locations in the app first. SAMPLE-VENDOR is a placeholder, not a live vendor.",
    ],
    [
      "Confirm whether ORDER_NO or PARENT_ORDER_NO is the delivery-group identity before building the export.",
    ],
    [
      "SECRET_GIFT and sender identity remain CMS-owned privacy settings. Current importer does not enforce secret-gift masking; do not upload surprise-sensitive item/message information assuming it will be hidden from drivers.",
    ],
    [
      "Payment, refund, charge, tax, loyalty, wallet and sender fields are not needed in this delivery import. Keep them in CMS.",
    ],
    [
      "Use only approved active orders in CMS exports. Current importer filters dates, not source cancellation/payment states.",
    ],
  ].forEach((r) => notes.addRow(r));
  for (const s of book.worksheets) {
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF5F174B" },
    };
    s.views = [{ state: "frozen", ySplit: 1 }];
    s.columns.forEach(
      (c, i) =>
        (c.width =
          s === sheet ? (i === 4 || i === 6 ? 45 : 25) : i === 2 ? 95 : 40),
    );
    s.eachRow((r) => (r.alignment = { vertical: "top", wrapText: true }));
  }
  for (const column of [1, 2, 4]) sheet.getColumn(column).numFmt = "@";
  sheet.getColumn(10).numFmt = "0.000";
  return book;
}
module.exports = { workbook, fields };
