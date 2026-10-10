
const API_VERSION = "v23.0";
const AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";

const LINKS = {
  shop: "https://shopperssuggestions.online",
  contact: "https://wa.me/918606349917",
  zilnet: "https://www.instagram.com/zilnet.future/",
  privacy: "https://shop-now-with.github.io/Instabot-megfo/privacy.html",
};

const enc = new TextEncoder();

const SYSTEM_PROMPT = `
You are a friendly Instagram assistant for MEGFO.
The creator and owner is @faayahx.
Chat naturally about MEGFO, general topics, ideas, and jokes.
Use short, simple replies and occasional emojis.
Do not invent business information, branch addresses, or prices.
If you do not know a fact about MEGFO, say so honestly.
Never claim to be human. Do not randomly discuss your AI provider.
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
  if (!env.IG_ACCESS_TOKEN) {
    throw new Error("IG_ACCESS_TOKEN is missing");
  }

  const response = await fetch(
    `https://graph.instagram.com/${API_VERSION}/me/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message,
      }),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.error) {
    console.error("Instagram API error:", response.status, result);
    throw new Error(
      `Instagram API error ${response.status}: ${
        result.error?.message || "Unknown error"
      }`
    );
  }

  return result;
}

async function say(id, text, env) {
  return send(id, { text: String(text).slice(0, 950) }, env);
}

async function buttons(id, text, items, env) {
  return send(id, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: String(text).slice(0, 640),
        buttons: items.slice(0, 3).map(item =>
          item.url
            ? {
                type: "web_url",
                url: item.url,
                title: item.title.slice(0, 20),
              }
            : {
                type: "postback",
                title: item.title.slice(0, 20),
                payload: item.payload,
              }
        ),
      },
    },
  }, env);
}

// Four choices in the main menu.
async function mainMenu(id, env) {
  const row = await env.DB.prepare(
    "SELECT value FROM bot_settings WHERE key = 'welcome'"
  ).first();

  return send(id, {
    text: row?.value ||
      "Hey! 👋 Welcome! I'm the MEGFO assistant. What would you like to do?",
    quick_replies: [
      { content_type: "text", title: "✨ AI CHAT", payload: "MENU_AI" },
      { content_type: "text", title: "📍 BRANCHES", payload: "MENU_BRANCHES" },
      { content_type: "text", title: "ℹ️ ABOUT", payload: "MENU_ABOUT" },
      { content_type: "text", title: "❓ HELP", payload: "MENU_HELP" },
    ],
  }, env);
}

async function moreMenu(id, env) {
  return buttons(id, "What would you like to explore?", [
    { title: "Shop", url: LINKS.shop },
    { title: "Contact", url: LINKS.contact },
    { title: "Main Menu", payload: "MENU_HOME" },
  ], env);
}

async function branchesMenu(id, env) {
  const row = await env.DB.prepare(
    "SELECT value FROM bot_settings WHERE key = 'branches'"
  ).first();

  return buttons(
    id,
    row?.value ||
      "For current branch information, contact @faayahx. I don't want to give you an incorrect address. 📍",
    [
      { title: "Shop Website", url: LINKS.shop },
      { title: "Contact", url: LINKS.contact },
      { title: "Main Menu", payload: "MENU_HOME" },
    ],
    env
  );
}

async function aboutMenu(id, env) {
  return buttons(
    id,
    "MEGFO is managed by its creator, @faayahx. 👋 You can chat with me about MEGFO or ask general questions.",
    [
      { title: "Branches", payload: "MENU_BRANCHES" },
      { title: "Shop", url: LINKS.shop },
      { title: "Main Menu", payload: "MENU_HOME" },
    ],
    env
  );
}

async function helpMenu(id, env) {
  return buttons(
    id,
    "📚 COMMANDS\n\n/menu — main menu\n/ai — start AI chat\n/exit — leave AI chat\n/branches — branch info\n/about — about MEGFO\n/contact — contact options\n/shop — website\n/zilnet — Zilnet\n/privacy — privacy policy\n/feedback — send feedback\n/clear — clear AI history\n/ping — connection test\n/status — bot status\n/admin — admin access",
    [
      { title: "Main Menu", payload: "MENU_HOME" },
      { title: "Contact", url: LINKS.contact },
      { title: "Shop", url: LINKS.shop },
    ],
    env
  );
}

