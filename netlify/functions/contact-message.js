// netlify/functions/contact-message.js
// Receives contact form submissions from Edu Pab sites, verifies the sender is
// human via Cloudflare Turnstile (same widget/key shared across sites),
// forwards the message to Telegram, and — if an email was provided — sends the
// sender a short thank-you email via Gmail SMTP.

const nodemailer = require("nodemailer");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

async function verifyTurnstile(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET_KEY_EDUPAB;
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
    if (!data.success) {
      // TEMP DEBUG: log Cloudflare's exact reason so we can see it in Netlify function logs
      console.error("Turnstile siteverify failed:", JSON.stringify(data));
    }
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return false;
  }
}

// Sends a short thank-you email to whoever filled in the form (best-effort —
// failure here should never block the Telegram notification going through).
async function sendThankYouEmail(toEmail, name) {
  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;
  if (!EMAIL_USER || !EMAIL_APP_PASSWORD || !toEmail) return;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `"Edu Pab" <${EMAIL_USER}>`,
      to: toEmail,
      subject: "ස්තූතියි! ඔබේ පණිවිඩය අප වෙත ලැබුණා — Edu Pab",
      text:
        `ආයුබෝවන් ${name || ""},\n\n` +
        `ඔබ Edu Pab වෙත එවූ පණිවිඩය අප වෙත ලැබී ඇත. ඉක්මනින්ම අප ඔබ වෙත ප්‍රතිචාර දක්වන්නෙමු.\n\n` +
        `ස්තූතියි,\nEdu Pab කණ්ඩායම`,
      html:
        `<p>ආයුබෝවන් ${name ? name : ""},</p>` +
        `<p>ඔබ <b>Edu Pab</b> වෙත එවූ පණිවිඩය අප වෙත ලැබී ඇත. ඉක්මනින්ම අප ඔබ වෙත ප්‍රතිචාර දක්වන්නෙමු.</p>` +
        `<p>ස්තූතියි,<br/>Edu Pab කණ්ඩායම</p>`
    });
  } catch (err) {
    console.error("Thank-you email failed:", err);
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
  const turnstileToken = (data.turnstileToken || "").toString();
  const remoteip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"];
  const isHuman = await verifyTurnstile(turnstileToken, remoteip);
  if (!isHuman) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Human verification failed" })
    };
  }

  const name = (data.name || "").toString().trim().slice(0, 200);
  const email = (data.email || "").toString().trim().slice(0, 200);
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
    `<b>Email:</b> ${escapeHtml(email || "-")}\n` +
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

    // Best-effort thank-you email — never blocks the response if it fails.
    if (email) {
      await sendThankYouEmail(email, name);
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
