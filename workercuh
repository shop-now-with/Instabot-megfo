const API_VERSION = "v23.0";

const LINKS = {
  shop: "https://shopperssuggestions.online",
  contact: "https://wa.me/918606349917",
  zilnet: "https://www.instagram.com/zilnet.future/",
  privacy: "https://shop-now-with.github.io/Instabot-megfo/privacy.html"
};

const enc = new TextEncoder();

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
        recipient: { id: recipientId },
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
  return send(id, { text }, env);
}

// Buttons can open URLs or trigger bot actions.
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

  await buttons(
    id,
    welcome?.value ||
      "👋 Hey! I'm the instabot_megfo assistant. Choose an option below.",
    [
      { title: "Shop", url: LINKS.shop },
      { title: "WhatsApp", url: LINKS.contact },
      { title: "More", payload: "MENU_MORE" }
    ],
    env
  );
}

async function moreMenu(id, env) {
  await buttons(id, "What would you like to explore?", [
    { title: "About", payload: "CMD_ABOUT" },
    { title: "Zilnet", url: LINKS.zilnet },
    { title: "Commands", payload: "CMD_HELP" }
  ], env);
}

async function contactMenu(id, env) {
  await buttons(id, "Choose where you want to go.", [
    { title: "WhatsApp", url: LINKS.contact },
    { title: "Shop Website", url: LINKS.shop },
    { title: "Back to Menu", payload: "MENU_HOME" }
  ], env);
}

async function branchesMenu(id, env) {
  await buttons(
    id,
    "🛍️ Shopper's Suggestions\n🚀 Zilnet — coming soon!",
    [
      { title: "Shop Website", url: LINKS.shop },
      { title: "Zilnet Instagram", url: LINKS.zilnet },
      { title: "Contact Us", url: LINKS.contact }
    ],
    env
  );
}

async function adminMenu(id, env) {
  await buttons(id, "🔐 ADMIN CONTROL PANEL\nChoose a tool.", [
    { title: "Statistics", payload: "ADMIN_STATS" },
    { title: "Feedback", payload: "ADMIN_FEEDBACK" },
    { title: "Admin Help", payload: "ADMIN_HELP" }
  ], env);
}

async function isAdmin(id, env) {
  const row = await env.DB.prepare(
    "SELECT is_admin FROM bot_users WHERE igsid = ?"
  ).bind(id).first();

  return row?.is_admin === 1;
}

async function recordUser(id, env) {
  await env.DB.prepare(`
    INSERT INTO bot_users
      (igsid, first_seen, last_seen, message_count)
    VALUES (?, datetime('now'), datetime('now'), 1)
    ON CONFLICT(igsid) DO UPDATE SET
      last_seen = datetime('now'),
      message_count = message_count + 1
  `).bind(id).run();
}

async function adminStats(id, env) {
  const stats = await env.DB.prepare(`
    SELECT COUNT(*) AS users,
           COALESCE(SUM(message_count), 0) AS messages,
           COALESCE(SUM(is_admin), 0) AS admins
    FROM bot_users
  `).first();

  await say(
    id,
    `📊 BOT STATISTICS\n\n` +
    `👥 Recorded users: ${stats.users}\n` +
    `💬 Incoming events counted: ${stats.messages}\n` +
    `🔐 Admin accounts: ${stats.admins}\n\n` +
    `These are local database counts, not Instagram-wide analytics.`,
    env
  );
}

async function showFeedback(id, env) {
  const rows = await env.DB.prepare(`
    SELECT feedback, created_at
    FROM bot_feedback
    ORDER BY id DESC
    LIMIT 5
  `).all();

  if (!rows.results.length) {
    return say(id, "No feedback has been submitted yet.", env);
  }

  const text = rows.results.map((row, i) =>
    `${i + 1}. ${row.feedback}\n(${row.created_at})`
  ).join("\n\n");

  await say(id, "📝 RECENT FEEDBACK\n\n" + text.slice(0, 1800), env);
}

