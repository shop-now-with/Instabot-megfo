
const encoder = new TextEncoder();

async function verifySignature(body, signature, appSecret) {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );

  const expected =
    "sha256=" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  if (signature.length !== expected.length) return false;

  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return difference === 0;
}

async function sendInstagramMessage(recipientId, text, env) {
  const response = await fetch(
    "https://graph.instagram.com/v23.0/me/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("Instagram send failed:", response.status, result);
    throw new Error(`Instagram API error (${response.status})`);
  }

  return result;
}

function getReply(messageText) {
  const command = messageText.trim().toLowerCase();

  if (command === "/about") {
    return "🤖 Welcome to instabot_megfo! Your Instagram assistant.";
  }

  if (command === "/contact") {
    return "📞 Contact Shopper's Suggestions on WhatsApp: https://wa.me/918606349917";
  }

  if (command === "/branches") {
    return "🏪 Our branches:\n\n🛍️ Shopper's Suggestions: https://shopperssuggestions.online\n\n🚀 Zilnet: Coming soon — Instagram @zilnet.future";
  }

  return "👋 Welcome! Try /about, /contact, or /branches.";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (
        mode === "subscribe" &&
        token &&
        env.VERIFY_TOKEN &&
        token === env.VERIFY_TOKEN &&
        challenge
      ) {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }

      return new Response("Webhook verification failed", {
        status: 403
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();

    const valid = await verifySignature(
      body,
      request.headers.get("X-Hub-Signature-256"),
      env.META_APP_SECRET
    );

    if (!valid) {
      return new Response("Invalid webhook signature", { status: 401 });
    }

    let payload;

    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.object !== "instagram") {
      return new Response("Unsupported webhook object", { status: 404 });
    }

    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (event.message?.is_echo) continue;

        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        if (!senderId || !messageText) continue;

        try {
          const reply = getReply(messageText);
          await sendInstagramMessage(senderId, reply, env);
        } catch (error) {
          console.error("Message processing failed:", error);
        }
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }
};
