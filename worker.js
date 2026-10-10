
const API_VERSION = "v23.0";

const LINKS = {
  shop: "https://shopperssuggestions.online",
  contact: "https://wa.me/918606349917",
  zilnet: "https://www.instagram.com/zilnet.future/",
  privacy: "https://shop-now-with.github.io/Instabot-megfo/privacy.html"
};

const CREATOR = "@faayahx";
const enc = new TextEncoder();
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const SYSTEM_PROMPT = `
You are the friendly MEGFO chat assistant.
The creator and brand owner is @faayahx, who owns the branches.
Use simple, natural English and short replies.
Use a few emojis when they fit.
Avoid difficult words and long answers unless needed.
You can answer general questions, chat casually, tell jokes,
and answer questions about MEGFO and its branches.
Never invent branch addresses, hours, prices, or policies.
Do not randomly discuss your technical origin or AI provider.
Never claim to be a human.
If you don't know, say so briefly.
`;

async function verifySignature(body, signature, secret) {
  if (!secret || !signature?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(body)
  );

  const expected = "sha256=" +
    Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

  if (signature.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function send(recipientId, message, env) {
  const response = await fetch(
    `https://graph.instagram.com/${API_VERSION}/me/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: String(recipientId) },
        message
      })
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Instagram API error:", response.status, result);
    throw new Error(`Instagram API returned ${response.status}`);
  }

  return result;
}

async function say(id, text, env) {
  return send(id, { text: String(text).slice(0, 2000) }, env);
}

// Four menu choices use quick replies instead of a three-button template.
async function quickMenu(id, text, items, env) {
  return send(id, {
    text: String(text).slice(0, 2000),
    quick_replies: items.slice(0, 13).map(item => ({
      content_type: "text",
      title: item.title.slice(0, 20),
      payload: item.payload
    }))
  }, env);
}

// Keep URL/postback button templates for menus with up to three buttons.
async function buttons(id, text, items, env) {
  return send(id, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, 640),
        buttons: items.slice(0, 3).map(item =>
          item.url
            ? {
                type: "web_url",
                url: item.url,
                title: item.title.slice(0, 20)
              }
            : {
                type: "postback",
                title: item.title.slice(0, 20),
                payload: item.payload
              }
        )
      }
    }
  }, env);
}

async function mainMenu(id, env) {
  const welcome = await env.DB.prepare(
    "SELECT value FROM bot_settings WHERE key = 'welcome'"
  ).first();

  return quickMenu(
    id,
    welcome?.value || "👋 Hey! Welcome to MEGFO. What would you like to do?",
    [
      { title: "✨ AI CHAT", payload: "MENU_AI" },
      { title: "📍 BRANCHES", payload: "MENU_BRANCHES" },
      { title: "ℹ️ ABOUT", payload: "MENU_ABOUT" },
      { title: "❓ HELP", payload: "MENU_HELP" }
    ],
    env
  );
}

async function aiMenu(id, env, message) {
  return quickMenu(id, message, [
    { title: "🏠 MAIN MENU", payload: "MENU_HOME" },
    { title: "🛑 EXIT AI", payload: "AI_EXIT" }
  ], env);
}

async function branchesMenu(id, env) {
  return buttons(id, "📍 Explore our projects and branches.", [
    { title: "Shop Website", url: LINKS.shop },
    { title: "Zilnet Instagram", url: LINKS.zilnet },
    { title: "Contact Us", url: LINKS.contact }
  ], env);
}

async function aboutMenu(id, env) {
  return buttons(
    id,
    `✨ MEGFO\nCreated and owned by ${CREATOR}.`,
    [
      { title: "AI Chat", payload: "MENU_AI" },
      { title: "Shop Website", url: LINKS.shop },
      { title: "Main Menu", payload: "MENU_HOME" }
    ],
    env
  );
}

async function contactMenu(id, env) {
  return buttons(id, "Choose how you'd like to connect.", [
    { title: "WhatsApp", url: LINKS.contact },
    { title: "Shop Website", url: LINKS.shop },
    { title: "Main Menu", payload: "MENU_HOME" }
  ], env);
}

async function helpMenu(id, env) {
  return quickMenu(
    id,
    "📚 COMMANDS\n\n" +
    "/start — Main menu\n" +
    "/menu — Main menu\n" +
    "/ai — Start AI chat\n" +
    "/exit — Leave AI chat\n" +
    "/branches — Branch information\n" +
    "/about — About MEGFO\n" +
    "/contact — Contact options\n" +
    "/shop — Shop website\n" +
    "/zilnet — Zilnet link\n" +
    "/privacy — Privacy policy\n" +
    "/feedback — Send feedback\n" +
    "/ping — Test replies\n" +
    "/status — Service status\n" +
    "/clear — Clear AI conversation history",
    [
      { title: "✨ AI CHAT", payload: "MENU_AI" },
      { title: "📍 BRANCHES", payload: "MENU_BRANCHES" },
      { title: "🏠 MAIN MENU", payload: "MENU_HOME" }
    ],
    env
  );
}

async function recordUser(id, env) {
  await env.DB.prepare(`
    INSERT INTO bot_users
      (igsid, first_seen, last_seen, message_count)
    VALUES (?, datetime('now'), datetime('now'), 1)
    ON CONFLICT(igsid) DO UPDATE SET
      last_seen = datetime('now'),
      message_count = message_count + 1
  `).bind(String(id)).run();
}

async function getUser(id, env) {
  return env.DB.prepare(
    "SELECT * FROM bot_users WHERE igsid = ?"
  ).bind(String(id)).first();
}

async function isAdmin(id, env) {
  const row = await env.DB.prepare(
    "SELECT is_admin FROM bot_users WHERE igsid = ?"
  ).bind(String(id)).first();

  return Number(row?.is_admin || 0) === 1;
}

async function setChatMode(id, enabled, env) {
  await env.DB.prepare(
    "UPDATE bot_users SET chat_mode = ? WHERE igsid = ?"
  ).bind(enabled ? 1 : 0, String(id)).run();
}

async function getAIReply(id, userText, env) {
  const rows = await env.DB.prepare(`
    SELECT role, content FROM ai_messages
    WHERE igsid = ?
    ORDER BY id DESC LIMIT 10
  `).bind(String(id)).all();

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(rows.results || []).reverse().map(row => ({
      role: row.role,
      content: row.content
    })),
    { role: "user", content: userText.slice(0, 1500) }
  ];

  const result = await env.AI.run(AI_MODEL, {
    messages,
    max_tokens: 220,
    temperature: 0.7
  });

  const answer = String(
    result?.response || "Oops 😅 I couldn't answer that. Try again!"
  ).slice(0, 1800);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO ai_messages (igsid, role, content, created_at)
      VALUES (?, 'user', ?, datetime('now'))
    `).bind(String(id), userText.slice(0, 1500)),
    env.DB.prepare(`
      INSERT INTO ai_messages (igsid, role, content, created_at)
      VALUES (?, 'assistant', ?, datetime('now'))
    `).bind(String(id), answer)
  ]);

  return answer;
}

