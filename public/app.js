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
  if (!r.ok) throw Error(j.error || "Request failed");
  return j;
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    alert(e.message);
  }
}
const field = (name, label, type = "text") =>
  `<label>${label}<input name="${name}" type="${type}" required></label>`;
async function boot() {
  const s = await api("setup");
  if (s.required) return auth(true, s.keyRequired);
  try {
    state = await api("state");
    render();
  } catch {
    auth(false);
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
  const admin = state.user.role === "admin",
    ops = admin || state.user.role === "operations";
  $("#logout").hidden = false;
  app.innerHTML = `<div class="row"><div><p class="muted">OPERATIONS WORKSPACE · KUWAIT</p><h1>Your deliveries, connected.</h1></div><span>${esc(state.user.name)} · ${esc(state.user.role)}</span></div><div class="grid stats">${["Created", "Picked up", "At warehouse", "Out for delivery", "Delivery failed", "Delivered"].map((s) => `<section><span class="muted">${s}</span><strong>${state.orders.filter((o) => o.status === s).length}</strong></section>`).join("")}</div><nav><button data-view="orders">Orders</button>${ops ? '<button data-view="create">New order / Excel</button><button data-view="vendors">Vendors</button>' : ""}${admin ? '<button data-view="users">Team access</button>' : ""}</nav><div id="content"></div>`;
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.view;
        render();
      }),
  );
  const c = $("#content");
  if (view === "orders") orders(c);
  if (view === "create" && ops) create(c);
  if (view === "vendors" && ops) vendors(c);
  if (view === "users" && admin) users(c);
}
async function refresh() {
  state = await api("state");
  render();
}
function bindForm(id, path, transform = (x) => x) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await api(path, transform(Object.fromEntries(new FormData(e.target))));
      await refresh();
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
  c.innerHTML = `<section><h2>Create order</h2><form id="order"><div class="grid">${field("reference", "Your order reference")}${field("recipient", "Recipient name")}${field("phone", "Phone (+965 followed by 8 digits)")}${field("address", "Delivery address")}</div><h3>Items and pickups</h3><div id="items"></div><button type="button" id="add">Add item</button><button>Create order</button></form></section><section><h2>Upload Excel (.xlsx)</h2><p>First row must contain these columns in this order: reference, recipient, phone, address, vendorCode, name, quantity. Use one row per item; repeat order details for additional items. Format phone cells as text.</p><input id="excel" type="file" accept=".xlsx"><button id="preview">Validate and preview</button><div id="previewResult"></div></section>`;
  const add = () =>
    $("#items").insertAdjacentHTML(
      "beforeend",
      `<div class="grid item"><label>Vendor<select class="vendor">${state.vendors.map((v) => `<option value="${esc(v.code)}">${esc(v.name)} (${esc(v.code)})</option>`).join("")}</select></label><label>Item<input class="name" required></label><label>Quantity<input class="quantity" type="number" min="1" step="1" value="1" required></label></div>`,
    );
  add();
  $("#add").onclick = add;
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
      const result = await api("import", f);
      $("#previewResult").innerHTML =
        `<p>${result.count} valid orders</p>${result.orders.map((o) => `<p>${esc(o.reference)} · ${esc(o.recipient)} · ${o.items.length} items</p>`).join("")}<button id="confirm">Confirm import</button>`;
      $("#confirm").onclick = () =>
        run(async () => {
          await api("import?confirm=yes", f);
          view = "orders";
          await refresh();
        });
    });
}
function orders(c) {
  const manager = ["admin", "operations"].includes(state.user.role),
    warehouse = ["admin", "warehouse"].includes(state.user.role);
  const drivers = state.users.filter((u) => u.role === "driver");
  const driverSelect = () =>
    `<select name="driver" required><option value="">Choose driver</option>${drivers.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>`;
  const button = (o, action, label, extra = "") =>
    `<button data-order="${o.id}" data-action="${action}" ${extra}>${label}</button>`;
  c.innerHTML = `<h2>Order board</h2>${!state.orders.length ? "<section>No orders yet. Add vendors, then create an order or upload Excel.</section>" : ""}${state.orders
    .map(
      (o) => `<section>
 <div class="row"><div><b>${esc(o.awb)}</b><p>${esc(o.reference)} · ${esc(o.recipient)}</p></div><span class="badge">${esc(o.status)}</span></div>
 <p>${esc(o.address)} · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></p>
 <p>Delivery driver: ${esc(state.users.find((u) => u.id === o.driver)?.name || (o.driver ? "Assigned" : "Unassigned"))}${o.deliveryDate ? " · Scheduled " + esc(o.deliveryDate) : ""}</p>
 ${button(o, "label", "Print AWB label")}
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
 ${!p.completed && (manager || (state.user.role === "driver" && p.driver === state.user.id)) ? button(o, "pickup", "Verify items and record pickup", `data-pickup="${p.id}"`) : ""}
 ${p.legacy ? "<small>Historical pickup: separate vendor proof was not recorded.</small>" : ""}</div>`,
   )
   .join("")}
 <h3>Warehouse manifest</h3>${o.items.map((i) => `<div class="item row"><span>${i.received ? "✓ Received" : "○ Awaiting receipt"} · ${esc(i.name)} × ${i.quantity}<small>${esc(i.vendor.name)}</small></span>${warehouse && !i.received && ["Created", "Picked up", "At warehouse"].includes(o.status) ? button(o, "receive", "Receive item", `data-item="${i.id}"`) : ""}</div>`).join("")}
 ${warehouse && ["Created", "Picked up", "At warehouse"].includes(o.status) ? `<details><summary>Add an item already at the warehouse</summary><p>This adds a physically received item to this order. Check its order reference before saving.</p><form class="addItem" data-order="${o.id}"><label>Vendor<select name="vendorCode">${state.vendors.map((v) => `<option value="${esc(v.code)}">${esc(v.name)}</option>`).join("")}</select></label>${field("name", "Item name")}${field("quantity", "Quantity", "number")}<button>Add received item</button></form></details>` : ""}
 ${manager && !["Delivered", "Out for delivery"].includes(o.status) ? `<form class="deliveryAssign" data-order="${o.id}"><label>Delivery driver${driverSelect()}</label><button>Assign delivery driver</button></form>` : ""}
 ${o.status === "At warehouse" && (manager || (state.user.role === "driver" && o.driver === state.user.id)) ? button(o, "Out for delivery", "Verify manifest and dispatch") : ""}
 ${o.status === "Out for delivery" && (manager || (state.user.role === "driver" && o.driver === state.user.id)) ? button(o, "Delivered", "Record delivery") + button(o, "fail", "Delivery unsuccessful") : ""}
 ${o.status === "Delivery failed" ? `<p>Latest failure: ${esc(o.attempts?.at(-1)?.reason)}</p><p>${o.returned ? "Returned to warehouse" : "Awaiting warehouse return confirmation"}</p>${warehouse && !o.returned ? button(o, "return", "Confirm physical return") : ""}${manager && o.returned ? `<form class="reschedule" data-order="${o.id}">${field("date", "New delivery date", "date")}<button>Reschedule</button></form>` : ""}` : ""}
 <details><summary>History and proof</summary>${o.history.map((h) => `<p>${esc(h.event)} · ${esc(h.by || "")} · ${new Date(h.at).toLocaleString("en-GB", { timeZone: "Asia/Kuwait" })}${h.reason ? " · " + esc(h.reason) : ""}${h.date ? " · " + esc(h.date) : ""}${h.item ? " · item " + esc(h.item) : ""}</p>`).join("")}${(o.proofs || []).map((p) => `<p>${esc(p.stage)} · ${esc(p.vendor || "")} · ${esc(p.name)} · GPS ${p.lat}, ${p.lng}</p><img width="180" src="${p.photo}" alt="Handover photo">${p.signature ? `<img width="180" src="${p.signature}" alt="Recipient signature">` : ""}`).join("")}</details></section>`,
    )
    .join("")}`;
  for (const [selector, action] of [
    [".taskAssign", "assign-pickup"],
    [".deliveryAssign", "assign"],
    [".addItem", "add-item"],
    [".reschedule", "reschedule"],
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
          if (action === "fail") {
            failureOrder = o;
            $("#failureForm").reset();
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
        })),
  );
}
function printLabel(o) {
  $("#labelContent").innerHTML =
    `<h2>RELAY · KUWAIT</h2><img class="barcode" src="/api/orders/${o.id}/awb" alt="AWB barcode"><h3>${esc(o.awb)}</h3><p>Reference: ${esc(o.reference)}</p><h3>${esc(o.recipient)}</h3><p>${esc(o.phone)}</p><p>${esc(o.address)}</p><hr><p>${o.items.length} item lines · ${o.items.reduce((n, i) => n + i.quantity, 0)} units</p>${o.items.map((i) => `<p>${esc(i.name)} × ${i.quantity} · ${esc(i.vendor.name)}</p>`).join("")}`;
  $("#label").showModal();
  const img = $("#labelContent img");
  $("#printLabel").disabled = true;
  img.onload = () => ($("#printLabel").disabled = false);
  img.onerror = () => alert("Label could not load. Close and retry.");
}
let dispatchOrder, failureOrder;
$("#dispatchForm").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    await api("orders/" + dispatchOrder.id + "/action", {
      action: "Out for delivery",
      verifiedItems: new FormData(e.target).getAll("verifiedItems"),
    });
    $("#dispatch").close();
    await refresh();
  });
};
$("#failureForm").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    await api("orders/" + failureOrder.id + "/action", {
      action: "fail",
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
    const photo = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const pos = await new Promise((res, rej) =>
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
    await api("logout", {});
    location.reload();
  });
boot();
