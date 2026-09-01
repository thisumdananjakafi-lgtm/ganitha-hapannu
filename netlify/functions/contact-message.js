// netlify/functions/contact-message.js
// Receives contact form submissions from the site and forwards them to Telegram.

exports.handler = async function (event) {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server not configured" })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON" })
    };
  }

  const name = (data.name || "").toString().trim().slice(0, 200);
  const message = (data.message || "").toString().trim().slice(0, 2000);
  const time = (data.time || new Date().toISOString()).toString();

  if (!name || !message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing name or message" })
    };
  }

  // Escape basic HTML special chars for Telegram HTML parse mode
  const escapeHtml = (str) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const text =
    `📩 <b>Ganitha Hapannu — New Contact Message</b>\n\n` +
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
        body: JSON.stringify({ error: "Failed to send Telegram message" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error("Error sending to Telegram:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
