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
    await context.route("https://tile.openstreetmap.org/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
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
    await page.locator(".executiveDashboard").waitFor();
    assert.equal(
      await page.locator("[data-view=dashboard]").getAttribute("aria-current"),
      "page",
    );
    await page.locator("[data-view=orders]").click();
    await page.getByRole("heading", { name: "Order board" }).waitFor();
    assert.equal(await page.locator("#orderList > section").count(), 4);
    assert.equal(
      await page
        .getByRole("link", { name: "Suggest an improvement" })
        .getAttribute("target"),
      "_blank",
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /Electric Orchid/ }).click();
    assert.equal(
      await page.locator("html").getAttribute("data-palette"),
      "orchid",
    );
    await page.locator("input[name=accent]").fill("#efb1db");
    await page
      .getByRole("button", { name: "Save custom colours", exact: true })
      .click();
    await page.reload();
    assert.equal(
      await page
        .locator("html")
        .evaluate((el) => el.style.getPropertyValue("--accent")),
      "#efb1db",
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /Midnight Burgundy/ }).click();
    await page.locator("[data-view=orders]").click();
    assert.equal(await page.locator("#dashboardCharts .chartCard").count(), 2);
    assert.equal(
      await page
        .locator(".mawadaLogo")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
      true,
    );
    await page.locator("[data-view=dashboard]").click();
    assert.equal(await page.locator(".dailyMetrics article").count(), 6);
    await page.locator("[data-daily-detail=delivered][data-day=today]").click();
    await page.locator("#metricDialog").waitFor();
    assert.ok(
      (await page.locator("#metricRecords").textContent()).includes("0 orders"),
    );
    await page.locator("#closeMetric").click();

    assert.equal(await page.locator("#orderList").count(), 0);
    await page.locator("#overviewCharts [data-chart-status]").first().click();
    await page
      .getByRole("heading", { name: "Order board", exact: true })
      .waitFor();
    await page.locator("#statusFilter").selectOption("");
    await page.locator("[data-view=users]").click();
    await page.locator("#user [name=role]").selectOption("warehouse");
    assert.equal(
      await page.locator("#newPermissions input[value=reports]").isDisabled(),
      true,
    );
    assert.equal(
      await page.locator("#newPermissions input[value=work]").isChecked(),
      true,
    );
    assert.equal(await page.locator("#user button").isDisabled(), true);
    await page.locator("[data-view=orders]").click();
    // Appearance preference survives reloads, and System tracks the device.
    await page.getByLabel("Appearance", { exact: true }).selectOption("dark");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.reload();
    await page.locator(".executiveDashboard").waitFor();
    await page.locator("[data-view=orders]").click();
    await page.getByRole("heading", { name: "Order board" }).waitFor();
    assert.equal(
      await page.getByLabel("Appearance", { exact: true }).inputValue(),
      "dark",
    );
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: path.join(os.tmpdir(), "relay-ui-dark.png"),
      animations: "disabled",
    });
    await page.getByLabel("Appearance", { exact: true }).selectOption("light");
    await page.screenshot({
      path: path.join(os.tmpdir(), "relay-ui-light.png"),
      animations: "disabled",
    });
    await page.getByLabel("Appearance", { exact: true }).selectOption("system");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.getByLabel("Appearance", { exact: true }).selectOption("light");
    await page.setViewportSize({ width: 412, height: 915 });
    // Search/filter controls really narrow the board and recover from an empty result.
    await page
      .getByRole("searchbox", { name: "Search orders" })
      .fill("SAMPLE-1002");
    assert.equal(await page.locator("#orderList > section:visible").count(), 1);
    await page
      .getByRole("searchbox", { name: "Search orders" })
      .fill("no-such-order");
    await page.getByRole("heading", { name: "No matching orders" }).waitFor();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    assert.equal(await page.locator("#orderList > section:visible").count(), 4);
    await page.locator('[data-status="Out for delivery"]').click();
    assert.equal(await page.locator("#orderList > section:visible").count(), 1);
    assert.equal(
      await page.getByLabel("Filter by status").inputValue(),
      "Out for delivery",
    );
    await page.getByLabel("Filter by status").selectOption("");
    await page.getByLabel("Sort orders").selectOption("reference");
    assert.ok(
      (
        await page.locator("#orderList > section").first().textContent()
      ).includes("SAMPLE-1001"),
    );
    await page
      .getByRole("button", { name: "New order / Excel", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Validate and preview", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Select a workbook" })
      .waitFor();
    await page.getByRole("button", { name: /^Orders/ }).click();
    // The first sample order requires two separately verified vendor handovers.
    const order = () =>
      page.locator("#orderList > section").filter({ hasText: "SAMPLE-1001" });
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
    await order().locator("[data-open-awb]").click();
    await page.locator("#orderDetailDialog").waitFor();
    assert.ok(
      (await page.locator("#orderDetailContent").textContent()).includes(
        "Sample receiver",
      ),
    );
    assert.equal(
      await page
        .locator('#orderDetailContent img[alt="Recipient signature"]')
        .count(),
      1,
    );
    await page.locator("#orderDetailContent [data-proof-pin]").last().click();
    assert.equal(
      await page.locator("#proofLocationMap .leaflet-marker-icon").count(),
      1,
    );
    await page.locator("#closeOrderDetail").click();
    await page.locator("[data-view=labels]").click();
    await page
      .locator("#addPrintAwbs textarea")
      .fill("DEMO-KW-1001, DEMO-KW-1002 DEMO-KW-1001");
    await page.locator("#addPrintAwbs button").click();
    await page
      .getByRole("heading", { name: "2 labels selected", exact: true })
      .waitFor();
    const labelBarcode = await context.request.get(
      url + "/demo/barcode/DEMO-KW-1004",
    );
    await page.locator("#labelScanImage").setInputFiles({
      name: "awb.png",
      mimeType: "image/png",
      buffer: await labelBarcode.body(),
    });
    await page
      .getByRole("heading", { name: "3 labels selected", exact: true })
      .waitFor();
    await page.locator("#printBatch").click();
    await page.waitForFunction(
      () => !document.querySelector("#printLabel").disabled,
    );
    assert.equal(await page.locator("#labelContent .printAwb").count(), 3);
    assert.ok(
      (await page.locator("#labelContent").textContent()).includes(
        "total units",
      ),
    );
    await page.locator("#label [data-close]").click();
    await page.locator("[data-view=orders]").click();

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
    await page.locator(".executiveDashboard").waitFor();
    await page.locator("[data-view=orders]").click();
    await page.getByRole("heading", { name: "Order board" }).waitFor();
    assert.equal(
      await order().locator(".badge").filter({ hasText: "Delivered" }).count(),
      1,
    );
    // Scan an actual Code 128 image, claim a ready order, and start the driver's trip.
    await page.locator("[data-view=assignments]").click();
    await page.locator("#addPrintAwbs textarea").fill("DEMO-KW-1004");
    await page.locator("#addPrintAwbs button").click();
    await page.locator("#assignmentDriver").selectOption("demo-driver2");
    await page.locator("#assignmentLeg").selectOption("delivery");
    await page.locator("#printBatch").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#assignmentResults")
        .textContent.includes("delivery assigned"),
    );
    await page.locator("#demoRole").selectOption("demo-driver2");
    await page
      .getByRole("button", { name: "Scan / claim AWB", exact: true })
      .click();
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      };
    });
    await page
      .getByRole("button", { name: "Open camera", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Camera could not open" })
      .waitFor();
    const barcode = await context.request.get(
      url + "/demo/barcode/DEMO-KW-1004",
    );
    await page.locator("#scanImage").setInputFiles({
      name: "awb.png",
      mimeType: "image/png",
      buffer: await barcode.body(),
    });
    await page
      .getByRole("button", { name: "Claim delivery", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Claim delivery", exact: true })
      .click();
    const claimed = () =>
      page.locator("#orderList > section").filter({ hasText: "SAMPLE-1004" });
    await claimed()
      .getByRole("button", { name: "Start delivery trip", exact: true })
      .click();
    for (const check of await page.locator("#dispatchItems input").all())
      await check.check();
    await page
      .getByRole("button", { name: "Dispatch complete order", exact: true })
      .click();
    await claimed()
      .getByRole("button", { name: "Arrived at delivery", exact: true })
      .waitFor();
    await claimed()
      .getByRole("button", { name: "Arrived at delivery", exact: true })
      .click();
    await page.locator("#demoRole").selectOption("demo-admin");
    await page.locator(".executiveDashboard").waitFor();
    await page.locator("[data-view=orders]").click();
    await page
      .getByRole("heading", { name: "Fleet control", exact: true })
      .waitFor();
    const fleetRow = () =>
      page
        .locator("#fleetTable tbody tr")
        .filter({ hasText: "Sample Driver Two" });
    assert.ok(
      (await fleetRow().locator("td").nth(3).textContent()).includes(
        "1 in transit",
      ),
    );
    assert.equal(await page.locator(".driverMarker").count(), 2);
    await fleetRow()
      .getByRole("button", {
        name: "Sample Driver Two · View driver",
        exact: true,
      })
      .click();
    await page
      .locator("#driverProfile")
      .getByRole("heading", { name: "Sample Driver Two", exact: true })
      .waitFor();
    assert.ok(
      (await page.locator("#driverProfile").textContent()).includes(
        "SAMPLE-1004",
      ),
    );
    assert.ok(
      (await page.locator("#driverProfile").textContent()).includes(
        "Shipments handled",
      ),
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .locator("#fleetTable")
      .getByRole("button", { name: "Demo Driver · View driver", exact: true })
      .click();
    await page
      .locator(
        '#driverProfile form[data-review-alert="sample-location-jump"] input',
      )
      .fill("Confirmed this is the simulated GPS example");
    await page
      .locator(
        '#driverProfile form[data-review-alert="sample-location-jump"] button',
      )
      .click();
    await page.locator("#driverProfile .driverFlag.reviewed").waitFor();
    assert.ok(
      (
        await page.locator("#driverProfile .driverFlag.reviewed").textContent()
      ).includes("Confirmed this is the simulated GPS example"),
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await page
      .getByRole("heading", {
        name: "Order history & delivery reports",
        exact: true,
      })
      .waitFor();
    await page
      .locator("#reportFilters select[name=driver]")
      .selectOption("demo-driver2");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-report-detail]").length === 1,
    );
    await page
      .getByRole("button", { name: "View history", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Pickup details", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "Order history", exact: true })
      .waitFor();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export CSV (demo)", exact: true })
      .click();
    assert.ok((await download).suggestedFilename().endsWith(".csv"));
    await page.locator("#demoRole").selectOption("demo-driver2");
    await claimed()
      .getByRole("button", { name: "Record delivery", exact: true })
      .click();
    await page
      .locator("#proofForm input[name=name]")
      .fill("Scanned order receiver");
    for (const check of await page.locator("#proofItems input").all())
      await check.check();
    const secondCanvas = await page.locator("canvas").boundingBox();
    await page.mouse.move(secondCanvas.x + 15, secondCanvas.y + 55);
    await page.mouse.down();
    await page.mouse.move(secondCanvas.x + 110, secondCanvas.y + 45, {
      steps: 8,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: "Save proof", exact: true }).click();
    await page.locator("#proof").waitFor({ state: "hidden" });
    await page.locator("#demoRole").selectOption("demo-admin");
    await page.locator(".executiveDashboard").waitFor();
    await page.locator("[data-view=orders]").click();
    await page
      .getByRole("heading", { name: "Fleet control", exact: true })
      .waitFor();
    assert.ok(
      (await fleetRow().locator("td").nth(3).textContent()).includes(
        "0 in transit",
      ),
    );
    assert.equal(
      (await fleetRow().locator("td").nth(5).textContent()).trim(),
      "1",
    );
    // A removable item row and a successful create return the operator to the board.
    await page
      .getByRole("button", { name: "New order / Excel", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Remove item", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    assert.equal(await page.locator("#items .item").count(), 2);
    await page
      .getByRole("button", { name: "Remove item", exact: true })
      .last()
      .click();
    assert.equal(await page.locator("#items .item").count(), 1);
    await page
      .getByLabel("Your order reference", { exact: true })
      .fill("UX-TEST-ORDER");
    await page
      .getByLabel("Recipient name", { exact: true })
      .fill("Sample UI test");
    await page
      .getByLabel("Phone (+965 followed by 8 digits)", { exact: true })
      .fill("+96500000000");
    await page
      .getByLabel("Delivery address", { exact: true })
      .fill("Fictional Kuwait address");
    await page.locator("#items .name").fill("Sample parcel");
    await page
      .getByRole("button", { name: "Create order", exact: true })
      .click();
    await page.getByRole("heading", { name: "Order board" }).waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Order created successfully" })
      .waitFor();
    assert.ok(
      (
        await page.locator("#orderList > section").first().textContent()
      ).includes("UX-TEST-ORDER"),
    );
    for (const width of [360, 412, 768, 1440]) {
      await page.setViewportSize({ width, height: 915 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `No overflow at ${width}px`,
      );
    }
    await page.setViewportSize({ width: 412, height: 915 });
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
    // Polls update the fleet while preserving a focused order-search field.
    const pollingPage = await context.newPage();
    await pollingPage.clock.install();
    await pollingPage.goto(url + "/demo");
    await pollingPage.locator("[data-view=orders]").click();
    await pollingPage
      .getByRole("heading", { name: "Fleet control", exact: true })
      .waitFor();
    await pollingPage
      .getByRole("searchbox", { name: "Search orders" })
      .fill("SAMPLE-1004");
    await pollingPage.evaluate(async () => {
      const sample = (await relayDemo.request("state")).orders.find(
        (o) => o.awb === "DEMO-KW-1004",
      );
      await relayDemo.request("orders/" + sample.id + "/action", {
        action: "assign",
        driver: "demo-driver2",
      });
      await relayDemo.request("orders/" + sample.id + "/action", {
        action: "Out for delivery",
        verifiedItems: sample.items.map((i) => i.id),
      });
    });
    await pollingPage.clock.fastForward(30000);
    await pollingPage.waitForFunction(() =>
      [...document.querySelectorAll("#fleetTable tbody tr")].some(
        (row) =>
          row.textContent.includes("Sample Driver Two") &&
          row.querySelectorAll("td")[3].textContent.includes("1 in transit"),
      ),
    );
    assert.equal(
      await pollingPage
        .getByRole("searchbox", { name: "Search orders" })
        .inputValue(),
      "SAMPLE-1004",
    );
    await pollingPage
      .getByRole("heading", { name: "Order board", exact: true })
      .click();
    await pollingPage.clock.fastForward(30000);
    await pollingPage.waitForFunction(
      () =>
        document.querySelector(
          '#orderList section[data-id="demo-order-3"] .orderTop .badge',
        ).textContent === "Out for delivery",
    );
    await pollingPage.close();
    console.log(
      "Browser smoke passed: persistent light/dark/system themes, themes, responsive layouts, barcode image scanning, driver claims/trips, map workload counts, report history/export, foreground location controls and automatic dashboard refresh.",
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
