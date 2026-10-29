const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");
function verify(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("SQLite integrity check failed");
    const rows = db.prepare("SELECT kind,id,body FROM records").all();
    for (const row of rows)
      if (JSON.parse(row.body).id !== row.id)
        throw Error("Invalid record in backup");
    return {
      records: rows.length,
      users: rows.filter((r) => r.kind === "users").length,
      orders: rows.filter((r) => r.kind === "orders").length,
    };
  } finally {
    db.close();
  }
}
async function createBackup(env = process.env) {
  if (env.DATABASE_BACKEND && env.DATABASE_BACKEND !== "sqlite")
    throw Error(
      "Use the database provider’s backup and restore workflow for remote storage; this command backs up SQLite only",
    );
  const dataDir = env.DATA_DIR || path.resolve("data"),
    dir = env.BACKUP_DIR || path.join(dataDir, "backups");
  if (!path.isAbsolute(dataDir) || !path.isAbsolute(dir))
    throw Error("DATA_DIR and BACKUP_DIR must be absolute");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"),
    name =
      "mawada-" + stamp + "-" + crypto.randomBytes(4).toString("hex") + ".db",
    filename = path.join(dir, name),
    partial = filename + ".partial";
  const source = new DatabaseSync(path.join(dataDir, "app.db"), {
    readOnly: true,
  });
  try {
    await backup(source, partial);
    fs.chmodSync(partial, 0o600);
    const counts = verify(partial);
    // Rehearse a restore into an isolated directory; never overwrite operational data.
    const rehearsal = fs.mkdtempSync(path.join(dir, ".restore-check-"));
    try {
      fs.copyFileSync(partial, path.join(rehearsal, "app.db"));
      verify(path.join(rehearsal, "app.db"));
    } finally {
      fs.rmSync(rehearsal, { recursive: true, force: true });
    }
    fs.renameSync(partial, filename);
    const sha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filename))
      .digest("hex");
    const result = {
      verifiedAt: new Date().toISOString(),
      filename: name,
      sha256,
      ...counts,
      offHostVerified: false,
    };
    fs.writeFileSync(filename + ".json", JSON.stringify(result, null, 2), {
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(dataDir, "backup-status.json"),
      JSON.stringify(result),
      { mode: 0o600 },
    );
    const keep = Math.max(2, Math.min(90, Number(env.BACKUP_KEEP) || 7));
    const old = fs
      .readdirSync(dir)
      .filter((n) => /^mawada-.*\.db$/.test(n))
      .sort()
      .reverse()
      .slice(keep);
    for (const name of old) {
      fs.unlinkSync(path.join(dir, name));
      fs.rmSync(path.join(dir, name + ".json"), { force: true });
    }
    return result;
  } finally {
    source.close();
    fs.rmSync(partial, { force: true });
  }
}
function restore(filename, destination) {
  if (!filename || !destination || !path.isAbsolute(destination))
    throw Error("Use restore BACKUP_FILE ABSOLUTE_NEW_DATA_DIR");
  const manifest = JSON.parse(fs.readFileSync(filename + ".json", "utf8"));
  const sha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
  if (sha !== manifest.sha256) throw Error("Backup checksum mismatch");
  const counts = verify(filename);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length)
    throw Error(
      "Restore destination must be empty; existing operational files are never overwritten",
    );
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  fs.copyFileSync(
    filename,
    path.join(destination, "app.db"),
    fs.constants.COPYFILE_EXCL,
  );
  fs.chmodSync(path.join(destination, "app.db"), 0o600);
  return counts;
}
function schedule(env = process.env) {
  if (
    env.NODE_ENV !== "production" ||
    env.AUTO_BACKUP === "false" ||
    (env.DATABASE_BACKEND && env.DATABASE_BACKEND !== "sqlite")
  )
    return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await createBackup(env);
      console.log("Local SQLite backup verified; off-host copy still required");
    } catch {
      console.error(
        "Automatic local SQLite backup failed; inspect persistent storage and backup directory",
      );
    } finally {
      running = false;
    }
  };
  const interval =
    Math.max(1, Math.min(168, Number(env.BACKUP_INTERVAL_HOURS) || 24)) *
    3600000;
  run();
  setInterval(run, interval).unref();
}
if (require.main === module) {
  const [command, filename, destination] = process.argv.slice(2);
  Promise.resolve()
    .then(() =>
      command === "restore"
        ? restore(filename, destination)
        : command === "verify"
          ? verify(filename)
          : !command || command === "backup"
            ? createBackup()
            : Promise.reject(
                Error(
                  "Use backup, verify FILE, or restore FILE ABSOLUTE_NEW_DATA_DIR",
                ),
              ),
    )
    .then((result) => console.log(JSON.stringify(result)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
module.exports = { createBackup, verify, restore, schedule };
