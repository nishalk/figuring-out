/* Scoped order details, foreground driver trail and printable manifests. */
let proofPinMap = null,
  labelReader = null,
  activityGeneration = 0;
document.body.insertAdjacentHTML(
  "beforeend",
  `<dialog id="orderDetailDialog"><button id="closeOrderDetail" class="ghost">Close order details</button><div id="orderDetailContent"></div></dialog>`,
);
const validPoint = (p) =>
  p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180;
const safeProofImage = (value) =>
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value || "");
function openOrderDetails(id) {
  const o = state.orders.find((o) => o.id === id);
  if (!o) {
    toast("This order is not available to your account.", "error");
    return;
  }
  const proofs = o.proofs || [];
  proofPinMap?.remove();
  proofPinMap = null;
  document.querySelector("#orderDetailContent").innerHTML =
    `<div class="eyebrow">${o.demoData ? "FICTIONAL DEMO · " : ""}ORDER DETAILS</div><h2>${esc(o.awb)}</h2><p>${esc(o.reference)} · ${esc(o.status)}</p><h3>${esc(o.recipient)}</h3><p>${esc(o.phone)}<br>${esc(o.address)}</p><p>${o.items.length} item lines · ${o.items.reduce((n, i) => n + i.quantity, 0)} units</p>${orderDeliveryNotes(o).replace(/<form[\s\S]*?<\/form>/g, "")}<h3>Items & pickup locations</h3>${o.items.map((i) => `<p>${esc(i.name)} × ${i.quantity} · ${esc(i.vendor.name)} · ${i.received ? "At warehouse" : "Awaiting receipt"}</p>`).join("")}<button id="detailPrintAwb">Print this AWB</button><h3>Pickup and delivery proof</h3>${proofs.map((p, i) => `<article class="proofCard"><h4>${esc(p.stage)} ${p.simulated ? "· Simulated" : ""}</h4><p>Received / acknowledged by: <strong>${esc(p.name || "Not recorded")}</strong><br>${displayTime(p.at)}<br>${esc(p.vendor || "")}</p>${safeProofImage(p.photo) ? `<img class="proofEvidence" src="${p.photo}" alt="${esc(p.stage)} proof photo">` : "<p>Photo not recorded.</p>"}${safeProofImage(p.signature) ? `<img class="proofEvidence signatureEvidence" src="${p.signature}" alt="Recipient signature">` : "<p>Signature not recorded.</p>"}${validPoint(p) ? `<p>GPS: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} <button class="ghost" data-proof-pin="${i}">Show location pin</button><a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}" target="_blank" rel="noopener">Open map</a></p>` : "<p>GPS not recorded.</p>"}</article>`).join("") || "<p>No handover proof recorded.</p>"}<div id="proofLocationMap" hidden></div><h3>Order history</h3>${o.history.map((h) => `<p>${esc(h.event)} · ${esc(h.by || "System")} · ${displayTime(h.at)}</p>`).join("")}`;
  const dialog = document.querySelector("#orderDetailDialog");
  if (!dialog.open) dialog.showModal();
  document.querySelector("#detailPrintAwb").onclick = () => {
    dialog.close();
    showPrintLabels([o]);
  };
  document.querySelectorAll("[data-proof-pin]").forEach(
    (b) =>
      (b.onclick = () => {
        const p = proofs[Number(b.dataset.proofPin)];
        const root = document.querySelector("#proofLocationMap");
        root.hidden = false;
        proofPinMap?.remove();
        proofPinMap = null;
        if (!window.L) {
          root.textContent = "Map unavailable. Use Open map above.";
          return;
        }
        proofPinMap = L.map(root).setView([p.lat, p.lng], 16);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
        }).addTo(proofPinMap);
        L.marker([p.lat, p.lng])
          .addTo(proofPinMap)
          .bindPopup(esc(p.name || p.stage))
          .openPopup();
        requestAnimationFrame(() => proofPinMap?.invalidateSize());
      }),
  );
}
document.querySelector("#closeOrderDetail").onclick = () =>
  document.querySelector("#orderDetailDialog").close();
