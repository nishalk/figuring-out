(() => {
  if (location.pathname !== "/demo") return;
  const key = "relay-sample-demo-v1";
  const photo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=";
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function fresh() {
    const users = [
      {
        id: "demo-admin",
        name: "Demo Administrator",
        email: "admin@example.test",
        role: "admin",
      },
      { id: "demo-ops", name: "Demo Dispatcher", role: "operations" },
      { id: "demo-warehouse", name: "Demo Warehouse", role: "warehouse" },
      { id: "demo-driver", name: "Demo Driver", role: "driver" },
    ];
    const vendors = [
      {
        id: "vendor-1",
        code: "V1",
        name: "Sample Electronics",
        address: "Kuwait City · sample pickup",
        phone: "",
      },
      {
        id: "vendor-2",
        code: "V2",
        name: "Sample Home Store",
        address: "Salmiya · sample pickup",
        phone: "",
      },
    ];
    const orders = ["Created", "At warehouse", "Out for delivery"].map(
      (status, n) => ({
        id: "demo-order-" + n,
        awb: "DEMO-KW-" + (1001 + n),
        reference: "SAMPLE-" + (1001 + n),
        recipient: "Sample recipient " + (n + 1),
        address: "Hawally · fictional address",
        phone: "+96500000000",
        driver: "demo-driver",
        status,
        items: vendors.map((vendor, i) => ({
          id: "demo-item-" + n + "-" + i,
          vendor,
          name: i ? "Home accessory" : "Electronics box",
          quantity: 1,
          received: n > 0,
        })),
        pickups: vendors.map((vendor, i) => ({
          id: "demo-pickup-" + n + "-" + i,
          vendor,
          driver: "demo-driver",
          completed: n > 0,
        })),
        history: [
          { event: "Sample order created", at: new Date().toISOString() },
        ],
      }),
    );
    return { users, vendors, orders, userId: "demo-admin" };
  }
  let data;
  try {
    data = JSON.parse(sessionStorage.getItem(key)) || fresh();
  } catch {
    data = fresh();
  }
  const persist = () => sessionStorage.setItem(key, JSON.stringify(data));
  const current = () => data.users.find((u) => u.id === data.userId);
  function fail(message) {
    throw Error(message);
  }
  function sync(o) {
    o.status = o.items.every((i) => i.received)
      ? "At warehouse"
      : o.pickups.every((p) => p.completed)
        ? "Picked up"
        : "Created";
  }
  function assertManager() {
    if (!["admin", "operations"].includes(current().role))
      fail("Dispatcher access required");
  }
  function warehouse() {
    if (!["admin", "warehouse"].includes(current().role))
      fail("Warehouse access required");
  }
  function driver(id) {
    if (!data.users.some((u) => u.id === id && u.role === "driver"))
      fail("Choose a driver");
    return id;
  }
  async function request(url, b) {
    if (url === "setup") return { required: false };
    if (url === "state")
      return clone({
        user: current(),
        users: ["admin", "operations"].includes(current().role)
          ? data.users
          : [],
        vendors: current().role === "driver" ? [] : data.vendors,
        orders: data.orders.filter(
          (o) =>
            current().role !== "driver" ||
            o.driver === current().id ||
            o.pickups.some((p) => p.driver === current().id),
        ),
        storageBackend: "demo",
      });
    if (url === "logout") {
      data.userId = "demo-admin";
      persist();
      return { ok: true };
    }
    if (url === "vendors") {
      assertManager();
      if (
        !b.code ||
        !b.name ||
        !b.address ||
        data.vendors.some((v) => v.code === b.code)
      )
        fail("Unique vendor code, name and address required");
      data.vendors.push({ ...b, id: crypto.randomUUID() });
    } else if (url === "users") {
      if (current().role !== "admin") fail("Administrator access required");
      if (!b.name || !b.email || data.users.some((u) => u.email === b.email))
        fail("Unique email and name required");
      const { password, ...user } = b;
      data.users.push({ ...user, id: crypto.randomUUID() });
    } else if (url === "orders") {
      assertManager();
      if (
        !b.reference ||
        data.orders.some((o) => o.reference === b.reference) ||
        !b.items?.length ||
        !/^\+965\d{8}$/.test(b.phone)
      )
        fail("Unique reference, items and a +965 phone required");
      const items = b.items.map((i) => {
        const vendor = data.vendors.find((v) => v.code === i.vendorCode);
        if (
          !vendor ||
          !i.name ||
          !Number.isInteger(i.quantity) ||
          i.quantity < 1
        )
          fail("Check each item and vendor");
        return { ...i, id: crypto.randomUUID(), vendor, received: false };
      });
      data.orders.unshift({
        ...b,
        id: crypto.randomUUID(),
        awb: "DEMO-KW-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
        items,
        status: "Created",
        driver: null,
        pickups: [
          ...new Map(items.map((i) => [i.vendor.id, i.vendor])).values(),
        ].map((vendor) => ({
          id: crypto.randomUUID(),
          vendor,
          completed: false,
          driver: null,
        })),
        history: [{ event: "Created", at: new Date().toISOString() }],
      });
    } else if (url.startsWith("import"))
      fail(
        "Excel uploads are available in the connected live app. In this sample demo, use New order to try order entry.",
      );
    else if (url.startsWith("orders/")) {
      const o = data.orders.find((o) => o.id === url.split("/")[1]);
      if (!o) fail("Order not found");
      const manager = ["admin", "operations"].includes(current().role),
        assigned = current().role === "driver" && o.driver === current().id;
      const t = o.pickups.find((p) => p.id === b.pickup);
      if (b.action === "assign") {
        assertManager();
        o.driver = driver(b.driver);
      } else if (b.action === "assign-pickup") {
        assertManager();
        if (!t || t.completed) fail("Select an incomplete pickup");
        t.driver = driver(b.driver);
      } else if (b.action === "pickup") {
        if (!t || t.completed || !t.driver)
          fail("Assign an incomplete pickup first");
        if (!manager && t.driver !== current().id)
          fail("This pickup is assigned to another driver");
        if (
          !b.name ||
          !b.photo ||
          o.items
            .filter((i) => i.vendor.id === t.vendor.id)
            .some((i) => !b.verifiedItems.includes(i.id))
        )
          fail("Verify all pickup items and add handover details");
        t.completed = true;
        (o.proofs ??= []).push({
          ...b,
          stage: "Vendor pickup",
          vendor: t.vendor.name,
          at: new Date().toISOString(),
        });
        sync(o);
      } else if (b.action === "receive") {
        warehouse();
        const i = o.items.find((i) => i.id === b.item);
        if (
          !i ||
          !o.pickups.find((p) => p.vendor.id === i.vendor.id)?.completed
        )
          fail("Complete vendor pickup first");
        i.received = true;
        sync(o);
      } else if (b.action === "add-item") {
        warehouse();
        if (!["Created", "Picked up", "At warehouse"].includes(o.status))
          fail("Add items before dispatch");
        const vendor = data.vendors.find((v) => v.code === b.vendorCode),
          quantity = Number(b.quantity);
        if (!vendor || !b.name || !Number.isInteger(quantity) || quantity < 1)
          fail("Valid item, quantity and vendor required");
        o.items.push({
          id: crypto.randomUUID(),
          name: b.name,
          quantity,
          vendor,
          received: true,
          source: "Warehouse addition",
        });
        if (!o.pickups.some((p) => p.vendor.id === vendor.id))
          o.pickups.push({ id: crypto.randomUUID(), vendor, completed: true });
        sync(o);
      } else if (b.action === "Out for delivery") {
        if (!manager && !assigned) fail("Assigned driver access required");
        if (
          o.status !== "At warehouse" ||
          !o.driver ||
          o.items.some((i) => !i.received || !b.verifiedItems?.includes(i.id))
        )
          fail("All items must be received, assigned and verified");
        o.status = "Out for delivery";
      } else if (b.action === "Delivered") {
        if (!manager && !assigned) fail("Assigned driver access required");
        if (
          o.status !== "Out for delivery" ||
          !b.name ||
          !b.signature ||
          !b.photo
        )
          fail("Delivery requires recipient name, signature and photo");
        o.status = "Delivered";
        (o.proofs ??= []).push({
          ...b,
          stage: "Delivered",
          at: new Date().toISOString(),
        });
      } else if (b.action === "fail") {
        if (!manager && !assigned) fail("Assigned driver access required");
        if (o.status !== "Out for delivery" || !b.reason?.trim())
          fail("Enter a reason for this dispatched order");
        o.status = "Delivery failed";
        o.returned = false;
        (o.attempts ??= []).push({
          reason: b.reason,
          at: new Date().toISOString(),
        });
      } else if (b.action === "return") {
        warehouse();
        if (o.status !== "Delivery failed") fail("Choose a failed delivery");
        o.returned = true;
      } else if (b.action === "reschedule") {
        assertManager();
        if (o.status !== "Delivery failed" || !o.returned || !b.date)
          fail("Confirm warehouse return and choose a date");
        o.deliveryDate = b.date;
        o.driver = null;
        o.status = "At warehouse";
      } else fail("Unsupported sample action");
      o.history.push({
        event: b.action,
        by: current().name,
        at: new Date().toISOString(),
        reason: b.reason,
        date: b.date,
      });
    } else fail("This action is unavailable in the sample demo");
    persist();
    return { ok: true };
  }
  window.relayDemo = { request, samplePhoto: photo };
  const banner = document.createElement("aside");
  banner.className = "demoBanner";
  banner.innerHTML =
    '<strong>SAMPLE DEMO</strong><span>Fictional orders · saved only in this browser tab · simulated GPS · no customer notifications. Do not enter real customer data. Pickup photos are optional here.</span><label>Try a role <select id="demoRole"></select></label><button id="resetDemo">Reset sample orders</button><a href="/">Live app</a>';
  document.querySelector("header").after(banner);
  const select = banner.querySelector("select");
  for (const u of data.users) {
    const option = document.createElement("option");
    option.value = u.id;
    option.textContent = u.name + " · " + u.role;
    option.selected = data.userId === u.id;
    select.append(option);
  }
  select.onchange = () => {
    data.userId = select.value;
    persist();
    location.reload();
  };
  banner.querySelector("button").onclick = () => {
    if (confirm("Reset all sample changes in this browser tab?")) {
      sessionStorage.removeItem(key);
      location.reload();
    }
  };
})();
