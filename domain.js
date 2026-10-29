const crypto = require("node:crypto");
const stages = [
  "Created",
  "Picked up",
  "At warehouse",
  "Out for delivery",
  "Delivered",
];
function transition(order, next) {
  if (
    !stages.includes(order.status) ||
    !stages.includes(next) ||
    stages.indexOf(next) !== stages.indexOf(order.status) + 1
  )
    throw Error("Complete the preceding stage first");
  if (
    next === "Out for delivery" &&
    (!order.items.length || order.items.some((i) => !i.received))
  )
    throw Error(
      "Every item must be received before dispatch; partial delivery is not allowed",
    );
  return { ...order, status: next };
}
function pickupTasks(order) {
  // Preserve old completed orders without inventing separate historical vendor proofs.
  if (!order.pickups)
    order.pickups = [
      ...new Map(order.items.map((i) => [i.vendor.id, i.vendor])).values(),
    ].map((v) => ({
      id: crypto.randomUUID(),
      vendor: v,
      driver: order.driver || null,
      completed: order.status !== "Created",
      legacy: order.status !== "Created",
    }));
  return order.pickups;
}
function syncStatus(order) {
  if (!["Created", "Picked up", "At warehouse"].includes(order.status)) return;
  order.status = order.items.every((i) => i.received)
    ? "At warehouse"
    : pickupTasks(order).every((p) => p.completed)
      ? "Picked up"
      : "Created";
}
function validateProof(body, delivery = false) {
  const { name, photo, signature, lat, lng } = body;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    !validImage(photo) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    throw Error("Name, valid photo and GPS required");
  if (delivery && !validImage(signature, true))
    throw Error("Valid signature required");
  let capturedAt;
  if (body.capturedAt !== undefined) {
    const captured = Date.parse(body.capturedAt);
    if (
      !Number.isFinite(captured) ||
      captured > Date.now() + 60000 ||
      Date.now() - captured > 86400000
    )
      throw Error(
        "Proof draft capture is invalid or more than 24 hours old. Contact operations to reconcile the handover.",
      );
    capturedAt = new Date(captured).toISOString();
  }
  return {
    capturedAt,
    name: name.trim(),
    photo,
    signature: delivery ? signature : undefined,
    lat,
    lng,
    at: new Date().toISOString(),
  };
}
function validImage(value, pngOnly = false) {
  if (typeof value !== "string" || value.length > 6 * 1024 * 1024) return false;
  const m = value.match(
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!m || (pngOnly && m[1] !== "png")) return false;
  const b = Buffer.from(m[2], "base64");
  return m[1] === "png"
    ? b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
        b.length > 24
    : m[1] === "jpeg"
      ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : b.toString("ascii", 0, 4) === "RIFF" &&
        b.toString("ascii", 8, 12) === "WEBP";
}
module.exports = { stages, transition, pickupTasks, syncStatus, validateProof };
