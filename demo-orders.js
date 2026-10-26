const crypto = require("node:crypto");
const { startDelivery, finishTrip } = require("./public/operations");
module.exports = async function loadDemoOrders(
  store,
  prepareOrder,
  actor,
  now = new Date(),
) {
  const vendors = [
    [
      "flowers",
      "DEMO-FLOWERS",
      "DEMO · Petals Studio",
      "Fictional pickup · Kuwait City",
    ],
    [
      "gifts",
      "DEMO-GIFTS",
      "DEMO · Gift Atelier",
      "Fictional pickup · Salmiya",
    ],
  ];
  for (const [key, code, name, address] of vendors) {
    const id = "mawada-demo-vendor-" + key;
    const existing = await store.get("vendors", id);
    if (existing && !existing.demoData) throw Error("Demo ID conflict");
    if (!existing)
      await store.save("vendors", {
        id,
        code,
        name,
        address,
        phone: "+96500000000",
        demoData: true,
      });
  }
  const drivers = [];
  for (let n = 1; n <= 3; n++) {
    const id = "mawada-demo-driver-" + n,
      existing = await store.get("users", id);
    if (existing && !existing.demoData) throw Error("Demo ID conflict");
    if (!existing)
      await store.save("users", {
        id,
        name: "DEMO · Experience Manager " + n,
        email: "mawada-demo-" + n + "@example.invalid",
        role: "driver",
        demoData: true,
        password: require("bcryptjs").hashSync(
          crypto.randomBytes(32).toString("hex"),
          4,
        ),
      });
    drivers.push(id);
  }
  const existing = new Set((await store.all("orders")).map((o) => o.reference));
  const rows = [];
  for (const offset of [-1, 0, 1]) {
    const day = new Date(now.getTime() + 10800000 + offset * 86400000)
      .toISOString()
      .slice(0, 10);
    for (let n = 0; n < 8; n++) {
      const reference = `MAWADA-DEMO-${day}-${n + 1}`;
      if (existing.has(reference)) continue;
      const at = (hour) => `${day}T${hour}:00+03:00`;
      const o = await prepareOrder({
        reference,
        recipient: "DEMO · Recipient " + (n + 1),
        phone: "+96500000000",
        address:
          ["Hawally", "Salmiya", "Kuwait City", "Jabriya"][n % 4] +
          " · fictional demonstration address",
        source: "Mawada CMS",
        deliveryDate: day,
        timeSlot: "10:00–12:00",
        amountFils: 12500 + n * 1000,
        ringBell: n % 2 === 0,
        cardAvailable: true,
        extraDirections:
          "FICTIONAL DEMO ORDER — do not dispatch or contact anyone.",
        occasion: {
          label: n % 2 ? "Birthday" : "Congratulations",
          needsReview: false,
          source: "demo",
        },
        items: [
          {
            vendorCode: "DEMO-FLOWERS",
            name: "DEMO · Floral arrangement",
            quantity: 1,
          },
          ...(n % 2
            ? [
                {
                  vendorCode: "DEMO-GIFTS",
                  name: "DEMO · Gift box",
                  quantity: 1,
                },
              ]
            : []),
        ],
      });
      o.demoData = true;
      o.driver = n === 0 ? null : drivers[n % 3];
      o.history = [
        {
          event: "Fictional demo order loaded",
          at: at("08:00"),
          by: actor.name,
          actorId: actor.id,
          detail:
            "Simulated milestones and proof metadata; not a real shipment",
        },
      ];
      o.pickups.forEach((p, i) => {
        p.driver = drivers[(n + i) % 3];
        p.dueAt = at("09:00");
        if (n > 1) {
          p.completed = true;
          p.proof = {
            name: "DEMO · Vendor contact",
            lat: 29.3759,
            lng: 47.9774,
            at: at(n === 7 ? "09:30" : "08:45"),
            driverId: p.driver,
            simulated: true,
          };
          o.proofs ||= [];
          o.proofs.push({ ...p.proof, stage: "Vendor pickup", pickup: p.id });
        }
      });
      const status = [
        "Created",
        "Created",
        "Picked up",
        "At warehouse",
        "At warehouse",
        "Out for delivery",
        "Delivered",
        "Delivered",
      ][n];
      o.status = status;
      if (n >= 3) o.items.forEach((i) => (i.received = true));
      if (n >= 5) {
        startDelivery(o, crypto.randomUUID(), at("10:00"));
        o.history.push({
          event: "Out for delivery",
          at: at("10:00"),
          driverId: o.driver,
          by: "DEMO simulation",
        });
      }
      if (n >= 6) {
        const deliveredAt = at(n === 7 ? "12:30" : "11:00");
        finishTrip(o, "delivery", null, "Completed", deliveredAt);
        o.proofs.push({
          stage: "Delivered",
          name: "DEMO · Receiver",
          at: deliveredAt,
          lat: 29.3375,
          lng: 48.0251,
          driverId: o.driver,
          simulated: true,
        });
        o.history.push({
          event: "Delivered",
          at: deliveredAt,
          driverId: o.driver,
          by: "DEMO simulation",
        });
      }
      rows.push(o);
    }
  }
  if (rows.length) await store.insertMany("orders", rows);
  return {
    created: rows.length,
    message:
      "Fictional demo orders only. Three sample drivers have no usable login password; create real driver accounts separately.",
  };
};
