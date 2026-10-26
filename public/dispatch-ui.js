/* Operational UI: fleet map, driver scanning/location tools and report views. */
let selectedDriverId = null;
let fleetMap,
  fleetMarkers = [],
  fleetRoot;
let locationHeartbeat = null;
let watchId = null,
  locationAutomatic = false,
  lastLocationSent = 0,
  sendingLocation = false;
let cameraReader = null,
  cameraGeneration = 0;
let reportFilters = {};
let reportRequest = 0;
let locationRequest = Promise.resolve();
const displayTime = (at) =>
  at && Number.isFinite(Date.parse(at))
    ? new Date(at).toLocaleString("en-GB", { timeZone: "Asia/Kuwait" })
    : "Not recorded";
function locationAge(at) {
  if (!at || !Number.isFinite(Date.parse(at))) return "No location";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  return seconds < 20
    ? "Just now"
    : seconds < 60
      ? seconds + " sec ago"
      : Math.floor(seconds / 60) + " min ago";
}
function releaseFleetMap() {
  if (fleetMap) {
    fleetMap.stop();
    fleetMap.remove();
  }
  fleetMap = null;
  fleetRoot = null;
  fleetMarkers = [];
}
function renderFleet(root) {
  if (!root) return;
  if (fleetRoot !== root) {
    if (fleetMap) {
      fleetMap.remove();
      fleetMap = null;
    }
    fleetRoot = root;
    fleetMarkers = [];
    root.innerHTML = `<section class="fleetSection"><div class="boardHeading"><div><h2>Fleet control</h2><p class="muted">Pickup and delivery legs · refreshes every 15 seconds</p></div><button class="ghost" id="refreshFleet">Refresh fleet</button></div><div class="fleetMapHeading"><span id="fleetRefreshTime"></span><button class="ghost" id="fitDrivers">Fit driver locations</button></div><div id="driverMap" role="region" aria-label="Driver location map"></div><p class="mapNotice" id="mapNotice">Markers show last reported GPS, not guaranteed current positions. Sharing requires the driver screen to remain open.</p><div id="fleetAlerts" aria-live="polite"></div><div id="fleetTable" class="tableScroll"></div><div id="driverProfile"></div><p class="muted fleetDefinitions">Assigned = open orders with a delivery or pending pickup for that driver. Pending delivery = not dispatched. Active trips = pickup or delivery legs currently in transit.</p></section>`;
    $("#refreshFleet").onclick = () =>
      run(async () => {
        state = await api("state");
        render();
        toast("Fleet refreshed");
      });
    if (window.L) {
      fleetMap = L.map(root.querySelector("#driverMap"), {
        scrollWheelZoom: false,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
      }).setView([29.3759, 47.9774], 10);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      })
        .on("tileerror", () => {
          if ($("#mapNotice"))
            $("#mapNotice").textContent =
              "Map tiles could not load. Driver coordinates and timestamps are still available in the table.";
        })
        .addTo(fleetMap);
    } else
      root.querySelector("#driverMap").textContent =
        "Map could not load. See driver coordinates below.";
    $("#fitDrivers").onclick = () => {
      if (fleetMap && fleetMarkers.length)
        fleetMap.fitBounds(L.featureGroup(fleetMarkers).getBounds().pad(0.25), {
          maxZoom: 14,
        });
    };
  }
  const rows = state.fleet || RelayOperations.fleet(state.users, state.orders);
  root.querySelector("#fleetRefreshTime").textContent =
    "Updated " +
    displayTime(new Date().toISOString()) +
    (window.relayDemo ? " · Simulated sample locations" : "");
  const openFlags = rows.flatMap((d) =>
    (d.alerts || [])
      .filter((a) => !a.review)
      .map((a) => ({ ...a, driver: d.name, driverId: d.id })),
  );
  root.querySelector("#fleetAlerts").innerHTML =
    `<section class="monitoringSummary"><h3>Operations review · ${openFlags.length} open flags</h3><p class="muted">Review signals, not findings of misconduct. Long stop: 20 min within 150 m on an active trip. GPS gap: 5 min. Jump: over 160 km/h after GPS accuracy allowance. Proof discrepancy: over 500 m from recent GPS.</p>${openFlags.map((a) => `<button class="ghost" data-driver-profile="${esc(a.driverId)}">${esc(a.driver)} · ${esc(a.kind)}</button>`).join("") || "<p>No current flags. Checks require location data; no flag does not verify activity.</p>"}</section>`;
  const oldCount = fleetMarkers.length;
  if (fleetMap) fleetMarkers.forEach((m) => m.remove());
  fleetMarkers = [];
  root.querySelector("#fleetTable").innerHTML = rows.length
    ? `<table><thead><tr><th>Driver</th><th>Assigned</th><th>Pending delivery</th><th>Active trips</th><th>Pending pickups</th><th>Delivered</th><th>Last location</th></tr></thead><tbody>${rows
        .map((d) => {
          const pos = d.lastLocation,
            valid = pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng);
          const fresh =
            valid &&
            Date.now() - Date.parse(pos.at) < 120000 &&
            d.locationSharing;
          if (valid && fleetMap) {
            const marker = L.marker([pos.lat, pos.lng], {
              title: d.name,
              icon: L.divIcon({
                className: "driverMarker",
                html: `<span class="${fresh ? "fresh" : "stale"}">${esc(d.name.slice(0, 2).toUpperCase())}</span>`,
                iconSize: [34, 34],
              }),
            })
              .addTo(fleetMap)
              .bindPopup(
                `<b>${esc(d.name)}</b><p>${d.activeTrips.length} active trips · ${d.pendingPickups} pending pickups</p><p>${esc(locationAge(pos.at))} · ${d.locationSharing ? "Sharing enabled" : "Sharing paused"}</p><p>Accuracy ±${Math.round(pos.accuracy || 0)} m</p>`,
              );
            fleetMarkers.push(marker);
          }
          return `<tr><td><button class="ghost driverProfileButton" data-driver-profile="${esc(d.id)}">${esc(d.name)} · View driver</button><small>${d.shipmentsHandled} shipments handled · ${(d.alerts || []).filter((a) => !a.review).length} open flags</small><small>${d.failedDeliveries} failed deliveries · ${d.completedPickups} pickups completed</small></td><td>${d.assignedOrders}</td><td>${d.pendingDeliveries}</td><td><details><summary>${d.activeTrips.length} in transit</summary>${d.activeTrips.map((t) => `<p>${esc(t.awb)} · ${esc(t.kind)}<small>${esc(t.milestone || "In transit")}</small></p>`).join("") || "<small>No active trips</small>"}</details></td><td><details><summary>${d.pendingPickups} pending</summary>${
            d.pickups
              .filter((p) => !p.completed)
              .map(
                (p) =>
                  `<p><strong>${esc(p.vendor.name)}</strong><small>${esc(p.awb)} · ${esc(p.vendor.address)}</small></p>`,
              )
              .join("") || "<small>No pending pickups</small>"
          }</details></td><td>${d.delivered}</td><td>${valid ? `<span class="locationState ${fresh ? "fresh" : "stale"}">${fresh ? "Recent GPS" : d.locationSharing ? "Stale GPS" : "Sharing paused"}</span><small>${esc(locationAge(pos.at))} · ±${Math.round(pos.accuracy || 0)} m</small><small>${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}</small><button class="ghost" data-locate="${esc(d.id)}" aria-label="Locate ${esc(d.name)}">Locate</button>` : '<span class="muted">Not shared yet</span>'}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : '<p class="muted">Create driver accounts in Team access. Their workloads and shared locations will appear here.</p>';
  root.querySelectorAll("[data-driver-profile]").forEach(
    (b) =>
      (b.onclick = () => {
        selectedDriverId = b.dataset.driverProfile;
        renderDriverProfile(root, rows);
        root
          .querySelector("#driverProfile")
          .scrollIntoView({ behavior: "smooth", block: "start" });
      }),
  );
  renderDriverProfile(root, rows);
  root.querySelectorAll("[data-locate]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = rows.find((d) => d.id === b.dataset.locate);
        if (fleetMap && d?.lastLocation) {
          fleetMap.setView([d.lastLocation.lat, d.lastLocation.lng], 15, {
            animate: false,
          });
          fleetMarkers.find((m) => m.options.title === d.name)?.openPopup();
          root
            .querySelector("#driverMap")
            .scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }),
  );
  if (fleetMap) {
    requestAnimationFrame(() => fleetMap?.invalidateSize());
    if (!oldCount && fleetMarkers.length)
      root.querySelector("#fitDrivers").click();
  }
}
function renderDriverProfile(root, rows) {
  const target = root.querySelector("#driverProfile");
  const d = rows.find((d) => d.id === selectedDriverId);
  if (!d) {
    target.innerHTML = "";
    return;
  }
  // Preserve an unfinished review during fleet polling.
  if (
    target.dataset.driver === d.id &&
    target.contains(document.activeElement) &&
    document.activeElement.closest("form")
  )
    return;
  target.dataset.driver = d.id;
  target.innerHTML = `<section class="driverProfile"><div class="boardHeading"><div><div class="eyebrow">DRIVER DETAILS</div><h2>${esc(d.name)}</h2><p class="muted">All recorded history · unique shipments handled includes pickup, delivery and previous trip assignments. Current workload and completed legs are separate counts.</p></div><button class="ghost" id="closeDriverProfile">Close</button></div><div class="driverCounters"><span><strong>${d.shipmentsHandled}</strong> Shipments handled</span><span><strong>${d.assignedOrders}</strong> Open assigned shipments</span><span><strong>${d.delivered}</strong> Delivered</span><span><strong>${d.pendingDeliveries}</strong> Awaiting dispatch</span><span><strong>${d.inTransitDeliveries}</strong> Out for delivery</span><span><strong>${d.failedDeliveries}</strong> Failed delivery</span><span><strong>${d.completedPickups}</strong> Pickups completed</span><span><strong>${d.pendingPickups}</strong> Pickups pending</span><span><strong>${d.activeTrips.length}</strong> Active trip legs</span></div><h3>Location & activity review</h3><p>${d.lastLocation ? `Last GPS ${displayTime(d.lastLocation.at)} · ±${Math.round(d.lastLocation.accuracy)} m` : "No GPS reported"} · ${d.locationSharing ? "Sharing enabled" : "Sharing paused"}</p><p class="muted">Proof checks compare GPS sources, not the destination address. Destination geofencing needs verified map pins. GPS can be inaccurate; confirm with the driver before acting.</p>${(d.alerts || []).map((a) => `<article class="driverFlag ${a.review ? "reviewed" : ""}"><h4>${esc(a.kind)} ${a.review ? "· Reviewed" : "· Needs review"}</h4><p>${esc(a.detail)}</p><small>${displayTime(a.at)}</small>${a.review ? `<p>Reviewed by ${esc(a.review.by)} · ${displayTime(a.review.at)}<br>${esc(a.review.note)}</p>` : `<form data-review-alert="${esc(a.id)}"><label>Review note<input name="note" required maxlength="500" placeholder="For example: confirmed waiting at vendor"></label><button>Record review</button></form>`}</article>`).join("") || "<p>No review flags recorded.</p>"}${d.reviews?.length ? `<details><summary>Review log · ${d.reviews.length} recorded</summary>${d.reviews.map((r) => `<p><strong>${esc(r.kind || "Location review")}</strong> · ${esc(r.by)} · ${displayTime(r.at)}<br>${esc(r.note)}</p>`).join("")}</details>` : ""}<h3>Shipments, pickups & trip history</h3><div class="tableScroll"><table><thead><tr><th>Shipment</th><th>Current order status</th><th>Driver’s work</th><th>Trips</th></tr></thead><tbody>${(d.shipments || []).map((o) => `<tr><td><button class="ghost" data-driver-order="${esc(o.id)}">${esc(o.awb)}</button><small>${esc(o.reference)} · ${esc(o.recipient)}</small><small>${esc(o.address)}</small></td><td>${esc(o.status)}</td><td>${o.deliveryAssigned ? "Current delivery driver" : ""}${o.pickups.map((p) => `<p>${esc(p.vendor)} · ${p.completed ? "Pickup completed" : "Pickup pending"}<small>${esc(p.address)}</small></p>`).join("") || (o.deliveryAssigned ? "" : "Previous assignment")}</td><td>${o.trips.map((t) => `<p>${esc(t.kind)} · ${esc(t.status)}<small>${displayTime(t.startedAt)} → ${displayTime(t.endedAt)} · ${esc(t.milestone || "")}</small></p>`).join("") || "Not started"}</td></tr>`).join("") || '<tr><td colspan="4">No shipments recorded.</td></tr>'}</tbody></table></div></section>`;
  target.querySelector("#closeDriverProfile").onclick = () => {
    selectedDriverId = null;
    target.innerHTML = "";
  };
  target.querySelectorAll("[data-driver-order]").forEach(
    (b) =>
      (b.onclick = () => {
        selectedOrder = b.dataset.driverOrder;
        searchQuery = "";
        statusFilter = "";
        render();
        document
          .querySelector(".orderCard.selected")
          ?.scrollIntoView({ block: "center" });
      }),
  );
  target.querySelectorAll("[data-review-alert]").forEach(
    (form) =>
      (form.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          await api("fleet/" + encodeURIComponent(d.id) + "/review", {
            alertId: form.dataset.reviewAlert,
            note: new FormData(form).get("note"),
          });
          await refresh("Review recorded");
        });
      }),
  );
}
function pickupTripControls(o, p, manager, button) {
  if (
    p.completed ||
    !p.driver ||
    (!manager && (state.user.role !== "driver" || p.driver !== state.user.id))
  )
    return "";
  const trip = RelayOperations.activeTrips(o).find(
    (t) => t.kind === "pickup" && t.pickupId === p.id,
  );
  return trip
    ? `<div class="tripState"><span class="badge transit">${esc(trip.milestone)}</span><small>Started ${displayTime(trip.startedAt)}</small></div>${trip.milestone !== "Arrived at pickup" ? button(o, "arrived-pickup", "Arrived at pickup", `data-pickup="${p.id}"`) : ""}${button(o, "pickup-failed", "Pickup unsuccessful", `data-pickup="${p.id}"`)}`
    : button(
        o,
        "start-pickup-trip",
        "Start pickup trip",
        `data-pickup="${p.id}"`,
      );
}
function deliveryTripControls(o, button) {
  const trip = RelayOperations.activeTrips(o).find(
    (t) => t.kind === "delivery",
  );
  return trip?.milestone !== "Arrived at delivery"
    ? button(o, "arrived-delivery", "Arrived at delivery")
    : "";
}
function renderDriverPanel(root) {
  if (!root) return;
  const pending = state.orders
    .flatMap((o) => o.pickups)
    .filter((p) => p.driver === state.user.id && !p.completed).length;
  const active = state.orders
    .flatMap((o) => RelayOperations.activeTrips(o))
    .filter((t) => t.driver === state.user.id).length;
  root.innerHTML = `<section class="driverConsole"><div class="row"><div><div class="eyebrow">DRIVER WORKSPACE</div><h2>Your next stop starts here.</h2></div><button id="scanOrder">Scan / claim AWB</button></div><div class="driverCounters"><span><strong>${state.orders.length}</strong> Assigned orders</span><span><strong>${pending}</strong> Pending pickups</span><span><strong>${active}</strong> Active trips</span></div><div class="locationTools"><button class="ghost" id="shareLocation">${watchId === null ? "Share my location" : "Stop location sharing"}</button><span id="gpsState">${watchId === null ? "Location sharing is off" : "Sharing GPS while this screen is open"}</span></div><p class="muted">Starting a trip asks for location permission. Tracking pauses if this screen closes, the phone locks, or the browser goes into the background. Delivery proof still requires GPS.</p></section>`;
  root.querySelector("#scanOrder").onclick = () => {
    $("#claimPreview").innerHTML = "";
    $("#awbLookup").reset();
    $("#scanDialog").showModal();
  };
  root.querySelector("#shareLocation").onclick = () =>
    watchId === null
      ? startLocationSharing(false).catch((error) =>
          toast(error.message, "error"),
        )
      : run(async () => {
          await stopLocationSharing();
          renderDriverPanel(root);
          toast("Location sharing stopped");
        });
}
async function startLocationSharing(automatic = false) {
  if (state?.user.role !== "driver" || watchId !== null) return;
  if (!navigator.geolocation) {
    toast("GPS is not available in this browser.", "error");
    return;
  }
  locationAutomatic = automatic;
  if (window.relayDemo) {
    watchId = "sample";
    locationRequest = api("driver/location", {
      lat: 29.3759,
      lng: 47.9774,
      accuracy: 15,
    });
    await locationRequest;
    if ($("#driverTools")) renderDriverPanel($("#driverTools"));
    return;
  }
  const onPosition = async (position) => {
    if (
      watchId === null ||
      document.hidden ||
      sendingLocation ||
      Date.now() - lastLocationSent < 15000
    )
      return;
    sendingLocation = true;
    try {
      locationRequest = api("driver/location", {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
      await locationRequest;
      lastLocationSent = Date.now();
      if ($("#gpsState"))
        $("#gpsState").textContent =
          "GPS updated " +
          new Date().toLocaleTimeString("en-GB", {
            timeZone: "Asia/Kuwait",
          }) +
          " · ±" +
          Math.round(position.coords.accuracy) +
          " m";
    } catch (error) {
      toast(error.message, "error");
    } finally {
      sendingLocation = false;
    }
  };
  watchId = navigator.geolocation.watchPosition(
    onPosition,
    (error) => {
      toast(
        error.code === 1
          ? "Location permission was denied. Allow location in browser settings to share GPS."
          : "GPS could not be acquired. Move to an open area and try sharing again.",
        "error",
      );
      stopLocationSharing()
        .then(() => {
          if ($("#driverTools")) renderDriverPanel($("#driverTools"));
        })
        .catch(() => {});
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
  locationHeartbeat = setInterval(() => {
    if (watchId === null || document.hidden) return;
    navigator.geolocation.getCurrentPosition(onPosition, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
  }, 30000);
  if ($("#driverTools")) renderDriverPanel($("#driverTools"));
}
async function stopLocationSharing() {
  const wasActive = watchId !== null;
  if (watchId !== null && watchId !== "sample")
    navigator.geolocation.clearWatch(watchId);
  clearInterval(locationHeartbeat);
  locationHeartbeat = null;
  watchId = null;
  locationAutomatic = false;
  lastLocationSent = 0;
  if (wasActive && state?.user.role === "driver") {
    await locationRequest.catch(() => {});
    await api("driver/sharing", { enabled: false });
  }
}
function reconcileTracking() {
  if (
    locationAutomatic &&
    watchId !== null &&
    !state.orders.some((o) =>
      RelayOperations.activeTrips(o).some((t) => t.driver === state.user.id),
    )
  )
    stopLocationSharing()
      .then(() => {
        if ($("#driverTools")) renderDriverPanel($("#driverTools"));
      })
      .catch(() => {});
}
function pauseForBackground() {
  stopScanner();
  if (watchId === null) return;
  if (watchId !== "sample") navigator.geolocation.clearWatch(watchId);
  clearInterval(locationHeartbeat);
  locationHeartbeat = null;
  watchId = null;
  locationAutomatic = false;
  lastLocationSent = 0;
  if (window.relayDemo)
    window.relayDemo
      .request("driver/sharing", { enabled: false })
      .catch(() => {});
  else
    fetch("/api/driver/sharing", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }).catch(() => {});
  if ($("#driverTools")) renderDriverPanel($("#driverTools"));
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseForBackground();
});
window.addEventListener("pagehide", pauseForBackground);
function stopScanner() {
  cameraGeneration++;
  if (cameraReader) {
    cameraReader.reset();
    cameraReader = null;
  }
  const video = document.querySelector("#scanVideo");
  if (video?.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  if (video) {
    video.srcObject = null;
    video.hidden = true;
  }
}
async function lookupAwb(value) {
  const awb = String(value).trim().toUpperCase();
  $("#scanAwb").value = awb;
  $("#claimPreview").textContent = "Finding the order…";
  try {
    const o = await api("driver/lookup?awb=" + encodeURIComponent(awb));
    $("#claimPreview").innerHTML =
      `<section class="claimCard"><strong>${esc(o.awb)}</strong><p>${esc(o.reference)} · ${esc(o.recipient)}</p><p>${esc(o.address)}</p><p>${o.items.map((i) => `${esc(i.name)} × ${i.quantity}`).join(" · ")}</p>${o.pickups.map((p) => `<button data-claim="pickup" data-pickup="${esc(p.id)}">Claim pickup · ${esc(p.name)}</button>`).join("")}${o.deliveryAvailable ? '<button data-claim="delivery">Claim delivery</button>' : ""}</section>`;
    $("#claimPreview")
      .querySelectorAll("[data-claim]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            run(async () => {
              const result = await api("driver/claim", {
                awb: o.awb,
                leg: b.dataset.claim,
                pickupId: b.dataset.pickup,
              });
              selectedOrder = result.id || o.id;
              statusFilter = "";
              searchQuery = "";
              $("#scanDialog").close();
              await refresh("Order assigned to you");
            })),
      );
  } catch (error) {
    $("#claimPreview").textContent = error.message;
    throw error;
  }
}
document.querySelector("#awbLookup").onsubmit = (e) => {
  e.preventDefault();
  run(() => lookupAwb(new FormData(e.target).get("awb")));
};
document.querySelector("#closeScanner").onclick = () =>
  $("#scanDialog").close();
document.querySelector("#scanDialog").addEventListener("close", stopScanner);
document.querySelector("#startCamera").onclick = () =>
  run(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.ZXing)
      throw Error(
        "Camera scanning is unavailable. Enter the AWB number or choose a barcode image.",
      );
    stopScanner();
    const generation = cameraGeneration;
    const reader = new ZXing.BrowserMultiFormatReader(
      new Map([
        [
          ZXing.DecodeHintType.POSSIBLE_FORMATS,
          [ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.QR_CODE],
        ],
      ]),
    );
    cameraReader = reader;
    $("#scanVideo").hidden = false;
    try {
      await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        $("#scanVideo"),
        (result) => {
          if (result && generation === cameraGeneration) {
            const value = result.getText();
            stopScanner();
            lookupAwb(value).catch((error) => toast(error.message, "error"));
          }
        },
      );
      if (generation !== cameraGeneration || !$("#scanDialog").open)
        reader.reset();
    } catch {
      stopScanner();
      throw Error(
        "Camera could not open. Allow camera permission, or enter the AWB number / upload a barcode image.",
      );
    }
  });
