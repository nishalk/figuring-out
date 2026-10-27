/* Sample media must never be added to real operational evidence. */
function enrichDemoOrder(order) {
  if (
    order.demoData !== true ||
    !String(order.reference || "").startsWith("MAWADA-DEMO-")
  )
    return false;
  let changed = false;
  for (const item of order.items || [])
    if (!item.photo) {
      item.photo = "/brand/demo-gift.png";
      item.simulatedPhoto = true;
      changed = true;
    }
  const proofs = [
    ...(order.proofs || []),
    ...(order.pickups || []).map((p) => p.proof).filter(Boolean),
  ];
  for (const proof of proofs) {
    if (!proof.simulated) continue;
    if (!proof.photo) {
      proof.photo = "/brand/demo-gift.png";
      changed = true;
    }
    if (proof.stage === "Delivered" && !proof.signature) {
      proof.signature = "/brand/demo-signature.png";
      changed = true;
    }
  }
  return changed;
}
module.exports = { enrichDemoOrder };
