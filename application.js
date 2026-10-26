const express = require("express"),
  session = require("express-session"),
  bcrypt = require("bcryptjs"),
  crypto = require("node:crypto"),
  multer = require("multer"),
  ExcelJS = require("exceljs");
const {
  transition,
  pickupTasks,
  syncStatus,
  validateProof,
} = require("./domain");
const bwipjs = require("bwip-js");
const path = require("node:path");
const { createStorage } = require("./storage");
const operations = require("./public/operations");
async function main() {
  const store = createStorage();
  const all = (kind) => store.all(kind);
  const get = (kind, id) => store.get(kind, id);
  const save = (kind, body) => store.save(kind, body);
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "8mb" }));
  const production = process.env.NODE_ENV === "production";
  if (production && (process.env.SESSION_SECRET || "").length < 32)
    throw Error(
      "Set SESSION_SECRET to a random value of at least 32 characters",
    );
  if (
    (process.env.SETUP_KEY || production) &&
    (process.env.SETUP_KEY || "").length < 32 &&
    !(await all("users")).length
  )
    throw Error(
      "Set SETUP_KEY to a separate random value of at least 32 characters before first setup",
    );
  const secret =
    process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
  app.use(
    session({
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 28800000,
      },
    }),
  );
  app.use(express.static(path.join(__dirname, "public")));
  app.get("/api/setup", async (_, r) =>
    r.json({
      required: (await all("users")).length === 0,
      keyRequired: Boolean(process.env.SETUP_KEY) || production,
    }),
  );
  app.post("/api/setup", async (q, r) => {
    if ((await all("users")).length)
      return r.status(409).json({ error: "Already configured" });
    if (process.env.SETUP_KEY || production) {
      const supplied =
        typeof q.body.setupKey === "string" ? q.body.setupKey : "";
      const digest = (value) =>
        crypto.createHash("sha256").update(value).digest();
      if (
        !process.env.SETUP_KEY ||
        !crypto.timingSafeEqual(digest(supplied), digest(process.env.SETUP_KEY))
      )
        return r.status(403).json({ error: "Valid setup key required" });
    }
    if (
      typeof q.body.name !== "string" ||
      !q.body.name.trim() ||
      typeof q.body.email !== "string" ||
      !q.body.email.trim() ||
      typeof q.body.password !== "string" ||
      q.body.password.length < 12
    )
      return r.status(400).json({
        error: "Name, email and a password of at least 12 characters required",
      });
    await save("users", {
      id: "initial-administrator",
      name: q.body.name,
      email: q.body.email.toLowerCase(),
      password: bcrypt.hashSync(q.body.password, 12),
      role: "admin",
    });
    r.json({ ok: true });
  });
  app.post("/api/login", async (q, r) => {
    const u = (await all("users")).find(
      (u) => u.email === String(q.body.email).toLowerCase(),
    );
    if (!u || !bcrypt.compareSync(q.body.password || "", u.password))
      return r.status(401).json({ error: "Invalid login" });
    q.session.regenerate((e) => {
      if (e) return r.sendStatus(500);
      q.session.uid = u.id;
      r.json({ ok: true });
    });
  });
  app.post("/api/logout", (q, r) =>
    q.session.destroy(() => r.json({ ok: true })),
  );
  app.use("/api", async (q, r, n) => {
    q.user = await get("users", q.session.uid);
    if (!q.user) return r.status(401).json({ error: "Sign in required" });
    if (q.method !== "GET" && q.get("sec-fetch-site") === "cross-site")
      return r.sendStatus(403);
    n();
  });
  const permit =
    (...roles) =>
    (q, r, n) =>
      roles.includes(q.user.role)
        ? n()
        : r.status(403).json({ error: "Access denied" });
  require("./operational-routes")(app, store, permit);
  app.get("/api/state", async (q, r) => {
    const orders = (await all("orders"))
      .map((o) => {
        pickupTasks(o);
        return o;
      })
      .filter(
        (o) =>
          q.user.role !== "driver" ||
          o.driver === q.user.id ||
          o.pickups.some((p) => p.driver === q.user.id),
      );
    const users = ["admin", "operations"].includes(q.user.role)
      ? (await all("users"))
          .filter((u) => q.user.role === "admin" || u.role === "driver")
          .map(
            ({
              password,
              locationHistory,
              stationary,
              locationAlerts,
              alertReviews,
              ...u
            }) => u,
          )
      : [];
    r.json({
      user: { ...q.user, password: undefined },
      storageBackend: q.user.role === "admin" ? store.backend : undefined,
      users,
      vendors: q.user.role === "driver" ? [] : await all("vendors"),
      orders,
      fleet: ["admin", "operations"].includes(q.user.role)
        ? operations.fleet(await all("users"), orders)
        : undefined,
    });
  });
  app.post("/api/users", permit("admin"), async (q, r) => {
    const { name, email, password, role } = q.body;
    if (
      !name ||
      !email ||
      password?.length < 12 ||
      !["admin", "operations", "warehouse", "driver"].includes(role) ||
      (await all("users")).some((u) => u.email === email.toLowerCase())
    )
      return r.status(400).json({
        error: "Check user details, unique email and 12-character password",
      });
    await save("users", {
      id: crypto.randomUUID(),
      name,
      email: email.toLowerCase(),
      password: bcrypt.hashSync(password, 12),
      role,
    });
    r.json({ ok: true });
  });
  app.post("/api/vendors", permit("admin", "operations"), async (q, r) => {
    const { code, name, address, phone } = q.body;
    if (
      !code ||
      !name ||
      !address ||
      (await all("vendors")).some((v) => v.code === code)
    )
      return r
        .status(400)
        .json({ error: "Unique code, name and pickup address required" });
    r.json(
      await save("vendors", {
        id: crypto.randomUUID(),
        code,
        name,
        address,
        phone,
      }),
    );
  });
  async function createOrder(b) {
    if (
      !b.reference ||
      !b.recipient ||
      !b.address ||
      !/^\+965\d{8}$/.test(b.phone) ||
      !b.items?.length
    )
      throw Error(
        "Reference, recipient, address, +965 phone and items required",
      );
    if ((await all("orders")).some((o) => o.reference === b.reference))
      throw Error("Duplicate reference");
    const vendors = await all("vendors");
    const items = b.items.map((i) => {
      const vendor = vendors.find((v) => v.code === i.vendorCode);
      if (
        !vendor ||
        !i.name ||
        !Number.isInteger(Number(i.quantity)) ||
        Number(i.quantity) < 1
      )
        throw Error(
          "Each item needs a known vendor code, name and positive integer quantity",
        );
      return {
        id: crypto.randomUUID(),
        name: i.name,
        quantity: Number(i.quantity),
        vendor,
        received: false,
      };
    });
    return {
      id: crypto.randomUUID(),
      awb: "KW-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
      reference: b.reference,
      recipient: b.recipient,
      address: b.address,
      phone: b.phone,
      items,
      status: "Created",
      driver: null,
      ...(b.source === "Mawada CMS"
        ? {
            source: b.source,
            deliveryDate: b.deliveryDate,
            timeSlot: b.timeSlot,
            amountFils: b.amountFils,
            currency: "KWD",
            ringBell: b.ringBell,
            extraDirections: b.extraDirections,
            cardAvailable: b.cardAvailable,
            occasion: b.occasion,
          }
        : {}),
      history: [{ at: new Date().toISOString(), event: "Created" }],
    };
  }
  async function prepareOrder(body) {
    const o = await createOrder(body);
    pickupTasks(o);
    return o;
  }
  app.post("/api/orders", permit("admin", "operations"), async (q, r) => {
    try {
      r.json(await save("orders", await prepareOrder(q.body)));
    } catch (e) {
      r.status(e.status || 400).json({ error: e.message });
    }
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });
  app.post(
    "/api/import",
    permit("admin", "operations"),
    upload.single("file"),
    async (q, r) => {
      try {
        if (!q.file) throw Error("Select an XLSX workbook");
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(q.file.buffer);
        const sheet = wb.worksheets[0];
        if (!sheet || sheet.rowCount > 2001)
          throw Error("Use at most 2000 rows");
        if (
          q.query.format === "mawada" ||
          sheet
            .getRow(1)
            .values.some(
              (v) =>
                String(v).trim().toLowerCase() === "recipient delivery date",
            )
        ) {
          const parsed = require("./mawada-import").parseMawada(sheet, {
            vendors: await all("vendors"),
          });
          if (parsed.errors.length)
            return r.status(400).json({
              error: "Mawada validation failed. No orders were imported.",
              errors: parsed.errors,
              excluded: parsed.excluded,
              today: parsed.today,
            });
          const orders = await Promise.all(parsed.orders.map(prepareOrder));
          if (q.query.confirm === "yes") {
            if (!orders.length)
              throw Error("No orders are due today in Kuwait.");
            await store.insertMany("orders", orders);
          }
          return r.json({
            ...parsed,
            orders,
            count: orders.length,
            committed: q.query.confirm === "yes",
          });
        }
        const groups = new Map();
        sheet.eachRow((row, n) => {
          if (n === 1) return;
          const a = row.values
            .slice(1)
            .map((v) => (v == null ? "" : String(v)));
          const [
            reference,
            recipient,
            phone,
            address,
            vendorCode,
            name,
            quantity,
          ] = a;
          if (!groups.has(reference))
            groups.set(reference, {
              reference,
              recipient,
              phone,
              address,
              items: [],
            });
          const o = groups.get(reference);
          if (
            o.recipient !== recipient ||
            o.phone !== phone ||
            o.address !== address
          )
            throw Error("Conflicting recipient details for " + reference);
          o.items.push({ vendorCode, name, quantity: Number(quantity) });
        });
        const orders = await Promise.all(
          [...groups.values()].map(prepareOrder),
        );
        if (!orders.length) throw Error("Workbook is empty");
        if (q.query.confirm === "yes") {
          await store.insertMany("orders", orders);
        }
        r.json({
          count: orders.length,
          orders,
          committed: q.query.confirm === "yes",
        });
      } catch (e) {
        r.status(e.status || 400).json({ error: e.message });
      }
    },
  );
  app.get("/api/orders/:id/awb", async (q, r) => {
    const o = await get("orders", q.params.id);
    if (!o) return r.sendStatus(404);
    if (
      q.user.role === "driver" &&
      o.driver !== q.user.id &&
      !pickupTasks(o).some((p) => p.driver === q.user.id)
    )
      return r.sendStatus(403);
    try {
      const png = await bwipjs.toBuffer({
        bcid: "code128",
        text: o.awb,
        scale: 3,
        height: 14,
        includetext: true,
      });
      r.type("png").send(png);
    } catch (e) {
      r.status(500).json({ error: "Unable to generate label" });
    }
  });
  app.post("/api/orders/:id/action", async (q, r) => {
    try {
      let o = await get("orders", q.params.id);
      if (!o) return r.status(404).json({ error: "Order not found" });
      const pickups = pickupTasks(o),
        { action } = q.body,
        manager = ["admin", "operations"].includes(q.user.role),
        warehouse = ["admin", "warehouse"].includes(q.user.role);
      const driver = async () => {
        const d = await get("users", q.body.driver);
        if (d?.role !== "driver") throw Error("Choose a driver");
        return d.id;
      };
      const deny = () => r.status(403).json({ error: "Access denied" });
      operations.normaliseTrips(o);
      const at = new Date().toISOString();
      let detail = {};
      if (action === "review-occasion") {
        if (!manager) return deny();
        if (
          o.source !== "Mawada CMS" ||
          typeof q.body.occasion !== "string" ||
          !q.body.occasion.trim() ||
          q.body.occasion.length > 120
        )
          throw Error("Enter an occasion label for this Mawada order.");
        o.occasion = {
          value: q.body.occasion.trim(),
          source: "Operations review",
          needsReview: false,
          reviewedBy: q.user.name,
          reviewedAt: at,
        };
        detail = { occasion: o.occasion.value };
      } else if (
        ["start-pickup-trip", "arrived-pickup", "pickup-failed"].includes(
          action,
        )
      ) {
        const task = pickups.find((p) => p.id === q.body.pickup);
        if (
          !task ||
          (!manager && (q.user.role !== "driver" || task.driver !== q.user.id))
        )
          return deny();
        if (!task.driver || task.completed)
          throw Error("An assigned, incomplete pickup is required.");
        if (action === "start-pickup-trip") {
          const trip = operations.startPickup(
            o,
            task.id,
            task.driver,
            crypto.randomUUID(),
            at,
          );
          detail = { tripId: trip.id, pickup: task.id };
        } else {
          const trip = operations
            .activeTrips(o)
            .find((t) => t.kind === "pickup" && t.pickupId === task.id);
          if (!trip) throw Error("Start the pickup trip first.");
          if (action === "arrived-pickup") {
            trip.milestone = "Arrived at pickup";
            trip.arrivedAt = at;
          } else {
            if (typeof q.body.reason !== "string" || !q.body.reason.trim())
              throw Error("A pickup failure reason is required.");
            operations.finishTrip(
              o,
              "pickup",
              task.id,
              "Failed",
              at,
              q.body.reason.trim(),
            );
            task.lastFailure = q.body.reason.trim();
          }
          detail = {
            tripId: trip.id,
            pickup: task.id,
            reason: q.body.reason?.trim(),
          };
        }
      } else if (action === "arrived-delivery") {
        if (!manager && (q.user.role !== "driver" || o.driver !== q.user.id))
          return deny();
        if (o.status !== "Out for delivery")
          throw Error("Start the delivery trip first.");
        const trip = operations
          .activeTrips(o)
          .find((t) => t.kind === "delivery");
        if (!trip) throw Error("No active delivery trip.");
        trip.milestone = "Arrived at delivery";
        trip.arrivedAt = at;
        detail = { tripId: trip.id };
      } else if (action === "assign") {
        if (!manager) return deny();
        if (["Delivered", "Out for delivery"].includes(o.status))
          throw Error("Cannot reassign during or after delivery");
        o.driver = await driver();
      } else if (action === "assign-pickup") {
        if (!manager) return deny();
        const task = pickups.find((p) => p.id === q.body.pickup);
        if (!task || task.completed) throw Error("Choose an incomplete pickup");
        if (
          operations
            .activeTrips(o)
            .some((t) => t.kind === "pickup" && t.pickupId === task.id)
        )
          throw Error(
            "Finish or fail the active pickup trip before reassigning.",
          );
        task.driver = await driver();
        detail = { pickup: task.id };
      } else if (action === "pickup") {
        const task = pickups.find((p) => p.id === q.body.pickup);
        if (
          !task ||
          task.completed ||
          !["Created", "Picked up"].includes(o.status)
        )
          throw Error("Choose an incomplete pickup");
        if (!manager && (q.user.role !== "driver" || task.driver !== q.user.id))
          return deny();
        if (!task.driver) throw Error("Assign a pickup driver first");
        const ids = o.items
          .filter((i) => i.vendor.id === task.vendor.id)
          .map((i) => i.id);
        if (
          !Array.isArray(q.body.verifiedItems) ||
          ids.some((id) => !q.body.verifiedItems.includes(id))
        )
          throw Error("Verify every item for this vendor");
        if (
          q.user.role === "driver" &&
          !operations
            .activeTrips(o)
            .some(
              (t) =>
                t.kind === "pickup" &&
                t.pickupId === task.id &&
                t.driver === q.user.id,
            )
        )
          throw Error("Start the pickup trip first.");
        const proof = {
          ...validateProof(q.body),
          gpsAtCapture:
            q.user.role === "driver"
              ? (await store.get("users", q.user.id))?.lastLocation || null
              : null,
          driverId: task.driver,
          capturedBy: q.user.name,
        };
        operations.finishTrip(o, "pickup", task.id, "Completed", at);
        task.completed = true;
        task.proof = proof;
        (o.proofs ??= []).push({
          ...proof,
          stage: "Vendor pickup",
          vendor: task.vendor.name,
          pickup: task.id,
        });
        syncStatus(o);
        detail = { pickup: task.id };
      } else if (action === "receive") {
        if (!warehouse) return deny();
        if (!["Created", "Picked up", "At warehouse"].includes(o.status))
          throw Error("Cannot receive items at this stage");
        const item = o.items.find((i) => i.id === q.body.item);
        if (!item || item.received) throw Error("Choose an unreceived item");
        if (!pickups.find((p) => p.vendor.id === item.vendor.id)?.completed)
          throw Error("Complete this vendor pickup first");
        item.received = true;
        syncStatus(o);
        detail = { item: item.id };
      } else if (action === "add-item") {
        if (!warehouse) return deny();
        if (!["Created", "Picked up", "At warehouse"].includes(o.status))
          throw Error("Items can only be added before dispatch");
        const vendor = (await all("vendors")).find(
          (v) => v.code === q.body.vendorCode,
        );
        const quantity = Number(q.body.quantity);
        if (
          !vendor ||
          typeof q.body.name !== "string" ||
          !q.body.name.trim() ||
          !Number.isInteger(quantity) ||
          quantity < 1
        )
          throw Error("Known vendor, item name and positive quantity required");
        const item = {
          id: crypto.randomUUID(),
          vendor,
          name: q.body.name.trim(),
          quantity,
          received: true,
          source: "Warehouse addition",
        };
        o.items.push(item);
        if (!pickups.some((p) => p.vendor.id === vendor.id))
          pickups.push({
            id: crypto.randomUUID(),
            vendor,
            driver: null,
            completed: true,
            source: "Warehouse addition",
          });
        syncStatus(o);
        detail = { item: item.id };
      } else if (action === "fail") {
        if (!manager && (q.user.role !== "driver" || o.driver !== q.user.id))
          return deny();
        if (o.status !== "Out for delivery")
          throw Error("Only dispatched deliveries can fail");
        if (typeof q.body.reason !== "string" || !q.body.reason.trim())
          throw Error("Failure reason required");
        operations.finishTrip(
          o,
          "delivery",
          null,
          "Failed",
          at,
          q.body.reason.trim(),
        );
        o.status = "Delivery failed";
        o.returned = false;
        (o.attempts ??= []).push({
          at: new Date().toISOString(),
          reason: q.body.reason.trim(),
          driver: o.driver,
        });
        detail = { reason: q.body.reason.trim() };
      } else if (action === "return") {
        if (!warehouse) return deny();
        if (o.status !== "Delivery failed" || o.returned)
          throw Error("Choose a failed delivery awaiting return");
        o.returned = true;
      } else if (action === "reschedule") {
        if (!manager) return deny();
        if (o.status !== "Delivery failed" || !o.returned)
          throw Error("Warehouse must confirm return before rescheduling");
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(q.body.date || "") ||
          !Number.isFinite(Date.parse(q.body.date)) ||
          new Date(q.body.date).toISOString().slice(0, 10) !== q.body.date ||
          q.body.date <
            new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)
        )
          throw Error("Choose today or a future valid delivery date");
        o.deliveryDate = q.body.date;
        o.status = "At warehouse";
        o.driver = null;
        detail = { date: q.body.date };
      } else if (action === "Out for delivery") {
        if (!manager && (q.user.role !== "driver" || o.driver !== q.user.id))
          return deny();
        if (!o.driver) throw Error("Assign a delivery driver first");
        if (
          o.deliveryDate &&
          o.deliveryDate >
            new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)
        )
          throw Error("Scheduled delivery date has not arrived");
        if (
          !Array.isArray(q.body.verifiedItems) ||
          o.items.some((i) => !q.body.verifiedItems.includes(i.id))
        )
          throw Error("Verify every item before departure");
        o = transition(o, action);
        const trip = operations.startDelivery(o, crypto.randomUUID(), at);
        detail = { tripId: trip.id };
      } else if (action === "Delivered") {
        if (!manager && (q.user.role !== "driver" || o.driver !== q.user.id))
          return deny();
        const proof = {
          ...validateProof(q.body, true),
          gpsAtCapture:
            q.user.role === "driver"
              ? (await store.get("users", q.user.id))?.lastLocation || null
              : null,
          driverId: o.driver,
          capturedBy: q.user.name,
        };
        o = transition(o, action);
        operations.finishTrip(o, "delivery", null, "Completed", at);
        (o.proofs ??= []).push({ ...proof, stage: action });
      } else throw Error("Unknown action");
      o.history.push({
        event: action,
        by: q.user.name,
        actorId: q.user.id,
        driverId: o.driver,
        at: new Date().toISOString(),
        ...detail,
      });
      r.json(await save("orders", o));
    } catch (e) {
      r.status(e.status || 400).json({ error: e.message });
    }
  });
  app.use((e, q, r, n) => r.status(e.status || 400).json({ error: e.message }));
  // Persist stable pickup identifiers for orders created before vendor tasks existed.
  for (const order of await all("orders")) {
    if (!order.pickups || !order.trips) {
      pickupTasks(order);
      operations.normaliseTrips(order);
      await save("orders", order);
    }
  }
  return app;
}
module.exports = { createApplication: main };