document.querySelector("#orderDetailDialog").addEventListener("close", () => {
  proofPinMap?.remove();
  proofPinMap = null;
});
document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-open-awb]");
  if (button) openOrderDetails(button.dataset.openAwb);
});
async function loadDriverActivity(target, id) {
  const token = ++activityGeneration;
  let result;
  try {
    if (window.relayDemo) {
      const user = state.users.find((u) => u.id === id) || {};
      result = {
        shift: user.shift || null,
        events: state.orders.flatMap((o) =>
          (o.history || [])
            .filter((h) => h.actorId === id)
            .map((h) => ({ ...h, awb: o.awb, orderId: o.id })),
        ),
        positions: user.locationHistory || [],
        lastLocation: user.lastLocation,
      };
    } else result = await api("fleet/" + encodeURIComponent(id) + "/activity");
    if (window.relayDemo)
      result.events = [
        ...(state.users.find((u) => u.id === id)?.activity || []),
        ...result.events,
      ];
    if (
      !target.isConnected ||
      target.dataset.driver !== id ||
      token !== activityGeneration
    )
      return;
    const root = target.querySelector("#driverActivity");
    root.innerHTML = `<h3>Driver activity & GPS movement</h3><p>Shift started: ${displayTime(result.shift?.startedAt)} · ${result.shift?.active ? "On shift" : result.shift?.endedAt ? "Shift ended " + displayTime(result.shift.endedAt) : "No shift recorded"}</p><p class="muted">Latest reported positions, not continuous live tracking. Refreshes every 30 seconds while this page is visible. Foreground driver screen required. Trace retains up to 2,000 fixes from the last 24 hours. Gaps over 2 minutes are not joined.</p><div id="driverTrailMap"></div><p>${result.positions.length} recorded GPS fixes · latest ${displayTime(result.lastLocation?.at)} ${result.lastLocation ? "· accuracy ±" + Math.round(result.lastLocation.accuracy) + " m" : ""}</p><details><summary>GPS movement log</summary><div class="tableScroll"><table><thead><tr><th>Kuwait time</th><th>Latitude</th><th>Longitude</th><th>Accuracy</th></tr></thead><tbody>${result.positions
      .slice()
      .reverse()
      .map(
        (p) =>
          `<tr><td>${displayTime(p.at)}</td><td>${p.lat}</td><td>${p.lng}</td><td>±${Math.round(p.accuracy)} m</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div></details><h4>Actions performed by this driver</h4><ol class="reportTimeline">${result.events.map((h) => `<li><strong>${esc(h.event)}</strong> · ${displayTime(h.at)} ${h.orderId ? `<button class="ghost" data-open-awb="${esc(h.orderId)}">${esc(h.awb)}</button>` : ""}${h.reason ? "<p>" + esc(h.reason) + "</p>" : ""}${validPoint(h.position) ? `<p>Reported GPS at action: ${h.position.lat}, ${h.position.lng} · ${displayTime(h.position.at)}</p>` : ""}${h.awbs ? `<p>${h.awbs.map(esc).join(", ")}</p>` : ""}</li>`).join("") || "<li>No captured activity yet. Older actions without actor IDs are not attributed by guesswork.</li>"}</ol>`;
    const points = result.positions.filter(validPoint),
      last = result.lastLocation;
    if (window.L && (points.length || validPoint(last))) {
      driverTrailMap = L.map(root.querySelector("#driverTrailMap")).setView(
        validPoint(last)
          ? [last.lat, last.lng]
          : [points[0].lat, points[0].lng],
        13,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(driverTrailMap);
      let segment = [];
      for (const p of points) {
        if (
          segment.length &&
          Date.parse(p.at) - Date.parse(segment.at(-1).at) > 120000
        ) {
          if (segment.length > 1)
            L.polyline(
              segment.map((p) => [p.lat, p.lng]),
              { color: "#b65a96" },
            ).addTo(driverTrailMap);
          segment = [];
        }
        segment.push(p);
      }
      if (segment.length > 1)
        L.polyline(
          segment.map((p) => [p.lat, p.lng]),
          { color: "#b65a96" },
        ).addTo(driverTrailMap);
      if (points.length)
        L.marker([points[0].lat, points[0].lng])
          .addTo(driverTrailMap)
          .bindPopup("First retained GPS · " + displayTime(points[0].at));
      if (validPoint(last))
        L.marker([last.lat, last.lng])
          .addTo(driverTrailMap)
          .bindPopup(
            "Latest GPS · " +
              displayTime(last.at) +
              " · ±" +
              Math.round(last.accuracy) +
              " m",
          )
          .openPopup();
      if (points.length > 1)
        driverTrailMap.fitBounds(
          L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.15),
          { maxZoom: 16 },
        );
      requestAnimationFrame(() => driverTrailMap?.invalidateSize());
    } else
      root.querySelector("#driverTrailMap").textContent =
        "No GPS fixes recorded yet. Driver must enable location sharing.";
  } catch (error) {
    if (
      target.isConnected &&
      target.dataset.driver === id &&
      token === activityGeneration
    )
      target.querySelector("#driverActivity").textContent =
        "Driver activity could not load: " + error.message;
  }
}
function labelMarkup(o) {
  return `<article class="printAwb"><h2>MAWADA EXPERIENCE MANAGERS</h2>${o.demoData ? "<strong>FICTIONAL DEMO — DO NOT DISPATCH</strong>" : ""}<img class="barcode" src="${window.relayDemo ? "/demo/barcode/" + encodeURIComponent(o.awb) : "/api/orders/" + encodeURIComponent(o.id) + "/awb"}" alt="AWB barcode"><h3>${esc(o.awb)}</h3><p>Reference: ${esc(o.reference)}</p><h3>${esc(o.recipient)}</h3><p>${esc(o.phone)}<br>${esc(o.address)}</p><p>Delivery date: ${esc(o.deliveryDate || "Not specified")} · Slot: ${esc(o.timeSlot || "Not specified")}</p><hr><p>${o.items.length} item lines · ${o.items.reduce((n, i) => n + i.quantity, 0)} total units</p>${o.items.map((i) => `<p>${esc(i.name)} × ${i.quantity} · ${esc(i.vendor.name)}</p>`).join("")}<p>Ring bell: ${o.ringBell == null ? "Not specified" : o.ringBell ? "Yes" : "No"} · Card: ${o.cardAvailable == null ? "Not specified" : o.cardAvailable ? "Yes" : "No"}</p><p>${esc(o.extraDirections || "")}</p></article>`;
}
async function showPrintLabels(orders) {
  document.querySelector("#printLabel").disabled = true;
  if (!orders.length || orders.length > 100) {
    toast("Choose between 1 and 100 orders.", "error");
    return;
  }
  if (!window.relayDemo) {
    try {
      await api("labels/audit", { orderIds: orders.map((o) => o.id) });
    } catch (error) {
      toast(error.message, "error");
      return;
    }
  }
  const root = document.querySelector("#labelContent"),
    button = document.querySelector("#printLabel");
  button.disabled = true;
  root.innerHTML = orders.map(labelMarkup).join("");
  const dialog = document.querySelector("#label");
  if (!dialog.open) dialog.showModal();
  const images = [...root.querySelectorAll("img")];
  try {
    await Promise.all(
      images.map(
        (img) =>
          new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () =>
              reject(Error("Barcode could not load. Close and retry."));
            if (img.complete) {
              if (img.naturalWidth) resolve();
              else reject(Error("Barcode unavailable"));
            }
          }),
      ),
    );
    if (root.isConnected) button.disabled = false;
  } catch (error) {
    toast(error.message, "error");
  }
}
let labelSelection = new Set();
function renderLabelWorkspace(root) {
  labelReader?.reset();
  labelReader = null;
  labelSelection = new Set();
  root.innerHTML = `<section class="chartCard"><h2>Scan, select & print AWBs</h2><p>Enter AWBs separated by spaces, commas or new lines, or scan with a USB/Bluetooth barcode scanner into the input. Print up to 100 labels per batch. Only orders available to your account can be selected.</p><form id="addPrintAwbs"><label>AWB numbers<textarea name="awbs" required placeholder="KW-…"></textarea></label><button>Add AWBs to print list</button></form><button class="ghost" id="labelCamera">Scan with camera</button><button class="ghost" id="stopLabelCamera">Stop camera</button><video id="labelVideo" playsinline muted hidden></video><label>Scan barcode image<input type="file" id="labelScanImage" accept="image/*"></label><p id="labelScanStatus" role="status"></p><button class="ghost" id="selectVisibleLabels">Select current order filter (max 100)</button><div id="labelQueue"></div><button id="printBatch" disabled>Preview / print selected labels</button></section>`;
  const add = (value) => {
    const tokens = String(value)
        .trim()
        .toUpperCase()
        .split(/[\s,;]+/)
        .filter(Boolean),
      missing = [];
    for (const awb of tokens) {
      const o = state.orders.find((o) => o.awb.toUpperCase() === awb);
      if (!o) missing.push(awb);
      else if (labelSelection.size < 100) labelSelection.add(o.id);
    }
    draw();
    root.querySelector("#labelScanStatus").textContent = missing.length
      ? "Not found or not accessible: " + missing.join(", ")
      : "AWBs added. Duplicate scans are ignored.";
  };
  const draw = () => {
    root.querySelector("#labelQueue").innerHTML =
      `<h3>${labelSelection.size} labels selected</h3>${[...labelSelection]
        .map((id) => {
          const o = state.orders.find((o) => o.id === id);
          return `<p><button class="awbLink" data-open-awb="${esc(id)}">${esc(o.awb)}</button> · ${esc(o.recipient)} <button class="ghost" data-remove-label="${esc(id)}">Remove</button></p>`;
        })
        .join("")}`;
    root.querySelector("#printBatch").disabled = !labelSelection.size;
    root.querySelectorAll("[data-remove-label]").forEach(
      (b) =>
        (b.onclick = () => {
          labelSelection.delete(b.dataset.removeLabel);
          draw();
        }),
    );
  };
  root.querySelector("#addPrintAwbs").onsubmit = (e) => {
    e.preventDefault();
    add(new FormData(e.target).get("awbs"));
    e.target.reset();
  };
  root.querySelector("#selectVisibleLabels").onclick = () => {
    const orders = state.orders
      .filter((o) => !statusFilter || o.status === statusFilter)
      .filter(
        (o) =>
          !searchQuery ||
          [
            o.awb,
            o.reference,
            o.recipient,
            o.address,
            ...o.items.map((i) => i.vendor.name),
          ]
            .join(" ")
            .toLowerCase()
            .includes(searchQuery.toLowerCase()),
      )
      .slice(0, 100);
    orders.forEach((o) => labelSelection.add(o.id));
    labelSelection = new Set([...labelSelection].slice(0, 100));
    draw();
  };
  root.querySelector("#printBatch").onclick = () => {
    labelReader?.reset();
    labelReader = null;
    showPrintLabels(state.orders.filter((o) => labelSelection.has(o.id)));
  };
  root.querySelector("#stopLabelCamera").onclick = () => {
    labelReader?.reset();
    labelReader = null;
    root.querySelector("#labelVideo").hidden = true;
  };
  root.querySelector("#labelCamera").onclick = () =>
    run(async () => {
      if (!window.ZXing)
        throw Error("Camera scanner unavailable. Enter AWBs manually.");
      labelReader?.reset();
      const reader = new ZXing.BrowserMultiFormatReader();
      labelReader = reader;
      root.querySelector("#labelVideo").hidden = false;
      let previous = "",
        last = 0;
      try {
        await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          root.querySelector("#labelVideo"),
          (result) => {
            if (!result || !root.isConnected) return;
            const code = result.getText();
            if (code === previous && Date.now() - last < 2000) return;
            previous = code;
            last = Date.now();
            add(code);
          },
        );
        if (!root.isConnected || document.hidden || labelReader !== reader)
          reader.reset();
      } catch {
        reader.reset();
        labelReader = null;
        throw Error(
          "Allow camera permission or enter/upload the barcode instead.",
        );
      }
    });
  root.querySelector("#labelScanImage").onchange = (e) =>
    run(async () => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) throw Error("Use an image under 5 MB");
      const url = URL.createObjectURL(file);
      try {
        const result =
          await new ZXing.BrowserMultiFormatReader().decodeFromImageUrl(url);
        if (root.isConnected) add(result.getText());
      } finally {
        URL.revokeObjectURL(url);
        e.target.value = "";
      }
    });
  draw();
}
