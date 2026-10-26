const { test } = require("node:test");
const assert = require("node:assert/strict");
const ops = require("../public/operations");
const start = Date.parse("2026-10-27T07:00:00Z");
const point = (minutes, extra = {}) => ({
  lat: 29.3759,
  lng: 47.9774,
  accuracy: 10,
  at: new Date(start + minutes * 60000).toISOString(),
  ...extra,
});
const order = () => ({
  id: "o1",
  awb: "KW-1",
  reference: "R1",
  recipient: "Test",
  address: "Kuwait",
  driver: "d1",
  status: "Out for delivery",
  items: [],
  pickups: [],
  history: [],
  trips: [
    {
      driver: "d1",
      kind: "delivery",
      status: "In transit",
      startedAt: point(0).at,
    },
  ],
  proofs: [],
});
const user = () => ({ id: "d1", name: "Driver", role: "driver" });
test("long stops need active trips, continuous fresh accurate GPS and 20 minutes", () => {
  const u = user(),
    o = order();
  for (let i = 0; i <= 21; i++) ops.recordLocation(u, point(i));
  assert.ok(
    ops
      .driverAlerts(u, [o], start + 21 * 60000)
      .some((a) => a.kind === "Long stop"),
  );
  assert.ok(
    !ops
      .driverAlerts(u, [], start + 21 * 60000)
      .some((a) => a.kind === "Long stop"),
  );
  assert.ok(
    !ops
      .driverAlerts(u, [o], start + 24 * 60000)
      .some((a) => a.kind === "Long stop"),
  );
  ops.recordLocation(u, point(25));
  assert.ok(
    !ops
      .driverAlerts(u, [o], start + 25 * 60000)
      .some((a) => a.kind === "Long stop"),
  );
  ops.recordLocation(u, point(26, { accuracy: 500 }));
  assert.equal(u.stationary, null);
});
test("GPS movement and sharing pauses reset a stationary period; new trips do not inherit earlier idle time", () => {
  const u = user(),
    o = order();
  for (let i = 0; i <= 21; i++) ops.recordLocation(u, point(i));
  o.trips[0].startedAt = point(20).at;
  assert.ok(
    !ops
      .driverAlerts(u, [o], start + 21 * 60000)
      .some((a) => a.kind === "Long stop"),
  );
  ops.recordLocation(u, point(22, { lat: 29.4 }));
  assert.equal(u.stationary.since, point(22).at);
  u.locationSharing = false;
  ops.recordLocation(u, point(23, { lat: 29.4 }));
  assert.equal(u.stationary.since, point(23).at);
});
test("jump flags subtract accuracy uncertainty and ignore poor fixes; tracking gaps require active work", () => {
  const u = user(),
    o = order();
  ops.recordLocation(u, point(0));
  ops.recordLocation(u, point(0.5, { lat: 30.3759 }));
  assert.equal(u.locationAlerts.length, 1);
  assert.match(u.locationAlerts[0].detail, /accuracy allowance/);
  ops.recordLocation(u, point(1, { lat: 31, accuracy: 1000 }));
  assert.equal(u.locationAlerts.length, 1);
  assert.ok(
    ops
      .driverAlerts(u, [o], start + 7 * 60000)
      .some((a) => a.kind === "Tracking gap"),
  );
  assert.ok(
    !ops
      .driverAlerts(u, [], start + 7 * 60000)
      .some((a) => a.kind === "Tracking gap"),
  );
  const flag = u.locationAlerts[0];
  u.alertReviews = {
    [flag.id]: { note: "GPS error confirmed", by: "Ops", at: point(2).at },
  };
  assert.equal(
    ops.driverAlerts(u, [o], start + 60000).find((a) => a.id === flag.id).review
      .note,
    "GPS error confirmed",
  );
});
test("proof discrepancies use fresh saved GPS evidence, survive trail expiry and skip stale evidence", () => {
  const u = user(),
    o = order();
  o.proofs = [
    {
      stage: "Delivered",
      driverId: u.id,
      lat: 30,
      lng: 48,
      at: point(1).at,
      gpsAtCapture: point(0),
    },
  ];
  assert.equal(
    ops
      .driverAlerts(u, [o], start + 2 * 86400000)
      .filter((a) => a.kind === "Proof / GPS discrepancy").length,
    1,
  );
  o.proofs[0].at = point(5).at;
  assert.equal(
    ops
      .driverAlerts(u, [o], start + 2 * 86400000)
      .filter((a) => a.kind === "Proof / GPS discrepancy").length,
    0,
  );
});
test("unique shipment totals include historical drivers; pending and completed work stay distinct", () => {
  const u = user(),
    o = order();
  o.pickups = [
    {
      id: "p1",
      driver: u.id,
      completed: true,
      vendor: { id: "v1", name: "Vendor", address: "Pickup" },
    },
  ];
  let d = ops.fleet([u], [o], start + 60000)[0];
  assert.equal(d.shipmentsHandled, 1);
  assert.equal(d.assignedOrders, 1);
  assert.equal(d.completedPickups, 1);
  assert.equal(d.delivered, 0);
  o.status = "Delivered";
  o.proofs = [{ stage: "Delivered", driverId: u.id }];
  o.trips[0].status = "Completed";
  o.driver = "d2";
  d = ops.fleet([u], [o], start + 60000)[0];
  assert.equal(d.delivered, 1);
  assert.equal(d.assignedOrders, 0);
  assert.equal(d.shipments.length, 1);
});
