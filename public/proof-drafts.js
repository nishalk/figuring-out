/* On-device proof drafts. Explicit retry only; no background operational writes. */
const ProofDrafts = (() => {
  let database;
  const open = () =>
    (database ||= new Promise((resolve, reject) => {
      if (!window.indexedDB)
        return reject(Error("On-device draft storage is unavailable"));
      const request = indexedDB.open("mawada-proof-drafts", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(Error("Could not open on-device draft storage"));
    }));
  async function operation(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", mode),
        store = transaction.objectStore("drafts");
      const request = action(store);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(
          Error(
            "Could not save draft on this device. Keep this screen open and retry.",
          ),
        );
    });
  }
  const key = () =>
    [state.user.id, proofOrder, proofStage, proofPickup || ""].join(":");
  const all = async () => {
    const rows = await operation("readonly", (s) => s.getAll());
    for (const r of rows)
      if (Date.now() - r.savedAt > 86400000)
        await operation("readwrite", (s) => s.delete(r.id));
    return rows.filter((r) => Date.now() - r.savedAt <= 86400000);
  };
  let current = null,
    timer,
    saving = Promise.resolve(),
    generation = 0;
  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(Error("Could not read the photo"));
      r.readAsDataURL(file);
    });
  const status = (message) => {
    const el = document.querySelector("#proofDraftStatus");
    if (el) el.textContent = message;
  };
  async function begin() {
    clearTimeout(timer);
    await saving.catch(() => {});
    generation++;
    const mine = generation;
    current = null;
    if (!document.querySelector("#proofDraftStatus"))
      document
        .querySelector("#proofForm h2")
        .insertAdjacentHTML(
          "afterend",
          '<p id="proofDraftStatus" role="status"></p><p class="muted">Drafts stay on this device for up to 24 hours. Use a private device. Reconnect and explicitly submit to upload; a saved draft does not complete the delivery.</p>',
        );
    status("Changes will be saved on this device.");
    if (window.relayDemo) return;
    try {
      const row = (await all()).find((r) => r.id === key());
      if (mine !== generation || !row) return;
      current = row;
      const form = document.querySelector("#proofForm");
      form.elements.name.value = row.body.name || "";
      form.elements.photo.required = !row.body.photo;
      form
        .querySelectorAll("[name=verifiedItems]")
        .forEach(
          (el) =>
            (el.checked = (row.body.verifiedItems || []).includes(el.value)),
        );
      if (row.body.signature) {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = row.body.signature;
        });
        if (mine !== generation) return;
        ctx.drawImage(img, 0, 0);
        signed = true;
      }
      status(
        "Restored on-device draft. Review all details and submit when connected.",
      );
    } catch (e) {
      status(e.message);
    }
  }
  function save(position) {
    clearTimeout(timer);
    if (window.relayDemo || !state?.user || !proofOrder)
      return Promise.resolve(null);
    // Snapshot before async reads, so navigating to another proof cannot change the key.
    const id = key(),
      userId = state.user.id,
      orderId = proofOrder,
      action = proofStage,
      pickup = proofPickup,
      mine = generation;
    const form = document.querySelector("#proofForm"),
      f = new FormData(form),
      file = f.get("photo");
    const body = {
      action,
      pickup,
      name: f.get("name"),
      verifiedItems: f.getAll("verifiedItems"),
      signature:
        action === "Delivered" && signed ? canvas.toDataURL() : undefined,
    };
    saving = saving
      .catch(() => {})
      .then(async () => {
        let stored;
        try {
          stored = await operation("readonly", (s) => s.get(id));
        } catch {}
        const previous =
          current?.id === id && (current.volatile || !stored)
            ? current
            : stored;
        if (file.size > 4 * 1024 * 1024)
          throw Error("Photo must be smaller than 4 MB");
        body.photo = file.size ? await readFile(file) : previous?.body.photo;
        if (position)
          Object.assign(body, {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            capturedAt: new Date().toISOString(),
          });
        else if (
          previous?.body.capturedAt &&
          previous.body.photo === body.photo
        )
          Object.assign(body, {
            lat: previous.body.lat,
            lng: previous.body.lng,
            capturedAt: previous.body.capturedAt,
          });
        const row = { id, userId, orderId, savedAt: Date.now(), body };
        try {
          await operation("readwrite", (s) => s.put(row));
        } catch {
          row.volatile = true;
        }
        if (mine === generation) {
          current = row;
          status(
            row.volatile
              ? "Device storage is unavailable. Keep this screen open and submit while connected; this draft will be lost on reload."
              : "Saved on this device · pending upload. Review and submit when connected.",
          );
        }
        return row;
      });
    return saving;
  }
  function autosave() {
    clearTimeout(timer);
    if (!document.querySelector("#proof").open) return;
    timer = setTimeout(() => save().catch((e) => status(e.message)), 300);
  }
  async function remove(id) {
    clearTimeout(timer);
    await saving.catch(() => {});
    await operation("readwrite", (s) => s.delete(id));
    if (current?.id === id) current = null;
  }
  async function clearUser(userId) {
    for (const row of await all())
      if (row.userId === userId) await remove(row.id);
  }
  async function panel(root) {
    if (window.relayDemo) return;
    try {
      const rows = (await all()).filter((r) => r.userId === state.user.id);
      root.innerHTML = `<section><h3>${rows.length} on-device proof draft${rows.length === 1 ? "" : "s"}</h3><p>${navigator.onLine ? "Connection available; uploads still require explicit submission." : "Offline · keep this device and reconnect to upload."} Drafts expire after 24 hours and are removed when you sign out.</p>${rows
        .map((r) => {
          const o = state.orders.find((o) => o.id === r.orderId);
          return `<div class="draftRow"><strong>${esc(o?.awb || "Order no longer assigned")}</strong><p>${esc(r.body.action)} · saved ${esc(displayTime(new Date(r.savedAt).toISOString()))}</p>${o ? `<button data-resume-draft="${esc(r.id)}">Review draft</button>` : ""}<button class="ghost" data-delete-draft="${esc(r.id)}">Delete on-device draft</button></div>`;
        })
        .join("")}</section>`;
      root.querySelectorAll("[data-delete-draft]").forEach(
        (b) =>
          (b.onclick = () => {
            if (
              confirm(
                "Delete this on-device draft? This does not change the server order.",
              )
            )
              run(async () => {
                await remove(b.dataset.deleteDraft);
                await panel(root);
              });
          }),
      );
      root.querySelectorAll("[data-resume-draft]").forEach(
        (b) =>
          (b.onclick = () => {
            const row = rows.find((r) => r.id === b.dataset.resumeDraft);
            const button = [...document.querySelectorAll("[data-action]")].find(
              (el) =>
                el.dataset.order === row.orderId &&
                el.dataset.action === row.body.action &&
                (el.dataset.pickup || "") === (row.body.pickup || ""),
            );
            if (button) button.click();
            else
              toast(
                "The workflow changed. Open the order to review its current state before retrying.",
                "error",
              );
          }),
      );
    } catch (e) {
      root.textContent = e.message;
    }
  }
  return {
    begin,
    save,
    autosave,
    remove,
    all,
    clearUser,
    panel,
    pending: () => saving,
  };
})();
function renderDriverFocus(root) {
  const stops = [];
  for (const o of state.orders.filter((o) => !o.demoData || window.relayDemo)) {
    for (const p of o.pickups.filter(
      (p) => p.driver === state.user.id && !p.completed,
    ))
      stops.push({
        o,
        label: "Vendor pickup · " + p.vendor.name,
        address: p.vendor.address,
        phone: p.vendor.phone,
        active: RelayOperations.activeTrips(o).some(
          (t) => t.kind === "pickup" && t.pickupId === p.id,
        ),
        kind: "pickup",
      });
    if (
      o.driver === state.user.id &&
      ["At warehouse", "Out for delivery"].includes(o.status) &&
      (!o.deliveryDate || o.deliveryDate <= MawadaControl.day())
    )
      stops.push({
        o,
        label: "Delivery · " + o.recipient,
        address: o.address,
        phone: o.phone,
        active: o.status === "Out for delivery",
        kind: "delivery",
      });
  }
  stops.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      (MawadaControl.deadline(a.o) || Infinity) -
        (MawadaControl.deadline(b.o) || Infinity),
  );
  const next = stops[0];
  root.innerHTML = `<section class="driverNext"><h3>${next ? "Suggested next stop" : "No ready stops"}</h3>${next ? `<strong>${esc(next.label)}</strong><p>${esc(next.o.awb)} · ${esc(next.address)}</p><p>${esc(next.o.deliveryDate || "Date not set")} ${esc(next.o.timeSlot || "Window not set")}${next.active ? " · Active trip" : ""}</p>${next.o.extraDirections ? `<p>${esc(next.o.extraDirections)}</p>` : ""}${next.kind === "delivery" ? `<p>Ring bell: ${next.o.ringBell == null ? "Not recorded" : next.o.ringBell ? "Yes" : "No"}</p>` : ""}<div class="row"><a class="primaryLink" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(next.address + ", Kuwait")}">Navigate to stop</a>${/^\+?\d[\d\s-]{5,20}$/.test(next.phone || "") ? `<a class="primaryLink" href="tel:${esc(next.phone.replace(/[^+\d]/g, ""))}">Call contact</a>` : ""}<button id="focusNextOrder">Open workflow</button></div><p class="muted">Active trips first, then earliest known window. This is not route optimization; follow dispatcher instructions.</p>` : "<p>Check with operations for your next assignment.</p>"}</section><div id="driverDrafts"></div>`;
  if (next)
    root.querySelector("#focusNextOrder").onclick = () => {
      const card = document.querySelector(
        `.orderCard[data-id="${CSS.escape(next.o.id)}"]`,
      );
      if (card) {
        searchQuery = next.o.awb;
        statusFilter = "";
        selectedOrder = next.o.id;
        render();
        document
          .querySelector(`.orderCard[data-id="${CSS.escape(next.o.id)}"]`)
          ?.scrollIntoView({ behavior: "smooth" });
      }
    };
  ProofDrafts.panel(root.querySelector("#driverDrafts"));
}
document.addEventListener("input", (e) => {
  if (e.target.closest("#proofForm")) ProofDrafts.autosave();
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#proofForm")) ProofDrafts.autosave();
});
window.addEventListener("online", () => {
  if (typeof state !== "undefined" && state?.user)
    toast(
      "Connection restored. Review pending drafts and submit them explicitly.",
    );
});
if ("serviceWorker" in navigator && location.pathname !== "/demo")
  navigator.serviceWorker.register("/sw.js").catch(() => {});
