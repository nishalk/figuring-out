const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const rules = require("../public/control");
const { createStorage } = require("../storage");
const { createBackup, restore } = require("../scripts/backup.cjs");
const ExcelJS = require("exceljs");
const { parseMawada } = require("../mawada-import");
test("proof drafts retain capture time separately from acceptance and reject expired/future captures", () => {
  const { validateProof } = require("../domain");
  const body = {
    name: "Receiver",
    photo:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=",
    lat: 29.37,
    lng: 47.97,
    capturedAt: new Date(Date.now() - 3600000).toISOString(),
  };
  const proof = validateProof(body);
  assert.equal(proof.capturedAt, body.capturedAt);
  assert.ok(Date.parse(proof.at) > Date.parse(proof.capturedAt));
  assert.throws(
    () =>
      validateProof({
        ...body,
        capturedAt: new Date(Date.now() - 25 * 3600000).toISOString(),
      }),
    /24 hours/,
  );
  assert.throws(
    () =>
      validateProof({
        ...body,
        capturedAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    /invalid/,
  );
});
test("exceptions remain visible with recovery plans; future pickups and fictional data are excluded", () => {
  const at = Date.parse("2026-10-29T10:00:00Z");
  const order = {
    id: "one",
    awb: "KW-1",
    status: "Created",
    deliveryDate: "2026-10-29",
    timeSlot: "09:00-12:00",
    items: [],
    pickups: [
      { id: "p", vendor: { id: "v", name: "Vendor" }, completed: false },
    ],
    exceptionReviews: {
      overdue: { owner: "Dispatcher", followUpAt: "2026-10-29T09:00:00Z" },
    },
  };
  const exceptions = rules.exceptions(
    [
      order,
      { ...order, id: "demo", demoData: true },
      { ...order, id: "future", deliveryDate: "2026-10-30" },
    ],
    [],
    at,
  );
  assert.ok(
    exceptions.some(
      (e) => e.code === "overdue" && e.review.owner === "Dispatcher",
    ),
  );
  assert.equal(exceptions.filter((e) => e.code === "pickup").length, 1);
  assert.ok(exceptions.every((e) => e.orderId === "one"));
});
test("performance counts unfinished overdue promises as late and reports unknown windows separately", () => {
  const at = Date.parse("2026-10-29T10:00:00Z");
  const base = {
    deliveryDate: "2026-10-29",
    timeSlot: "09:00-12:00",
    status: "Delivered",
    attempts: [],
    history: [],
    proofs: [{ stage: "Delivered", at: "2026-10-29T08:00:00Z" }],
  };
  const p = rules.performance(
    [
      base,
      { ...base, status: "Out for delivery", proofs: [] },
      { ...base, timeSlot: "Morning", attempts: [{ reason: "No answer" }] },
      { ...base, demoData: true },
    ],
    "2026-10-29",
    "2026-10-29",
    at,
  );
  assert.equal(p.scheduled, 3);
  assert.equal(p.onTimeRate, 50);
  assert.equal(p.measuredWindows, 2);
  assert.equal(p.unknownWindows, 1);
  assert.equal(p.firstAttemptRate, 50);
  assert.equal(
    rules.deadline({ deliveryDate: "2026-10-29", timeSlot: "23:00-02:00" }),
    null,
  );
});
test("saved mappings parse alternate CMS headers and reject ambiguous headings", () => {
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet("Orders");
  sheet.addRow([
    "Due",
    "Number",
    "To",
    "Mobile",
    "Where",
    "Shop",
    "Product",
    "Units",
  ]);
  sheet.addRow([
    "2026-10-29",
    "CMS-1",
    "Recipient",
    "+96555555555",
    "Salmiya",
    "V1",
    "Gift",
    1,
  ]);
  const mapping = {
    date: "Due",
    reference: "Number",
    recipient: "To",
    phone: "Mobile",
    address: "Where",
    vendor: "Shop",
    item: "Product",
    quantity: "Units",
  };
  const parsed = parseMawada(sheet, {
    now: new Date("2026-10-29T08:00:00Z"),
    vendors: [{ code: "V1", name: "Vendor" }],
    mapping,
  });
  assert.equal(parsed.orders[0].reference, "CMS-1");
  assert.equal(parsed.errors.length, 0);
  sheet.getCell("I1").value = "Due";
  assert.throws(() => parseMawada(sheet, { mapping }), /match one heading/);
});
test("SQLite backup rehearses restoration, preserves proof records and refuses overwriting data", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mawada-backup-test-"));
  const store = createStorage({ DATA_DIR: dir });
  try {
    await store.save("orders", {
      id: "order",
      reference: "R-1",
      proofs: [{ photo: "stored-proof" }],
    });
    const manifest = await createBackup({ DATA_DIR: dir });
    assert.equal(manifest.orders, 1);
    assert.equal(manifest.offHostVerified, false);
    const target = path.join(dir, "restore");
    const file = path.join(dir, "backups", manifest.filename);
    assert.equal(restore(file, target).orders, 1);
    assert.throws(() => restore(file, target), /must be empty/);
    const restored = createStorage({ DATA_DIR: target });
    assert.equal(
      (await restored.get("orders", "order")).proofs[0].photo,
      "stored-proof",
    );
    restored.close();
    fs.appendFileSync(file, "tampering");
    assert.throws(() => restore(file, path.join(dir, "other")), /checksum/);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("control APIs enforce role/revision checks, durable sessions, private tracking, one-time email recovery and exactly one provider attempt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mawada-control-api-"));
  const envKeys = [
    "DATA_DIR",
    "DATABASE_BACKEND",
    "NODE_ENV",
    "SESSION_SECRET",
    "PUBLIC_APP_URL",
    "RECOVERY_EMAIL_API_KEY",
    "RECOVERY_EMAIL_FROM",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_GRAPH_VERSION",
    "WHATSAPP_TEMPLATE",
  ];
  const before = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    DATA_DIR: dir,
    DATABASE_BACKEND: "sqlite",
    NODE_ENV: "test",
    SESSION_SECRET: "test-only-stable-secret-12345678901234567890",
    PUBLIC_APP_URL: "https://delivery.example.test",
    RECOVERY_EMAIL_API_KEY: "test-only",
    RECOVERY_EMAIL_FROM: "Mawada <test@example.test>",
    WHATSAPP_ACCESS_TOKEN: "test-only",
    WHATSAPP_PHONE_NUMBER_ID: "1234",
    WHATSAPP_GRAPH_VERSION: "v25.0",
    WHATSAPP_TEMPLATE: "delivery_status",
  });
  const nativeFetch = global.fetch;
  let resetToken,
    providerCalls = 0,
    providerFailure = false,
    server,
    base;
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const body = JSON.parse(options.body);
      resetToken = body.text.match(/\/reset#([A-Za-z0-9_-]+)/)[1];
      return Response.json({ id: "email-fixture" });
    }
    if (String(url).startsWith("https://graph.facebook.com/")) {
      providerCalls++;
      if (providerFailure) throw Error("Fixture: request outcome unknown");
      const body = JSON.parse(options.body);
      assert.equal(body.template.components[0].parameters.length, 3);
      return Response.json({ messages: [{ id: "fixture-provider-id" }] });
    }
    return nativeFetch(url, options);
  };
  const start = async () => {
    const app = await require("../application").createApplication();
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = "http://127.0.0.1:" + server.address().port;
  };
  const stop = async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      server = null;
    }
  };
  const call = async (agent, route, body, status = 200) => {
    const r = await nativeFetch(base + "/api/" + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: agent.cookie || "",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    assert.equal(r.status, status, text);
    if (r.headers.get("set-cookie"))
      agent.cookie = r.headers.get("set-cookie").split(";")[0];
    return JSON.parse(text);
  };
  const admin = {},
    driverAgent = {},
    restricted = {},
    anonymous = {},
    password = "test-password-12345";
  try {
    await start();
    await call(admin, "setup", {
      name: "Administrator",
      email: "admin@example.test",
      password,
    });
    await call(admin, "login", { email: "admin@example.test", password });
    await call(admin, "users", {
      name: "Driver",
      email: "driver@example.test",
      password,
      role: "driver",
    });
    await call(admin, "users", {
      name: "Restricted",
      email: "restricted@example.test",
      password,
      role: "operations",
      permissions: ["create"],
    });
    await call(driverAgent, "login", {
      email: "driver@example.test",
      password,
    });
    await call(restricted, "login", {
      email: "restricted@example.test",
      password,
    });
    await call(driverAgent, "control", null, 403);
    await call(restricted, "control", null, 403);
    await call(admin, "vendors", {
      code: "V1",
      name: "Vendor",
      address: "Kuwait",
      phone: "+96555555555",
    });
    const date = rules.day();
    let o = await call(admin, "orders", {
      reference: "C-1",
      recipient: "Customer",
      address: "Salmiya",
      phone: "+96555555555",
      deliveryDate: date,
      timeSlot: "09:00-12:00",
      whatsappConsent: true,
      items: [{ vendorCode: "V1", name: "Gift", quantity: 1 }],
    });
    const userState = await call(admin, "state"),
      driver = userState.users.find((u) => u.role === "driver");
    const selections = [{ id: o.id, revision: o._revision }];
    const plan = { driverId: driver.id, selections, leg: "delivery" };
    assert.equal((await call(admin, "control/bulk", plan)).additional, 1);
    assert.equal((await call(admin, "state")).orders[0].driver, null);
    await call(admin, "control/bulk", { ...plan, confirm: true });
    await call(admin, "control/bulk", { ...plan, confirm: true }, 409);
    await call(driverAgent, "control/bulk", plan, 403);
    const control = await call(admin, "control");
    const exception = control.exceptions.find(
      (e) => e.orderId === o.id && e.code === "pickup",
    );
    await call(admin, "control/review", {
      orderId: o.id,
      exceptionId: exception.id,
      owner: "Dispatcher",
      note: "Vendor confirmation due",
      followUpAt: new Date(Date.now() + 3600000).toISOString(),
    });
    assert.equal(
      (await call(admin, "control")).exceptions.find(
        (e) => e.id === exception.id,
      ).review.owner,
      "Dispatcher",
    );
    const tracking = await call(
      admin,
      "control/orders/" + o.id + "/tracking",
      {},
    );
    const token = tracking.url.split("#")[1];
    const trackingState = await call(anonymous, "tracking/" + token);
    assert.equal(trackingState.awb, o.awb);
    assert.equal(trackingState.phone, undefined);
    assert.equal(trackingState.recipient, undefined);
    assert.equal(trackingState.address, undefined);
    const updates = await call(admin, "control/updates");
    assert.equal(updates.rows.length, 1);
    const result = await Promise.all([
      call(admin, "control/orders/" + o.id + "/updates", {
        updateId: updates.rows[0].id,
      }),
      (async () => {
        const r = await nativeFetch(
          base + "/api/control/orders/" + o.id + "/updates",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: admin.cookie,
            },
            body: JSON.stringify({ updateId: updates.rows[0].id }),
          },
        );
        assert.equal(r.status, 409);
      })(),
    ]);
    assert.equal(result[0].status, "Accepted by provider");
    assert.equal(providerCalls, 1);
    await call(admin, "control/orders/" + o.id + "/updates", { queue: true });
    const queued = (await call(admin, "control/updates")).rows.find(
      (u) => u.status === "Queued",
    );
    providerFailure = true;
    assert.equal(
      (
        await call(admin, "control/orders/" + o.id + "/updates", {
          updateId: queued.id,
        })
      ).status,
      "Needs provider review",
    );
    await call(
      admin,
      "control/orders/" + o.id + "/updates",
      { updateId: queued.id },
      409,
    );
    assert.equal(providerCalls, 2);
    await call(admin, "control/orders/" + o.id + "/updates", {
      updateId: queued.id,
      review: {
        outcome: "not-sent",
        note: "Fixture provider log confirms no message was sent",
      },
    });
    assert.equal(providerCalls, 2);
    const driverState = await call(driverAgent, "state");
    assert.equal(driverState.orders[0].trackingTokens, undefined);
    assert.equal(driverState.orders[0].customerUpdates, undefined);
    await call(admin, "control/orders/" + o.id + "/tracking", { revoke: true });
    await call(anonymous, "tracking/" + token, null, 404);
    // Save an alternate export mapping and prove duplicate blocking/explicit exclusion on real XLSX uploads.
    const mapping = {
      date: "Due",
      reference: "Number",
      recipient: "To",
      phone: "Mobile",
      address: "Where",
      vendor: "Shop",
      item: "Product",
      quantity: "Units",
    };
    await call(admin, "import/mapping", { mapping });
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("CMS");
    sheet.addRow([
      "Due",
      "Number",
      "To",
      "Mobile",
      "Where",
      "Shop",
      "Product",
      "Units",
    ]);
    for (const reference of ["C-1", "C-2"])
      sheet.addRow([
        date,
        reference,
        "Customer",
        "+96555555555",
        "Salmiya",
        "V1",
        "Gift",
        1,
      ]);
    const bytes = await workbook.xlsx.writeBuffer();
    const upload = async (query, expected) => {
      const form = new FormData();
      form.append("file", new Blob([bytes]), "CMS.xlsx");
      const response = await nativeFetch(
        base + "/api/import?format=mawada" + query,
        { method: "POST", headers: { Cookie: admin.cookie }, body: form },
      );
      const body = await response.json();
      assert.equal(response.status, expected, JSON.stringify(body));
      return body;
    };
    assert.equal((await upload("", 409)).duplicates.length, 1);
    assert.equal((await upload("&skipDuplicates=yes", 200)).count, 1);
    assert.equal((await call(admin, "state")).orders.length, 1);
    await upload("&skipDuplicates=yes&confirm=yes", 200);
    assert.equal((await call(admin, "state")).orders.length, 2);
    await stop();
    await start();
    assert.equal((await call(admin, "state")).user.email, "admin@example.test");
    await call(anonymous, "recovery/request", { email: "admin@example.test" });
    assert.ok(resetToken);
    const inspector = createStorage({ DATA_DIR: dir });
    const account = (await inspector.all("users")).find(
      (u) => u.email === "admin@example.test",
    );
    account.reset.expires = Date.now() - 1;
    await inspector.save("users", account);
    inspector.close();
    await call(
      anonymous,
      "recovery/reset",
      { token: resetToken, password },
      400,
    );
    await call(anonymous, "recovery/request", { email: "admin@example.test" });
    const state = await call(admin, "state");
    assert.equal(state.user.reset, undefined);
    assert.ok(state.users.every((u) => !u.reset && !u.password));
    await call(anonymous, "recovery/reset", {
      token: resetToken,
      password: "replacement-password-123",
    });
    await call(admin, "state", null, 401);
    await call(
      anonymous,
      "recovery/reset",
      { token: resetToken, password },
      400,
    );
    await call(admin, "login", {
      email: "admin@example.test",
      password: "replacement-password-123",
    });
    const unknown = await call(anonymous, "recovery/request", {
      email: "missing@example.test",
    });
    assert.equal(unknown.ok, true);
    for (let i = 0; i < 2; i++)
      await call(anonymous, "recovery/request", {
        email: "missing@example.test",
      });
    await call(
      anonymous,
      "recovery/request",
      { email: "missing@example.test" },
      429,
    );
  } finally {
    global.fetch = nativeFetch;
    await stop();
    for (const k of envKeys)
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
