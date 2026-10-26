const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transition } = require("../domain");
test("cannot dispatch an incomplete multi-vendor order", () =>
  assert.throws(
    () =>
      transition(
        {
          status: "At warehouse",
          items: [{ received: true }, { received: false }],
        },
        "Out for delivery",
      ),
    /Every item/,
  ));
test("dispatches a fully consolidated order", () =>
  assert.equal(
    transition(
      {
        status: "At warehouse",
        items: [{ received: true }, { received: true }],
      },
      "Out for delivery",
    ).status,
    "Out for delivery",
  ));
test("cannot skip pickup or warehouse", () =>
  assert.throws(
    () => transition({ status: "Created", items: [] }, "Out for delivery"),
    /preceding/,
  ));

test("unknown states cannot transition into the workflow", () => {
  assert.throws(
    () => transition({ status: "Delivery failed", items: [] }, "Created"),
    /preceding/,
  );
});

test("legacy pickup identifiers remain stable and preserve historical status", () => {
  const { pickupTasks } = require("../domain");
  const order = {
    status: "At warehouse",
    driver: "driver-1",
    items: [
      { vendor: { id: "v1" } },
      { vendor: { id: "v1" } },
      { vendor: { id: "v2" } },
    ],
  };
  const tasks = pickupTasks(order);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((p) => p.completed && p.legacy));
  assert.equal(pickupTasks(order)[0].id, tasks[0].id);
});