async function processEvent(event, env) {
  if (event.message?.is_echo) return;

  const id = event.sender?.id;
  if (!id) return;

  await recordUser(id, env);

  const admin = await isAdmin(id, env);
  const text = (
    event.message?.text ||
    event.postback?.payload ||
    event.message?.quick_reply?.payload ||
    ""
  ).trim();

  if (!text) {
    return say(
      id,
      "I couldn't read that message. Please send text or choose an option.",
      env
    );
  }

  const command = text.toLowerCase();

  // Handle admin-code entry before ordinary commands.
  const user = await env.DB.prepare(
    "SELECT admin_pending, awaiting_feedback FROM bot_users WHERE igsid = ?"
  ).bind(id).first();

  if (!admin && user?.admin_pending === 1) {
    if (env.ADMIN_CODE && text === env.ADMIN_CODE) {
      await env.DB.prepare(`
        UPDATE bot_users
        SET is_admin = 1, admin_pending = 0
        WHERE igsid = ?
      `).bind(id).run();

      await say(id, "✅ Admin access activated for this Instagram account.", env);
      return adminMenu(id, env);
    }

    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 0 WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "❌ Incorrect admin code. Send /admin to try again.", env);
  }

  // Feedback collection.
  if (user?.awaiting_feedback === 1) {
    await env.DB.prepare(`
      INSERT INTO bot_feedback (igsid, feedback, created_at)
      VALUES (?, ?, datetime('now'))
    `).bind(id, text.slice(0, 1500)).run();

    await env.DB.prepare(
      "UPDATE bot_users SET awaiting_feedback = 0 WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "✅ Thanks! Your feedback has been recorded.", env);
  }

  // Admin-only commands.
  if (admin) {
    if (command === "admin" || command === "/admin" ||
        command === "admin_help" || command === "admin help" ||
        command === "admin_help") {
      return adminMenu(id, env);
    }

    if (command === "admin_stats" || command === "/stats" ||
        command === "stats") {
      return adminStats(id, env);
    }

    if (command === "admin_feedback" || command === "/feedbacks" ||
        command === "feedbacks") {
      return showFeedback(id, env);
    }

    if (command === "admin_help" || command === "/adminhelp") {
      return say(
        id,
        "🔐 ADMIN COMMANDS\n\n" +
        "/stats — database statistics\n" +
        "/feedbacks — latest feedback\n" +
        "/setwelcome Your message — change the welcome\n" +
        "/maintenance on — pause normal replies\n" +
        "/maintenance off — resume normal replies\n" +
        "/exitadmin — remove your admin access",
        env
      );
    }

    if (command.startsWith("/setwelcome ")) {
      const value = text.slice("/setwelcome ".length).trim();

      if (!value) return say(id, "Add the welcome text after /setwelcome.", env);

      await env.DB.prepare(`
        INSERT INTO bot_settings (key, value) VALUES ('welcome', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(value.slice(0, 640)).run();

      return say(id, "✅ Welcome message updated.", env);
    }

    if (command === "/maintenance on" ||
        command === "/maintenance off") {
      const value = command.endsWith("on") ? "on" : "off";

      await env.DB.prepare(`
        INSERT INTO bot_settings (key, value)
        VALUES ('maintenance', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).bind(value).run();

      return say(id, `✅ Maintenance mode: ${value.toUpperCase()}`, env);
    }

    if (command === "/exitadmin") {
      await env.DB.prepare(
        "UPDATE bot_users SET is_admin = 0 WHERE igsid = ?"
      ).bind(id).run();

      return say(id, "Admin access removed from this account.", env);
    }
  }

  // Maintenance mode only affects non-admin users.
  const maintenance = await env.DB.prepare(
    "SELECT value FROM bot_settings WHERE key = 'maintenance'"
  ).first();

  if (!admin && maintenance?.value === "on") {
    return say(id, "🛠️ The assistant is temporarily under maintenance. Please try again later.", env);
  }

  // Button actions.
  if (text === "MENU_HOME") return mainMenu(id, env);
  if (text === "MENU_MORE") return moreMenu(id, env);
  if (text === "CMD_ABOUT") {
    return say(id, "🤖 I'm instabot_megfo, an automated Instagram assistant. Use the buttons or /help to explore.", env);
  }
  if (text === "CMD_HELP") return helpMenu(id, env);
  if (text === "ADMIN_STATS" && admin) return adminStats(id, env);
  if (text === "ADMIN_FEEDBACK" && admin) return showFeedback(id, env);
  if (text === "ADMIN_HELP" && admin) {
    return say(id, "Admin commands: /stats, /feedbacks, /setwelcome, /maintenance on, /maintenance off, /exitadmin.", env);
  }

  // Public commands.
  if (command === "hi" || command === "hello" ||
      command === "hey" || command === "/start" ||
      command === "/menu" || command === "menu") {
    return mainMenu(id, env);
  }

  if (command === "/about" || command === "about") {
    return say(id, "🤖 Welcome to instabot_megfo! I'm an automated assistant for links, information and feedback.", env);
  }

  if (command === "/contact" || command === "contact") {
    return contactMenu(id, env);
  }

  if (command === "/branches" || command === "branches") {
    return branchesMenu(id, env);
  }

  if (command === "/shop" || command === "shop") {
    return buttons(id, "🛍️ Open Shopper's Suggestions.", [
      { title: "Open Website", url: LINKS.shop },
      { title: "Contact Us", url: LINKS.contact },
      { title: "Main Menu", payload: "MENU_HOME" }
    ], env);
  }

  if (command === "/zilnet" || command === "zilnet") {
    return buttons(id, "🚀 Zilnet is coming soon.", [
      { title: "Zilnet Instagram", url: LINKS.zilnet },
      { title: "Main Menu", payload: "MENU_HOME" }
    ], env);
  }

  if (command === "/privacy" || command === "privacy") {
    return buttons(id, "Read our privacy policy.", [
      { title: "Privacy Policy", url: LINKS.privacy },
      { title: "Main Menu", payload: "MENU_HOME" }
    ], env);
  }

  if (command === "/ping" || command === "ping") {
    return say(id, "🏓 Pong! The assistant is online.", env);
  }

  if (command === "/status" || command === "status") {
    return say(id, "✅ The assistant is online and ready to receive messages.", env);
  }

  if (command === "/feedback") {
    await env.DB.prepare(
      "UPDATE bot_users SET awaiting_feedback = 1 WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "📝 Send your feedback in your next message.", env);
  }

  if (command === "/admin" || command === "admin") {
    await env.DB.prepare(
      "UPDATE bot_users SET admin_pending = 1 WHERE igsid = ?"
    ).bind(id).run();

    return say(id, "🔐 Admin authentication required. Send your admin code in your next message.", env);
  }

  if (command === "/help" || command === "/commands" ||
      command === "help" || command === "commands") {
    return helpMenu(id, env);
  }

  if (command.startsWith("/")) {
    return say(id, "I don't recognise that command. Send /help to see the available commands.", env);
  }

  return mainMenu(id, env);
}

async function helpMenu(id, env) {
  await buttons(id, "📚 AVAILABLE COMMANDS\n\n" +
    "/menu — main menu\n" +
    "/about — about the bot\n" +
    "/contact — contact options\n" +
    "/branches — projects\n" +
    "/shop — shopping website\n" +
    "/zilnet — Zilnet\n" +
    "/privacy — privacy policy\n" +
    "/ping — quick test\n" +
    "/status — bot status\n" +
    "/feedback — send feedback\n" +
    "/admin — admin access",
    [
      { title: "Main Menu", payload: "MENU_HOME" },
      { title: "Contact", url: LINKS.contact },
      { title: "Shop", url: LINKS.shop }
    ],
    env
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Simple health check.
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("instabot_megfo is online.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    if (url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    // Meta webhook verification.
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

    // Acknowledge Meta quickly; process the received events.
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
