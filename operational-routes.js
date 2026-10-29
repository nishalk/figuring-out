const ExcelJS = require("exceljs");
const rules = require("./public/operations");
module.exports = function install(app, store, permit) {
  const now = () => new Date().toISOString();
  const manager = permit("admin", "operations");
  const driver = permit("driver");
  const validPosition = (b) =>
    Number.isFinite(b.lat) &&
    Number.isFinite(b.lng) &&
    Math.abs(b.lat) <= 90 &&
    Math.abs(b.lng) <= 180 &&
    Number.isFinite(b.accuracy) &&
    b.accuracy >= 0 &&
    b.accuracy <= 100000;
  app.get("/api/driver/lookup", driver, async (q, r) => {
    const awb = String(q.query.awb || "")
      .trim()
      .toUpperCase();
    if (!awb || awb.length > 80)
      return r.status(400).json({ error: "Scan or enter a valid AWB." });
    const order = (await store.all("orders")).find((o) => o.awb === awb);
    if (!order)
      return r
        .status(404)
        .json({ error: "No available order matches that AWB." });
    const availablePickups = order.pickups.filter(
      (p) =>
        !p.completed &&
        (!p.driver || p.driver === q.user.id) &&
        ["Created", "Picked up"].includes(order.status),
    );
    const deliveryAvailable =
      order.status === "At warehouse" &&
      order.items.every((i) => i.received) &&
      (!order.driver || order.driver === q.user.id);
    if (!availablePickups.length && !deliveryAvailable)
      return r.status(409).json({
        error:
          "This order is not available to claim. It may be assigned to another driver or not ready.",
      });
    const lookupUser = await store.get("users", q.user.id);
    lookupUser.activity = [
      ...(lookupUser.activity || []),
      {
        event: "AWB scanned / looked up",
        at: now(),
        actorId: q.user.id,
        orderId: order.id,
        awb: order.awb,
      },
    ].slice(-500);
    await store.save("users", lookupUser);
    r.json({
      id: order.id,
      awb: order.awb,
      reference: order.reference,
      status: order.status,
      recipient: order.recipient,
      address: order.address,
      items: order.items.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        vendor: i.vendor.name,
      })),
      pickups: availablePickups.map((p) => ({
        id: p.id,
        name: p.vendor.name,
        address: p.vendor.address,
      })),
      deliveryAvailable,
    });
  });
  app.post("/api/driver/claim", driver, async (q, r) => {
    const order = (await store.all("orders")).find(
      (o) =>
        o.awb ===
        String(q.body.awb || "")
          .trim()
          .toUpperCase(),
    );
    if (!order)
      return r
        .status(404)
        .json({ error: "No available order matches that AWB." });
    rules.claimOrder(order, q.user.id, q.body.leg, q.body.pickupId);
    order.history.push({
      event: "Driver claimed " + q.body.leg,
      by: q.user.name,
      actorId: q.user.id,
      driverId: q.user.id,
      pickup: q.body.pickupId,
      at: now(),
    });
    require("./customer-updates").queueUpdate(order, "assign", q.user.id);
    r.json(await store.save("orders", order));
  });
  app.post("/api/driver/shift", driver, async (q, r) => {
    const user = await store.get("users", q.user.id),
      at = now();
    user.activity ||= [];
    if (q.body.action === "start") {
      if (user.shift?.active)
        return r.status(409).json({ error: "Shift already started" });
      user.shift = { active: true, startedAt: at };
    } else if (q.body.action === "end") {
      if (!user.shift?.active)
        return r.status(409).json({ error: "No active shift" });
      if (
        (await store.all("orders")).some((o) =>
          rules.activeTrips(o).some((t) => t.driver === user.id),
        )
      )
        return r.status(409).json({
          error: "Complete or reconcile active trips before ending the shift",
        });
      user.shift = { ...user.shift, active: false, endedAt: at };
    } else return r.status(400).json({ error: "Choose start or end" });
    user.activity = [
      ...user.activity,
      {
        event: q.body.action === "start" ? "Shift started" : "Shift ended",
        at,
        actorId: user.id,
      },
    ].slice(-500);
    await store.save("users", user);
    r.json({ ok: true, shift: user.shift });
  });
  app.get("/api/fleet/:id/activity", manager, async (q, r) => {
    if (!require("./public/access").allowed(q.user, "dashboard"))
      return r.status(403).json({ error: "Driver tracking access required" });
    const user = await store.get("users", q.params.id);
    if (!user || user.role !== "driver" || user.deletedAt)
      return r.status(404).json({ error: "Driver not found" });
    const events = [...(user.activity || [])];
    for (const o of await store.all("orders"))
      for (const h of o.history || [])
        if (h.actorId === user.id)
          events.push({ ...h, awb: o.awb, orderId: o.id });
    r.json({
      driverId: user.id,
      shift: user.shift || null,
      events: events
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, 500),
      positions: (user.locationHistory || [])
        .filter((p) => Date.now() - Date.parse(p.at) <= 86400000)
        .slice(-2000),
      lastLocation: user.lastLocation || null,
    });
  });
  app.post("/api/driver/location", driver, async (q, r) => {
    if (!validPosition(q.body))
      return r
        .status(400)
        .json({ error: "Valid GPS coordinates and accuracy are required." });
    const user = await store.get("users", q.user.id);
    rules.recordLocation(user, {
      lat: q.body.lat,
      lng: q.body.lng,
      accuracy: q.body.accuracy,
      at: now(),
      source: "gps",
    });
    await store.save("users", user);
    r.json({ ok: true, at: user.lastLocation.at });
  });
  app.post("/api/driver/sharing", driver, async (q, r) => {
    if (typeof q.body.enabled !== "boolean")
      return r.status(400).json({ error: "Choose whether to share location." });
    const user = await store.get("users", q.user.id);
    user.locationSharing = q.body.enabled;
    user.activity = [
      ...(user.activity || []),
      {
        event: q.body.enabled
          ? "Location sharing enabled"
          : "Location sharing paused",
        at: now(),
        actorId: user.id,
      },
    ].slice(-500);
    await store.save("users", user);
    r.json({ ok: true });
  });
  app.post("/api/fleet/:id/review", manager, async (q, r) => {
    const user = await store.get("users", q.params.id);
    if (!user || user.role !== "driver")
      return r.status(404).json({ error: "Driver not found" });
    const flag = rules
      .driverAlerts(user, await store.all("orders"))
      .find((f) => f.id === q.body.alertId);
    const note = String(q.body.note || "").trim();
    if (!flag || !note || note.length > 500)
      return r.status(400).json({
        error:
          "Select an existing flag and enter a review note of 1–500 characters.",
      });
    const reviews = Object.entries(user.alertReviews || {}).slice(-199);
    user.alertReviews = Object.fromEntries(reviews);
    user.alertReviews[flag.id] = {
      note,
      kind: flag.kind,
      detail: flag.detail,
      flaggedAt: flag.at,
      by: q.user.name,
      at: now(),
    };
    await store.save("users", user);
    r.json({ ok: true });
  });
  app.post("/api/labels/audit", async (q, r) => {
    const ids = q.body.orderIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string")
    )
      return r.status(400).json({ error: "Choose 1–100 label orders" });
    const orders = await store.all("orders");
    const selected = ids.map((id) => orders.find((o) => o.id === id));
    if (
      selected.some(
        (o) =>
          !o ||
          (q.user.role === "driver" &&
            o.driver !== q.user.id &&
            !o.pickups.some((p) => p.driver === q.user.id)),
      )
    )
      return r.status(403).json({ error: "Order not accessible" });
    const user = await store.get("users", q.user.id);
    user.activity = [
      ...(user.activity || []),
      {
        event: "AWB labels previewed",
        at: now(),
        actorId: user.id,
        awbs: selected.map((o) => o.awb),
      },
    ].slice(-500);
    await store.save("users", user);
    r.json({ ok: true });
  });
  async function getReport(q) {
    return rules.report(
      await store.all("orders"),
      await store.all("users"),
      q.query,
    );
  }
  app.get("/api/reports", manager, async (q, r) =>
    r.json({ orders: await getReport(q), generatedAt: now() }),
  );
  app.get("/api/reports/export", manager, async (q, r) => {
    const rows = await getReport(q),
      book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Orders");
    sheet.addRow([
      "AWB",
      "Reference",
      "Status",
      "Delivery driver",
      "Recipient",
      "Phone",
      "Address",
      "Created",
      "Delivered",
      "Receiver",
      "Latitude",
      "Longitude",
      "Photo",
      "Signature",
      "Recipient Delivery Date",
      "Delivery time slot",
      "Order value (KWD)",
      "Ring bell",
      "Card available",
      "Extra directions",
      "Occasion",
      "Occasion review required",
    ]);
    const history = book.addWorksheet("Order history");
    history.addRow([
      "AWB",
      "Event",
      "Actor",
      "Time (UTC)",
      "Pickup ID",
      "Item ID",
      "Reason",
    ]);
    const pickups = book.addWorksheet("Pickups");
    pickups.addRow([
      "AWB",
      "Vendor",
      "Pickup address",
      "Driver",
      "Completed",
      "Contact",
      "Pickup time (UTC)",
      "Latitude",
      "Longitude",
    ]);
    const items = book.addWorksheet("Items");
    items.addRow(["AWB", "Item", "Quantity", "Vendor", "Received"]);
    const trips = book.addWorksheet("Trips");
    trips.addRow([
      "AWB",
      "Trip ID",
      "Leg",
      "Driver",
      "Status",
      "Milestone",
      "Started (UTC)",
      "Ended (UTC)",
      "Reason",
    ]);
    for (const o of rows) {
      const d = o.delivery.at(-1) || {};
      sheet.addRow([
        o.awb,
        o.reference,
        o.status,
        o.driver,
        o.recipient,
        o.phone,
        o.address,
        o.createdAt,
        d.at || "",
        d.name || "",
        d.lat ?? "",
        d.lng ?? "",
        d.photoCaptured ? "Yes" : "No",
        d.signatureCaptured ? "Yes" : "No",
        o.deliveryDate || "",
        o.timeSlot,
        o.amountFils == null ? "" : (o.amountFils / 1000).toFixed(3),
        o.ringBell == null ? "" : o.ringBell ? "Yes" : "No",
        o.cardAvailable == null ? "" : o.cardAvailable ? "Yes" : "No",
        o.extraDirections,
        o.occasion?.value || "",
        o.occasion?.needsReview ? "Yes" : "No",
      ]);
      for (const h of o.history)
        history.addRow([
          o.awb,
          h.event,
          h.by || "",
          h.at,
          h.pickup || "",
          h.item || "",
          h.reason || "",
        ]);
      for (const p of o.pickups)
        pickups.addRow([
          o.awb,
          p.vendor,
          p.address,
          p.driver,
          p.completed ? "Yes" : "No",
          p.proof?.name || "",
          p.proof?.at || "",
          p.proof?.lat ?? "",
          p.proof?.lng ?? "",
        ]);
      for (const i of o.items)
        items.addRow([
          o.awb,
          i.name,
          i.quantity,
          i.vendor,
          i.received ? "Yes" : "No",
        ]);
      for (const t of o.trips)
        trips.addRow([
          o.awb,
          t.id,
          t.kind,
          t.driver,
          t.status,
          t.milestone || "",
          t.startedAt || "",
          t.endedAt || "",
          t.reason || "",
        ]);
    }
    for (const s of book.worksheets) {
      s.getRow(1).font = { bold: true };
      s.views = [{ state: "frozen", ySplit: 1 }];
      s.columns.forEach((c) => (c.width = 24));
    }
    const buffer = await book.xlsx.writeBuffer();
    r.set(
      "Content-Disposition",
      'attachment; filename="relay-operations-report.xlsx"',
    )
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(Buffer.from(buffer));
  });
};