async function saveFeedback(id, feedback, env) {
  await env.DB.prepare(`
    INSERT INTO bot_feedback (igsid, feedback, created_at)
    VALUES (?, ?, datetime('now'))
  `).bind(String(id), feedback.slice(0, 1500)).run();

  // Optional forwarding to your own Instagram-scoped ID.
  if (env.ADMIN_IGSID) {
    try {
      await say(
        env.ADMIN_IGSID,
        `📩 NEW MEGFO FEEDBACK\nSender ID: ${id}\nMessage: ${feedback.slice(0, 1200)}`,
        env
      );
    } catch (error) {
      console.error("Feedback forwarding failed:", error.message);
    }
  }
}

async function adminStats(id, env) {
  const stats = await env.DB.prepare(`
    SELECT COUNT(*) AS users,
      COALESCE(SUM(message_count), 0) AS messages,
      COALESCE(SUM(is_admin), 0) AS admins
    FROM bot_users
  `).first();

  return say(
    id,
    `📊 MEGFO STATISTICS\n\n` +
    `👥 Users: ${stats?.users || 0}\n` +
    `💬 Events counted: ${stats?.messages || 0}\n` +
    `🔐 Admins: ${stats?.admins || 0}`,
    env
  );
}

async function showFeedback(id, env) {
  const rows = await env.DB.prepare(`
    SELECT igsid, feedback, created_at
    FROM bot_feedback ORDER BY id DESC LIMIT 8
  `).all();

  if (!rows.results?.length) {
    return say(id, "No feedback has been submitted yet.", env);
  }

  const output = rows.results.map((row, i) =>
    `${i + 1}. Sender ID: ${row.igsid}\n${row.feedback}\n${row.created_at}`
  ).join("\n\n");

  return say(id, "📝 RECENT FEEDBACK\n\n" + output.slice(0, 1800), env);
}

