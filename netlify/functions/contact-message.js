// netlify/functions/contact-message.js
// Receives contact form submissions from any Edu Pab site, verifies the sender is
// human via Cloudflare Turnstile (each site can use its own Turnstile widget),
// then forwards the message to Telegram.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// Map a "site" identifier (sent by the frontend) to the matching Turnstile secret key.
// Currently only the Edu Pab (Grade 5 Scholarship) site uses this check.
function getSecretForSite(site) {
  const secrets = {
    edupab: process.env.TURNSTILE_SECRET_KEY_EDUPAB
  };
  return secrets[site];
}

async function verifyTurnstile(token, remoteip, site) {
  const secret = getSecretForSite(site);
  if (!secret || !token) return false;

  const body = new URLSearchParams();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteip) body.append("remoteip", remoteip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return false;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Server not configured" })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" })
    };
  }

  // ---- Human verification (Cloudflare Turnstile) ----
  // Only the Edu Pab (Grade 5 Scholarship) site requires this check for now.
  // Ganitha Hapannu's own contact form sends no "site" field, so it's skipped here.
  const site = (data.site || "ganithahapannu").toString();
  if (site === "edupab") {
    const turnstileToken = (data.turnstileToken || "").toString();
    const remoteip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"];
    const isHuman = await verifyTurnstile(turnstileToken, remoteip, site);
    if (!isHuman) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Human verification failed" })
      };
    }
  }

  const name = (data.name || "").toString().trim().slice(0, 200);
  const message = (data.message || "").toString().trim().slice(0, 2000);
  const time = (data.time || new Date().toISOString()).toString();
  const source = (data.source || "Ganitha Hapannu").toString().trim().slice(0, 120);

  if (!name || !message) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Missing name or message" })
    };
  }

  const escapeHtml = (str) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const text =
    `📩 <b>Edu Pab — New Contact Message</b>\n` +
    `<b>From:</b> ${escapeHtml(source)}\n\n` +
    `<b>Name:</b> ${escapeHtml(name)}\n` +
    `<b>Time:</b> ${escapeHtml(time)}\n\n` +
    `<b>Message:</b>\n${escapeHtml(message)}`;

  try {
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML"
      })
    });

    const result = await res.json();

    if (!res.ok || !result.ok) {
      console.error("Telegram API error:", result);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Failed to send Telegram message" })
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error("Error sending to Telegram:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
