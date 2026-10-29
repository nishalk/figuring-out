let controlTab = "exceptions";
async function renderControlWorkspace(root) {
  const tabs = [
    ["exceptions", "Daily exceptions", "dashboard"],
    ["planning", "Plan & assign", "work"],
    ["performance", "Performance", "reports"],
    ["updates", "Customer updates", "work"],
    ...(state.user.role === "admin"
      ? [["readiness", "Readiness", "dashboard"]]
      : []),
  ].filter(([, , permission]) => MawadaAccess.allowed(state.user, permission));
  if (!tabs.some(([id]) => id === controlTab)) controlTab = tabs[0][0];
  root.innerHTML = `<section class="controlIntro"><h2>Operations control</h2><p>Protect today’s promises. Give every problem an owner, a next action and a follow-up time.</p><div class="controlTabs" aria-label="Operations controls">${tabs.map(([id, label]) => `<button class="${id === controlTab ? "primary" : "ghost"}" data-control-tab="${id}" aria-pressed="${id === controlTab}">${label}</button>`).join("")}</div><p class="muted">All dates and times use Kuwait time. Fictional demo orders are excluded from operational controls and performance.</p></section><div id="controlBody" aria-live="polite"><p>Loading…</p></div>`;
  root.querySelectorAll("[data-control-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        controlTab = b.dataset.controlTab;
        run(() => renderControlWorkspace(root));
      }),
  );
  const body = root.querySelector("#controlBody");
  if (window.relayDemo) {
    body.innerHTML =
      "<section><h3>Open the live workspace</h3><p>Operations control uses real saved assignments, recovery plans, customer consent and provider configuration. It is unavailable in the isolated sample demo.</p></section>";
    return;
  }
  try {
    if (controlTab === "exceptions") await renderExceptions(body);
    if (controlTab === "planning") renderPlanning(body);
    if (controlTab === "performance") await renderPerformance(body);
    if (controlTab === "updates") await renderCustomerUpdates(body);
    if (controlTab === "readiness") await renderReadiness(body);
  } catch (e) {
    body.innerHTML = `<section role="alert"><p>${esc(e.message)}</p><button id="retryControl">Retry</button></section>`;
    body.querySelector("#retryControl").onclick = () =>
      run(() => renderControlWorkspace(root));
  }
}
function controlOrderButtons(root) {
  root.querySelectorAll("[data-control-order]").forEach(
    (b) =>
      (b.onclick = () => {
        view = "orders";
        searchQuery =
          state.orders.find((o) => o.id === b.dataset.controlOrder)?.awb || "";
        statusFilter = "";
        selectedOrder = b.dataset.controlOrder;
        render();
      }),
  );
}
async function renderExceptions(root) {
  const data = await api("control");
  const rows = data.exceptions;
  root.innerHTML = `<section><div class="row"><h3>${rows.length} active exceptions · ${rows.filter((e) => e.severity === "High").length} high priority</h3><button id="reloadExceptions">Refresh queue</button></div><p class="muted">An order may have several exceptions. A recovery plan keeps the issue visible until the underlying workflow is fixed. Pickup checks apply to work due today or earlier; unscheduled work needs review.</p><label>Show<select id="exceptionFilter"><option value="all">All active exceptions</option><option value="High">High priority</option><option value="unowned">Without a recovery owner</option><option value="overdue">Follow-up overdue</option><option value="Warehouse">Warehouse</option></select></label><p>Updated ${esc(displayTime(data.at))}. Refresh to see new work.</p></section><div id="exceptionRows"></div>`;
  const draw = () => {
    const filter = root.querySelector("#exceptionFilter").value;
    root.querySelector("#exceptionRows").innerHTML =
      rows
        .filter(
          (e) =>
            filter === "all" ||
            filter === e.severity ||
            filter === e.owner ||
            (filter === "unowned" && !e.review) ||
            (filter === "overdue" &&
              e.review &&
              Date.parse(e.review.followUpAt) < Date.now()),
        )
        .map(
          (e) =>
            `<section class="exceptionCard"><div class="row"><h3>${esc(e.awb)} · ${esc(e.code.split(":")[0].replaceAll("-", " "))}</h3><span class="badge ${e.severity === "High" ? "failed" : "warehouse"}">${e.severity}</span></div><p>${esc(e.detail)}</p><p><strong>${esc(e.owner)}:</strong> ${esc(e.action)}</p><p>Delivery date: ${esc(e.due)}</p>${e.review ? `<div class="recoveryPlan"><strong>Recovery owner: ${esc(e.review.owner)}</strong><p>${esc(e.review.note)}</p><p>${Date.parse(e.review.followUpAt) < Date.now() ? "FOLLOW-UP OVERDUE · " : "Follow up · "}${esc(displayTime(e.review.followUpAt))} · recorded by ${esc(e.review.by)}</p></div>` : "<p>No recovery plan recorded.</p>"}<button class="ghost" data-control-order="${esc(e.orderId)}">Open order workflow</button>${MawadaAccess.allowed(state.user, "work") ? `<details><summary>Record recovery plan</summary><form data-exception="${esc(e.id)}" data-order-id="${esc(e.orderId)}"><div class="grid"><label>Responsible person<input name="owner" required maxlength="100" value="${esc(e.review?.owner || "")}"></label><label>Follow up (Kuwait)<input name="followUpAt" type="datetime-local" required value="${new Date(Date.now() + 10800000 + 1800000).toISOString().slice(0, 16)}"></label></div><label>Next action and reason<textarea name="note" required maxlength="1000">${esc(e.review?.note || "")}</textarea></label><button>Save recovery plan</button></form></details>` : ""}</section>`,
        )
        .join("") ||
      "<section><h3>No exceptions in this view</h3><p>Continue checking scheduled commitments and incoming warehouse work.</p></section>";
    controlOrderButtons(root);
    root.querySelectorAll("[data-exception]").forEach(
      (form) =>
        (form.onsubmit = (e) => {
          e.preventDefault();
          run(async () => {
            const b = Object.fromEntries(new FormData(form));
            await api("control/review", {
              ...b,
              followUpAt: b.followUpAt + ":00+03:00",
              orderId: form.dataset.orderId,
              exceptionId: form.dataset.exception,
            });
            await renderExceptions(root);
            toast(
              "Recovery plan saved; exception stays visible until resolved",
            );
          });
        }),
    );
  };
  root.querySelector("#exceptionFilter").onchange = draw;
  root.querySelector("#reloadExceptions").onclick = () =>
    run(async () => {
      state = await api("state");
      await renderExceptions(root);
    });
  draw();
}
function renderPlanning(root) {
  const live = state.orders.filter(
    (o) =>
      !o.demoData &&
      !["Delivered", "Out for delivery", "Delivery failed"].includes(o.status),
  );
  const drivers = state.users.filter(
    (u) => u.role === "driver" && !u.deletedAt,
  );
  root.innerHTML = `<section><h3>Set the delivery commitment</h3><p>Record area, date and an agreed delivery window before assigning work. WhatsApp consent must come from the customer.</p><form id="commitment"><label>Order<select name="orderId" required><option value="">Choose order</option>${live.map((o) => `<option value="${esc(o.id)}">${esc(o.awb)} · ${esc(o.reference)}</option>`).join("")}</select></label><div class="grid"><label>Delivery date<input name="deliveryDate" type="date" required min="${MawadaControl.day()}" value="${MawadaControl.day()}"></label><label>Area<input name="area" maxlength="100" placeholder="e.g. Salmiya"></label><label>Start (Kuwait)<input name="start" type="time" required></label><label>End (Kuwait)<input name="end" type="time" required></label></div><label class="check"><input name="consent" type="checkbox"> Customer agreed to WhatsApp delivery updates</label><button>Save delivery plan</button></form></section><section><h3>Bulk assignment</h3><p>Filter orders, select up to 100, then preview the driver’s total open workload. Assignment does not dispatch an order or confirm a route. Pickup assignment covers every incomplete vendor pickup on each selected order.</p><form id="bulkPlan"><div class="grid"><label>Delivery date<input name="date" type="date"></label><label>Area / address<input name="area" placeholder="Search area or address"></label><label>Vendor<input name="vendor" placeholder="Vendor name or code"></label><label>Time window<input name="window" placeholder="e.g. 09:00-12:00"></label><label>Work<select name="leg"><option value="delivery">Delivery assignments</option><option value="pickup">Vendor pickup assignments</option></select></label><label>Driver<select name="driverId" required><option value="">Choose driver</option>${drivers
    .map((u) => {
      const w = MawadaControl.workload(state.orders, u.id);
      return `<option value="${esc(u.id)}">${esc(u.name)} · ${w.deliveries} deliveries / ${w.pickups} pickups / ${w.active} active trips</option>`;
    })
    .join(
      "",
    )}</select></label></div><button type="button" id="selectPlan">Select visible orders</button> <button type="button" id="clearPlan" class="ghost">Clear selection</button><div id="bulkOrders"></div><button>Preview assignment</button></form><div id="bulkPreview" aria-live="polite"></div></section>`;
  const pendingPickups = live.flatMap((o) =>
    o.pickups.filter((p) => !p.completed).map((p) => ({ order: o, pickup: p })),
  );
  root
    .querySelector("#commitment")
    .closest("section")
    .insertAdjacentHTML(
      "afterend",
      `<section><h3>Agree a vendor pickup deadline</h3><p>Record the vendor’s collection commitment so late pickups can be measured instead of guessed.</p><form id="pickupPromise"><label>Vendor pickup<select name="task" required><option value="">Choose pickup</option>${pendingPickups.map(({ order, pickup }) => `<option value="${esc(order.id + "/" + pickup.id)}">${esc(order.awb)} · ${esc(pickup.vendor.name)}${pickup.dueAt ? " · Due " + esc(displayTime(pickup.dueAt)) : ""}</option>`).join("")}</select></label><label>Pickup deadline (Kuwait)<input type="datetime-local" name="dueAt" required></label><button>Save pickup deadline</button></form></section>`,
    );
  root.querySelector("#pickupPromise").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target.elements;
    run(async () => {
      await api(
        "control/pickups/" +
          f.task.value.split("/").map(encodeURIComponent).join("/"),
        { dueAt: f.dueAt.value + ":00+03:00" },
      );
      state = await api("state");
      renderPlanning(root);
      toast("Vendor pickup deadline saved");
    });
  };
  const commitment = root.querySelector("#commitment");
  commitment.elements.orderId.onchange = () => {
    const o = live.find((o) => o.id === commitment.elements.orderId.value);
    if (!o) return;
    const [start = "", end = ""] = (o.timeSlot || "").split("-");
    Object.entries({
      deliveryDate: o.deliveryDate || MawadaControl.day(),
      area: o.area || "",
      start,
      end,
    }).forEach(([k, v]) => (commitment.elements[k].value = v));
    commitment.elements.consent.checked = Boolean(o.whatsappConsent);
  };
  commitment.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const f = commitment.elements;
      await api(
        "control/orders/" + encodeURIComponent(f.orderId.value) + "/plan",
        {
          deliveryDate: f.deliveryDate.value,
          area: f.area.value,
          timeSlot: f.start.value + "-" + f.end.value,
          whatsappConsent: f.consent.checked,
        },
      );
      state = await api("state");
      renderPlanning(root);
      toast("Delivery commitment saved");
    });
  };
  const form = root.querySelector("#bulkPlan"),
    chosen = new Set();
  let visible = [],
    pending = null;
  const invalidate = () => {
    pending = null;
    root.querySelector("#bulkPreview").innerHTML = "";
  };
  const draw = () => {
    const f = form.elements;
    visible = live.filter(
      (o) =>
        (!f.date.value || o.deliveryDate === f.date.value) &&
        (!f.area.value ||
          [o.area, o.address]
            .join(" ")
            .toLowerCase()
            .includes(f.area.value.toLowerCase())) &&
        (!f.vendor.value ||
          o.items.some((i) =>
            [i.vendor.name, i.vendor.code]
              .join(" ")
              .toLowerCase()
              .includes(f.vendor.value.toLowerCase()),
          )) &&
        (!f.window.value || (o.timeSlot || "").includes(f.window.value)) &&
        (f.leg.value !== "pickup" ||
          (o.pickups.some((p) => !p.completed) &&
            !RelayOperations.activeTrips(o).some((t) => t.kind === "pickup"))),
    );
    for (const id of chosen)
      if (!visible.some((o) => o.id === id)) chosen.delete(id);
    root.querySelector("#bulkOrders").innerHTML =
      `<p>${visible.length} matching orders · ${chosen.size} selected</p><div class="controlOrderList">${visible.map((o) => `<label class="check"><input type="checkbox" data-plan-order="${esc(o.id)}" ${chosen.has(o.id) ? "checked" : ""}> ${esc(o.awb)} · ${esc(o.area || o.address)} · ${esc(o.deliveryDate || "Unscheduled")} ${esc(o.timeSlot || "No window")} · ${esc(o.status)}</label>`).join("") || "<p>No matching orders.</p>"}</div>`;
    root.querySelectorAll("[data-plan-order]").forEach(
      (el) =>
        (el.onchange = () => {
          el.checked
            ? chosen.add(el.dataset.planOrder)
            : chosen.delete(el.dataset.planOrder);
          invalidate();
          draw();
        }),
    );
    invalidate();
  };
  ["date", "area", "vendor", "window", "leg"].forEach((k) =>
    form.elements[k].addEventListener("input", draw),
  );
  form.elements.driverId.onchange = invalidate;
  root.querySelector("#selectPlan").onclick = () => {
    visible.slice(0, 100).forEach((o) => chosen.add(o.id));
    draw();
  };
  root.querySelector("#clearPlan").onclick = () => {
    chosen.clear();
    draw();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      pending = {
        driverId: form.elements.driverId.value,
        leg: form.elements.leg.value,
        selections: live
          .filter((o) => chosen.has(o.id))
          .map((o) => ({ id: o.id, revision: o._revision })),
      };
      const p = await api("control/bulk", pending);
      root.querySelector("#bulkPreview").innerHTML =
        `<h3>Review assignment to ${esc(p.driver)}</h3><p>Current: ${p.workload.deliveries} deliveries + ${p.workload.pickups} pickups. Adding ${p.additional} legs gives ${p.projected} open legs. ${p.workload.active} trips already active.</p><p>This is a workload count, not a capacity or travel-time guarantee. Confirm driver availability and delivery windows.</p>${p.orders.map((o) => `<p>${esc(o.awb)} · ${o.count} leg(s) · ${esc(o.date)} ${esc(o.window)}${o.replacing ? " · REPLACES AN EXISTING ASSIGNMENT" : ""}</p>`).join("")}<button id="commitBulk">Confirm these assignments</button>`;
      root.querySelector("#commitBulk").onclick = () =>
        run(async () => {
          if (!pending) throw Error("Preview again before confirming");
          const result = await api("control/bulk", {
            ...pending,
            confirm: true,
          });
          pending = null;
          state = await api("state");
          renderPlanning(root);
          root.querySelector("#bulkPreview").innerHTML =
            `<h3>${result.results.filter((r) => r.ok).length} assigned / ${result.results.length} selected</h3>${result.results.map((r) => `<p>${esc(r.awb)} · ${r.ok ? "Assigned" : esc(r.error)}</p>`).join("")}<p>${result.partial ? "Some assignments failed. Successful changes remain saved. Refresh and select only the failed orders to retry." : "Assignments saved. Drivers must still verify their manifests before dispatch."}</p>`;
        });
    });
  };
  draw();
}
async function renderPerformance(
  root,
  from = MawadaControl.day(),
  to = MawadaControl.day(),
) {
  const p = await api(
    "control/performance?" + new URLSearchParams({ from, to }),
  );
  const percent = (v, n, d) =>
    v === null ? "No measured records" : `${v}% · ${n}/${d}`;
  root.innerHTML = `<section><h3>Delivery performance</h3><form id="performanceRange"><div class="grid"><label>Scheduled from<input name="from" type="date" value="${esc(p.from)}" required></label><label>Scheduled to<input name="to" type="date" value="${esc(p.to)}" required></label></div><button>Apply dates</button></form><p>Orders are grouped by their current scheduled delivery date. Fictional orders are excluded. Rescheduling changes this cohort; this is not a frozen historical SLA report.</p><div class="controlMetrics">${[
    ["Scheduled orders", p.scheduled],
    ["Delivered", p.delivered],
    [
      "First-attempt success",
      percent(p.firstAttemptRate, p.firstSuccess, p.attempted),
    ],
    ["On-time delivery", percent(p.onTimeRate, p.onTime, p.measuredWindows)],
    [
      "Average warehouse dwell",
      p.averageDwellMinutes === null
        ? "No measured records"
        : p.averageDwellMinutes + " min · " + p.dwellSamples + " orders",
    ],
    ["Pickup failures", p.pickupFailures],
    [
      "Late vendor pickups",
      p.latePickups + " / " + p.measuredPickups + " measured",
    ],
    ["Unknown pickup deadlines", p.unknownPickupDeadlines],
    ["Unknown delivery windows", p.unknownWindows],
    ["Unscheduled open orders · all dates", p.unscheduled],
  ]
    .map(
      ([label, value]) =>
        `<article><small>${label}</small><strong>${value}</strong></article>`,
    )
    .join(
      "",
    )}</div><details><summary>How these measures work</summary><p>First-attempt success: delivered without an earlier recorded failure, divided by orders with a recorded delivery attempt. Imported historical attempts may be incomplete.</p><p>On-time: completed by an explicit window end, divided by orders with a known window that are delivered or already overdue. Open overdue orders count as late. Future windows and unknown promises are excluded.</p><p>Warehouse dwell: last full receipt to last dispatch, for delivered orders with both timestamps. Missing history is excluded.</p><p>Late pickups: completed after an agreed pickup deadline, or still incomplete after it. Unknown deadlines are shown separately; no deadline means no punctuality claim.</p></details><button class="ghost" id="exportPerformance">Export order cohort CSV</button><div class="tableScroll"><table><thead><tr><th>AWB</th><th>Scheduled</th><th>Area</th><th>Window</th><th>Status</th></tr></thead><tbody>${p.rows.map((o) => `<tr><td><button class="ghost" data-control-order="${esc(o.id)}">${esc(o.awb)}</button></td><td>${esc(o.date)}</td><td>${esc(o.area)}</td><td>${esc(o.window)}</td><td>${esc(o.status)}</td></tr>`).join("")}</tbody></table></div></section>`;
  root.querySelector("#performanceRange").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target.elements;
    run(() => renderPerformance(root, f.from.value, f.to.value));
  };
  root.querySelector("#exportPerformance").onclick = () => {
    const cell = (v) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const rows = [
      [
        "AWB",
        "Scheduled date (Kuwait)",
        "Area",
        "Window (Kuwait)",
        "Status",
        "Recorded attempts",
      ],
      ...p.rows.map((o) => [
        o.awb,
        o.date,
        o.area,
        o.window,
        o.status,
        o.attempts,
      ]),
    ];
    downloadBlob(
      new Blob(
        ["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
      "Mawada-performance-" + p.from + "-" + p.to + ".csv",
    );
  };
  controlOrderButtons(root);
}
async function renderCustomerUpdates(root) {
  const p = await api("control/updates");
  const orders = state.orders.filter((o) => !o.demoData);
  root.innerHTML = `<section><h3>WhatsApp delivery updates</h3><p>${p.configured ? "Provider settings present. Test acceptance and receipt with your own consented number before customer use." : "Live sending is not configured. Add the WhatsApp Business provider settings and approved message template."}</p><p>Updates queue automatically on assignment, departure, delivery failure, rescheduling and completion when consent and the public app address are recorded. Sending requires an explicit review here.</p><p>“Accepted by provider” does not mean delivered or read. Check WhatsApp provider logs for receipt. Requests with uncertain outcomes are held for review and are never retried automatically.</p><form id="trackingTools"><label>Order<select name="orderId" required><option value="">Choose order</option>${orders.map((o) => `<option value="${esc(o.id)}">${esc(o.awb)} · ${esc(o.status)}</option>`).join("")}</select></label><div class="row"><button name="tool" value="link">Create private tracking link</button><button name="tool" value="queue">Queue current WhatsApp update</button><button name="tool" value="revoke" class="ghost">Revoke tracking links</button></div></form><div id="trackingResult" role="status"></div><p class="muted">Links expire after seven days and show AWB, status and delivery window only. Anyone with a link can see that limited status; share it privately. Revoking links also cancels queued messages for this order.</p></section><section><h3>Latest ${p.rows.length} customer updates</h3>${p.rows.map((u) => `<article class="updateRow"><strong>${esc(u.awb)} · ${esc(u.label)}</strong><p>${esc(u.status)} · ${esc(displayTime(u.at))} · ${esc(u.phone)}</p><p>${esc(u.text)}</p>${u.error ? `<p>${esc(u.error)}</p>` : ""}${u.review ? `<p>Provider review by ${esc(u.review.by)}: ${esc(u.review.note)}</p>` : ""}${["Sending", "Needs provider review"].includes(u.status) ? `<details><summary>Record provider-log review</summary><form data-provider-review="${esc(u.id)}" data-order="${esc(u.orderId)}"><label>Verified outcome<select name="outcome"><option value="accepted">Provider confirms acceptance</option><option value="not-sent">Provider confirms not sent</option></select></label><label>Log reference and review note<textarea name="note" required maxlength="1000"></textarea></label><button>Save reviewed outcome</button></form></details>` : ""}${u.status === "Queued" ? `<button data-send-update="${esc(u.id)}" data-order="${esc(u.orderId)}" ${p.configured ? "" : "disabled"}>Send WhatsApp update</button> <button class="ghost" data-cancel-update="${esc(u.id)}" data-order="${esc(u.orderId)}">Cancel queued update</button>` : ""}</article>`).join("") || "<p>No updates queued.</p>"}</section>`;
  root.querySelector("#trackingTools").onsubmit = (e) => {
    e.preventDefault();
    const tool = e.submitter.value,
      id = e.target.elements.orderId.value;
    run(async () => {
      const result = await api(
        "control/orders/" +
          encodeURIComponent(id) +
          (tool === "queue" ? "/updates" : "/tracking"),
        tool === "queue" ? { queue: true } : { revoke: tool === "revoke" },
      );
      if (result.url)
        root.querySelector("#trackingResult").innerHTML =
          `<label>Private link (expires ${esc(displayTime(result.expires))})<input readonly value="${esc(result.url)}" aria-label="Private tracking link"></label>`;
      else {
        await renderCustomerUpdates(root);
        toast(
          tool === "queue"
            ? "Current update queued for review"
            : "Tracking links revoked",
        );
      }
    });
  };
  root.querySelectorAll("[data-provider-review]").forEach(
    (f) =>
      (f.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          await api(
            "control/orders/" +
              encodeURIComponent(f.dataset.order) +
              "/updates",
            {
              updateId: f.dataset.providerReview,
              review: Object.fromEntries(new FormData(f)),
            },
          );
          await renderCustomerUpdates(root);
          toast("Provider outcome recorded; no message was resent");
        });
      }),
  );
  root.querySelectorAll("[data-send-update],[data-cancel-update]").forEach(
    (b) =>
      (b.onclick = () => {
        const cancel = Boolean(b.dataset.cancelUpdate);
        if (
          !cancel &&
          !confirm(
            "Send this WhatsApp update to the recorded customer number? Confirm consent and current status first.",
          )
        )
          return;
        run(async () => {
          await api(
            "control/orders/" +
              encodeURIComponent(b.dataset.order) +
              "/updates",
            {
              updateId: b.dataset.sendUpdate || b.dataset.cancelUpdate,
              cancel,
            },
          );
          await renderCustomerUpdates(root);
        });
      }),
  );
}
async function renderReadiness(root) {
  const p = await api("control/readiness");
  root.innerHTML = `<section><h3>Operational readiness</h3><div class="controlMetrics">${[
    ["Sessions", "Saved across restarts on this volume"],
    [
      "Stable session secret",
      p.sessionSecretStable
        ? "Configured"
        : "Missing · restart will sign users out",
    ],
    [
      "Email password recovery",
      p.emailConfigured
        ? "Settings present · send a test"
        : "Provider setup required",
    ],
    [
      "WhatsApp",
      p.whatsappConfigured
        ? "Settings present · send a test"
        : "Provider setup required",
    ],
    [
      "Last verified local backup",
      p.backup?.verifiedAt
        ? displayTime(p.backup.verifiedAt)
        : "No successful backup recorded",
    ],
    [
      "Backup age",
      p.backup?.verifiedAt
        ? Math.floor((Date.now() - Date.parse(p.backup.verifiedAt)) / 3600000) +
          " hours"
        : "Unknown",
    ],
  ]
    .map(
      ([label, value]) =>
        `<article><small>${label}</small><strong>${esc(value)}</strong></article>`,
    )
    .join(
      "",
    )}</div><p>${esc(p.note)}</p><h3>Before accepting real customer work</h3><ol><li>Verify HTTPS, persistent storage and a restart with a test login.</li><li>Schedule daily backups, copy them off the application host and rehearse restoration.</li><li>Test email reset and WhatsApp receipt using your own accounts.</li><li>Walk through camera, GPS, signature, offline drafts and label printing on the drivers’ Android phones.</li><li>Reconcile an actual Mawada CMS export against the preview before confirming import.</li></ol></section>`;
}
