const $ = (s) => document.querySelector(s),
  app = $("#app");
let state,
  view = "orders",
  proofOrder,
  proofStage,
  proofPickup,
  signed = false;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(url, body) {
  if (window.relayDemo) return window.relayDemo.request(url, body);
  const r = await fetch("/api/" + url, {
    method: body ? "POST" : "GET",
    headers:
      body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok && j.errors?.length)
    j.error +=
      " " +
      j.errors
        .slice(0, 5)
        .map((e) => "Row " + e.row + ": " + e.error)
        .join("; ");
  if (!r.ok)
    throw Object.assign(Error(j.error || "Request failed"), {
      status: r.status,
      code: j.code,
    });
  return j;
}
let toastTimer;
function toast(message, type = "success") {
  const el = $("#toast");
  clearTimeout(toastTimer);
  el.textContent = message;
  el.dataset.type = type;
  el.hidden = false;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  toastTimer = setTimeout(
    () => (el.hidden = true),
    type === "error" ? 8000 : 3500,
  );
}
let busy = false;
async function run(fn) {
  if (busy) return;
  busy = true;
  const trigger =
    document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : null;
  if (trigger) {
    trigger.disabled = true;
    trigger.setAttribute("aria-busy", "true");
  }
  try {
    await fn();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    busy = false;
    if (trigger) {
      trigger.disabled = false;
      trigger.removeAttribute("aria-busy");
    }
  }
}
const symbols = {
  orders: "M3 6h18M3 12h18M3 18h18",
  plus: "M12 5v14M5 12h14",
  vendor: "M3 10l2-6h14l2 6M4 10v10h16V10M9 20v-7h6v7",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87",
  box: "M3 7l9-5 9 5v10l-9 5-9-5V7zm0 0l9 5 9-5M12 12v10M7.5 4.5l9 5",
  truck: "M3 6h11v12H3zM14 10h4l3 4v4h-7M5 18a2 2 0 1 0 4 0m7 0a2 2 0 1 0 4 0",
  check: "M5 12l4 4L19 6",
  clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  warehouse: "M3 21V9l9-6 9 6v12M7 21V11h10v10M7 15h10M7 18h10",
  alert: "M12 8v5m0 3v1M10 3L2 19h20L14 3z",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${symbols[name] || symbols.box}"/></svg>`;
const statuses = [
  "Created",
  "Picked up",
  "At warehouse",
  "Out for delivery",
  "Delivery failed",
  "Delivered",
];
const statusClass = (status) =>
  ({
    Created: "created",
    "Picked up": "picked",
    "At warehouse": "warehouse",
    "Out for delivery": "transit",
    "Delivery failed": "failed",
    Delivered: "delivered",
  })[status] || "created";
let searchQuery = "",
  statusFilter = "",
  sortOrder = "newest",
  selectedOrder = null;
const field = (name, label, type = "text") =>
  `<label>${label}<input name="${name}" type="${type}" required></label>`;
async function boot() {
  try {
    const s = await api("setup");
    if (s.required) return auth(true, s.keyRequired);
    try {
      state = await api("state");
      render();
    } catch (error) {
      if (error.status === 401) auth(false);
      else throw error;
    }
  } catch (error) {
    app.innerHTML = `<section class="auth"><h1>App setup needs attention</h1><p>${esc(error.message)}</p><p>Your data has not been moved or replaced.</p><button id="retryStartup">Try again</button><a class="primaryLink" href="/demo">Try the sample-data demo</a><p class="muted">The demo is separate from your operational data. Share the error code with your administrator: ${esc(error.code || "CONNECTION_ERROR")}</p></section>`;
    $("#retryStartup").onclick = boot;
  }
}

function auth(setup, keyRequired = false) {
  app.innerHTML = `<section class="auth"><h1>${setup ? "Set up Relay" : "Welcome back"}</h1><p>${setup ? "Create your administrator account. Use a password of at least 12 characters." : "Sign in to your delivery workspace."}</p><form id="auth">${setup ? field("name", "Your name") : ""}${setup && keyRequired ? field("setupKey", "Setup key (from Hostinger settings)", "password") : ""}${field("email", "Email", "email")}${field("password", "Password", "password")}<button>${setup ? "Create administrator" : "Sign in"}</button></form></section>`;
  $("#auth").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await api(
        setup ? "setup" : "login",
        Object.fromEntries(new FormData(e.target)),
      );
      if (setup) auth(false);
      else boot();
    });
  };
}
function render() {
  releaseFleetMap();
  const admin = state.user.role === "admin",
    ops = admin || state.user.role === "operations";
  const pages = [
    ...(ops
      ? [{ id: "dashboard", label: "Dashboard", symbol: "warehouse" }]
      : []),
    { id: "orders", label: "Orders", symbol: "orders" },
    ...(ops
      ? [
          { id: "create", label: "New order / Excel", symbol: "plus" },
          { id: "vendors", label: "Vendors", symbol: "vendor" },
          { id: "reports", label: "Reports", symbol: "orders" },
        ]
      : []),
    ...(admin ? [{ id: "users", label: "Team access", symbol: "users" }] : []),
    { id: "settings", label: "Settings", symbol: "vendor" },
  ];
  if (!pages.some((p) => p.id === view)) view = "orders";
  $("#logout").hidden = false;
  const titles = {
    dashboard: "A beautiful overview of your day.",
    orders: "Every delivery. One clear view.",
    create: "A new journey starts here.",
    vendors: "Your pickup network.",
    users: "The people who keep it moving.",
    reports: "The full story of every order.",
    settings: "Make Mawada yours.",
  };
  app.innerHTML = `<div class="appShell"><aside class="workspaceSidebar"><div class="workspaceLabel">WORKSPACE <span class="liveDot"></span></div><div class="workspaceName">Mawada delivery<small>One warehouse · Online delivery</small></div><nav aria-label="Workspace navigation">${pages.map((p) => `<button data-view="${p.id}" class="${view === p.id ? "active" : ""}" ${view === p.id ? 'aria-current="page"' : ""}>${icon(p.symbol)}<span>${p.label}</span>${p.id === "orders" ? `<span class="navCount">${state.orders.length}</span>` : ""}</button>`).join("")}</nav><div class="sidebarNote">${icon("check")}<div>Complete orders only<small>Every item checked before dispatch.</small></div></div><div class="userCard"><span class="avatar">${esc(state.user.name.slice(0, 2).toUpperCase())}</span><div><strong>${esc(state.user.name)}</strong><small>${esc(state.user.role)}</small></div></div></aside><div class="workspaceMain"><div class="pageHeading"><div><div class="eyebrow">OPERATIONS / ${esc(pages.find((p) => p.id === view).label.toUpperCase())}</div><h1>${titles[view]}</h1><p class="muted">${view === "orders" ? "Track pickups, consolidate with confidence, and keep deliveries moving." : "Everything your team needs, without the extra steps."}</p></div>${ops && view === "orders" ? `<button class="primary" id="quickCreate">${icon("plus")} Create order</button>` : ""}</div>${admin ? `<div class="storageNote"><span class="liveDot"></span>${state.storageBackend === "supabase" ? "Cloud database: Supabase" : state.storageBackend === "demo" ? "Sample demo · browser only" : "Local trial database"}</div>` : ""}${view === "orders" ? `<div class="stats">${statuses.map((s, i) => `<button class="stat ${statusClass(s)} ${statusFilter === s ? "selected" : ""}" data-status="${s}" aria-pressed="${statusFilter === s}"><div class="statTop"><span>${s}</span>${icon(["box", "truck", "warehouse", "truck", "alert", "check"][i])}</div><div class="statBottom"><strong>${state.orders.filter((o) => o.status === s).length}</strong><span>View orders</span></div></button>`).join("")}</div>` : ""}${ops && view === "orders" ? '<div id="fleetPanel"></div>' : ""}<div id="content"></div><footer class="workspaceFooter"><span>Mawada · Kuwait delivery</span><span>Pickup → Warehouse → Delivery</span></footer></div></div>`;
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.view;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }),
  );
  if ($("#quickCreate"))
    $("#quickCreate").onclick = () => {
      view = "create";
      render();
    };
  document.querySelectorAll("[data-status]").forEach(
    (b) =>
      (b.onclick = () => {
        statusFilter =
          statusFilter === b.dataset.status ? "" : b.dataset.status;
        render();
      }),
  );
  const c = $("#content");
  if (view === "orders") orders(c);
  if (view === "create") create(c);
  if (view === "vendors") vendors(c);
  if (view === "users") users(c);
  if (view === "reports") renderReports(c);
  if (view === "settings") renderAppearance(c);
  if (view === "dashboard") renderExecutiveDashboard(c);
  if (ops && view === "orders") renderFleet($("#fleetPanel"));
}
async function refresh(message = "Workspace updated") {
  state = await api("state");
  render();
  toast(message);
  reconcileTracking();
}
function bindForm(id, path, transform = (x) => x) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const result = await api(
        path,
        transform(Object.fromEntries(new FormData(e.target))),
      );
      if (path === "orders") {
        view = "orders";
        searchQuery = "";
        statusFilter = "";
        selectedOrder = result.id || null;
        sortOrder = "newest";
      }
      await refresh(
        path === "orders"
          ? "Order created successfully"
          : path === "vendors"
            ? "Vendor location saved"
            : path === "users"
              ? "Team member created"
              : "Workspace updated",
      );
    });
  };
}
function vendors(c) {
  c.innerHTML = `<section><h2>Add vendor pickup location</h2><form id="vendor"><div class="grid">${field("code", "Vendor code")}${field("name", "Vendor name")}${field("address", "Pickup address")}${field("phone", "Contact phone")}</div><button>Save vendor</button></form></section>${state.vendors.map((v) => `<section><b>${esc(v.name)} · ${esc(v.code)}</b><p>${esc(v.address)} · ${esc(v.phone)}</p></section>`).join("")}`;
  bindForm("#vendor", "vendors");
}
function users(c) {
  c.innerHTML = `<section><h2>Create team member</h2><form id="user"><div class="grid">${field("name", "Name")}${field("email", "Email", "email")}${field("password", "Password (12+ characters)", "password")}<label>Role<select name="role">${["operations", "warehouse", "driver", "admin"].map((r) => `<option>${r}</option>`).join("")}</select></label></div><button>Create user</button></form></section>${state.users.map((u) => `<section>${esc(u.name)} · ${esc(u.email)} <span class="badge">${u.role}</span></section>`).join("")}`;
  bindForm("#user", "users");
}
function create(c) {
  c.innerHTML = `<section><h2>Create order</h2><form id="order"><div class="grid">${field("reference", "Your order reference")}${field("recipient", "Recipient name")}${field("phone", "Phone (+965 followed by 8 digits)")}${field("address", "Delivery address")}</div><h3>Items and pickups</h3><div id="items"></div><button type="button" id="add">Add item</button><button>Create order</button></form></section><section><h2>Upload Excel (.xlsx)</h2><label>Export format<select id="importFormat"><option value="mawada">Mawada CMS · deliveries due today (Kuwait)</option><option value="template">Relay item-row template</option></select></label><p>Mawada: use named columns for Order Number, Recipient Delivery Date, Recipient Name, Recipient Phone, Recipient Address, Vendor Name, Item Details and Quantity. Only deliveries due today in Kuwait are selected. Use one row per item. For the Relay template, use reference, recipient, phone, address, vendorCode, name, quantity in that order.</p><input id="excel" type="file" accept=".xlsx"><button id="preview">Validate and preview</button><div id="previewResult"></div></section>`;
  const updateRemove = () =>
    document
      .querySelectorAll(".removeItem")
      .forEach(
        (button) => (button.disabled = $("#items").children.length === 1),
      );
  const add = () => {
    $("#items").insertAdjacentHTML(
      "beforeend",
      `<div class="grid item"><label>Vendor<select class="vendor">${state.vendors.map((v) => `<option value="${esc(v.code)}">${esc(v.name)} (${esc(v.code)})</option>`).join("")}</select></label><label>Item<input class="name" required></label><label>Quantity<input class="quantity" type="number" min="1" step="1" value="1" required></label><button type="button" class="removeItem ghost" aria-label="Remove item">Remove item</button></div>`,
    );
    updateRemove();
  };
  add();
  $("#add").onclick = add;
  $("#items").onclick = (event) => {
    const button = event.target.closest(".removeItem");
    if (button && $("#items").children.length > 1) {
      button.closest(".item").remove();
      updateRemove();
    }
  };
  bindForm("#order", "orders", (b) => ({
    ...b,
    items: [...document.querySelectorAll("#items .item")].map((i) => ({
      vendorCode: i.querySelector(".vendor").value,
      name: i.querySelector(".name").value,
      quantity: Number(i.querySelector(".quantity").value),
    })),
  }));
  $("#preview").onclick = () =>
    run(async () => {
      const file = $("#excel").files[0];
      if (!file) throw Error("Select a workbook");
      const f = new FormData();
      f.append("file", file);
      const format = $("#importFormat").value;
      const result = await api("import?format=" + format, f);
      $("#previewResult").innerHTML =
        `<p>${result.count} valid orders${result.today ? " due " + esc(result.today) + " in Kuwait · " + result.excluded.length + " rows excluded" : ""}</p>${result.excluded?.length ? `<details><summary>Excluded rows</summary>${result.excluded.map((row) => `<p>Row ${row.row}: ${esc(row.reason)}</p>`).join("")}</details>` : ""}${result.orders.map((o) => `<section class="importPreview"><strong>${esc(o.reference)} · ${esc(o.recipient)}</strong><p>${esc(o.phone)} · ${esc(o.address)}</p><p>${o.items.map((i) => esc(i.name) + " × " + i.quantity + " · " + esc(i.vendor?.name || i.vendorCode)).join("<br>")}</p>${o.source === "Mawada CMS" ? `<p>${esc(o.deliveryDate)} · ${esc(o.timeSlot || "No slot provided")} · ${o.amountFils == null ? "Value not provided" : (o.amountFils / 1000).toFixed(3) + " KWD"}</p><p>Ring bell: ${o.ringBell == null ? "Not provided" : o.ringBell ? "Yes" : "No"} · Card: ${o.cardAvailable == null ? "Not provided" : o.cardAvailable ? "Yes" : "No"}</p><p>${esc(o.extraDirections || "No extra directions")}</p><p>Occasion: ${esc(o.occasion?.value || "Unknown")} ${o.occasion?.needsReview ? "· Requires review" : ""}</p>` : ""}</section>`).join("")}<button id="confirm" ${result.count ? "" : "disabled"}>Confirm import</button>`;
      $("#confirm").onclick = () =>
        run(async () => {
          await api("import?confirm=yes&format=" + format, f);
          view = "orders";
          await refresh();
        });
    });
}
function nextStep(o) {
  return (
    {
      Created: "Collect items from each vendor",
      "Picked up": "Check items into the warehouse",
      "At warehouse": "Verify the full manifest and dispatch",
      "Out for delivery": "Capture proof at the recipient’s door",
      "Delivery failed": o.returned
        ? "Ready for rescheduling"
        : "Confirm items returned to the warehouse",
      Delivered: "Delivery complete · proof recorded",
    }[o.status] || ""
  );
}
function orderDeliveryNotes(o) {
  if (o.source !== "Mawada CMS") return "";
  return `<div class="orderNotes"><strong>Delivery instructions</strong><p>${o.deliveryDate ? esc(o.deliveryDate) : ""} ${esc(o.timeSlot || "")} · Order amount ${o.amountFils == null ? "not provided" : (o.amountFils / 1000).toFixed(3) + " KWD"}</p><p>Ring bell: ${o.ringBell == null ? "Not provided" : o.ringBell ? "Yes" : "No"} · Card available: ${o.cardAvailable == null ? "Not provided" : o.cardAvailable ? "Yes" : "No"}</p><p>${esc(o.extraDirections || "No extra directions")}</p><p>Occasion: ${esc(o.occasion?.value || "Unknown")}${o.occasion?.needsReview ? " · Unconfirmed suggestion" : ""}</p>${["admin", "operations"].includes(state.user.role) ? `<form class="occasionReview" data-order="${o.id}"><label>Review occasion<input name="occasion" maxlength="120" required value="${esc(o.occasion?.value || "")}" placeholder="e.g. Birthday or Unknown"></label><button>Confirm occasion</button></form>` : ""}</div>`;
}
function journey(o) {
  const active =
    {
      Created: 0,
      "Picked up": 1,
      "At warehouse": 1,
      "Out for delivery": 2,
      "Delivery failed": 2,
      Delivered: 3,
    }[o.status] ?? 0;
  return `<ol class="journey" aria-label="Order progress">${["Pickup", "Warehouse", "On the road", "Delivered"].map((label, i) => `<li class="${i < active || (i === 3 && active === 3) ? "done" : i === active ? "current" : ""}"><span>${i < active || (i === 3 && active === 3) ? icon("check") : i + 1}</span><small>${label}</small></li>`).join("")}</ol>`;
}
function orders(c) {
  pendingOrderRefresh = false;
  const manager = ["admin", "operations"].includes(state.user.role),
    warehouse = ["admin", "warehouse"].includes(state.user.role);
  const drivers = state.users.filter((u) => u.role === "driver");
  const driverSelect = () =>
    `<select name="driver" required><option value="">Choose driver</option>${drivers.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>`;
  const button = (o, action, label, extra = "") =>
    `<button data-order="${o.id}" data-action="${action}" ${extra}>${label}</button>`;
  if (!selectedOrder && state.orders.length) selectedOrder = state.orders[0].id;
  c.innerHTML = `${state.user.role === "driver" ? '<div id="driverTools"></div>' : ""}<div class="boardHeading"><div><h2>Order board</h2><p class="muted" id="resultCount"></p></div><button class="ghost" id="expandOrders">Expand all</button></div><div class="orderToolbar"><label class="searchField">${icon("search")}<input id="orderSearch" type="search" aria-label="Search orders" placeholder="Search AWB, recipient, vendor or reference…" value="${esc(searchQuery)}"></label><label class="filterField"><span class="sr-only">Filter by status</span><select id="statusFilter" aria-label="Filter by status"><option value="">All statuses</option>${statuses.map((s) => `<option ${statusFilter === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label class="filterField"><span class="sr-only">Sort orders</span><select id="orderSort" aria-label="Sort orders"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="reference">Order reference</option></select></label></div><section id="noResults" class="emptyState" hidden>${icon("search")}<h3>No matching orders</h3><p class="muted">Try a different reference or clear your filters.</p><button id="clearFilters" class="secondary">Clear filters</button></section><div id="orderList">${state.orders
    .map(
      (
        o,
      ) => `<section class="orderCard" data-id="${o.id}" data-status-value="${esc(o.status)}" data-search="${esc([o.awb, o.reference, o.recipient, o.address, o.phone, ...o.items.map((i) => i.vendor.name), state.users.find((u) => u.id === o.driver)?.name || ""].join(" ").toLowerCase())}">
 <div class="orderTop"><div class="orderIdentity"><span class="orderIcon">${icon("box")}</span><div><span class="overline">AIR WAYBILL</span><b>${esc(o.awb)}</b><small>Ref. ${esc(o.reference)}</small></div></div><span class="badge ${statusClass(o.status)}">${esc(o.status)}</span></div>
 <div class="orderSummary"><div class="orderDestination"><h3>${esc(o.recipient)}</h3><p>${esc(o.address)}</p><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div><div class="orderFacts"><span>${o.pickups.length} vendor pickups</span><span>${o.items.length} item lines · ${o.items.reduce((n, i) => n + i.quantity, 0)} units</span></div></div>
 ${orderDeliveryNotes(o)}
 ${journey(o)}
 <div class="orderActionRow"><span class="nextStep">${icon(o.status === "Delivered" ? "check" : "clock")}${esc(nextStep(o))}</span>${button(o, "label", "Print AWB label")}</div>
 <details class="orderWorkflow" ${selectedOrder === o.id ? "open" : ""}><summary><span>${icon("orders")} Manage workflow</span><span>${o.items.filter((i) => i.received).length}/${o.items.length} items received</span></summary><div class="orderBody">
 <p class="assignmentLabel">Delivery driver: ${esc(state.users.find((u) => u.id === o.driver)?.name || (o.driver ? "Assigned" : "Unassigned"))}${o.deliveryDate ? " · Scheduled " + esc(o.deliveryDate) : ""}</p>
 <h3>Vendor pickups</h3>${o.pickups
   .map(
     (
       p,
     ) => `<div class="card"><b>${esc(p.vendor.name)}</b><p>${esc(p.vendor.address)} · ${esc(p.vendor.phone)}</p><span class="badge">${p.completed ? "Completed" : "Awaiting pickup"}</span><p>Pickup driver: ${esc(state.users.find((u) => u.id === p.driver)?.name || (p.driver ? "Assigned" : "Unassigned"))}</p>
 ${o.items
   .filter((i) => i.vendor.id === p.vendor.id)
   .map(
     (i) =>
       `<p>${esc(i.name)} × ${i.quantity}${i.source ? " · " + esc(i.source) : ""}</p>`,
   )
   .join("")}
 ${manager && !p.completed ? `<form class="taskAssign" data-order="${o.id}" data-pickup="${p.id}">${driverSelect()}<button>Assign pickup driver</button></form>` : ""}
 ${pickupTripControls(o, p, manager, button)}
 ${!p.completed && (manager || (state.user.role === "driver" && p.driver === state.user.id && RelayOperations.activeTrips(o).some((t) => t.kind === "pickup" && t.pickupId === p.id))) ? button(o, "pickup", "Verify items and record pickup", `data-pickup="${p.id}"`) : ""}
 ${p.legacy ? "<small>Historical pickup: separate vendor proof was not recorded.</small>" : ""}</div>`,
   )
   .join("")}
 <h3>Warehouse manifest</h3>${o.items.map((i) => `<div class="item row"><span>${i.received ? "✓ Received" : "○ Awaiting receipt"} · ${esc(i.name)} × ${i.quantity}<small>${esc(i.vendor.name)}</small></span>${warehouse && !i.received && ["Created", "Picked up", "At warehouse"].includes(o.status) ? button(o, "receive", "Receive item", `data-item="${i.id}"`) : ""}</div>`).join("")}
 ${warehouse && ["Created", "Picked up", "At warehouse"].includes(o.status) ? `<details><summary>Add an item already at the warehouse</summary><p>This adds a physically received item to this order. Check its order reference before saving.</p><form class="addItem" data-order="${o.id}"><label>Vendor<select name="vendorCode">${state.vendors.map((v) => `<option value="${esc(v.code)}">${esc(v.name)}</option>`).join("")}</select></label>${field("name", "Item name")}${field("quantity", "Quantity", "number")}<button>Add received item</button></form></details>` : ""}
 ${manager && !["Delivered", "Out for delivery"].includes(o.status) ? `<form class="deliveryAssign" data-order="${o.id}"><label>Delivery driver${driverSelect()}</label><button>Assign delivery driver</button></form>` : ""}
 ${o.status === "At warehouse" && (manager || (state.user.role === "driver" && o.driver === state.user.id)) ? button(o, "Out for delivery", state.user.role === "driver" ? "Start delivery trip" : "Verify manifest and dispatch") : ""}
 ${o.status === "Out for delivery" && (manager || (state.user.role === "driver" && o.driver === state.user.id)) ? deliveryTripControls(o, button) + button(o, "Delivered", "Record delivery") + button(o, "fail", "Delivery unsuccessful") : ""}
 ${o.status === "Delivery failed" ? `<p>Latest failure: ${esc(o.attempts?.at(-1)?.reason)}</p><p>${o.returned ? "Returned to warehouse" : "Awaiting warehouse return confirmation"}</p>${warehouse && !o.returned ? button(o, "return", "Confirm physical return") : ""}${manager && o.returned ? `<form class="reschedule" data-order="${o.id}">${field("date", "New delivery date", "date")}<button>Reschedule</button></form>` : ""}` : ""}
 <details><summary>History and proof</summary>${o.history.map((h) => `<p>${esc(h.event)} · ${esc(h.by || "")} · ${new Date(h.at).toLocaleString("en-GB", { timeZone: "Asia/Kuwait" })}${h.reason ? " · " + esc(h.reason) : ""}${h.date ? " · " + esc(h.date) : ""}${h.item ? " · item " + esc(h.item) : ""}</p>`).join("")}${(o.proofs || []).map((p) => `<p>${esc(p.stage)} · ${esc(p.vendor || "")} · ${esc(p.name)} · GPS ${p.lat}, ${p.lng}</p><img width="180" src="${p.photo}" alt="Handover photo">${p.signature ? `<img width="180" src="${p.signature}" alt="Recipient signature">` : ""}`).join("")}</details></div></details></section>`,
    )
    .join("")}</div>`;
  $("#orderSort").value = sortOrder;
  const applyFilters = () => {
    const cards = [...document.querySelectorAll("#orderList > .orderCard")];
    cards.forEach(
      (card) =>
        (card.hidden = Boolean(
          (statusFilter && card.dataset.statusValue !== statusFilter) ||
          (searchQuery.trim() &&
            !card.dataset.search.includes(searchQuery.trim().toLowerCase())),
        )),
    );
    const count = cards.filter((card) => !card.hidden).length;
    $("#resultCount").textContent =
      `Showing ${count} of ${cards.length} ${cards.length === 1 ? "order" : "orders"}`;
    $("#noResults").hidden = count !== 0;
    document.querySelectorAll("[data-status]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.status === statusFilter);
      b.setAttribute("aria-pressed", String(b.dataset.status === statusFilter));
    });
    cards
      .sort((a, b) => {
        const one = state.orders.find((o) => o.id === a.dataset.id),
          two = state.orders.find((o) => o.id === b.dataset.id);
        if (sortOrder === "reference")
          return one.reference.localeCompare(two.reference);
        const date = new Date(two.history[0].at) - new Date(one.history[0].at);
        return sortOrder === "oldest" ? -date : date;
      })
      .forEach((card) => $("#orderList").append(card));
  };
  $("#orderSearch").oninput = (e) => {
    searchQuery = e.target.value;
    applyFilters();
  };
  $("#statusFilter").onchange = (e) => {
    statusFilter = e.target.value;
    applyFilters();
  };
  $("#orderSort").onchange = (e) => {
    sortOrder = e.target.value;
    applyFilters();
  };
  $("#clearFilters").onclick = () => {
    searchQuery = "";
    statusFilter = "";
    $("#orderSearch").value = "";
    $("#statusFilter").value = "";
    applyFilters();
    $("#orderSearch").focus();
  };
  $("#expandOrders").onclick = () => {
    const details = [...document.querySelectorAll(".orderWorkflow")].filter(
      (d) => !d.closest("section").hidden,
    );
    const open = details.some((d) => !d.open);
    details.forEach((d) => (d.open = open));
    $("#expandOrders").textContent = open ? "Collapse all" : "Expand all";
  };
  document.querySelectorAll(".orderWorkflow").forEach((d) =>
    d.addEventListener("toggle", () => {
      if (d.open) selectedOrder = d.closest("section").dataset.id;
    }),
  );
  applyFilters();
  if (state.user.role === "driver") renderDriverPanel($("#driverTools"));
  for (const [selector, action] of [
    [".taskAssign", "assign-pickup"],
    [".deliveryAssign", "assign"],
    [".addItem", "add-item"],
    [".reschedule", "reschedule"],
    [".occasionReview", "review-occasion"],
  ])
    document.querySelectorAll(selector).forEach(
      (f) =>
        (f.onsubmit = (e) => {
          e.preventDefault();
          run(async () => {
            await api("orders/" + f.dataset.order + "/action", {
              action,
              pickup: f.dataset.pickup,
              ...Object.fromEntries(new FormData(f)),
            });
            await refresh();
          });
        }),
    );
  document.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = () =>
        run(async () => {
          const o = state.orders.find((o) => o.id === b.dataset.order),
            action = b.dataset.action;
          if (action === "label") {
            printLabel(o);
            return;
          }
          if (["pickup", "Delivered"].includes(action)) {
            proofOrder = o.id;
            proofStage = action;
            proofPickup = b.dataset.pickup;
            $("#proofForm").reset();
            $('#proofForm input[name="photo"]').required = !window.relayDemo;
            clear();
            const items =
              action === "pickup"
                ? o.items.filter(
                    (i) =>
                      i.vendor.id ===
                      o.pickups.find((p) => p.id === proofPickup).vendor.id,
                  )
                : o.items;
            $("#proofItems").innerHTML = items
              .map(
                (i) =>
                  `<label class="check"><input type="checkbox" name="verifiedItems" value="${i.id}" required> ${esc(i.name)} × ${i.quantity}</label>`,
              )
              .join("");
            $("#signatureArea").hidden = action !== "Delivered";
            $("#proof").showModal();
            return;
          }
          let extra = { item: b.dataset.item };
          if (action === "Out for delivery") {
            dispatchOrder = o;
            $("#dispatchItems").innerHTML = o.items
              .map(
                (i) =>
                  `<label class="check"><input type="checkbox" name="verifiedItems" value="${i.id}" required> ${esc(i.name)} × ${i.quantity} · ${esc(i.vendor.name)}</label>`,
              )
              .join("");
            $("#dispatch").showModal();
            return;
          }
          if (action === "fail" || action === "pickup-failed") {
            failureAction = action;
            failurePickup = b.dataset.pickup;
            failureOrder = o;
            $("#failureForm").reset();
            $("#failureForm h2").textContent =
              action === "pickup-failed"
                ? "Pickup unsuccessful"
                : "Delivery unsuccessful";
            $("#failure").showModal();
            return;
          }
          if (
            action === "return" &&
            !confirm(
              "Confirm that all items have physically returned to the warehouse?",
            )
          )
            return;
          await api("orders/" + o.id + "/action", { action, ...extra });
          await refresh();
          if (action === "start-pickup-trip" && state.user.role === "driver")
            startLocationSharing(true).catch((error) =>
              toast(error.message, "error"),
            );
        })),
  );
}
function printLabel(o) {
  $("#labelContent").innerHTML =
    `<h2>RELAY · KUWAIT</h2><img class="barcode" src="${window.relayDemo ? "/demo/barcode/" + o.awb : "/api/orders/" + o.id + "/awb"}" alt="AWB barcode"><h3>${esc(o.awb)}</h3><p>Reference: ${esc(o.reference)}</p><h3>${esc(o.recipient)}</h3><p>${esc(o.phone)}</p><p>${esc(o.address)}</p><hr><p>${o.items.length} item lines · ${o.items.reduce((n, i) => n + i.quantity, 0)} units</p>${o.items.map((i) => `<p>${esc(i.name)} × ${i.quantity} · ${esc(i.vendor.name)}</p>`).join("")}`;
  $("#label").showModal();
  const img = $("#labelContent img");
  $("#printLabel").disabled = true;
  img.onload = () => ($("#printLabel").disabled = false);
  img.onerror = () => alert("Label could not load. Close and retry.");
}
let dispatchOrder,
  failureOrder,
  failureAction = "fail",
  failurePickup;
$("#dispatchForm").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    await api("orders/" + dispatchOrder.id + "/action", {
      action: "Out for delivery",
      verifiedItems: new FormData(e.target).getAll("verifiedItems"),
    });
    $("#dispatch").close();
    await refresh();
    if (state.user.role === "driver")
      startLocationSharing(true).catch((error) =>
        toast(error.message, "error"),
      );
  });
};
$("#failureForm").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    await api("orders/" + failureOrder.id + "/action", {
      action: failureAction,
      pickup: failurePickup,
      reason: new FormData(e.target).get("reason"),
    });
    $("#failure").close();
    await refresh();
  });
};
$("#printLabel").onclick = () => window.print();
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $("#" + b.dataset.close).close()));
const canvas = $("canvas"),
  ctx = canvas.getContext("2d");
let drawing = false;
function clear() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  signed = false;
}
$("#clear").onclick = clear;
canvas.onpointerdown = (e) => {
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  ctx.beginPath();
  const r = canvas.getBoundingClientRect();
  ctx.moveTo(
    ((e.clientX - r.left) * canvas.width) / r.width,
    ((e.clientY - r.top) * canvas.height) / r.height,
  );
};
canvas.onpointermove = (e) => {
  if (!drawing) return;
  const r = canvas.getBoundingClientRect();
  ctx.lineTo(
    ((e.clientX - r.left) * canvas.width) / r.width,
    ((e.clientY - r.top) * canvas.height) / r.height,
  );
  ctx.stroke();
  signed = true;
};
canvas.onpointerup = () => (drawing = false);
canvas.onpointercancel = () => (drawing = false);
$("#cancel").onclick = () => $("#proof").close();
$("#proofForm").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    if (proofStage === "Delivered" && !signed)
      throw Error("Recipient signature required");
    const f = new FormData(e.target),
      file = f.get("photo");
    if (file.size > 4 * 1024 * 1024)
      throw Error("Photo must be smaller than 4 MB");
    const photo =
      window.relayDemo && !file.size
        ? window.relayDemo.samplePhoto
        : await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(file);
          });
    const pos = window.relayDemo
      ? { coords: { latitude: 29.3759, longitude: 47.9774 } }
      : await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(
            res,
            () => rej(Error("Allow GPS access to record proof")),
            { enableHighAccuracy: true, timeout: 20000 },
          ),
        );
    await api("orders/" + proofOrder + "/action", {
      action: proofStage,
      pickup: proofPickup,
      verifiedItems: f.getAll("verifiedItems"),
      name: f.get("name"),
      photo,
      signature: proofStage === "Delivered" ? canvas.toDataURL() : undefined,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    });
    $("#proof").close();
    await refresh();
  });
};
$("#logout").onclick = () =>
  run(async () => {
    try {
      await stopLocationSharing();
    } catch {}
    await api("logout", {});
    location.reload();
  });
startOperationalPolling();
boot();

function renderAppearance(root) {
  const theme = window.MawadaTheme,
    current = theme.get();
  root.innerHTML = `<section class="appearanceSettings"><div class="eyebrow">YOUR WORKSPACE, YOUR STYLE</div><h2>Choose your atmosphere.</h2><p class="muted">Preview instantly. Saved for this browser on this device.</p><div class="themeGallery">${Object.entries(
    theme.palettes,
  )
    .map(
      ([key, p]) =>
        `<button class="themePreview" data-palette-choice="${key}" aria-pressed="${current.palette === key}" style="--preview-bg:${p.background};--preview-accent:${p.accent}"><div class="miniWorkspace"><i></i><span></span><span></span><span></span></div><strong>${p.name}</strong><small>${key === "midnight" ? "Black · burgundy · white" : key === "orchid" ? "Deep violet · luminous orchid" : "Classic Mawada plum"}</small></button>`,
    )
    .join(
      "",
    )}</div><form id="appearanceForm"><label>Appearance<select name="mode"><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label><div class="colourChoices"><label>Accent colour<input type="color" name="accent" value="${current.custom.accent || theme.palettes[current.palette].accent}"></label><label>Background colour<input type="color" name="background" value="${current.custom.background || theme.palettes[current.palette].background}"></label></div><p class="muted">Use lighter lettering on dark backgrounds for readability. Custom colours override the selected palette.</p><label><input type="checkbox" name="motion" ${current.custom.motion !== false ? "checked" : ""}> Enable subtle animation (device reduced-motion preference is always respected)</label><div class="row"><button>Save custom colours</button><button type="button" class="ghost" id="resetColours">Reset custom colours</button></div><p id="appearanceSaved" role="status"></p></form></section>`;
  root.querySelector("[name=mode]").value = current.preference;
  root.querySelectorAll("[data-palette-choice]").forEach(
    (b) =>
      (b.onclick = () => {
        theme.set({
          palette: b.dataset.paletteChoice,
          custom: { motion: current.custom.motion },
          preference: "dark",
        });
        renderAppearance(root);
      }),
  );
  root.querySelector("#resetColours").onclick = () => {
    theme.set({ custom: {} });
    renderAppearance(root);
  };
  root.querySelector("#appearanceForm").onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    theme.set({
      preference: data.get("mode"),
      custom: {
        accent: data.get("accent"),
        background: data.get("background"),
        motion: data.has("motion"),
      },
    });
    root.querySelector("#appearanceSaved").textContent =
      "Appearance saved on this device.";
  };
  root.querySelector("[name=mode]").onchange = (e) =>
    theme.set({ preference: e.target.value });
}
