
const API_VERSION = "v23.0";
const GRAPH_URL = `https://graph.instagram.com/${API_VERSION}/me/messages`;
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const CREATOR = "@faayahx";
const BRAND = "MEGFO";
const BRANCHES_URL = "https://shopperssuggestions.online";
const PRIVACY_URL = "https://shop-now-with.github.io/Instabot-megfo/privacy.html";

const SYSTEM_PROMPT = `
You are MEGFO's friendly chat assistant.
The creator and brand owner is @faayahx, who also owns the branches.
Use simple, natural English, short replies, and a few emojis when useful.
Avoid long replies and difficult words unless they are needed.
You can discuss MEGFO, its branches, everyday questions, ideas, and jokes.
Do not randomly mention AI providers or talk about your technical origin.
Never claim to be a human.
Do not invent branch addresses, opening hours, prices, or official policies.
If you do not know something, say so briefly.
Keep a friendly, respectful tone.
`;

const MAIN_MENU = [
  { title: "✨ AI CHAT", payload: "MENU_AI" },
  { title: "📍 BRANCHES", payload: "MENU_BRANCHES" },
  { title: "ℹ️ ABOUT", payload: "MENU_ABOUT" },
  { title: "❓ HELP", payload: "MENU_HELP" }
];

const AI_MENU = [
  { title: "🏠 MAIN MENU", payload: "MENU_HOME" },
  { title: "🛑 EXIT AI", payload: "AI_EXIT" }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function cleanText(value, max = 1500) {
  return String(value || "").trim().slice(0, max);
}

function getMessageText(event) {
  const message = event?.message;
  return cleanText(message?.text || message?.quick_reply?.payload || "");
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  return [...new Uint8Array(signature)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(request, body, secret) {
  const header = request.headers.get("x-hub-signature-256") || "";
  if (!secret || !header.startsWith("sha256=")) return false;

  const expected = await hmacHex(secret, body);
  const supplied = header.slice(7);

  if (expected.length !== supplied.length) return false;

  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(supplied);
  return crypto.subtle.timingSafeEqual
    ? crypto.subtle.timingSafeEqual(a, b)
    : expected === supplied;
}

async function sendMessage(env, recipientId, message) {
  if (!recipientId || !env.IG_ACCESS_TOKEN) {
    throw new Error("Missing recipient ID or IG_ACCESS_TOKEN");
  }

  const response = await fetch(`${GRAPH_URL}?access_token=${encodeURIComponent(env.IG_ACCESS_TOKEN)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipient: { id: String(recipientId) },
      message
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Instagram send failed", response.status, JSON.stringify(result));
    throw new Error(`Instagram send failed (${response.status})`);
  }
  return result;
}

async function sendText(env, id, text, quickReplies = []) {
  const message = { text: cleanText(text, 2000) };
  if (quickReplies.length) {
    message.quick_replies = quickReplies.slice(0, 13).map(item => ({
      content_type: "text",
      title: item.title.slice(0, 20),
      payload: item.payload.slice(0, 1000)
    }));
  }
  return sendMessage(env, id, message);
}

async function sendMenu(env, id) {
  return sendText(
    env,
    id,
    `Hey! 👋 Welcome to ${BRAND}.\nWhat would you like to do?`,
    MAIN_MENU
  );
}

async function ensureUser(env, id) {
  await env.DB.prepare(`
    INSERT INTO bot_users
      (igsid, first_seen, last_seen, message_count, is_admin,
       admin_pending, awaiting_feedback, chat_mode)
    VALUES (?, datetime('now'), datetime('now'), 0, 0, 0, 0, 0)
    ON CONFLICT(igsid) DO UPDATE SET
      last_seen = datetime('now')
  `).bind(String(id)).run();

  await env.DB.prepare(`
    UPDATE bot_users
    SET message_count = message_count + 1, last_seen = datetime('now')
    WHERE igsid = ?
  `).bind(String(id)).run();
}

async function getUser(env, id) {
  return env.DB.prepare(
    "SELECT * FROM bot_users WHERE igsid = ?"
  ).bind(String(id)).first();
}

async function setChatMode(env, id, enabled) {
  await env.DB.prepare(
    "UPDATE bot_users SET chat_mode = ? WHERE igsid = ?"
  ).bind(enabled ? 1 : 0, String(id)).run();
}

async function getAIReply(env, id, userText) {
  const history = await env.DB.prepare(`
    SELECT role, content
    FROM ai_messages
    WHERE igsid = ?
    ORDER BY id DESC
    LIMIT 10
  `).bind(String(id)).all();

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...[...(history.results || [])].reverse().map(row => ({
      role: row.role,
      content: row.content
    })),
    { role: "user", content: userText }
  ];

  const result = await env.AI.run(AI_MODEL, {
    messages,
    max_tokens: 220,
    temperature: 0.7
  });

  const answer = cleanText(result?.response || "Oops 😅 Try saying that another way.", 1800);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ai_messages (igsid, role, content, created_at) VALUES (?, 'user', ?, datetime('now'))"
    ).bind(String(id), userText),
    env.DB.prepare(
      "INSERT INTO ai_messages (igsid, role, content, created_at) VALUES (?, 'assistant', ?, datetime('now'))"
    ).bind(String(id), answer)
  ]);

  return answer;
}

async function saveFeedback(env, id, feedback) {
  await env.DB.prepare(`
    INSERT INTO bot_feedback (igsid, feedback, created_at)
    VALUES (?, ?, datetime('now'))
  `).bind(String(id), feedback).run();

  if (env.ADMIN_IGSID) {
    const notice = `📩 New MEGFO feedback\nSender ID: ${id}\nMessage: ${feedback}`;
    try {
      await sendText(env, env.ADMIN_IGSID, notice);
    } catch (error) {
      console.error("Could not forward feedback:", error.message);
    }
  }
}

async function handleAdminCommand(env, senderId, text, user) {
  const [rawCommand, ...parts] = text.trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const args = parts.join(" ").trim();

  if (command === "/admin") {
    if (!env.ADMIN_CODE) {
      await sendText(env, senderId, "Admin access isn't configured yet.");
      return true;
    }

    if (args !== env.ADMIN_CODE) {
      await sendText(env, senderId, "Usage: /admin YOUR_ADMIN_CODE");
      return true;
    }

    await env.DB.prepare(
      "UPDATE bot_users SET is_admin = 1 WHERE igsid = ?"
    ).bind(String(senderId)).run();

    await sendText(
      env, senderId,
      "🔐 Admin mode enabled.\n\n/broadcast your message\n/reply IGSID your message\n/stats\n/users\n/feedbacks\n/maintenance on|off\n/exitadmin"
    );
    return true;
  }

  if (!user?.is_admin) return false;

  if (command === "/exitadmin") {
    await sendText(env, senderId, "Admin commands are available again when you need them. 👋");
    return true;
  }

  if (command === "/broadcast") {
    if (!args) {
      await sendText(env, senderId, "Use: /broadcast Your message");
      return true;
    }

    const settings = await env.DB.prepare(
      "SELECT value FROM bot_settings WHERE key = 'maintenance'"
    ).first();

    const users = await env.DB.prepare(
      "SELECT igsid FROM bot_users WHERE igsid != ?"
    ).bind(String(senderId)).all();

    let sent = 0;
    let failed = 0;

    for (const target of (users.results || [])) {
      try {
        await sendText(env, target.igsid, `📢 ${args}`);
        sent++;
      } catch {
        failed++;
      }
    }

    await sendText(env, senderId, `Broadcast finished.\nSent: ${sent}\nFailed: ${failed}\n\nDelivery depends on Instagram messaging rules.`);
    return true;
  }

  if (command === "/reply") {
    const match = args.match(/^(\S+)\s+([\s\S]+)$/);
    if (!match) {
      await sendText(env, senderId, "Use: /reply IGSID Your message");
      return true;
    }

    try {
      await sendText(env, match[1], `💬 MEGFO support:\n${match[2]}`);
      await sendText(env, senderId, "Reply sent if Instagram allowed delivery. ✅");
    } catch {
      await sendText(env, senderId, "Couldn't deliver it. Check the recipient ID and Instagram's messaging window.");
    }
    return true;
  }

  if (command === "/stats") {
    const users = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM bot_users"
    ).first();
    const feedback = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM bot_feedback"
    ).first();
    await sendText(env, senderId, `📊 MEGFO stats\nUsers: ${users?.total || 0}\nFeedback entries: ${feedback?.total || 0}`);
    return true;
  }

  if (command === "/users") {
    const users = await env.DB.prepare(`
      SELECT igsid, message_count, last_seen
      FROM bot_users ORDER BY last_seen DESC LIMIT 20
    `).all();

    const lines = (users.results || []).map(
      (u, i) => `${i + 1}. ${u.igsid} — ${u.message_count} messages`
    );

    await sendText(env, senderId, lines.length ? lines.join("\n") : "No users yet.");
    return true;
  }

  if (command === "/feedbacks") {
    const rows = await env.DB.prepare(`
      SELECT igsid, feedback, created_at
      FROM bot_feedback ORDER BY id DESC LIMIT 10
    `).all();

    const lines = (rows.results || []).map(
      row => `ID: ${row.igsid}\n${row.feedback}\n${row.created_at}`
    );

    await sendText(env, senderId, lines.length ? lines.join("\n\n") : "No feedback yet.");
    return true;
  }

  if (command === "/maintenance") {
    const value = args.toLowerCase() === "on" ? "on" : "off";
    await env.DB.prepare(`
      INSERT INTO bot_settings (key, value) VALUES ('maintenance', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).bind(value).run();
    await sendText(env, senderId, `Maintenance mode: ${value}`);
    return true;
  }

  return false;
}

async function handleEvent(env, event) {
  const senderId = event?.sender?.id;
  if (!senderId || !event?.message) return;

  const text = getMessageText(event);
  if (!text) return;

  await ensureUser(env, senderId);
  const user = await getUser(env, senderId);

  if (await handleAdminCommand(env, senderId, text, user)) return;

  const maintenance = await env.DB.prepare(
    "SELECT value FROM bot_settings WHERE key = 'maintenance'"
  ).first();

  if (maintenance?.value === "on" && !user?.is_admin) {
    await sendText(env, senderId, "We're doing a quick update. Please try again soon. 🛠️");
    return;
  }

  const value = text.trim();
  const command = value.toLowerCase();

  if (command === "menu_home" || command === "/start" || command === "/menu" || command === "menu") {
    await setChatMode(env, senderId, false);
    await sendMenu(env, senderId);
    return;
  }

  if (command === "menu_ai" || command === "ai chat" || command === "/ai") {
    await setChatMode(env, senderId, true);
    await sendText(env, senderId, "AI chat is on! 💬 Ask me anything. Tap below whenever you want to leave.", AI_MENU);
    return;
  }

  if (command === "ai_exit" || command === "/exit" || command === "exit ai") {
    await setChatMode(env, senderId, false);
    await sendMenu(env, senderId);
    return;
  }

  if (command === "menu_branches" || command === "/branches" || command === "branches") {
    await sendText(env, senderId, `📍 Branch information\nCheck the official site for current details:\n${BRANCHES_URL}`, [
      { title: "🏠 MAIN MENU", payload: "MENU_HOME" },
      { title: "💬 AI CHAT", payload: "MENU_AI" }
    ]);
    return;
  }

  if (command === "menu_about" || command === "/about" || command === "about") {
    await sendText(env, senderId, `✨ ${BRAND}\nA brand created and owned by ${CREATOR}.\nWant to ask something?`, [
      { title: "💬 AI CHAT", payload: "MENU_AI" },
      { title: "🏠 MAIN MENU", payload: "MENU_HOME" }
    ]);
    return;
  }

  if (command === "menu_help" || command === "/help" || command === "/commands" || command === "help") {
    await sendText(env, senderId,
      "📚 Commands\n/start — Main menu\n/menu — Main menu\n/ai — Start AI chat\n/exit — Leave AI chat\n/branches — Branch info\n/about — About MEGFO\n/help — Show commands\n/feedback Your message — Send feedback\n/privacy — Privacy policy",
      [
        { title: "💬 AI CHAT", payload: "MENU_AI" },
        { title: "🏠 MAIN MENU", payload: "MENU_HOME" }
      ]
    );
    return;
  }

  if (command === "/privacy") {
    await sendText(env, senderId, `🔒 Privacy policy:\n${PRIVACY_URL}`);
    return;
  }

  if (command.startsWith("/feedback")) {
    const feedback = value.slice("/feedback".length).trim();
    if (!feedback) {
      await sendText(env, senderId, "Use: /feedback Your message");
      return;
    }
    await saveFeedback(env, senderId, feedback);
    await sendText(env, senderId, "Thanks! Your feedback has been sent. 💛");
    return;
  }

  if (command === "/ping") {
    await sendText(env, senderId, "Pong! 🏓");
    return;
  }

  if (command === "/clear") {
    await env.DB.prepare("DELETE FROM ai_messages WHERE igsid = ?")
      .bind(String(senderId)).run();
    await sendText(env, senderId, "Chat memory cleared. 🧹");
    return;
  }

  if (user?.chat_mode === 1) {
    try {
      const answer = await getAIReply(env, senderId, value);
      await sendText(env, senderId, answer, AI_MENU);
    } catch (error) {
      console.error("AI reply failed:", error.message);
      await sendText(env, senderId, "Oops 😅 AI chat is having trouble right now. Try again in a moment.", AI_MENU);
    }
    return;
  }

  await sendMenu(env, senderId);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === env.VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      const rawBody = await request.text();

      if (!(await verifySignature(request, rawBody, env.META_APP_SECRET))) {
        return new Response("Invalid signature", { status: 401 });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      // Acknowledge the webhook promptly. Process events in the same request
      // to avoid requiring an additional queue binding.
      try {
        const entries = payload.entry || [];
        for (const entry of entries) {
          for (const event of (entry.messaging || [])) {
            await handleEvent(env, event);
          }
        }
      } catch (error) {
        console.error("Webhook processing error:", error.message);
      }

      return json({ ok: true });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "MEGFO" });
    }

    return new Response("Not found", { status: 404 });
  }
};
