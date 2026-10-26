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
    r.json(await store.save("orders", order));
  });
  app.post("/api/driver/location", driver, async (q, r) => {
    if (!validPosition(q.body))
      return r
        .status(400)
        .json({ error: "Valid GPS coordinates and accuracy are required." });
    const user = await store.get("users", q.user.id);
    user.locationSharing = true;
    user.lastLocation = {
      lat: q.body.lat,
      lng: q.body.lng,
      accuracy: q.body.accuracy,
      at: now(),
      source: "gps",
    };
    await store.save("users", user);
    r.json({ ok: true, at: user.lastLocation.at });
  });
  app.post("/api/driver/sharing", driver, async (q, r) => {
    if (typeof q.body.enabled !== "boolean")
      return r.status(400).json({ error: "Choose whether to share location." });
    const user = await store.get("users", q.user.id);
    user.locationSharing = q.body.enabled;
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