async function handleAdmin(id, text, env, user) {
  const lower = text.toLowerCase();

  // Start the secure-code flow; the next message is checked separately.
  if (lower === "/admin" || lower === "admin") {
    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 1 WHERE igsid = ?"
    ).bind(String(id)).run();

    return say(id, "🔐 Send your admin code in your next message.", env);
  }

  if (!Number(user?.is_admin || 0)) return false;

  if (lower === "/adminhelp" || lower === "admin_help" || lower === "admin help") {
    return say(
      id,
      "🔐 ADMIN COMMANDS\n\n" +
      "/stats — Statistics\n" +
      "/feedbacks — Recent feedback\n" +
      "/users — Recent users\n" +
      "/broadcast Your message — Message known users\n" +
      "/reply IGSID Your message — Reply to one user\n" +
      "/setwelcome Your text — Change welcome\n" +
      "/maintenance on|off — Toggle maintenance\n" +
      "/exitadmin — Remove admin access",
      env
    );
  }

  if (lower === "/stats" || lower === "stats") {
    return adminStats(id, env);
  }

  if (lower === "/feedbacks" || lower === "feedbacks") {
    return showFeedback(id, env);
  }

  if (lower === "/users" || lower === "users") {
    const rows = await env.DB.prepare(`
      SELECT igsid, message_count, last_seen
      FROM bot_users ORDER BY last_seen DESC LIMIT 15
    `).all();

    const output = (rows.results || []).map((row, i) =>
      `${i + 1}. ${row.igsid}\nMessages: ${row.message_count}\nLast seen: ${row.last_seen}`
    ).join("\n\n");

    return say(id, output ? output.slice(0, 1800) : "No users recorded yet.", env);
  }

  if (lower.startsWith("/broadcast ")) {
    const message = text.slice("/broadcast ".length).trim();
    if (!message) return say(id, "Use: /broadcast Your message", env);

    const users = await env.DB.prepare(
      "SELECT igsid FROM bot_users WHERE igsid != ?"
    ).bind(String(id)).all();

    let sent = 0;
    let failed = 0;

    for (const row of users.results || []) {
      try {
        await say(row.igsid, `📢 MEGFO UPDATE\n\n${message}`, env);
        sent++;
      } catch (error) {
        failed++;
        console.error("Broadcast failed for recipient:", row.igsid, error.message);
      }
    }

    return say(
      id,
      `📢 Broadcast attempt finished.\nSent: ${sent}\nFailed: ${failed}\n\nInstagram messaging rules still apply.`,
      env
    );
  }

  if (lower.startsWith("/reply ")) {
    const match = text.slice(7).trim().match(/^(\S+)\s+([\s\S]+)$/);

    if (!match) {
      return say(id, "Use: /reply IGSID Your message", env);
    }

    try {
      await say(match[1], `💬 MEGFO SUPPORT\n\n${match[2]}`, env);
      return say(id, "Reply accepted by Instagram. ✅", env);
    } catch {
      return say(id, "Couldn't send that reply. Check the recipient ID and Instagram messaging rules.", env);
    }
  }

  if (lower.startsWith("/setwelcome ")) {
    const welcome = text.slice("/setwelcome ".length).trim();

    await env.DB.prepare(`
      INSERT INTO bot_settings (key, value) VALUES ('welcome', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).bind(welcome.slice(0, 640)).run();

    return say(id, "✅ Welcome message updated.", env);
  }

  if (lower === "/maintenance on" || lower === "/maintenance off") {
    const value = lower.endsWith("on") ? "on" : "off";

    await env.DB.prepare(`
      INSERT INTO bot_settings (key, value) VALUES ('maintenance', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).bind(value).run();

    return say(id, `Maintenance mode: ${value.toUpperCase()}`, env);
  }

  if (lower === "/exitadmin") {
    await env.DB.prepare(
      "UPDATE bot_users SET is_admin = 0 WHERE igsid = ?"
    ).bind(String(id)).run();

    return say(id, "Admin access removed from this account.", env);
  }

  if (lower === "admin" || lower === "/admin") {
    return buttons(id, "🔐 ADMIN PANEL", [
      { title: "Statistics", payload: "ADMIN_STATS" },
      { title: "Feedback", payload: "ADMIN_FEEDBACK" },
      { title: "Admin Help", payload: "ADMIN_HELP" }
    ], env);
  }

  return false;
}

