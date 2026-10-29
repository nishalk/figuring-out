const session = require("express-session");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
class DurableSessions extends session.Store {
  constructor(dir) {
    super();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dir, "runtime.db"));
    fs.chmodSync(path.join(dir, "runtime.db"), 0o600);
    this.db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, body TEXT, expires INTEGER); CREATE TABLE IF NOT EXISTS limits (id TEXT PRIMARY KEY, count INTEGER, expires INTEGER)",
    );
  }
  get(id, cb) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      const r = this.db
        .prepare("SELECT body FROM sessions WHERE id=?")
        .get(hash(id));
      cb(null, r ? JSON.parse(r.body) : null);
    } catch (e) {
      cb(e);
    }
  }
  set(id, value, cb = () => {}) {
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO sessions VALUES (?,?,?)")
        .run(
          hash(id),
          JSON.stringify(value),
          Date.parse(value.cookie.expires) || Date.now() + 28800000,
        );
      cb();
    } catch (e) {
      cb(e);
    }
  }
  destroy(id, cb = () => {}) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE id=?").run(hash(id));
      cb();
    } catch (e) {
      cb(e);
    }
  }
  limiter(prefix, max, windowMs) {
    return (q, r, next) => {
      const at = Date.now();
      this.db.prepare("DELETE FROM limits WHERE expires<=?").run(at);
      const id = hash(prefix + ":" + q.ip);
      this.db
        .prepare(
          "INSERT INTO limits VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1",
        )
        .run(id, at + windowMs);
      const row = this.db
        .prepare("SELECT count,expires FROM limits WHERE id=?")
        .get(id);
      if (row.count > max)
        return r
          .set(
            "Retry-After",
            String(Math.max(1, Math.ceil((row.expires - at) / 1000))),
          )
          .status(429)
          .json({
            error: "Too many attempts. Please wait before trying again.",
          });
      next();
    };
  }
}
const validPassword = (value) =>
  typeof value === "string" &&
  value.length >= 12 &&
  Buffer.byteLength(value, "utf8") <= 72;
module.exports = { DurableSessions, hash, validPassword };
