(async () => {
  const root = document.querySelector("#customer"),
    token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const call = async (url, body) => {
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit",
      cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error || "Request failed");
    return j;
  };
  const message = (value) => {
    const p = document.createElement("p");
    p.textContent = value;
    root.append(p);
  };
  root.innerHTML = "<h1>Mawada</h1>";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    message(
      "This link is invalid or incomplete. Reopen the original link, or contact Mawada for help.",
    );
    return;
  }
  if (location.pathname === "/reset") {
    root.insertAdjacentHTML(
      "beforeend",
      '<h2>Choose a new password</h2><form><label>New password<input type="password" name="password" required minlength="12" maxlength="72" autocomplete="new-password"></label><label>Confirm password<input type="password" name="confirm" required minlength="12" maxlength="72" autocomplete="new-password"></label><button>Reset password</button><p role="status"></p></form>',
    );
    root.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target,
        button = f.querySelector("button"),
        status = f.querySelector("p");
      button.disabled = true;
      try {
        if (f.elements.password.value !== f.elements.confirm.value)
          throw Error("Passwords do not match");
        await call("/api/recovery/reset", {
          token,
          password: f.elements.password.value,
        });
        root.innerHTML =
          '<h1>Password reset</h1><p>Existing sessions have been revoked.</p><a href="/">Sign in to Mawada</a>';
      } catch (e) {
        status.textContent = e.message;
        button.disabled = false;
      }
    };
    return;
  }
  try {
    const p = await call("/api/tracking/" + encodeURIComponent(token));
    message(p.awb);
    const h = document.createElement("h2");
    h.textContent = p.status;
    root.append(h);
    message("Delivery date: " + (p.deliveryDate || "Being arranged"));
    message("Delivery window (Kuwait): " + (p.timeSlot || "Being arranged"));
    if (p.updatedAt)
      message(
        "Last updated: " +
          new Date(p.updatedAt).toLocaleString("en-GB", {
            timeZone: "Asia/Kuwait",
          }),
      );
    message(
      "Contact Mawada if you need to change delivery arrangements. This page does not show a live driver location.",
    );
  } catch (e) {
    message(e.message);
  }
})();
