const express = require("express");
const path = require("node:path");
const app = express();
let application;
let startup = {
  code: "STARTING",
  message: "The application is starting. Try again shortly.",
};
app.use(
  "/assets/leaflet",
  express.static(
    path.join(path.dirname(require.resolve("leaflet/package.json")), "dist"),
    { maxAge: "1h" },
  ),
);
app.get("/assets/zxing.js", (_, res) =>
  res.sendFile(require.resolve("@zxing/library/umd/index.min.js")),
);
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.get(["/track", "/reset"], (_, res) =>
  res.sendFile(path.join(__dirname, "public/customer.html")),
);
app.get("/driver", (_, res) =>
  res.sendFile(path.join(__dirname, "public/index.html")),
);
app.get("/demo", (_, res) =>
  res.sendFile(path.join(__dirname, "public/index.html")),
);
app.get("/demo/barcode/:awb", async (req, res) => {
  if (!/^DEMO-KW-[A-Z0-9-]{1,20}$/.test(req.params.awb))
    return res.sendStatus(400);
  try {
    const buffer = await require("bwip-js").toBuffer({
      bcid: "code128",
      text: req.params.awb,
      scale: 3,
      height: 14,
      includetext: true,
    });
    res.type("png").send(buffer);
  } catch {
    res.sendStatus(500);
  }
});
app.get("/health/live", (_, res) => res.json({ alive: true }));
app.get("/health/ready", (_, res) =>
  res.status(application ? 200 : 503).json({ ready: Boolean(application) }),
);
app.use((req, res, next) => {
  if (application) return application(req, res, next);
  if (req.path.startsWith("/api/"))
    return res.status(503).json({ error: startup.message, code: startup.code });
  if (req.path === "/")
    return res.sendFile(path.join(__dirname, "public/index.html"));
  next();
});
app.use((error, req, res, next) =>
  res.status(500).json({ error: "The request could not be completed." }),
);
const listener = app.listen(process.env.PORT || 3000, "0.0.0.0", () =>
  console.log("Delivery app listening " + listener.address().port),
);
(async () => {
  try {
    application = await require("./application").createApplication();
    console.log("Delivery application ready");
  } catch (error) {
    if (error.message.includes("SESSION_SECRET"))
      startup = {
        code: "SESSION_SECRET_REQUIRED",
        message:
          "The app administrator must configure SESSION_SECRET in hosting settings (32 or more random characters).",
      };
    else if (error.message.includes("SETUP_KEY"))
      startup = {
        code: "SETUP_KEY_REQUIRED",
        message:
          "The app administrator must configure SETUP_KEY in hosting settings before creating the first account.",
      };
    else if (error.message.includes("Supabase requires"))
      startup = {
        code: "SUPABASE_CREDENTIALS_REQUIRED",
        message:
          "The app administrator must configure SUPABASE_URL and a server-only Supabase service-role or secret key in hosting settings.",
      };
    else if (
      error.message.includes("Supabase") ||
      error.message.includes("fetch failed")
    )
      startup = {
        code: "SUPABASE_UNAVAILABLE",
        message:
          "The cloud database could not be reached. The app administrator must check the database table, project status and server credentials.",
      };
    else
      startup = {
        code: "APPLICATION_STARTUP_FAILED",
        message:
          "The application could not initialize. The administrator should check Hostinger runtime logs.",
      };
    console.error(
      "Application startup failed [" + startup.code + "]: " + error.message,
    );
  }
})();
