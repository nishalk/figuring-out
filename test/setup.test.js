const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
test(
  "production setup requires a private key and retains accounts in configured storage",
  { timeout: 60000 },
  async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "relay-setup-"));
    const dataDir = path.join(cwd, "persistent");
    const key = crypto.randomBytes(32).toString("hex");
    const env = {
      ...process.env,
      NODE_ENV: "production",
      SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
      SETUP_KEY: key,
      DATA_DIR: dataDir,
      PORT: "0",
    };
    let child;
    async function start() {
      child = spawn(process.execPath, [path.resolve("server.js")], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return new Promise((resolve, reject) => {
        child.once("exit", () => reject(Error("Server exited")));
        child.stdout.on("data", (chunk) => {
          const m = chunk.toString().match(/Delivery app listening (\d+)/);
          if (m) resolve("http://127.0.0.1:" + m[1]);
        });
      });
    }
    async function stop() {
      if (child && child.exitCode === null) {
        const done = new Promise((r) => child.once("exit", r));
        child.kill();
        await done;
      }
    }
    try {
      let url = await start();
      const before = await fetch(url + "/api/setup").then((r) => r.json());
      assert.equal(before.keyRequired, true);
      const body = {
        name: "Administrator",
        email: "admin@example.test",
        password: "test-only-password-123",
      };
      async function setup(b) {
        return fetch(url + "/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(b),
        });
      }
      assert.equal((await setup(body)).status, 403);
      assert.equal((await setup({ ...body, setupKey: "wrong" })).status, 403);
      assert.equal(
        (await setup({ ...body, setupKey: key, password: 123 })).status,
        400,
      );
      assert.equal((await setup({ ...body, setupKey: key })).status, 200);
      assert.equal((await setup({ ...body, setupKey: key })).status, 409);
      assert.equal(
        (await fetch(url + "/").then((r) => r.text())).includes("Mawada"),
        true,
      );
      await stop();
      url = await start();
      assert.equal(
        (await fetch(url + "/api/setup").then((r) => r.json())).required,
        false,
      );
      assert.ok(fs.existsSync(path.join(dataDir, "app.db")));
      const exposed = await fetch(url + "/api/setup").then((r) => r.text());
      assert.equal(exposed.includes(key), false);
    } finally {
      await stop();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  },
);