document.querySelector("#scanImage").onchange = (event) =>
  run(async () => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024)
      throw Error("Use a barcode image smaller than 5 MB.");
    stopScanner();
    const url = URL.createObjectURL(file),
      reader = new ZXing.BrowserMultiFormatReader();
    try {
      const result = await reader.decodeFromImageUrl(url);
      await lookupAwb(result.getText());
    } catch (error) {
      if ($("#claimPreview").textContent === error.message) throw error;
      throw Error(
        "No readable AWB found. Try a clearer barcode image or enter the number.",
      );
    } finally {
      reader.reset();
      URL.revokeObjectURL(url);
    }
  });
function renderReports(root) {
  const drivers = state.users.filter((u) => u.role === "driver");
  root.innerHTML = `<section><div class="boardHeading"><div><h2>Order history & delivery reports</h2><p class="muted">Filter by any recorded event date, in Kuwait time.</p></div><button id="exportReport" class="ghost" disabled>${window.relayDemo ? "Export CSV (demo)" : "Export Excel"}</button></div><form id="reportFilters" class="reportFilters"><label>From<input type="date" name="from" value="${esc(reportFilters.from || "")}"></label><label>To<input type="date" name="to" value="${esc(reportFilters.to || "")}"></label><label>Driver<select name="driver"><option value="">All drivers</option>${drivers.map((d) => `<option value="${esc(d.id)}" ${reportFilters.driver === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label><label>Status<select name="status"><option value="">All statuses</option>${statuses.map((s) => `<option ${reportFilters.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><button>Apply filters</button></form><div id="reportResults" class="tableScroll" aria-live="polite">Loading report…</div></section>`;
  const load = async () => {
    const requestId = ++reportRequest;
    root.querySelector("#exportReport").disabled = true;
    const params = new URLSearchParams(reportFilters);
    const result = await api("reports?" + params);
    if (!root.isConnected || requestId !== reportRequest) return;
    root.querySelector("#exportReport").disabled = false;
    const rows = result.orders;
    $("#reportResults").innerHTML = rows.length
      ? `<p class="muted">${rows.length} orders · generated ${displayTime(result.generatedAt)}</p><table><thead><tr><th>AWB / reference</th><th>Status</th><th>Delivery driver</th><th>Recipient</th><th>Pickup progress</th><th>Delivered</th><th>Details</th></tr></thead><tbody>${rows.map((o, i) => `<tr><td><strong>${esc(o.awb)}</strong><small>${esc(o.reference)}</small></td><td><span class="badge ${statusClass(o.status)}">${esc(o.status)}</span></td><td>${esc(o.driver)}</td><td>${esc(o.recipient)}<small>${esc(o.phone)}</small></td><td>${o.pickups.filter((p) => p.completed).length}/${o.pickups.length} completed</td><td>${displayTime(o.delivery.at(-1)?.at)}</td><td><button class="ghost" data-report-detail="${i}" aria-expanded="false">View history</button></td></tr><tr id="reportDetail${i}" hidden><td colspan="7"><div class="reportDetail"><h3>${esc(o.awb)} · Order details</h3><button class="ghost" data-open-report-order="${esc(o.id)}">Open order & proof</button><p>${esc(o.address)} · Created ${displayTime(o.createdAt)}</p><h3>Pickup details</h3>${o.pickups.map((p) => `<p><strong>${esc(p.vendor)}</strong> · ${esc(p.address)}<br>Driver: ${esc(p.driver)} · ${p.completed ? "Completed" : "Pending"}<small>${p.proof ? "Contact: " + esc(p.proof.name) + " · " + displayTime(p.proof.at) + " · GPS " + p.proof.lat + ", " + p.proof.lng : "No pickup proof recorded"}</small></p>`).join("")}<h3>Items</h3>${o.items.map((item) => `<p>${esc(item.name)} × ${item.quantity} · ${esc(item.vendor)} · ${item.received ? "Received" : "Awaiting receipt"}</p>`).join("")}<h3>Delivery details</h3><p>Scheduled: ${esc(o.deliveryDate || "Not provided")} ${esc(o.timeSlot || "")} · Order value: ${o.amountFils == null ? "Not provided" : (o.amountFils / 1000).toFixed(3) + " KWD"}</p><p>Ring bell: ${o.ringBell == null ? "Not provided" : o.ringBell ? "Yes" : "No"} · Card: ${o.cardAvailable == null ? "Not provided" : o.cardAvailable ? "Yes" : "No"} · Occasion: ${esc(o.occasion?.value || "Unknown")}${o.occasion?.needsReview ? " (unconfirmed)" : ""}</p><p>${esc(o.extraDirections || "")}</p>${o.delivery.map((d) => `<p>Received by ${esc(d.name)} · ${displayTime(d.at)}<br>GPS ${d.lat}, ${d.lng} · Signature ${d.signatureCaptured ? "captured" : "not recorded"} · Photo ${d.photoCaptured ? "captured" : "not recorded"}</p>`).join("") || "<p>No completed delivery proof.</p>"}<h3>Trips</h3>${o.trips.map((t) => `<p>${esc(t.kind)} · ${esc(t.driver)} · ${esc(t.status)}<small>${displayTime(t.startedAt)} → ${displayTime(t.endedAt)} · ${esc(t.milestone || "")}</small></p>`).join("") || "<p>No trip events recorded.</p>"}<h3>Order history</h3><ol class="reportTimeline">${o.history.map((h) => `<li><strong>${esc(h.event)}</strong><span>${esc(h.by || "System")} · ${displayTime(h.at)}</span>${h.reason ? "<small>" + esc(h.reason) + "</small>" : ""}</li>`).join("")}</ol></div></td></tr>`).join("")}</tbody></table>`
      : '<div class="emptyState"><h3>No orders match these filters</h3><p>Change the dates, driver or status.</p></div>';
    root.querySelectorAll("[data-report-detail]").forEach(
      (b) =>
        (b.onclick = () => {
          const detail = $("#reportDetail" + b.dataset.reportDetail);
          detail.hidden = !detail.hidden;
          b.setAttribute("aria-expanded", String(!detail.hidden));
          b.textContent = detail.hidden ? "View history" : "Hide history";
        }),
    );
    root.querySelectorAll("[data-open-report-order]").forEach(
      (button) =>
        (button.onclick = () => {
          const row = rows.find((o) => o.id === button.dataset.openReportOrder);
          view = "orders";
          selectedOrder = row.id;
          searchQuery = row.awb;
          statusFilter = "";
          render();
          document.querySelectorAll(".orderWorkflow details").forEach((d) => {
            if (d.querySelector("summary")?.textContent === "History and proof")
              d.open = true;
          });
          document
            .querySelector(".orderCard:not([hidden])")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }),
    );
    $("#exportReport").onclick = () =>
      run(async () => {
        if (window.relayDemo) {
          const quote = (v) =>
            '"' +
            String(
              /^[\s]*[=+\-@\t\r]/.test(String(v)) ? "'" + v : v,
            ).replaceAll('"', '""') +
            '"';
          const csv = [
            [
              "AWB",
              "Reference",
              "Status",
              "Delivery driver",
              "Recipient",
              "Phone",
              "Address",
              "History (Kuwait time)",
            ],
            ...rows.map((o) => [
              o.awb,
              o.reference,
              o.status,
              o.driver,
              o.recipient,
              o.phone,
              o.address,
              o.history
                .map(
                  (h) =>
                    `${h.event} · ${h.by || "System"} · ${displayTime(h.at)}`,
                )
                .join(" | "),
            ]),
          ]
            .map((row) => row.map(quote).join(","))
            .join("\r\n");
          downloadBlob(
            new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
            "relay-demo-report.csv",
          );
          return;
        }
        const response = await fetch(
          "/api/reports/export?" + new URLSearchParams(reportFilters),
        );
        if (!response.ok) {
          const error = await response.json();
          throw Error(error.error || "Report export failed.");
        }
        downloadBlob(await response.blob(), "relay-operations-report.xlsx");
      });
  };
  $("#reportFilters").onsubmit = (e) => {
    e.preventDefault();
    reportFilters = Object.fromEntries(new FormData(e.target));
    run(load);
  };
  load().catch((error) => {
    if (root.isConnected) {
      root.querySelector("#reportResults").textContent =
        "Report could not load. Check the filters and try Apply filters again.";
      toast(error.message, "error");
    }
  });
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let operationalPollingStarted = false,
  polling = false;
let pendingOrderRefresh = false;
function startOperationalPolling() {
  if (operationalPollingStarted) return;
  operationalPollingStarted = true;
  setInterval(async () => {
    if (
      typeof state === "undefined" ||
      !state?.user ||
      view !== "orders" ||
      document.hidden ||
      busy ||
      polling
    )
      return;
    polling = true;
    try {
      const before = JSON.stringify(
        state.orders.map((o) => [
          o.id,
          o._revision,
          o.status,
          o.history.length,
        ]),
      );
      const next = await api("state");
      state = next;
      if ($("#fleetPanel")) renderFleet($("#fleetPanel"));
      if (
        before !==
        JSON.stringify(
          state.orders.map((o) => [
            o.id,
            o._revision,
            o.status,
            o.history.length,
          ]),
        )
      )
        pendingOrderRefresh = true;
      const editing =
        document.querySelector("dialog[open]") ||
        document.activeElement?.closest(
          "#content input,#content select,#content textarea,#content form",
        );
      if (pendingOrderRefresh && !editing && $("#content"))
        orders($("#content"));
      document
        .querySelectorAll("[data-status]")
        .forEach(
          (b) =>
            (b.querySelector("strong").textContent = state.orders.filter(
              (o) => o.status === b.dataset.status,
            ).length),
        );
      document
        .querySelectorAll(".navCount")
        .forEach((el) => (el.textContent = state.orders.length));
    } catch {
      /* Keep the last successful view visible; the next poll can recover. */
    } finally {
      polling = false;
    }
  }, 15000);
}
