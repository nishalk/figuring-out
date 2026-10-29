/* Shared, deterministic operating rules. Kuwait calendar and explicit promises. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MawadaControl = api;
})(globalThis, () => {
  const day = (at = Date.now()) =>
    new Date(Number(at) + 10800000).toISOString().slice(0, 10);
  const time = (at) =>
    Number.isFinite(Date.parse(at)) ? Date.parse(at) : null;
  function deadline(o) {
    if (o.deliveryDueAt && /(?:Z|[+-]\d\d:\d\d)$/.test(o.deliveryDueAt))
      return time(o.deliveryDueAt);
    const slot = String(o.timeSlot || "").match(
      /^([0-2]?\d:[0-5]\d)\s*[-–]\s*([0-2]?\d:[0-5]\d)$/,
    );
    if (!slot || !o.deliveryDate) return null;
    const start = slot[1].padStart(5, "0"),
      end = slot[2].padStart(5, "0");
    if (
      Number(start.slice(0, 2)) > 23 ||
      Number(end.slice(0, 2)) > 23 ||
      end <= start
    )
      return null;
    return time(o.deliveryDate + "T" + end + ":00+03:00");
  }
  function exceptions(orders, users, at = Date.now()) {
    const rows = [],
      today = day(at);
    const add = (o, code, severity, owner, action, detail, suffix = "") =>
      rows.push({
        id: `${o.id}:${code}${suffix}`,
        orderId: o.id,
        awb: o.awb,
        code,
        severity,
        owner,
        action,
        detail,
        due: o.deliveryDate || "Unscheduled",
        review: o.exceptionReviews?.[code + suffix] || null,
      });
    for (const o of orders.filter(
      (o) => !o.demoData && o.status !== "Delivered",
    )) {
      const due = !o.deliveryDate || o.deliveryDate <= today;
      if (!o.deliveryDate)
        add(
          o,
          "schedule",
          "Medium",
          "Operations",
          "Set a delivery date and window",
          "No delivery commitment has been recorded.",
        );
      if (o.deliveryDate && deadline(o) === null)
        add(
          o,
          "delivery-window",
          "Medium",
          "Operations",
          "Confirm an explicit delivery window",
          "The delivery window is missing or cannot be measured.",
        );
      if (o.deliveryDate < today || (deadline(o) !== null && deadline(o) < at))
        add(
          o,
          "overdue",
          "High",
          "Operations",
          "Contact driver and agree a recovery plan",
          "Delivery date or explicit delivery window has passed.",
        );
      if (due && !o.driver && o.status !== "Delivery failed")
        add(
          o,
          "delivery-assignment",
          "High",
          "Operations",
          "Assign a delivery driver",
          "No delivery driver assigned.",
        );
      for (const p of o.pickups || []) {
        if (
          !p.completed &&
          (due || (time(p.dueAt) !== null && time(p.dueAt) < at))
        )
          add(
            o,
            "pickup",
            p.lastFailure || (time(p.dueAt) !== null && time(p.dueAt) < at)
              ? "High"
              : "Medium",
            "Operations",
            p.lastFailure
              ? "Resolve pickup failure and retry"
              : "Confirm vendor readiness and assign pickup",
            `${p.vendor.name}: ${p.lastFailure || (p.driver ? "Awaiting collection" : "Unassigned")}${p.dueAt ? "; pickup due " + p.dueAt : "; no pickup deadline recorded"}`,
            ":" + p.id,
          );
        if (
          p.completed &&
          o.items.some((i) => i.vendor.id === p.vendor.id && !i.received)
        )
          add(
            o,
            "receipt",
            "High",
            "Warehouse",
            "Reconcile picked-up items against receipt",
            `${p.vendor.name}: collected items remain unreceived.`,
            ":" + p.id,
          );
      }
      if (o.status === "At warehouse" && due) {
        const since =
          time(o.warehouseReadyAt) ||
          time(o.history?.findLast((h) => h.event === "receive")?.at);
        if (since !== null && at - since >= 2 * 3600000)
          add(
            o,
            "warehouse-dwell",
            "Medium",
            "Operations",
            "Plan departure or record the hold reason",
            "Complete order has waited at least two hours at the warehouse.",
          );
      }
      if (o.status === "Delivery failed")
        add(
          o,
          "failed-delivery",
          "High",
          o.returned ? "Operations" : "Warehouse",
          o.returned
            ? "Agree a new date with the customer"
            : "Confirm physical warehouse return",
          o.attempts?.at(-1)?.reason || "Delivery attempt failed.",
        );
    }
    for (const u of users.filter((u) => u.role === "driver" && !u.deletedAt)) {
      const active = orders.filter(
        (o) =>
          !o.demoData &&
          (o.trips || []).some(
            (t) => t.driver === u.id && t.status === "In transit",
          ),
      );
      if (
        active.length &&
        (!u.lastLocation || at - Date.parse(u.lastLocation.at) > 300000)
      ) {
        const o = active[0];
        add(
          o,
          "location",
          "Medium",
          "Operations",
          "Contact driver; confirm device and trip status",
          `${u.name}: no fresh GPS for active work. This is a connectivity signal, not a finding of misconduct.`,
          ":" + u.id,
        );
      }
    }
    return rows.sort(
      (a, b) =>
        (a.severity === "High" ? 0 : 1) - (b.severity === "High" ? 0 : 1) ||
        a.due.localeCompare(b.due) ||
        a.awb.localeCompare(b.awb),
    );
  }
  function performance(orders, from, to, at = Date.now()) {
    const inRange = (d) => d && (!from || d >= from) && (!to || d <= to);
    const live = orders.filter((o) => !o.demoData);
    const cohort = live.filter((o) => inRange(o.deliveryDate));
    const delivered = cohort.filter((o) => o.status === "Delivered");
    const attempted = cohort.filter(
      (o) =>
        o.status === "Delivered" ||
        o.attempts?.length ||
        (o.trips || []).some(
          (t) =>
            t.kind === "delivery" && ["Failed", "Completed"].includes(t.status),
        ),
    );
    const firstSuccess = attempted.filter(
      (o) =>
        o.status === "Delivered" &&
        !o.attempts?.length &&
        !(o.trips || []).some(
          (t) => t.kind === "delivery" && t.status === "Failed",
        ),
    );
    const observed = cohort.filter(
      (o) =>
        deadline(o) !== null && (o.status === "Delivered" || deadline(o) < at),
    );
    const onTime = observed.filter((o) => {
      const proof = (o.proofs || []).findLast((p) => p.stage === "Delivered");
      return (
        o.status === "Delivered" &&
        time(proof?.at) !== null &&
        time(proof.at) <= deadline(o)
      );
    });
    const dwell = delivered
      .map((o) => {
        const ready =
          time(o.warehouseReadyAt) ||
          time(o.history?.findLast((h) => h.event === "receive")?.at);
        const departure = time(
          o.history?.findLast((h) => h.event === "Out for delivery")?.at,
        );
        return ready !== null && departure !== null && departure >= ready
          ? (departure - ready) / 60000
          : null;
      })
      .filter((n) => n !== null);
    const pickups = cohort.flatMap((o) => o.pickups || []);
    const measuredPickups = pickups.filter(
      (p) =>
        time(p.dueAt) !== null &&
        (p.completed ? time(p.proof?.at) !== null : time(p.dueAt) < at),
    );
    const latePickups = measuredPickups.filter((p) =>
      p.completed
        ? time(p.proof?.at) !== null && time(p.proof.at) > time(p.dueAt)
        : time(p.dueAt) < at,
    );
    return {
      scheduled: cohort.length,
      delivered: delivered.length,
      attempted: attempted.length,
      firstSuccess: firstSuccess.length,
      firstAttemptRate: attempted.length
        ? Math.round((firstSuccess.length / attempted.length) * 100)
        : null,
      measuredWindows: observed.length,
      onTime: onTime.length,
      onTimeRate: observed.length
        ? Math.round((onTime.length / observed.length) * 100)
        : null,
      unknownWindows: cohort.filter((o) => deadline(o) === null).length,
      unscheduled: live.filter(
        (o) => !o.deliveryDate && o.status !== "Delivered",
      ).length,
      dwellSamples: dwell.length,
      averageDwellMinutes: dwell.length
        ? Math.round(dwell.reduce((a, b) => a + b, 0) / dwell.length)
        : null,
      pickupFailures: cohort.reduce(
        (n, o) =>
          n +
          (o.history || []).filter((h) => h.event === "pickup-failed").length,
        0,
      ),
      measuredPickups: measuredPickups.length,
      latePickups: latePickups.length,
      unknownPickupDeadlines: pickups.filter((p) => time(p.dueAt) === null)
        .length,
      rows: cohort.map((o) => ({
        id: o.id,
        awb: o.awb,
        date: o.deliveryDate,
        status: o.status,
        area: o.area || "Unspecified",
        window: o.timeSlot || "Unknown",
        attempts:
          (o.attempts || []).length + (o.status === "Delivered" ? 1 : 0),
      })),
    };
  }
  function workload(orders, driver) {
    const live = orders.filter((o) => !o.demoData);
    return {
      deliveries: live.filter(
        (o) => o.driver === driver && o.status !== "Delivered",
      ).length,
      pickups: live.reduce(
        (n, o) =>
          n +
          (o.pickups || []).filter((p) => p.driver === driver && !p.completed)
            .length,
        0,
      ),
      active: live.reduce(
        (n, o) =>
          n +
          (o.trips || []).filter(
            (t) => t.driver === driver && t.status === "In transit",
          ).length,
        0,
      ),
    };
  }
  return { day, deadline, exceptions, performance, workload };
});