async function contactMenu(id, env) {
  return buttons(id, "Choose where you want to go.", [
    { title: "WhatsApp", url: LINKS.contact },
    { title: "Shop Website", url: LINKS.shop },
    { title: "Main Menu", payload: "MENU_HOME" },
  ], env);
}

async function recordUser(id, env) {
  await env.DB.prepare(`
    INSERT INTO bot_users
      (igsid, first_seen, last_seen, message_count)
    VALUES (?, datetime('now'), datetime('now'), 1)
    ON CONFLICT(igsid) DO UPDATE SET
      last_seen = datetime('now'),
      message_count = COALESCE(message_count, 0) + 1
  `).bind(id).run();
}

async function getUser(id, env) {
  return env.DB.prepare(
    "SELECT * FROM bot_users WHERE igsid = ?"
  ).bind(id).first();
}

async function isAdmin(id, env) {
  const row = await env.DB.prepare(
    "SELECT is_admin FROM bot_users WHERE igsid = ?"
  ).bind(id).first();

  return Number(row?.is_admin || 0) === 1;
}

async function getSetting(key, env, fallback = "") {
  const row = await env.DB.prepare(
    "SELECT value FROM bot_settings WHERE key = ?"
  ).bind(key).first();

  return row?.value ?? fallback;
}

async function setSetting(key, value, env) {
  return env.DB.prepare(`
    INSERT INTO bot_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, value).run();
}

async function startAI(id, env) {
  await env.DB.prepare(
    "UPDATE bot_users SET chat_mode = 1 WHERE igsid = ?"
  ).bind(id).run();

  return say(
    id,
    "✨ AI CHAT is on! Ask me anything. Type /exit or /menu to leave.",
    env
  );
}

async function exitAI(id, env) {
  await env.DB.prepare(
    "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
  ).bind(id).run();

  return mainMenu(id, env);
}

async function runAI(id, text, env) {
  try {
    if (!env.AI || typeof env.AI.run !== "function") {
      throw new Error("Workers AI binding env.AI is missing");
    }

    const history = await env.DB.prepare(`
      SELECT role, content
      FROM ai_messages
      WHERE igsid = ?
      ORDER BY id DESC
      LIMIT 10
    `).bind(id).all();

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history.results || []).reverse()
        .filter(item =>
          item.role === "user" || item.role === "assistant"
        )
        .map(item => ({
          role: item.role,
          content: String(item.content).slice(0, 1500),
        })),
      { role: "user", content: text.slice(0, 1500) },
    ];

    const result = await env.AI.run(AI_MODEL, {
      messages,
      max_tokens: 220,
      temperature: 0.7,
    });

    // Handle both common Workers AI response formats.
    const answer =
      result?.response ||
      result?.choices?.[0]?.message?.content ||
      result?.result?.response ||
      "";

    if (typeof answer !== "string" || !answer.trim()) {
      console.error(
        "Gemma returned no usable text:",
        JSON.stringify(result).slice(0, 1500)
      );
      throw new Error("Empty or unexpected Gemma response");
    }

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO ai_messages (igsid, role, content)
        VALUES (?, 'user', ?)
      `).bind(id, text.slice(0, 1500)),
      env.DB.prepare(`
        INSERT INTO ai_messages (igsid, role, content)
        VALUES (?, 'assistant', ?)
      `).bind(id, answer.slice(0, 3000)),
    ]);

    return say(id, answer, env);
  } catch (error) {
    console.error(
      "Gemma AI failure:",
      String(error?.stack || error?.message || error)
    );

    return say(
      id,
      "Sorry, AI chat is temporarily unavailable. Please try again soon.",
      env
    );
  }
}

async function startFeedback(id, env) {
  await env.DB.prepare(
    "UPDATE bot_users SET awaiting_feedback = 1, chat_mode = 0 WHERE igsid = ?"
  ).bind(id).run();

  return say(id, "📝 Send your feedback in your next message.", env);
}

async function saveFeedback(id, text, env) {
  await env.DB.prepare(`
    INSERT INTO bot_feedback (igsid, feedback, created_at)
    VALUES (?, ?, datetime('now'))
  `).bind(id, text.slice(0, 1500)).run();

  await env.DB.prepare(
    "UPDATE bot_users SET awaiting_feedback = 0 WHERE igsid = ?"
  ).bind(id).run();

  if (env.ADMIN_IGSID && env.ADMIN_IGSID !== id) {
    try {
      await say(
        env.ADMIN_IGSID,
        `📩 New feedback\nInstagram-scoped user ID: ${id}\n\n${text.slice(0, 1200)}`,
        env
      );
    } catch (error) {
      console.error("Feedback forwarding failed:", String(error));
    }
  }

  return say(id, "✅ Thanks! Your feedback has been saved.", env);
}

