const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dailyOverview } = require("../public/operations");
test("dashboard uses Kuwait calendar days, actual proofs and deadlines without assuming punctuality", () => {
  const orders = [
    {
      awb: "late",
      deliveryDate: "2026-10-26",
      timeSlot: "10:00–12:00",
      pickups: [
        {
          vendor: { name: "Vendor" },
          dueAt: "2026-10-26T10:00:00+03:00",
          completed: true,
          proof: { at: "2026-10-26T10:30:00+03:00" },
        },
      ],
      proofs: [{ stage: "Delivered", at: "2026-10-26T12:15:00+03:00" }],
    },
    {
      awb: "unknown",
      deliveryDate: "2026-10-26",
      pickups: [{ vendor: { name: "Other" }, completed: false }],
      proofs: [],
    },
    {
      awb: "today",
      deliveryDate: "2026-10-27",
      pickups: [],
      proofs: [{ stage: "Delivered", at: "2026-10-26T21:30:00Z" }],
    },
  ];
  const d = dailyOverview(orders, Date.parse("2026-10-26T22:00:00Z"));
  assert.equal(d.today.date, "2026-10-27");
  assert.equal(d.today.delivered, 1);
  assert.equal(d.yesterday.delivered, 1);
  assert.equal(d.yesterday.due, 2);
  assert.equal(d.yesterday.lateDeliveries, 1);
  assert.equal(d.yesterday.delayRows[0].minutes, 15);
  assert.equal(d.yesterday.deliveryUnknown, 1);
  assert.equal(d.yesterday.latePickups, 1);
  assert.equal(d.yesterday.pickupUnknown, 1);
});
test("unfinished overdue work counts as late; unrecognised slot text stays unknown", () => {
  const orders = [
    {
      awb: "pending",
      deliveryDate: "2026-10-26",
      timeSlot: "10:00-11:00",
      pickups: [],
    },
    {
      awb: "unknown",
      deliveryDate: "2026-10-26",
      timeSlot: "evening",
      pickups: [],
    },
  ];
  const d = dailyOverview(orders, Date.parse("2026-10-27T10:00:00+03:00"));
  assert.equal(d.yesterday.lateDeliveries, 1);
  assert.equal(d.yesterday.delayRows[0].pending, true);
  assert.equal(d.yesterday.deliveryUnknown, 1);
});
