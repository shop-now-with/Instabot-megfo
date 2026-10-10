
const API_VERSION = "v23.0";
const AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";

const LINKS = {
  shop: "https://shopperssuggestions.online",
  contact: "https://wa.me/918606349917",
  zilnet: "https://www.instagram.com/zilnet.future/",
  privacy: "https://shop-now-with.github.io/Instabot-megfo/privacy.html",
};

const SYSTEM_PROMPT = `
You are a friendly Instagram chat assistant for MEGFO.
The creator and owner is @faayahx.
You can chat about MEGFO, its branches, general topics, ideas, and jokes.
Use simple, natural language and mostly short replies.
Use emojis when they fit naturally, but do not overuse them.
Avoid complicated words unless they are needed.
Do not randomly mention your AI provider or how you were built.
Never claim to be a human.
Do not invent branch addresses, prices, contact details, or business facts.
If you do not know a specific MEGFO fact, say so honestly.
Be respectful, helpful, conversational, and safe.
`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeError(error) {
  return String(error?.message || error || "Unknown error").slice(0, 1500);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;

  const parts = signature.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );

  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return constantTimeEqual(expected, parts[1].toLowerCase());
}

async function send(recipientId, message, env) {
  if (!recipientId) throw new Error("Missing Instagram recipient ID");
  if (!env.IG_ACCESS_TOKEN) throw new Error("IG_ACCESS_TOKEN is missing");

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
    console.error(
      "Instagram send API error:",
      JSON.stringify({
        status: response.status,
        error: result.error || result,
      })
    );
    throw new Error(
      `Instagram send failed (${response.status}): ${
        result.error?.message || "API request failed"
      }`
    );
  }

  return result;
}

async function say(id, text, env) {
  const cleaned = String(text || "").trim().slice(0, 950);
  return send(id, { text: cleaned || "Try sending that again." }, env);
}

async function quickMenu(id, text, env) {
  return send(
    id,
    {
      text: String(text).slice(0, 950),
      quick_replies: [
        { content_type: "text", title: "✨ AI CHAT", payload: "MENU_AI" },
        { content_type: "text", title: "📍 BRANCHES", payload: "MENU_BRANCHES" },
        { content_type: "text", title: "ℹ️ ABOUT", payload: "MENU_ABOUT" },
        { content_type: "text", title: "❓ HELP", payload: "MENU_HELP" },
      ],
    },
    env
  );
}

async function buttons(id, text, items, env) {
  const elements = items.slice(0, 3).map((item) => {
    if (item.url) {
      return {
        type: "web_url",
        url: item.url,
        title: item.title.slice(0, 20),
      };
    }

    return {
      type: "postback",
      title: item.title.slice(0, 20),
      payload: item.payload,
    };
  });

  return send(
    id,
    {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: String(text).slice(0, 640),
          buttons: elements,
        },
      },
    },
    env
  );
}

async function getUser(id, env) {
  return env.DB.prepare(
    "SELECT * FROM bot_users WHERE igsid = ?"
  ).bind(id).first();
}

async function recordUser(id, env) {
  await env.DB.prepare(`
    INSERT INTO bot_users
      (igsid, first_seen, last_seen, message_count,
       is_admin, admin_pending, awaiting_feedback, chat_mode)
    VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 0, 0, 0)
    ON CONFLICT(igsid) DO UPDATE SET
      last_seen = CURRENT_TIMESTAMP,
      message_count = COALESCE(bot_users.message_count, 0) + 1
  `).bind(id).run();

  return getUser(id, env);
}

async function getSetting(key, env, fallback = "") {
  const row = await env.DB.prepare(
    "SELECT value FROM bot_settings WHERE key = ?"
  ).bind(key).first();

  return row?.value ?? fallback;
}