async function processEvent(event, env) {
  if (event.message?.is_echo) return;

  const id = event.sender?.id;
  if (!id) return;

  const text = String(
    event.message?.quick_reply?.payload ||
    event.postback?.payload ||
    event.message?.text ||
    ""
  ).trim();

  if (!text) return;

  await recordUser(id, env);

  let user = await getUser(id, env);
  let admin = Number(user?.is_admin || 0) === 1;
  const lower = text.toLowerCase();

  // Admin code entry is processed before ordinary messages and AI chat.
  if (!admin && Number(user?.admin_pending || 0) === 1) {
    if (env.ADMIN_CODE && text === env.ADMIN_CODE) {
      await env.DB.prepare(`
        UPDATE bot_users
        SET is_admin = 1, admin_pending = 0
        WHERE igsid = ?
      `).bind(String(id)).run();

      await say(id, "✅ Admin access activated.", env);
      return buttons(id, "🔐 ADMIN PANEL", [
        { title: "Statistics", payload: "ADMIN_STATS" },
        { title: "Feedback", payload: "ADMIN_FEEDBACK" },
        { title: "Admin Help", payload: "ADMIN_HELP" }
      ], env);
    }

    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 0 WHERE igsid = ?"
    ).bind(String(id)).run();

    return say(id, "❌ Incorrect code. Send /admin to try again.", env);
  }

  // Allow /feedback message in one line, or /feedback followed by a message.
  if (lower.startsWith("/feedback ")) {
    const feedback = text.slice("/feedback ".length).trim();
    await saveFeedback(id, feedback, env);
    return say(id, "✅ Thanks! Your feedback has been recorded.", env);
  }

  if (Number(user?.awaiting_feedback || 0) === 1 && !lower.startsWith("/")) {
    await saveFeedback(id, text, env);
    await env.DB.prepare(
      "UPDATE bot_users SET awaiting_feedback = 0 WHERE igsid = ?"
    ).bind(String(id)).run();

    return say(id, "✅ Thanks! Your feedback has been recorded.", env);
  }

  // Admin commands.
  const adminResult = await handleAdmin(id, text, env, user);
  if (adminResult !== false) return;

  // Admin postback buttons.
  if (admin && text === "ADMIN_STATS") return adminStats(id, env);
  if (admin && text === "ADMIN_FEEDBACK") return showFeedback(id, env);
  if (admin && text === "ADMIN_HELP") {
    return say(id, "Use /adminhelp for all admin commands.", env);
  }

  // Navigation buttons and normal commands.
  if (["MENU_HOME", "/start", "/menu", "menu", "hi", "hello", "hey"].includes(lower)) {
    await setChatMode(id, false, env);
    return mainMenu(id, env);
  }

  if (lower === "menu_ai" || lower === "/ai" || lower === "ai chat") {
    await setChatMode(id, true, env);
    return aiMenu(id, env, "✨ AI chat is on! Ask me anything. Use the buttons to return to the menu or exit.");
  }

  if (lower === "ai_exit" || lower === "/exit" || lower === "exit ai") {
    await setChatMode(id, false, env);
    return mainMenu(id, env);
  }

  if (lower === "menu_branches" || lower === "/branches" || lower === "branches") {
    await setChatMode(id, false, env);
    return branchesMenu(id, env);
  }

  if (lower === "menu_about" || lower === "/about" || lower === "about") {
    await setChatMode(id, false, env);
    return aboutMenu(id, env);
  }

  if (lower === "menu_help" || lower === "/help" ||
      lower === "/commands" || lower === "help" || lower === "commands") {
    await setChatMode(id, false, env);
    return helpMenu(id, env);
  }

  if (lower === "menu_more") return branchesMenu(id, env);
  if (lower === "/contact" || lower === "contact") return contactMenu(id, env);

  if (lower === "/shop" || lower === "shop") {
    return buttons(id, "🛍️ Shopper's Suggestions", [
      { title: "Open Website", url: LINKS.shop },
      { title: "Contact Us", url: LINKS.contact },
      { title: "Main Menu", payload: "MENU_HOME" }
    ], env);
  }

  if (lower === "/zilnet" || lower === "zilnet") {
    return buttons(id, "🚀 Explore Zilnet.", [
      { title: "Zilnet Instagram", url: LINKS.zilnet },
      { title: "Main Menu", payload: "MENU_HOME" }
    ], env);
  }

  if (lower === "/privacy" || lower === "privacy") {
    return buttons(id, "🔒 Read the privacy policy.", [
      { title: "Privacy Policy", url: LINKS.privacy },
      { title: "Main Menu", payload: "MENU_HOME" }
    ], env);
  }

  if (lower === "/ping" || lower === "ping") {
    return say(id, "🏓 Pong! Replies are working.", env);
  }

  if (lower === "/status" || lower === "status") {
    return say(id, "✅ The service is online.", env);
  }

  if (lower === "/feedback") {
    await env.DB.prepare(
      "UPDATE bot_users SET awaiting_feedback = 1 WHERE igsid = ?"
    ).bind(String(id)).run();

    return say(id, "📝 Send your feedback in your next message.", env);
  }

  if (lower === "/clear") {
    await env.DB.prepare(
      "DELETE FROM ai_messages WHERE igsid = ?"
    ).bind(String(id)).run();

    return say(id, "🧹 AI chat history cleared.", env);
  }

  if (lower.startsWith("/")) {
    return say(id, "I don't recognise that command. Send /help to see the commands.", env);
  }

  // Ordinary messages go to AI only after the user enters AI chat mode.
  if (Number(user?.chat_mode || 0) === 1) {
    try {
      const answer = await getAIReply(id, text, env);
      return aiMenu(id, env, answer);
    } catch (error) {
      console.error("AI error:", error.message);
      return aiMenu(id, env, "Oops 😅 AI chat isn't responding right now. Please try again soon.");
    }
  }

  return mainMenu(id, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("MEGFO service is online.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

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
        return new Response(challenge, { status: 200 });
      }

      return new Response("Webhook verification failed", { status: 403 });
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
      console.error("Webhook signature invalid.");
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

    for (const entry of payload.entry || []) {
      for (const event of entry.messaging || []) {
        try {
          await processEvent(event, env);
        } catch (error) {
          console.error("Event processing failed:", String(error));
        }
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }
};
