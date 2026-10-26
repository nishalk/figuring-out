const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const ExcelJS = require("exceljs");
const photo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=";
test(
  "drivers scan/claim without stealing work; trips, GPS and reports reflect the complete pickup/delivery journey",
  { timeout: 120000 },
  async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "relay-ops-"));
    const child = spawn(process.execPath, [path.resolve("server.js")], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_BACKEND: "sqlite",
        DATA_DIR: path.join(cwd, "data"),
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const base = await new Promise((resolve, reject) => {
        child.once("exit", () => reject(Error("Server exited")));
        child.stdout.on("data", (b) => {
          const m = String(b).match(/Delivery app listening (\d+)/);
          if (m) resolve("http://127.0.0.1:" + m[1] + "/api/");
        });
      });
      const agent = () => ({ cookie: "" });
      const admin = agent(),
        a = agent(),
        b = agent();
      async function raw(who, route, body) {
        const r = await fetch(base + route, {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json", cookie: who.cookie },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (r.headers.get("set-cookie"))
          who.cookie = r.headers.get("set-cookie").split(";")[0];
        return r;
      }
      async function req(who, route, body, status = 200) {
        const r = await raw(who, route, body);
        assert.equal(r.status, status, await r.clone().text());
        return r.json();
      }
      const password = "test-only-password-123";
      await req(admin, "setup", {
        name: "Dispatcher",
        email: "admin@example.test",
        password,
      });
      await req(admin, "login", { email: "admin@example.test", password });
      for (const name of ["Driver A", "Driver B"])
        await req(admin, "users", {
          name,
          email: name.replace(" ", "") + "@example.test",
          password,
          role: "driver",
        });
      await req(a, "login", { email: "DriverA@example.test", password });
      await req(b, "login", { email: "DriverB@example.test", password });
      const initial = await req(admin, "state");
      const da = initial.users.find((u) => u.name === "Driver A"),
        db = initial.users.find((u) => u.name === "Driver B");
      await req(admin, "vendors", {
        code: "V1",
        name: "Vendor",
        address: "Sample Kuwait pickup",
        phone: "+96500000000",
      });
      const o = await req(admin, "orders", {
        reference: "=1+1",
        recipient: "Sample recipient",
        phone: "+96500000000",
        address: "Sample delivery address",
        items: [{ vendorCode: "V1", name: "Package", quantity: 2 }],
      });
      const lookup = await req(a, "driver/lookup?awb=" + o.awb);
      assert.equal(lookup.pickups.length, 1);
      assert.equal(lookup.deliveryAvailable, false);
      await req(
        admin,
        "driver/claim",
        { awb: o.awb, leg: "pickup", pickupId: o.pickups[0].id },
        403,
      );
      const claims = await Promise.all([
        raw(a, "driver/claim", {
          awb: o.awb,
          leg: "pickup",
          pickupId: o.pickups[0].id,
        }),
        raw(b, "driver/claim", {
          awb: o.awb,
          leg: "pickup",
          pickupId: o.pickups[0].id,
        }),
      ]);
      assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
      const assigned = (await req(admin, "state")).orders[0].pickups[0].driver;
      const winner = assigned === da.id ? a : b,
        loser = winner === a ? b : a,
        winnerId = assigned,
        loserId = assigned === da.id ? db.id : da.id;
      await req(loser, "driver/lookup?awb=" + o.awb, null, 409);
      const action = (who, body, status = 200) =>
        req(who, "orders/" + o.id + "/action", body, status);
      const proof = {
        name: "Pickup contact",
        photo,
        lat: 29.3759,
        lng: 47.9774,
      };
      await action(
        winner,
        {
          action: "pickup",
          pickup: o.pickups[0].id,
          verifiedItems: [o.items[0].id],
          ...proof,
        },
        400,
      );
      await action(winner, {
        action: "start-pickup-trip",
        pickup: o.pickups[0].id,
      });
      await action(
        winner,
        { action: "start-pickup-trip", pickup: o.pickups[0].id },
        409,
      );
      await action(
        loser,
        { action: "arrived-pickup", pickup: o.pickups[0].id },
        403,
      );
      await action(winner, {
        action: "arrived-pickup",
        pickup: o.pickups[0].id,
      });
      await action(
        admin,
        { action: "assign-pickup", pickup: o.pickups[0].id, driver: loserId },
        400,
      );
      let fleet = (await req(admin, "state")).fleet.find(
        (d) => d.id === winnerId,
      );
      assert.equal(fleet.activeTrips.length, 1);
      assert.equal(fleet.pendingPickups, 1);
      assert.equal(fleet.assignedOrders, 1);
      await req(
        winner,
        "driver/location",
        { lat: 999, lng: 48, accuracy: 8 },
        400,
      );
      await req(
        admin,
        "driver/location",
        { lat: 29, lng: 48, accuracy: 8 },
        403,
      );
      await req(winner, "driver/location", {
        lat: 29.3759,
        lng: 47.9774,
        accuracy: 8,
        driverId: loserId,
      });
      const tracked = await req(admin, "state");
      assert.equal(
        tracked.fleet.find((d) => d.id === winnerId).lastLocation.lat,
        29.3759,
      );
      assert.equal(
        tracked.fleet.find((d) => d.id === loserId).lastLocation,
        null,
      );
      await req(
        admin,
        "fleet/" + winnerId + "/review",
        { alertId: "missing", note: "review" },
        400,
      );
      await req(
        winner,
        "fleet/" + winnerId + "/review",
        { alertId: "missing", note: "review" },
        403,
      );
      await req(winner, "driver/sharing", { enabled: false });
      assert.equal(
        (await req(admin, "state")).fleet.find((d) => d.id === winnerId)
          .locationSharing,
        false,
      );
      const gapFlag = (await req(admin, "state")).fleet
        .find((d) => d.id === winnerId)
        .alerts.find((a) => a.kind === "Tracking gap");
      assert.ok(gapFlag);
      await req(admin, "fleet/" + winnerId + "/review", {
        alertId: gapFlag.id,
        note: "Driver confirmed loading at vendor",
      });
      assert.equal(
        (await req(admin, "state")).fleet
          .find((d) => d.id === winnerId)
          .alerts.find((a) => a.id === gapFlag.id).review.note,
        "Driver confirmed loading at vendor",
      );
      await action(winner, {
        action: "pickup",
        pickup: o.pickups[0].id,
        verifiedItems: [o.items[0].id],
        ...proof,
      });
      const afterPickup = await req(admin, "state");
      assert.equal(
        afterPickup.orders[0].pickups[0].proof.gpsAtCapture.lat,
        29.3759,
      );
      assert.ok(
        !(
          "locationHistory" in afterPickup.users.find((u) => u.id === winnerId)
        ),
      );
      const reviewedDriver = afterPickup.fleet.find((d) => d.id === winnerId);
      assert.equal(reviewedDriver.reviews.length, 1);
      assert.equal(reviewedDriver.reviews[0].kind, "Tracking gap");
      await action(admin, { action: "receive", item: o.items[0].id });
      await req(loser, "driver/claim", { awb: o.awb, leg: "delivery" });
      await req(winner, "driver/claim", { awb: o.awb, leg: "delivery" }, 409);
      await action(
        loser,
        { action: "Out for delivery", verifiedItems: [] },
        400,
      );
      await action(loser, {
        action: "Out for delivery",
        verifiedItems: [o.items[0].id],
      });
      await action(loser, { action: "arrived-delivery" });
      fleet = (await req(admin, "state")).fleet.find((d) => d.id === loserId);
      assert.equal(fleet.inTransitDeliveries, 1);
      assert.equal(fleet.activeTrips.length, 1);
      assert.equal(fleet.pendingDeliveries, 0);
      await action(loser, {
        action: "Delivered",
        ...proof,
        name: "Actual receiver",
        signature: photo,
      });
      fleet = (await req(admin, "state")).fleet.find((d) => d.id === loserId);
      assert.equal(fleet.delivered, 1);
      assert.equal(fleet.activeTrips.length, 0);
      assert.equal(fleet.assignedOrders, 0);
      await req(winner, "reports", null, 403);
      await req(winner, "reports/export", null, 403);
      const report = await req(admin, "reports?driver=" + winnerId);
      assert.equal(report.orders.length, 1);
      const row = report.orders[0];
      assert.equal(row.delivery[0].name, "Actual receiver");
      assert.equal(row.delivery[0].signatureCaptured, true);
      assert.equal(row.pickups[0].proof.name, "Pickup contact");
      assert.equal(row.trips.length, 2);
      assert.ok(row.trips.every((t) => t.status === "Completed"));
      assert.ok(row.history.some((h) => h.event === "Driver claimed pickup"));
      assert.ok(!JSON.stringify(report).includes("data:image/"));
      await req(admin, "reports?from=2026-02-31", null, 400);
      await req(admin, "reports?from=2026-12-01&to=2026-01-01", null, 400);
      const exportResponse = await raw(admin, "reports/export");
      assert.equal(
        exportResponse.status,
        200,
        await exportResponse.clone().text(),
      );
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
      assert.equal(book.getWorksheet("Orders").getCell("B2").value, "=1+1");
      assert.equal(book.getWorksheet("Trips").rowCount, 3);
      assert.ok(book.getWorksheet("Order history").rowCount > 5);
      await req(winner, "logout", {});
      await req(winner, "state", null, 401);
      await req(winner, "login", {
        email:
          "  " +
          (winnerId === da.id ? "DriverA" : "DriverB") +
          "@EXAMPLE.TEST  ",
        password,
      });
      assert.equal((await req(winner, "state")).user.id, winnerId);
      await req(admin, "users/" + winnerId + "/permissions", {
        permissions: [],
      });
      await req(winner, "driver/claim", { awb: o.awb, leg: "delivery" }, 403);
      await req(
        winner,
        "users/" + loserId + "/permissions",
        { permissions: [] },
        403,
      );
      await req(
        admin,
        "users/" + winnerId + "/permissions",
        { permissions: ["reports"] },
        400,
      );
      await req(admin, "users", {
        name: "Restricted dispatcher",
        email: "restricted@example.test",
        password,
        role: "operations",
        permissions: [],
      });
      const restricted = agent();
      await req(restricted, "login", {
        email: "restricted@example.test",
        password,
      });
      await req(restricted, "reports", null, 403);
      await req(
        restricted,
        "vendors",
        { code: "NO", name: "Blocked", address: "Kuwait" },
        403,
      );
      assert.equal((await req(restricted, "state")).fleet, undefined);
      await req(winner, "demo-orders", {}, 403);
      const seeded = await req(admin, "demo-orders", {});
      assert.equal(seeded.created, 24);
      assert.equal((await req(admin, "demo-orders", {})).created, 0);
      const examples = (await req(admin, "state")).orders.filter(
        (o) => o.demoData,
      );
      assert.equal(examples.length, 24);
      assert.ok(
        examples.some(
          (o) => o.status === "Delivered" && o.proofs.some((p) => p.simulated),
        ),
      );
      assert.ok(examples.some((o) => o.pickups.length === 2));
    } finally {
      if (child.exitCode === null) {
        const done = new Promise((r) => child.once("exit", r));
        child.kill();
        await done;
      }
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  },
);

test("report date filters use Kuwait dates at the UTC day boundary", () => {
  const ops = require("../public/operations");
  const o = {
    id: "o",
    awb: "KW-1",
    reference: "x",
    status: "Created",
    items: [],
    pickups: [],
    history: [{ event: "Created", at: "2026-10-25T21:30:00.000Z" }],
  };
  assert.equal(
    ops.report([o], [], { from: "2026-10-26", to: "2026-10-26" }).length,
    1,
  );
  assert.equal(
    ops.report([o], [], { from: "2026-10-25", to: "2026-10-25" }).length,
    0,
  );
});