async function setSetting(key, value, env) {
  await env.DB.prepare(`
    INSERT INTO bot_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, String(value)).run();
}

async function mainMenu(id, env) {
  const welcome = await getSetting(
    "welcome",
    env,
    "Hey! 👋 Welcome to MEGFO. What would you like to do?"
  );
  return quickMenu(id, welcome, env);
}

async function branchesMenu(id, env) {
  const branches = await getSetting(
    "branches",
    env,
    "For the latest branch information, contact @faayahx. I don't want to give you an incorrect address. 📍"
  );

  return buttons(
    id,
    branches,
    [
      { title: "Contact", url: LINKS.contact },
      { title: "Main Menu", payload: "MENU_HOME" },
    ],
    env
  );
}

async function aboutMenu(id, env) {
  return buttons(
    id,
    "MEGFO is managed by its creator, @faayahx. 👋 Ask me about MEGFO, its branches, or anything else!",
    [
      { title: "Branches", payload: "MENU_BRANCHES" },
      { title: "Visit Shop", url: LINKS.shop },
      { title: "Main Menu", payload: "MENU_HOME" },
    ],
    env
  );
}

async function helpMenu(id, env) {
  return quickMenu(
    id,
    "Here's what I can do! ✨\n\n• AI CHAT — talk with me about lots of topics\n• BRANCHES — get branch information\n• ABOUT — learn about MEGFO\n• HELP — see these options again\n\nType /menu anytime to return here.",
    env
  );
}

async function contactMenu(id, env) {
  return buttons(
    id,
    "Need to get in touch? Choose an option below. 👇",
    [
      { title: "WhatsApp", url: LINKS.contact },
      { title: "Shop", url: LINKS.shop },
      { title: "Main Menu", payload: "MENU_HOME" },
    ],
    env
  );
}

async function aiMenu(id, env) {
  await env.DB.prepare(
    "UPDATE bot_users SET chat_mode = 1 WHERE igsid = ?"
  ).bind(id).run();

  return say(
    id,
    "AI CHAT is on! 😎 Send me a message about MEGFO, ask a question, or tell me to crack a joke. Type /exit or /menu to leave AI CHAT.",
    env
  );
}

async function exitAI(id, env) {
  await env.DB.prepare(
    "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
  ).bind(id).run();

  return mainMenu(id, env);
}

async function saveFeedback(id, feedback, env) {
  await env.DB.prepare(`
    INSERT INTO bot_feedback (igsid, feedback, created_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).bind(id, feedback.slice(0, 2000)).run();

  await env.DB.prepare(
    "UPDATE bot_users SET awaiting_feedback = 0 WHERE igsid = ?"
  ).bind(id).run();

  if (env.ADMIN_IGSID && env.ADMIN_IGSID !== id) {
    try {
      await say(
        env.ADMIN_IGSID,
        `📩 New MEGFO feedback\nInstagram-scoped user ID: ${id}\n\n${feedback.slice(0, 1500)}`,
        env
      );
    } catch (error) {
      console.error("Could not forward feedback:", safeError(error));
    }
  }

  return say(
    id,
    "Thanks! Your feedback has been saved. 🙌",
    env
  );
}

async function startFeedback(id, env) {
  await env.DB.prepare(
    "UPDATE bot_users SET awaiting_feedback = 1, chat_mode = 0 WHERE igsid = ?"
  ).bind(id).run();

  return say(
    id,
    "Send your feedback in your next message. I'll save it for the team. 📝",
    env
  );
}

async function runAI(id, text, env) {
  try {
    if (!env.AI || typeof env.AI.run !== "function") {
      throw new Error("Workers AI binding env.AI is unavailable");
    }

    const history = await env.DB.prepare(`
      SELECT role, content
      FROM ai_messages
      WHERE igsid = ?
      ORDER BY id DESC
      LIMIT 12
    `).bind(id).all();

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history.results || [])
        .reverse()
        .filter((row) => ["user", "assistant"].includes(row.role))
        .map((row) => ({
          role: row.role,
          content: String(row.content).slice(0, 2000),
        })),
      { role: "user", content: text.slice(0, 2000) },
    ];

    const result = await env.AI.run(AI_MODEL, {
      messages,
      max_tokens: 220,
      temperature: 0.7,
    });

    const answer =
      result?.response ||
      result?.result?.response ||
      result?.choices?.[0]?.message?.content ||
      "";

    if (typeof answer !== "string" || !answer.trim()) {
      console.error("Gemma returned an empty or unexpected response:", JSON.stringify(result).slice(0, 2000));
      throw new Error("Gemma returned no usable text");
    }

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO ai_messages (igsid, role, content)
        VALUES (?, 'user', ?)
      `).bind(id, text.slice(0, 2000)),
      env.DB.prepare(`
        INSERT INTO ai_messages (igsid, role, content)
        VALUES (?, 'assistant', ?)
      `).bind(id, answer.slice(0, 4000)),
    ]);

    return say(id, answer, env);
  } catch (error) {
    console.error("Workers AI / Gemma failure:", safeError(error));

    return say(
      id,
      "Oops 😅 AI chat isn't responding right now. Please try again soon.",
      env
    );
  }
}

async function adminHelp(id, env) {
  return say(
    id,
    "🛠️ ADMIN COMMANDS\n\n/stats — bot statistics\n/users — known user count\n/feedbacks — latest feedback\n/broadcast Your message — send to known users\n/reply IGSID Your message — reply to a user\n/setwelcome Your text — change welcome message\n/setbranches Your text — change branch information\n/maintenance on or off\n/exitadmin — leave admin commands",
    env
  );
}

async function handleAdmin(id, text, env, user) {
  const lower = text.toLowerCase().trim();

  if (lower === "/admin" || lower === "admin") {
    if (Number(user?.is_admin || 0) === 1) {
      return adminHelp(id, env);
    }

    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 1 WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "Enter the admin code to continue.", env);
  }

  if (Number(user?.admin_pending || 0) === 1) {
    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 0 WHERE igsid = ?"
    ).bind(id).run();

    if (env.ADMIN_CODE && text === env.ADMIN_CODE) {
      await env.DB.prepare(
        "UPDATE bot_users SET is_admin = 1 WHERE igsid = ?"
      ).bind(id).run();

      return adminHelp(id, env);
    }

    return say(id, "That code wasn't accepted.", env);
  }

  if (Number(user?.is_admin || 0) !== 1) return false;

  if (lower === "/adminhelp" || lower === "/commands") {
    return adminHelp(id, env);
  }

  if (lower === "/exitadmin") {
    return say(id, "Admin commands closed.", env);
  }

  if (lower === "/stats") {
    const users = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM bot_users"
    ).first();
    const feedback = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM bot_feedback"
    ).first();

    return say(
      id,
      `📊 Bot statistics\nKnown users: ${users?.count ?? 0}\nFeedback entries: ${feedback?.count ?? 0}`,
      env
    );
  }

  if (lower === "/users") {
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM bot_users"
    ).first();

    return say(id, `Known users: ${result?.count ?? 0}`, env);
  }

  if (lower === "/feedbacks") {
    const result = await env.DB.prepare(`
      SELECT igsid, feedback, created_at
      FROM bot_feedback
      ORDER BY id DESC
      LIMIT 10
    `).all();

    if (!result.results?.length) {
      return say(id, "No feedback has been submitted yet.", env);
    }

    const output = result.results.map((item, index) =>
      `${index + 1}. User ID: ${item.igsid}\n${item.feedback}`
    ).join("\n\n");

    return say(id, output.slice(0, 900), env);
  }

  if (lower.startsWith("/setwelcome ")) {
    const value = text.slice("/setwelcome ".length).trim();
    if (!value) return say(id, "Add a welcome message after /setwelcome.", env);
    await setSetting("welcome", value, env);
    return say(id, "Welcome message updated. ✅", env);
  }

  if (lower.startsWith("/setbranches ")) {
    const value = text.slice("/setbranches ".length).trim();
    if (!value) return say(id, "Add branch information after /setbranches.", env);
    await setSetting("branches", value, env);
    return say(id, "Branch information updated. ✅", env);
  }

  if (lower === "/maintenance on" || lower === "/maintenance off") {
    const value = lower.endsWith("on") ? "on" : "off";
    await setSetting("maintenance", value, env);
    return say(id, `Maintenance mode: ${value}`, env);
  }

  if (lower.startsWith("/broadcast ")) {
    const message = text.slice("/broadcast ".length).trim();
    if (!message) return say(id, "Add a message after /broadcast.", env);

    const result = await env.DB.prepare(
      "SELECT igsid FROM bot_users WHERE is_admin = 0"
    ).all();

    let sent = 0;
    let failed = 0;

    for (const recipient of result.results || []) {
      try {
        await say(recipient.igsid, message, env);
        sent++;
      } catch (error) {
        failed++;
        console.error("Broadcast delivery failed:", recipient.igsid, safeError(error));
      }
    }

    return say(id, `Broadcast finished.\nSent: ${sent}\nFailed: ${failed}`, env);
  }

  if (lower.startsWith("/reply ")) {
    const remainder = text.slice("/reply ".length).trim();
    const space = remainder.indexOf(" ");

    if (space < 1) {
      return say(id, "Format: /reply IGSID Your message", env);
    }

    const recipientId = remainder.slice(0, space).trim();
    const message = remainder.slice(space + 1).trim();

    if (!message) return say(id, "Your reply message is empty.", env);

    try {
      await say(recipientId, message, env);
      return say(id, "Reply request sent. ✅", env);
    } catch (error) {
      console.error("Admin reply failed:", safeError(error));
      return say(id, "Reply failed. Check the Instagram messaging window and recipient ID.", env);
    }
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

  let user = await recordUser(id, env);
  const lower = text.toLowerCase();

  const maintenance = await getSetting("maintenance", env, "off");
  if (maintenance === "on" && Number(user?.is_admin || 0) !== 1) {
    return say(id, "We're doing a little maintenance right now. Please try again later. 🛠️", env);
  }

  // Main menu and button actions
  if (["MENU_HOME", "/menu", "/start", "menu"].includes(lower)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();
    return mainMenu(id, env);
  }

  if (["MENU_AI", "/ai", "ai chat", "✨ ai chat"].includes(lower)) {
    return aiMenu(id, env);
  }

  if (["AI_EXIT", "/exit"].includes(lower)) {
    return exitAI(id, env);
  }

  if (["MENU_BRANCHES", "/branches", "branches", "📍 branches"].includes(lower)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();
    return branchesMenu(id, env);
  }

  if (["MENU_ABOUT", "/about", "about", "ℹ️ about"].includes(lower)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();
    return aboutMenu(id, env);
  }

  if (["MENU_HELP", "/help", "help", "❓ help"].includes(lower)) {
    await env.DB.prepare(
      "UPDATE bot_users SET chat_mode = 0 WHERE igsid = ?"
    ).bind(id).run();
    return helpMenu(id, env);
  }

  if (["/contact", "contact"].includes(lower)) {
    return contactMenu(id, env);
  }

  if (["/shop", "shop"].includes(lower)) {
    return buttons(id, "Open the shop here. 🛍️", [
      { title: "Open Shop", url: LINKS.shop },
      { title: "Main Menu", payload: "MENU_HOME" },
    ], env);
  }

  if (["/zilnet", "zilnet"].includes(lower)) {
    return buttons(id, "Visit Zilnet here.", [
      { title: "Open Zilnet", url: LINKS.zilnet },
      { title: "Main Menu", payload: "MENU_HOME" },
    ], env);
  }

  if (["/privacy", "privacy"].includes(lower)) {
    return buttons(id, "Read the privacy information here.", [
      { title: "Privacy Policy", url: LINKS.privacy },
      { title: "Main Menu", payload: "MENU_HOME" },
    ], env);
  }

  if (lower === "/ping") {
    return say(id, "Pong! 🏓", env);
  }

  if (lower === "/status") {
    return say(id, "I'm online! ✅", env);
  }

  if (lower === "/feedback") {
    return startFeedback(id, env);
  }

  if (lower.startsWith("/feedback ")) {
    return saveFeedback(id, text.slice("/feedback ".length).trim(), env);
  }

  if (lower === "/clear") {
    await env.DB.prepare(
      "DELETE FROM ai_messages WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "AI chat history cleared. 🧹", env);
  }

  if (lower === "/commands") {
    return say(
      id,
      "Commands: /start, /menu, /ai, /exit, /branches, /about, /contact, /shop, /zilnet, /privacy, /ping, /status, /feedback, /clear, /help, /admin",
      env
    );
  }

  // Admin authentication and commands
  const adminResult = await handleAdmin(id, text, env, user);
  if (adminResult !== false) return adminResult;

  user = await getUser(id, env);

  // Feedback text is saved instead of being sent to AI.
  if (Number(user?.awaiting_feedback || 0) === 1) {
    return saveFeedback(id, text, env);
  }

  // AI mode: normal messages go to Gemma until the user exits or opens a menu.
  if (Number(user?.chat_mode || 0) === 1) {
    return runAI(id, text, env);
  }

  // Friendly fallback for normal messages.
  return quickMenu(
    id,
    "Hey! 👋 Choose an option below, or type /menu to see the main menu.",
    env
  );
}

async function processPayload(payload, env) {
  if (payload.object !== "instagram") {
    console.log("Ignoring unexpected webhook object:", payload.object);
    return;
  }

  for (const entry of payload.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await processEvent(event, env);
      } catch (error) {
        console.error("Message processing failed:", safeError(error));
      }
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return json({
        ok: true,
        status: "online",
        service: "MEGFO Instagram bot",
      });
    }

    if (url.pathname === "/webhook" && request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === env.VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 });
      }

      return new Response("Forbidden", { status: 403 });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const body = await request.text();

      const valid = await verifySignature(
        body,
        request.headers.get("x-hub-signature-256"),
        env.META_APP_SECRET
      );

      if (!valid) {
        console.error("Webhook rejected: invalid signature or missing secret");
        return new Response("Invalid signature", { status: 401 });
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      // Acknowledge Meta quickly; process messages in the background.
      ctx.waitUntil(processPayload(payload, env));

      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};
