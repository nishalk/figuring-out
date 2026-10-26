((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MawadaAccess = api;
})(globalThis, () => {
  const labels = {
    dashboard: "Dashboard and fleet/location monitoring",
    reports: "Reports and exports",
    create: "Create orders and upload Excel",
    vendors: "Manage vendor locations",
    work: "Assignments, scans, status changes and proof",
  };
  const defaults = {
    admin: Object.keys(labels),
    operations: Object.keys(labels),
    warehouse: ["work"],
    driver: ["work"],
  };
  const allowed = (user, key) =>
    Boolean(
      defaults[user?.role]?.includes(key) &&
      (user.role === "admin" ||
        !Array.isArray(user.permissions) ||
        user.permissions.includes(key)),
    );
  const validate = (role, permissions) =>
    Array.isArray(permissions) &&
    permissions.every(
      (p) => typeof p === "string" && defaults[role]?.includes(p),
    );
  return { labels, defaults, allowed, validate };
});
