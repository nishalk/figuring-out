const { test } = require("node:test");
const assert = require("node:assert/strict");
const { enrichDemoOrder } = require("../demo-media");
test("sample photos and signatures enrich only marked demo records and simulated proof", () => {
  const real = {
    reference: "REAL",
    items: [{}],
    proofs: [{ stage: "Delivered" }],
  };
  assert.equal(enrichDemoOrder(real), false);
  assert.equal(real.proofs[0].photo, undefined);
  const demo = {
    demoData: true,
    reference: "MAWADA-DEMO-test",
    items: [{}],
    proofs: [
      { stage: "Delivered", simulated: true },
      { stage: "Delivered", photo: "real-evidence" },
    ],
  };
  assert.equal(enrichDemoOrder(demo), true);
  assert.equal(demo.proofs[0].signature, "/brand/demo-signature.png");
  assert.equal(demo.items[0].photo, "/brand/demo-gift.png");
  assert.equal(demo.proofs[1].signature, undefined);
  assert.equal(demo.proofs[1].photo, "real-evidence");
  assert.equal(enrichDemoOrder(demo), false);
});
