/* Shared operational rules for the real app and the isolated sample demo. */
((root, factory) => {
  const operations = factory();
  if (typeof module === "object" && module.exports) module.exports = operations;
  else root.RelayOperations = operations;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const reject = (message) => {
    throw Object.assign(new Error(message), { status: 409 });
  };
  const activeTrips = (order) =>
    (order.trips || []).filter((t) => t.status === "In transit");
  function normaliseTrips(order) {
    order.trips ||= [];
    if (
      order.status === "Out for delivery" &&
      order.driver &&
      !order.trips.some(
        (t) => t.kind === "delivery" && t.status === "In transit",
      )
    ) {
      order.trips.push({
        id: order.id + "-legacy-delivery",
        kind: "delivery",
        driver: order.driver,
        status: "In transit",
        milestone: "On the road",
        startedAt:
          order.history?.findLast((h) => h.event === "Out for delivery")?.at ||
          null,
        legacy: true,
      });
    }
    return order;
  }
  function claimOrder(order, driverId, leg, pickupId) {
    if (leg === "delivery") {
      if (
        order.status !== "At warehouse" ||
        !order.items.length ||
        order.items.some((i) => !i.received)
      )
        reject(
          "Delivery can only be claimed after every item reaches the warehouse.",
        );
      if (order.driver && order.driver !== driverId)
        reject("This delivery is already assigned to another driver.");
      order.driver = driverId;
    } else if (leg === "pickup") {
      const task = order.pickups.find((p) => p.id === pickupId);
      if (
        !task ||
        task.completed ||
        !["Created", "Picked up"].includes(order.status)
      )
        reject("Choose an incomplete pickup.");
      if (task.driver && task.driver !== driverId)
        reject("This pickup is already assigned to another driver.");
      task.driver = driverId;
    } else reject("Choose pickup or delivery.");
    return order;
  }
  function startPickup(order, pickupId, driverId, tripId, at) {
    const task = order.pickups.find((p) => p.id === pickupId);
    if (
      !task ||
      task.completed ||
      task.driver !== driverId ||
      !["Created", "Picked up"].includes(order.status)
    )
      reject("An assigned, incomplete pickup is required.");
    order.trips ||= [];
    if (
      activeTrips(order).some(
        (t) => t.kind === "pickup" && t.pickupId === pickupId,
      )
    )
      reject("This pickup trip has already started.");
    const trip = {
      id: tripId,
      kind: "pickup",
      pickupId,
      driver: driverId,
      status: "In transit",
      milestone: "Travelling to pickup",
      startedAt: at,
    };
    order.trips.push(trip);
    return trip;
  }
  function startDelivery(order, tripId, at) {
    order.trips ||= [];
    if (activeTrips(order).some((t) => t.kind === "delivery"))
      reject("This delivery trip has already started.");
    const trip = {
      id: tripId,
      kind: "delivery",
      driver: order.driver,
      status: "In transit",
      milestone: "On the road",
      startedAt: at,
    };
    order.trips.push(trip);
    return trip;
  }
  function finishTrip(order, kind, pickupId, status, at, reason) {
    const trip = activeTrips(order).find(
      (t) => t.kind === kind && (kind !== "pickup" || t.pickupId === pickupId),
    );
    if (trip)
      Object.assign(trip, {
        status,
        endedAt: at,
        ...(reason ? { reason } : {}),
      });
    return trip;
  }
  function fleet(users, orders) {
    return users
      .filter((u) => u.role === "driver")
      .map((user) => {
        const deliveries = orders.filter((o) => o.driver === user.id);
        const tasks = orders.flatMap((o) =>
          o.pickups
            .filter((p) => p.driver === user.id)
            .map((p) => ({
              id: p.id,
              driver: p.driver,
              completed: p.completed,
              vendor: {
                id: p.vendor.id,
                name: p.vendor.name,
                address: p.vendor.address,
              },
              awb: o.awb,
              orderId: o.id,
            })),
        );
        const trips = orders.flatMap((o) =>
          activeTrips(o)
            .filter((t) => t.driver === user.id)
            .map((t) => ({ ...t, awb: o.awb, reference: o.reference })),
        );
        const assignedOrders = orders.filter(
          (o) =>
            (o.driver === user.id && o.status !== "Delivered") ||
            o.pickups.some((p) => p.driver === user.id && !p.completed),
        );
        return {
          id: user.id,
          name: user.name,
          lastLocation: user.lastLocation || null,
          locationSharing: Boolean(user.locationSharing),
          assignedOrders: assignedOrders.length,
          pendingDeliveries: deliveries.filter((o) =>
            ["Created", "Picked up", "At warehouse"].includes(o.status),
          ).length,
          inTransitDeliveries: deliveries.filter(
            (o) => o.status === "Out for delivery",
          ).length,
          failedDeliveries: deliveries.filter(
            (o) => o.status === "Delivery failed",
          ).length,
          delivered: deliveries.filter((o) => o.status === "Delivered").length,
          pendingPickups: tasks.filter((p) => !p.completed).length,
          completedPickups: tasks.filter((p) => p.completed).length,
          activeTrips: trips,
          pickups: tasks,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function report(orders, users, filters = {}) {
    const names = new Map(users.map((u) => [u.id, u.name]));
    const date = (value) => {
      if (!value) return null;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        throw Error("Use a valid date.");
      return value;
    };
    const from = date(filters.from),
      to = date(filters.to);
    if (from && to && from > to)
      throw Error("The start date must be on or before the end date.");
    const inRange = (at) => {
      if (!at) return false;
      const day = new Date(new Date(at).getTime() + 3 * 3600000)
        .toISOString()
        .slice(0, 10);
      return (!from || day >= from) && (!to || day <= to);
    };
    return orders
      .filter(
        (o) =>
          (!filters.status || o.status === filters.status) &&
          (!filters.driver ||
            o.driver === filters.driver ||
            o.pickups.some((p) => p.driver === filters.driver) ||
            (o.trips || []).some((t) => t.driver === filters.driver) ||
            o.history.some(
              (h) =>
                h.driverId === filters.driver || h.actorId === filters.driver,
            )) &&
          (!(from || to) || o.history.some((h) => inRange(h.at))),
      )
      .map((o) => ({
        id: o.id,
        awb: o.awb,
        reference: o.reference,
        status: o.status,
        recipient: o.recipient,
        phone: o.phone,
        address: o.address,
        driver: names.get(o.driver) || "Unassigned",
        driverId: o.driver,
        createdAt: o.history[0]?.at || null,
        deliveryDate: o.deliveryDate || null,
        timeSlot: o.timeSlot || "",
        amountFils: o.amountFils ?? null,
        ringBell: o.ringBell ?? null,
        cardAvailable: o.cardAvailable ?? null,
        extraDirections: o.extraDirections || "",
        occasion: o.occasion || null,
        items: o.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          vendor: i.vendor.name,
          received: i.received,
        })),
        pickups: o.pickups.map((p) => ({
          id: p.id,
          vendor: p.vendor.name,
          address: p.vendor.address,
          driver: names.get(p.driver) || "Unassigned",
          completed: p.completed,
          proof: p.proof
            ? {
                name: p.proof.name,
                at: p.proof.at,
                lat: p.proof.lat,
                lng: p.proof.lng,
              }
            : null,
        })),
        delivery: (o.proofs || [])
          .filter((p) => p.stage === "Delivered")
          .map((p) => ({
            name: p.name,
            at: p.at,
            lat: p.lat,
            lng: p.lng,
            signatureCaptured: Boolean(p.signature),
            photoCaptured: Boolean(p.photo),
          })),
        attempts: o.attempts || [],
        history: o.history.map((h) => ({ ...h })),
        trips: (o.trips || []).map((t) => ({
          ...t,
          driver: names.get(t.driver) || t.driver,
        })),
      }));
  }
  return {
    activeTrips,
    normaliseTrips,
    claimOrder,
    startPickup,
    startDelivery,
    finishTrip,
    fleet,
    report,
  };
});
