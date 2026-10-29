const crypto = require("node:crypto");
const { hash } = require("./reliability");
const labels = {
  assign: "Delivery driver assigned",
  "Out for delivery": "Out for delivery",
  fail: "Delivery attempt unsuccessful",
  Delivered: "Delivered",
  reschedule: "Delivery rescheduled",
};
function origin(env = process.env) {
  try {
    const u = new URL(env.PUBLIC_APP_URL);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash
      ? u.origin
      : null;
  } catch {
    return null;
  }
}
function trackingLink(order) {
  const base = origin();
  if (!base)
    throw Error("Configure PUBLIC_APP_URL as the HTTPS app origin first.");
  const token = crypto.randomBytes(32).toString("base64url"),
    expires = Date.now() + 7 * 86400000;
  order.trackingTokens = [
    ...(order.trackingTokens || []).filter((t) => t.expires > Date.now()),
    { hash: hash(token), expires },
  ].slice(-30);
  return {
    url: base + "/track#" + token,
    expires: new Date(expires).toISOString(),
  };
}
function queueUpdate(order, event, actor) {
  if (!labels[event] || order.demoData || !order.whatsappConsent || !origin())
    return;
  const tracking = trackingLink(order);
  order.customerUpdates = [
    ...(order.customerUpdates || []),
    {
      id: crypto.randomUUID(),
      event,
      label: labels[event],
      status: "Queued",
      at: new Date().toISOString(),
      actor,
      orderStatus: order.status,
      phone: order.phone,
      text: `Mawada ${order.awb}: ${labels[event]}. ${tracking.url}`,
      trackingUrl: tracking.url,
      expires: tracking.expires,
    },
  ].slice(-100);
}
function whatsappConfigured() {
  return Boolean(
    origin() &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    /^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID || "") &&
    /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION || "") &&
    /^[a-z0-9_]+$/.test(process.env.WHATSAPP_TEMPLATE || ""),
  );
}
async function sendWhatsApp(order, update) {
  if (order.demoData || !order.whatsappConsent || update.phone !== order.phone)
    throw Error("Customer consent and matching phone are required.");
  if (!/^\+965\d{8}$/.test(order.phone))
    throw Error("Valid Kuwait phone required.");
  const env = process.env;
  if (
    !env.WHATSAPP_ACCESS_TOKEN ||
    !/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID || "") ||
    !/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION || "") ||
    !env.WHATSAPP_TEMPLATE
  )
    throw Error(
      "Configure the WhatsApp Business token, phone number ID, Graph version and approved template first.",
    );
  const response = await fetch(
    `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: order.phone.slice(1),
        type: "template",
        template: {
          name: env.WHATSAPP_TEMPLATE,
          language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
          components: [
            {
              type: "body",
              parameters: [order.awb, update.label, update.trackingUrl].map(
                (text) => ({ type: "text", text }),
              ),
            },
          ],
        },
      }),
    },
  );
  if (!response.ok)
    throw Error(
      "WhatsApp provider did not accept the request. Check provider logs before retrying.",
    );
  const body = await response.json();
  if (!body.messages?.[0]?.id)
    throw Error(
      "WhatsApp acceptance could not be confirmed. Check provider logs.",
    );
  return body.messages[0].id;
}
async function sendRecovery(email, token) {
  const base = origin();
  if (
    !base ||
    !process.env.RECOVERY_EMAIL_API_KEY ||
    !process.env.RECOVERY_EMAIL_FROM
  )
    throw Error("Email recovery is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: "Bearer " + process.env.RECOVERY_EMAIL_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RECOVERY_EMAIL_FROM,
      to: [email],
      subject: "Reset your Mawada password",
      text: `Use this one-time link within 30 minutes to reset your Mawada password:\n${base}/reset#${token}\nIf you did not request this, ignore this email.`,
    }),
  });
  if (!response.ok) throw Error("Recovery email was not accepted");
}
module.exports = {
  origin,
  trackingLink,
  queueUpdate,
  sendWhatsApp,
  sendRecovery,
  whatsappConfigured,
};
