const { test } = require("node:test");
const assert = require("node:assert/strict");
const access = require("../public/access");
test("role checklists restrict permissions without expanding role powers or locking out administrators", () => {
  assert.equal(
    access.allowed({ role: "driver", permissions: ["reports"] }, "reports"),
    false,
  );
  assert.equal(
    access.allowed({ role: "operations", permissions: [] }, "create"),
    false,
  );
  assert.equal(access.allowed({ role: "operations" }, "create"), true);
  assert.equal(
    access.allowed({ role: "admin", permissions: [] }, "dashboard"),
    true,
  );
  assert.equal(access.validate("warehouse", ["reports"]), false);
  assert.equal(access.validate("driver", ["work"]), true);
});
