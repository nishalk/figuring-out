const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const ExcelJS = require("exceljs");
const photo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=";
test("multi-vendor pickup, consolidation, labels, failed delivery and rescheduling", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
  const p = spawn(process.execPath, [path.resolve("server.js")], {
    cwd,
    env: { ...process.env, PORT: "3199" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      p.stdout.on("data", resolve);
      p.on("exit", () => reject(Error("Server exited")));
      setTimeout(() => reject(Error("Startup timeout")), 30000).unref();
    });
    let cookie = "";
    async function req(route, body, status = 200) {
      const r = await fetch("http://127.0.0.1:3199/api/" + route, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          cookie,
        },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      assert.equal(r.status, status, await r.clone().text());
      return r.json();
    }
    const login = async (email) => {
      await req("logout", {});
      await req("login", {
        email: email + "@example.test",
        password: "test-password-123",
      });
    };
    await req("state", null, 401);
    await req("setup", {
      name: "Admin",
      email: "admin@example.test",
      password: "test-password-123",
    });
    await login("admin");
    for (const role of ["driver", "warehouse", "operations"])
      await req("users", {
        name: role,
        email: role + "@example.test",
        password: "test-password-123",
        role,
      });
    await req("users", {
      name: "Other driver",
      email: "other@example.test",
      password: "test-password-123",
      role: "driver",
    });
    for (const code of ["V1", "V2", "V3"])
      await req("vendors", {
        code,
        name: code,
        address: "Kuwait City",
        phone: "+96512345678",
      });
    let s = await req("state");
    const driver = s.users.find((u) => u.email === "driver@example.test"),
      other = s.users.find((u) => u.email === "other@example.test");
    await login("operations");
    assert.equal((await req("state")).users.length, 2);
    await req("users", { name: "Forbidden" }, 403);
    const o = await req("orders", {
      reference: "TEST-1",
      recipient: "Recipient",
      phone: "+96512345678",
      address: "Hawally",
      items: [
        { vendorCode: "V1", name: "Box", quantity: 1 },
        { vendorCode: "V2", name: "Parcel", quantity: 2 },
      ],
    });
    const action = (body, status = 200) =>
      req("orders/" + o.id + "/action", body, status);
    assert.equal(o.pickups.length, 2);
    for (const pickup of o.pickups)
      await action({
        action: "assign-pickup",
        pickup: pickup.id,
        driver: driver.id,
      });
    await action({ action: "assign", driver: other.id });
    await action({ action: "receive", item: o.items[0].id }, 403);
    await login("driver");
    assert.equal((await req("state")).orders.length, 1);
    await action({ action: "assign", driver: driver.id }, 403);
    await action(
      {
        action: "Delivered",
        name: "Wrong driver",
        photo,
        signature: photo,
        lat: 29,
        lng: 48,
      },
      403,
    );
    const proof = { name: "Vendor contact", photo, lat: 29.3, lng: 47.9 };
    const pickupBody = {
      action: "pickup",
      pickup: o.pickups[0].id,
      verifiedItems: [o.items[0].id],
      ...proof,
    };
    await action({ ...pickupBody, verifiedItems: [] }, 400);
    await action(
      { ...pickupBody, photo: "data:image/png;base64,invalid" },
      400,
    );
    await action({ action: "start-pickup-trip", pickup: o.pickups[0].id });
    await action(pickupBody);
    await action(pickupBody, 400);
    assert.equal((await req("state")).orders[0].status, "Created");
    await login("warehouse");
    await action({ action: "receive", item: o.items[1].id }, 400);
    await action({ action: "receive", item: o.items[0].id });
    await action({
      action: "add-item",
      vendorCode: "V3",
      name: "Warehouse accessory",
      quantity: 1,
    });
    assert.equal((await req("state")).orders[0].status, "Created");
    await login("driver");
    await action({ action: "start-pickup-trip", pickup: o.pickups[1].id });
    await action({
      action: "pickup",
      pickup: o.pickups[1].id,
      verifiedItems: [o.items[1].id],
      ...proof,
    });
    await login("warehouse");
    assert.equal((await req("state")).orders[0].status, "Picked up");
    await action({ action: "receive", item: o.items[1].id });
    let current = (await req("state")).orders[0];
    assert.equal(current.status, "At warehouse");
    assert.equal(current.items.length, 3);
    await login("operations");
    await action({ action: "Out for delivery", verifiedItems: [] }, 400);
    await action({
      action: "Out for delivery",
      verifiedItems: current.items.map((i) => i.id),
    });
    await login("warehouse");
    await action(
      { action: "add-item", vendorCode: "V3", name: "Too late", quantity: 1 },
      400,
    );
    await login("other");
    await action({ action: "fail", reason: "" }, 400);
    await action({ action: "fail", reason: "Recipient unavailable" });
    await login("operations");
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    await action({ action: "reschedule", date: today }, 400);
    await login("warehouse");
    await action({ action: "return" });
    await login("operations");
    await action({ action: "reschedule", date: "2026-02-31" }, 400);
    await action({ action: "reschedule", date: today });
    await action(
      {
        action: "Out for delivery",
        verifiedItems: current.items.map((i) => i.id),
      },
      400,
    );
    await action({ action: "assign", driver: other.id });
    await login("other");
    await action({
      action: "Out for delivery",
      verifiedItems: current.items.map((i) => i.id),
    });
    await action({ action: "Delivered", ...proof }, 400);
    await action({ action: "Delivered", ...proof, signature: photo });
    current = (await req("state")).orders[0];
    assert.equal(current.status, "Delivered");
    assert.equal(current.attempts.length, 1);
    assert.equal(current.proofs.length, 3);
    const label = await fetch(
      "http://127.0.0.1:3199/api/orders/" + o.id + "/awb",
      { headers: { cookie } },
    );
    assert.equal(label.status, 200);
    assert.equal(label.headers.get("content-type"), "image/png");
    assert.ok((await label.arrayBuffer()).byteLength > 1000);
    await action(
      { action: "add-item", vendorCode: "V3", name: "Forbidden", quantity: 1 },
      403,
    );
    await login("operations");
    await action({ action: "assign", driver: driver.id }, 400);
    // Exercise real XLSX parsing, preview isolation, commit and duplicate validation.
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet("Orders");
    sheet.addRow([
      "reference",
      "recipient",
      "phone",
      "address",
      "vendorCode",
      "name",
      "quantity",
    ]);
    sheet.addRow([
      "EXCEL-1",
      "Receiver",
      "+96512345678",
      "Salmiya",
      "V1",
      "Imported item",
      1,
    ]);
    const file = new FormData();
    file.append("file", new Blob([await wb.xlsx.writeBuffer()]), "orders.xlsx");
    assert.equal((await req("import", file)).committed, false);
    assert.equal((await req("state")).orders.length, 1);
    assert.equal((await req("import?confirm=yes", file)).count, 1);
    await req("import?confirm=yes", file, 400);
    const mw = new ExcelJS.Workbook(),
      ms = mw.addWorksheet("Mawada");
    ms.addRow([
      "Order Number",
      "Recipient Delivery Date",
      "Recipient Name",
      "Recipient Phone",
      "Recipient Address",
      "Vendor Name",
      "Item Details",
      "Quantity",
      "Order Amount",
      "Ring the bell",
      "Card available",
    ]);
    const cmsToday = require("../mawada-import").kuwaitDay();
    ms.addRow([
      "CMS-TODAY",
      cmsToday,
      "Sample receiver",
      "50000000",
      "Sample address",
      "V1",
      "Birthday bouquet",
      1,
      "12.345",
      "N",
      "Y",
    ]);
    ms.addRow([
      "CMS-OTHER",
      "2099-01-01",
      "Other receiver",
      "50000000",
      "Sample address",
      "V1",
      "Item",
      1,
      "12.345",
      "N",
      "Y",
    ]);
    const mf = new FormData();
    mf.append("file", new Blob([await mw.xlsx.writeBuffer()]), "cms.xlsx");
    const preview = await req("import?format=mawada", mf);
    assert.equal(preview.count, 1);
    assert.equal(preview.excluded.length, 1);
    const committed = await req("import?format=mawada&confirm=yes", mf);
    const imported = committed.orders[0];
    assert.equal(imported.amountFils, 12345);
    assert.equal(imported.ringBell, false);
    assert.equal(imported.occasion.needsReview, true);
    await req("orders/" + imported.id + "/action", {
      action: "review-occasion",
      occasion: "Birthday",
    });
    assert.equal(
      (await req("reports")).orders.find((o) => o.id === imported.id).occasion
        .needsReview,
      false,
    );
  } finally {
    p.kill();
    await new Promise((r) => p.once("exit", r));
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
