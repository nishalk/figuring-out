const { chromium } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve(__dirname, ".."),
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "relay-demo-browser-"));
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SESSION_SECRET: "",
      DATABASE_BACKEND: "sqlite",
      DATA_DIR: path.join(cwd, "data"),
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  try {
    const url = await new Promise((resolve, reject) => {
      child.on("exit", () => reject(Error("Server exited")));
      child.stdout.on("data", (b) => {
        const m = String(b).match(/Delivery app listening (\d+)/);
        if (m) resolve("http://127.0.0.1:" + m[1]);
      });
    });
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", async (d) => {
      errors.push(d.message());
      await d.dismiss();
    });
    await page.goto(url);
    await page
      .getByRole("heading", { name: "App setup needs attention" })
      .waitFor();
    await page.getByRole("link", { name: "Try the sample-data demo" }).click();
    await page.getByRole("heading", { name: "Order board" }).waitFor();
    assert.equal(await page.locator("#content > section").count(), 3);
    assert.equal(
      await page
        .getByRole("link", { name: "Suggest an improvement" })
        .getAttribute("target"),
      "_blank",
    );
    // The first sample order requires two separately verified vendor handovers.
    const order = () =>
      page.locator("#content > section").filter({ hasText: "SAMPLE-1001" });
    for (let i = 0; i < 2; i++) {
      await order()
        .getByRole("button", { name: "Verify items and record pickup" })
        .first()
        .click();
      await page
        .locator("#proofForm input[name=name]")
        .fill("Sample vendor contact");
      await page.locator("#proofItems input").check();
      await page.getByRole("button", { name: "Save proof" }).click();
      await page.locator("#proof").waitFor({ state: "hidden" });
    }
    await order()
      .getByRole("button", { name: "Receive item", exact: true })
      .first()
      .click();
    await page.waitForFunction(() =>
      document.querySelector("#content").textContent.includes("✓ Received"),
    );
    assert.equal(
      await order()
        .getByRole("button", { name: "Verify manifest and dispatch" })
        .count(),
      0,
    );
    await order()
      .getByRole("button", { name: "Receive item", exact: true })
      .click();
    await order()
      .getByRole("button", { name: "Verify manifest and dispatch" })
      .waitFor();
    await order()
      .getByRole("button", { name: "Verify manifest and dispatch" })
      .click();
    for (const check of await page.locator("#dispatchItems input").all())
      await check.check();
    await page.getByRole("button", { name: "Dispatch complete order" }).click();
    await order()
      .getByRole("button", { name: "Record delivery", exact: true })
      .waitFor();
    await order()
      .getByRole("button", { name: "Record delivery", exact: true })
      .click();
    await page.locator("#proofForm input[name=name]").fill("Sample receiver");
    for (const check of await page.locator("#proofItems input").all())
      await check.check();
    const canvas = await page.locator("canvas").boundingBox();
    await page.mouse.move(canvas.x + 20, canvas.y + 60);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 130, canvas.y + 40, { steps: 10 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Save proof" }).click();
    await page.locator("#proof").waitFor({ state: "hidden" });
    await order()
      .locator(".badge")
      .filter({ hasText: "Delivered" })
      .first()
      .waitFor();
    await order().getByRole("button", { name: "Print AWB label" }).click();
    await page.waitForFunction(
      () => !document.querySelector("#printLabel").disabled,
    );
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: path.join(os.tmpdir(), "relay-demo-label.pdf") });
    await page.emulateMedia({ media: "screen" });
    await page.locator("#label [data-close]").click();
    await page.locator("#demoRole").selectOption("demo-driver");
    await page.getByRole("heading", { name: "Order board" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Team access" }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "New order / Excel" }).count(),
      0,
    );
    await page.locator("#demoRole").selectOption("demo-admin");
    await page.getByRole("heading", { name: "Order board" }).waitFor();
    assert.equal(
      await order().locator(".badge").filter({ hasText: "Delivered" }).count(),
      1,
    );
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), "relay-demo-mobile.png"),
      fullPage: true,
    });
    console.log(
      "Browser smoke passed: configuration diagnostics, isolated sample demo, two vendor pickups, no partial dispatch, delivery signature, barcode printing, role switching and session persistence.",
    );
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill();
      await done;
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