async function adminHelp(id, env) {
  return say(
    id,
    "🔐 ADMIN COMMANDS\n\n" +
    "/stats — statistics\n" +
    "/feedbacks — latest feedback\n" +
    "/users — user count\n" +
    "/broadcast Your message — message known users\n" +
    "/reply IGSID Your message — reply to a user\n" +
    "/setwelcome Your text — change welcome\n" +
    "/setbranches Your text — change branch information\n" +
    "/maintenance on or off\n" +
    "/exitadmin — remove admin access",
    env
  );
}

async function adminStats(id, env) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS users,
           COALESCE(SUM(message_count), 0) AS messages
    FROM bot_users
  `).first();

  return say(
    id,
    `📊 Statistics\nKnown users: ${row?.users ?? 0}\nIncoming events counted: ${row?.messages ?? 0}`,
    env
  );
}

async function showFeedback(id, env) {
  const rows = await env.DB.prepare(`
    SELECT igsid, feedback, created_at
    FROM bot_feedback
    ORDER BY id DESC
    LIMIT 5
  `).all();

  if (!rows.results?.length) {
    return say(id, "No feedback has been submitted yet.", env);
  }

  const output = rows.results.map((row, index) =>
    `${index + 1}. User ID: ${row.igsid}\n${row.feedback}`
  ).join("\n\n");

  return say(id, output.slice(0, 1800), env);
}

async function handleAdmin(id, text, env, user, admin) {
  const command = text.toLowerCase().trim();

  if (command === "/admin" || command === "admin") {
    if (admin) return adminHelp(id, env);

    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 1 WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "🔐 Enter your admin code.", env);
  }

  if (!admin && Number(user?.admin_pending || 0) === 1) {
    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 0 WHERE igsid = ?"
    ).bind(id).run();

    if (env.ADMIN_CODE && text === env.ADMIN_CODE) {
      await env.DB.prepare(
        "UPDATE bot_users SET is_admin = 1 WHERE igsid = ?"
      ).bind(id).run();

      return adminHelp(id, env);
    }

    return say(id, "Incorrect admin code. Send /admin to try again.", env);
  }

  if (!admin) return false;

  if (command === "/adminhelp" || command === "/commands") {
    return adminHelp(id, env);
  }

  if (command === "/stats") return adminStats(id, env);

  if (command === "/feedbacks") return showFeedback(id, env);

  if (command === "/users") {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM bot_users"
    ).first();

    return say(id, `Known users: ${row?.count ?? 0}`, env);
  }

  if (command.startsWith("/setwelcome ")) {
    const value = text.slice("/setwelcome ".length).trim();
    await setSetting("welcome", value.slice(0, 640), env);
    return say(id, "Welcome message updated. ✅", env);
  }

  if (command.startsWith("/setbranches ")) {
    const value = text.slice("/setbranches ".length).trim();
    await setSetting("branches", value.slice(0, 640), env);
    return say(id, "Branch information updated. ✅", env);
  }

  if (command === "/maintenance on" || command === "/maintenance off") {
    const value = command.endsWith("on") ? "on" : "off";
    await setSetting("maintenance", value, env);
    return say(id, `Maintenance mode: ${value}`, env);
  }

  if (command === "/exitadmin") {
    await env.DB.prepare(
      "UPDATE bot_users SET is_admin = 0 WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "Admin access removed.", env);
  }

  if (command.startsWith("/broadcast ")) {
    const message = text.slice("/broadcast ".length).trim();
    const rows = await env.DB.prepare(
      "SELECT igsid FROM bot_users WHERE is_admin = 0"
    ).all();

    let sent = 0;
    let failed = 0;

    for (const row of rows.results || []) {
      try {
        await say(row.igsid, message, env);
        sent++;
      } catch (error) {
        failed++;
        console.error("Broadcast delivery failed:", String(error));
      }
    }

    return say(id, `Broadcast complete.\nSent: ${sent}\nFailed: ${failed}`, env);
  }

  if (command.startsWith("/reply ")) {
    const rest = text.slice("/reply ".length).trim();
    const split = rest.indexOf(" ");

    if (split < 1) {
      return say(id, "Use: /reply IGSID Your message", env);
    }

    const recipient = rest.slice(0, split);
    const message = rest.slice(split + 1).trim();

    try {
      await say(recipient, message, env);
      return say(id, "Reply request sent. ✅", env);
    } catch (error) {
      console.error("Admin reply failed:", String(error));
      return say(id, "Reply failed. Check the recipient ID and Instagram messaging window.", env);
    }
  }

  return false;
}

async function processEvent(event, env) {
  if (event.message?.is_echo) return;

  const id = event.sender?.id;
  if (!id) return;

  // Read button payloads first, then ordinary text.
  const text = String(
    event.message?.quick_reply?.payload ||
    event.postback?.payload ||
    event.message?.text ||
    ""
  ).trim();

  if (!text) return;

  await recordUser(id, env);

  const user = await getUser(id, env);
  const admin = await isAdmin(id, env);
  const command = text.toLowerCase();

  // Keep admin-code and feedback replies out of AI chat.
  if (!admin && Number(user?.admin_pending || 0) === 1) {
    return handleAdmin(id, text, env, user, admin);
  }

  if (Number(user?.awaiting_feedback || 0) === 1) {
    return saveFeedback(id, text, env);
  }

  const adminResult = await handleAdmin(id, text, env, user, admin);
  if (adminResult !== false) return adminResult;

  const maintenance = await getSetting("maintenance", env, "off");
  if (maintenance === "on" && !admin) {
    return say(id, "🛠️ We're temporarily under maintenance. Please try again later.", env);
  }

  // Main menu and menu buttons always exit AI mode.
  if (["menu_home", "/menu", "/start", "menu", "hi", "hello", "hey"].includes(command)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();

    return mainMenu(id, env);
  }

  if (["menu_ai", "/ai", "ai chat", "✨ ai chat"].includes(command)) {
    return startAI(id, env);
  }

  if (["ai_exit", "/exit"].includes(command)) {
    return exitAI(id, env);
  }

  if (["menu_branches", "/branches", "branches", "📍 branches"].includes(command)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();

    return branchesMenu(id, env);
  }

  if (["menu_about", "/about", "about", "ℹ️ about"].includes(command)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();

    return aboutMenu(id, env);
  }

  if (["menu_help", "/help", "help", "❓ help", "/commands"].includes(command)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();

    return helpMenu(id, env);
  }

  if (["/contact", "contact"].includes(command)) return contactMenu(id, env);

  if (["/shop", "shop"].includes(command)) {
    return buttons(id, "🛍️ Open Shopper's Suggestions.", [
      { title: "Open Shop", url: LINKS.shop },
      { title: "Contact", url: LINKS.contact },
      { title: "Main Menu", payload: "MENU_HOME" },
    ], env);
  }

  if (["/zilnet", "zilnet"].includes(command)) {
    return buttons(id, "🚀 Visit Zilnet.", [
      { title: "Zilnet Instagram", url: LINKS.zilnet },
      { title: "Main Menu", payload: "MENU_HOME" },
    ], env);
  }

  if (["/privacy", "privacy"].includes(command)) {
    return buttons(id, "Read the privacy policy.", [
      { title: "Privacy Policy", url: LINKS.privacy },
      { title: "Main Menu", payload: "MENU_HOME" },
    ], env);
  }

  if (command === "/ping" || command === "ping") {
    return say(id, "Pong! 🏓", env);
  }

  if (command === "/status") return say(id, "I'm online! ✅", env);

  if (command === "/feedback") return startFeedback(id, env);

  if (command.startsWith("/feedback ")) {
    return saveFeedback(id, text.slice("/feedback ".length).trim(), env);
  }

  if (command === "/clear") {
    await env.DB.prepare(
      "DELETE FROM ai_messages WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "AI chat history cleared. 🧹", env);
  }

  // All ordinary messages in AI mode go to Gemma.
  if (Number(user?.chat_mode || 0) === 1) {
    return runAI(id, text, env);
  }

  if (command.startsWith("/")) {
    return say(id, "I don't recognise that command. Send /help to see the options.", env);
  }

  return mainMenu(id, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("instabot_megfo is online.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
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
      console.error("Webhook signature invalid or META_APP_SECRET missing.");
      return new Response("Invalid signature", { status: 401 });
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

    // Same sequential event processing style as your old working Worker.
    for (const entry of payload.entry || []) {
      for (const event of entry.messaging || []) {
        try {
          await processEvent(event, env);
        } catch (error) {
          console.error(
            "Event processing failed:",
            String(error?.stack || error?.message || error)
          );
        }
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  },
};
