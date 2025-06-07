import fetch from "node-fetch";
import { Bot, session, InlineKeyboard } from "grammy";
import { FileAdapter } from "@grammyjs/storage-file";
import cron from "node-cron";
import fs from "fs";
import path from "path";

import { setupAdminHandlers } from "./handlers/admin.js"; // Tambahkan baris ini

// Setup Admin Handlers
setupAdminHandlers(bot);

// === UTILITY FUNCTIONS ===
const getProgressBar = (used, total) => {
  const progress = Math.min(used / total, 1);
  const filled = "▰".repeat(Math.floor(progress * 10));
  const empty = "▱".repeat(10 - filled.length);
  return `${filled}${empty} ${used}/${total}`;
};

const getDynamicProgressBar = (currentStep, totalSteps) => {
  const percentage = Math.min(Math.floor((currentStep / totalSteps) * 10), 10);
  const filled = "▰".repeat(percentage);
  const empty = "▱".repeat(10 - percentage);
  return `${filled}${empty} - ${Math.round((currentStep / totalSteps) * 100)}%`;
};

// === CRON SETUP ===
const resetDailyLimits = () => {
  const sessionDir = path.resolve("./sessions");
  const files = fs.readdirSync(sessionDir);

  files.forEach((file) => {
    const filePath = path.join(sessionDir, file);
    try {
      const rawData = fs.readFileSync(filePath);
      const session = JSON.parse(rawData);

      // Reset only if the last signal date is not today
      const today = new Date().toISOString().split("T")[0];
      if (session.lastSignalDate !== today) {
        session.signalCount = 0;
        session.tradingPlanCount = 0; // Reset trading plan count too
        session.lastSignalDate = today;
      }

      fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    } catch (error) {
      console.error(`Failed to process session file ${file}:`, error.message);
    }
  });

  console.log("♻️ Daily limits reset at midnight WIB");
};

// Schedule daily reset at 00:00 WIB (17:00 UTC)
cron.schedule("0 17 * * *", resetDailyLimits, {
  timezone: "Asia/Jakarta",
  scheduled: true,
});

// === CONFIG ===
// Satu URL Webhook untuk semua AI model
const AI_WEBHOOK_URL =
  "https://berlaskhristian.app.n8n.cloud/webhook/ask-market";

const AI_MODELS = {
  gpt4: {
    name: "GPT 4.1",
    webhook: AI_WEBHOOK_URL,
  },
  deepseek: {
    name: "Deepseek",
    webhook: AI_WEBHOOK_URL,
  },
  gemini: {
    name: "Gemini",
    webhook: AI_WEBHOOK_URL,
  },
};

// === INDIKATOR GROUPS ===
const INDICATOR_GROUPS = {
  freemium: [
    "Support & Resist",
    "Volume",
    "MACD",
    "Candlestick Pattern",
    "Stochastic",
    "Stop Level",
    "Relative Stock Index",
  ],
  premium: [
    "Support & Resist",
    "Volume",
    "MACD",
    "Candlestick Pattern",
    "Stochastic",
    "Stop Level",
    "Fair Value Gap",
    "Momentum",
    "Bollinger",
    "Relative Stock Index",
    "Order Block",
    "Trend",
    "System (Long/Short)",
    "ADX",
    "Parabolic SAR",
  ],
  pro: [
    "Relative Stock Index",
    "MACD",
    "Bollinger",
    "Volume",
    "Fibonacci",
    "Fair Value Gap",
    "Stochastic",
    "Candlestick Pattern",
    "Recent Price Action",
    "Support & Resist",
    "Trend",
    "Trend ROC",
    "CCI",
    "Momentum",
    "Baseline",
    "Volatility Filter",
    "Stop Level",
    "Order Block",
    "Liquidity Block",
    "System (Long/Short)",
    "Bull/Bear Cross",
    "ADX",
    "Explosion",
    "Parabolic SAR",
    "ATR",
    "Pivot Points",
    "Forex Swing Trader",
    "EMA",
    "SMA",
  ],
};

const TIERS = {
  freemium: {
    dailyLimit: 3,
    indicatorLimit: INDICATOR_GROUPS.freemium.length, // Dinamis berdasarkan grup
    ai: ["gpt4"],
    cooldown: 300, // seconds
    tradingPlanLimit: 1, // new limit for trading plans
    icon: "🆓",
  },
  premium: {
    dailyLimit: 10,
    indicatorLimit: INDICATOR_GROUPS.premium.length, // Dinamis berdasarkan grup
    ai: ["gpt4", "gemini"],
    cooldown: 60, // seconds
    tradingPlanLimit: 3,
    icon: "⭐",
  },
  pro: {
    dailyLimit: 30,
    indicatorLimit: INDICATOR_GROUPS.pro.length, // Dinamis berdasarkan grup
    ai: ["gpt4", "deepseek", "gemini"],
    cooldown: 5, // seconds
    tradingPlanLimit: 7,
    icon: "⚡",
    specialFeatures: ["unlimited"],
  },
};

const MARKET_SYMBOLS = {
  forex: ["XAU/USD", "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD"],
  crypto: ["BTC/USD", "ETH/USD", "BNB/USD", "SOL/USD", "DOGE/USD"],
};

const TIMEFRAMES = [
  "1min",
  "5min",
  "15min",
  "30min",
  "1h",
  "2h",
  "4h",
  "1day",
  "1week",
  "1month",
];

// === INIT ===
const bot = new Bot("7592814330:AAEBVPjkDzPrK-uS2-YBZ520-EsWcQLCYvw"); // Replace with your actual bot token

// === MODIFIED SESSION ===
bot.use(
  session({
    initial: () => ({
      tier: "freemium",
      signalCount: 0,
      lastSignalTime: 0,
      lastCallbackTime: 0,
      lastSignalDate: new Date().toISOString().split("T")[0],
      totalSignalCount: 0, // Total signals across all days
      joinDate: new Date().toISOString().split("T")[0],
      aiUsage: {
        gpt4: 0,
        gemini: 0,
        deepseek: 0,
      },
      forexUsage: 0,
      cryptoUsage: 0,
      selectedAI: null, // Initialize selected AI
      selectedMarketType: null,
      selectedSymbol: null,
      selectedTimeframe: null,
      tradingPlanCount: 0, // new field for trading plan usage
      lastTradingPlanTime: 0, // new field for trading plan cooldown
      lastUpgradeDate: new Date().toISOString().split("T")[0], // Track last upgrade date
      tierExpiryDate: null, // Placeholder for tier expiry if applicable
    }),
    storage: new FileAdapter({ dirName: "./sessions" }),
  })
);

// === FIXED MAIN MENU ===
function createMainMenu(ctx, additionalText = "") {
  const tier = ctx.session.tier || "freemium";
  const ai = ctx.session.selectedAI;
  const aiName = ai ? AI_MODELS[ai]?.name : "❌ Not selected";

  let usageText = "";
  if (ctx.session.signalCount !== undefined && TIERS[tier]) {
    const limit = TIERS[tier].dailyLimit === 30 ? "30" : TIERS[tier].dailyLimit;
    usageText = `\n📊 Signals today: ${ctx.session.signalCount}/${limit}`;
  }

  const menu = {
    text: `🧠 AI: ${aiName} | 📊 Tier: ${tier.toUpperCase()}${usageText}\n${additionalText}`,
    reply_markup: new InlineKeyboard()
      .text("🔁 Change AI", "menu_ai")
      .row()
      .text("📡 Ask Signal", "ask_market")
      .row()
      .text("📝 Trading Plan", "ask_trading_plan") // New button
      .row()
      .text("💎 Plan Status", "menu_plan_status") // Renamed callback
      .text("📈 Stats", "menu_stats") // New button
      .row()
      .text("⬆️ Upgrade", "menu_upgrade"), // Placed upgrade separately
  };

  return menu;
}

// === START / MENU ===
bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("⚙️ Choose AI", "menu_ai")
    .row()
    .text("💎 View Plans", "menu_upgrade")
    .row()
    .text("📄 Main Menu", "menu");

  await ctx.reply(
    `👋 Welcome to CortexSignal AI Bot!\n\n` +
      `Get premium trading signals for Forex and Crypto powered by multiple AI models. Choose your plan and start now!\n\n` +
      `💼 Available Plans:\n` +
      `⭐️ Freemium: 3 signals/day + ${INDICATOR_GROUPS.freemium.length} Indicators\n` +
      `✨ Premium: 10 signals/day + ${INDICATOR_GROUPS.premium.length} Indicators\n` +
      `🚀 Pro: 30 signals/day + access to all AIs + ${INDICATOR_GROUPS.pro.length} Indicators\n\n` +
      `👇 Select an option to continue:`,
    { reply_markup: keyboard }
  );
});

bot.command("menu", async (ctx) => {
  await ctx.reply(createMainMenu(ctx).text, {
    reply_markup: createMainMenu(ctx).reply_markup,
  });
});

// =========Help Command============
bot.command("help", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("📄 Main Menu", "menu")
    .row()
    .text("💎 View Plans", "menu_upgrade");

  await ctx.reply(
    `
🤖 *CortexSignal AI Trading Bot Help Guide*

Welcome! Here's how to get started and use the bot effectively:

📌 *Commands:*
/start – Restart the bot
/help – Show this help menu 
/menu – Open the main menu
/stast – View your current plan and signal count

🧠 *AI Models:*
Choose from multiple AI engines to get tailored trading signals. Use the main menu to select your preferred model.

📈 *How to Request a Signal:*
1. Tap *Ask Signal* in the menu.
2. Select Market Type (Forex or Crypto).
3. Choose your Symbol and Timeframe.
4. Get your signal instantly (subject to your plan limits).

⭐️ *Plans:*
- Free: 3 signals/day
- Premium: 10 signals/day
- Pro: 30 signals/day + advanced models

💎 *Features:*
- Multi-AI selection
- Market & timeframe filtering
- Daily signal limits
- Indicator-based strategies (coming soon!)

🛟 *Need Help?*
If you're stuck or found a bug, contact support at: [@YourSupportHandle]

Happy trading! 🚀
  `,
    { reply_markup: keyboard }
  );
});

// === AI SELECTION MENU ===
bot.callbackQuery("menu_ai", async (ctx) => {
  const tier = ctx.session.tier;
  const tierAI = TIERS[tier].ai;
  const keyboard = new InlineKeyboard();

  keyboard.text("✅ GPT 4.1", "use_gpt4").row();

  if (tierAI.includes("gemini")) {
    keyboard.text("✅ Gemini 2.5 Pro", "use_gemini");
  } else {
    keyboard.text("🔒 Gemini", "lock_ai_gemini");
  }
  keyboard.row();

  if (tierAI.includes("deepseek")) {
    keyboard.text("✅ Deepseek R1-0528", "use_deepseek");
  } else {
    keyboard.text("🔒 Deepseek R1-0528", "lock_ai_deepseek");
  }

  keyboard.row().text("🔙 Back to Main Menu", "menu");

  await ctx.editMessageText(
    `🤖 *Choose an AI model:*\n\n` +
      `Each AI is trained with different strategies. You can switch between them anytime.\n\n` +
      `🔹 GPT 4.1 — Balanced & safe signals (Freemium)\n` +
      `🔹 Gemini 2.5 Pro — Balanced & safe signals (Premium)\n` +
      `🔹 Deepseek — AI with smarter entry/exit with DeepThink R1 (Pro)\n\n` +
      `👇 Pick your AI to continue:`,
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );
  await ctx.answerCallbackQuery();
});

// === AI SELECT HANDLERS ===
bot.callbackQuery("use_gpt4", async (ctx) => {
  ctx.session.selectedAI = "gpt4";
  await ctx.answerCallbackQuery("✅ GPT 4.1 selected!");
  await ctx.editMessageText(createMainMenu(ctx).text, {
    reply_markup: createMainMenu(ctx).reply_markup,
  });
});

bot.callbackQuery("use_gemini", async (ctx) => {
  ctx.session.selectedAI = "gemini";
  await ctx.answerCallbackQuery("✅ Gemini 2.5 selected!");
  await ctx.editMessageText(createMainMenu(ctx).text, {
    reply_markup: createMainMenu(ctx).reply_markup,
  });
});

bot.callbackQuery("use_deepseek", async (ctx) => {
  ctx.session.selectedAI = "deepseek";
  await ctx.answerCallbackQuery("✅ Deepseek R1-0528 selected!");
  await ctx.editMessageText(createMainMenu(ctx).text, {
    reply_markup: createMainMenu(ctx).reply_markup,
  });
});

// === LOCKED AI HANDLERS ===
bot.callbackQuery(["lock_ai_gemini", "lock_ai_deepseek"], async (ctx) => {
  const data = ctx.callbackQuery.data;
  const aiName =
    data === "lock_ai_gemini" ? "Gemini 2.5 Pro" : "Deepseek R1-0528";
  const requiredTier = data === "lock_ai_gemini" ? "Premium" : "Pro";

  await ctx.answerCallbackQuery(ctx.callbackQuery.id, {
    text: `🚫 ${aiName} is not available in your current plan.`,
    show_alert: true,
  });

  const upgradeKeyboard = new InlineKeyboard()
    .url("⚡ Upgrade Now", "https://your-upgrade-page.com") // Replace with your actual upgrade page URL
    .row()
    .text("🔙 Back to AI Menu", "menu_ai");

  await ctx.reply(
    `💡 *${aiName} is locked.*\nUpgrade to *${requiredTier}* to unlock this AI model.`,
    { parse_mode: "Markdown", reply_markup: upgradeKeyboard }
  );
});

// === ASK SIGNAL FLOW ===
bot.callbackQuery("ask_market", async (ctx) => {
  if (!ctx.session.selectedAI) {
    await ctx.answerCallbackQuery({
      text: "Please choose an AI model first!",
      show_alert: true,
    });
    return;
  }

  const now = Date.now();
  const tier = TIERS[ctx.session.tier];
  if (now - ctx.session.lastSignalTime < tier.cooldown * 1000) {
    const timeLeft = Math.ceil(
      (tier.cooldown * 1000 - (now - ctx.session.lastSignalTime)) / 1000
    );
    await ctx.answerCallbackQuery({
      text: `⏳ Cooldown active. Please wait ${timeLeft} seconds before asking for another signal.`,
      show_alert: true,
    });
    return;
  }

  // Check daily limit
  if (ctx.session.signalCount >= tier.dailyLimit) {
    await ctx.answerCallbackQuery({
      text: "🚫 Daily signal limit reached. Upgrade your plan for more signals!",

      show_alert: true,
    });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("📈 Forex", "select_market_forex_signal")
    .text("💰 Crypto", "select_market_crypto_signal")
    .row()
    .text("🔙 Back to Main Menu", "menu");

  await ctx.editMessageText(`🌐 *Select a market type for the signal:*`, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
  await ctx.answerCallbackQuery();
});

// Handle market type selection for signal
bot.callbackQuery(/select_market_(forex|crypto)_signal/, async (ctx) => {
  const marketType = ctx.match[1];
  ctx.session.selectedMarketType = marketType;
  const symbols = MARKET_SYMBOLS[marketType];
  const keyboard = new InlineKeyboard();

  symbols.forEach((symbol) => {
    keyboard.text(symbol, `select_symbol_${marketType}_${symbol}_signal`);
  });

  keyboard.row().text("🔙 Back", "ask_market");

  await ctx.editMessageText(`📊 *Select a symbol for ${marketType}:*`, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
  await ctx.answerCallbackQuery();
});

// Handle symbol selection for signal
bot.callbackQuery(/select_symbol_(forex|crypto)_(.+)_signal/, async (ctx) => {
  const [, marketType, symbol] = ctx.match;
  ctx.session.selectedSymbol = symbol;
  const keyboard = new InlineKeyboard();

  TIMEFRAMES.forEach((timeframe) => {
    keyboard.text(timeframe, `select_timeframe_${timeframe}_signal`);
  });

  keyboard.row().text("🔙 Back", `select_market_${marketType}_signal`);

  await ctx.editMessageText(`⏰ *Select a timeframe for ${symbol}:*`, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
  await ctx.answerCallbackQuery();
});

// Handle timeframe selection and send signal
bot.callbackQuery(/select_timeframe_(.+)_signal/, async (ctx) => {
  const timeframe = ctx.match[1];
  ctx.session.selectedTimeframe = timeframe;

  const {
    selectedAI,
    selectedSymbol,
    selectedMarketType,
    selectedTimeframe,
    tier,
  } = ctx.session;

  if (!selectedAI || !selectedSymbol || !selectedTimeframe) {
    await ctx.answerCallbackQuery({
      text: "❌ Missing selection. Please start over.",
      show_alert: true,
    });
    await ctx.editMessageText(createMainMenu(ctx, "Please try again.").text, {
      reply_markup: createMainMenu(ctx).reply_markup,
    });
    return;
  }
  // Jawab callback query segera untuk menghilangkan jam pasir
  await ctx.answerCallbackQuery("🔍 Generating signal, please wait...");

  await ctx.reply(
    `Generating a *${selectedMarketType.toUpperCase()}* signal for *${selectedSymbol}* on *${selectedTimeframe}* using *${
      AI_MODELS[selectedAI].name
    }*...`,
    { parse_mode: "Markdown" }
  );

  // Kirim pesan awal progress bar
  const initialMessage = await ctx.reply(
    "Processing your request...\n" + getDynamicProgressBar(0, 3)
  ); // 3 langkah contoh
  const messageIdToEdit = initialMessage.message_id;
  const chatIdToEdit = initialMessage.chat.id;

  try {
    // === Langkah 1: Persiapan ===
    // Simulasi pekerjaan
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Tunggu 1 detik
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      "Analyzing Chart Pattern and All indicator...\n" +
        getDynamicProgressBar(1, 3)
    );

    // === Langkah 2: Memanggil Webhook ===
    const webhookUrl = AI_MODELS[selectedAI].webhook;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: ctx.from.id,
        marketType: selectedMarketType,
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        ai: selectedAI,
        type: "signal",
        indicators: INDICATOR_GROUPS[tier],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook API error: ${response.status} - ${errorText}`);
    }
    // Perbarui progress setelah webhook dipanggil
    await new Promise((resolve) => setTimeout(resolve, 15000));
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      "AI Analyzing the best trading signal...\n" + getDynamicProgressBar(2, 3)
    );

    // === Langkah 3: Finalisasi ===
    // Update session stats
    ctx.session.signalCount++;
    ctx.session.totalSignalCount++;
    ctx.session.lastSignalTime = Date.now();
    ctx.session.aiUsage[selectedAI] =
      (ctx.session.aiUsage[selectedAI] || 0) + 1;
    if (selectedMarketType === "forex") {
      ctx.session.forexUsage++;
    } else if (selectedMarketType === "crypto") {
      ctx.session.cryptoUsage++;
    }

    // Perbarui progress bar menjadi 100% dan tambahkan pesan sukses
    await new Promise((resolve) => setTimeout(resolve, 10000));
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      "✅ Signal generated successfully!\n" + getDynamicProgressBar(3, 3)
    );
    await ctx.reply(
      "Your signal has been sent to you! Check your chat for the detailed signal."
    );
  } catch (error) {
    console.error("Error sending signal to webhook:", error);
    // Jika ada error, perbarui pesan progress bar menjadi error
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      `❌ Failed to generate signal. Error: ${error.message}`
    );
    await ctx.reply(`Please try again later.`);
  } finally {
    // Reset selections
    ctx.session.selectedMarketType = null;
    ctx.session.selectedSymbol = null;
    ctx.session.selectedTimeframe = null;
    // Mungkin Anda ingin menghapus atau mengedit pesan progress bar ke menu utama setelah beberapa saat
    // atau biarkan pesan error/sukses tetap ada
    await ctx.reply(createMainMenu(ctx).text, {
      reply_markup: createMainMenu(ctx).reply_markup,
    });
  }
});

// === ASK TRADING PLAN FLOW (NEW) ===
bot.callbackQuery("ask_trading_plan", async (ctx) => {
  if (!ctx.session.selectedAI) {
    await ctx.answerCallbackQuery({
      text: "Please choose an AI model first!",
      show_alert: true,
    });
    return;
  }

  const now = Date.now();
  const tier = TIERS[ctx.session.tier];
  if (now - ctx.session.lastTradingPlanTime < tier.cooldown * 1000) {
    // Using same cooldown for now
    const timeLeft = Math.ceil(
      (tier.cooldown * 1000 - (now - ctx.session.lastTradingPlanTime)) / 1000
    );
    await ctx.answerCallbackQuery({
      text: `⏳ Cooldown active. Please wait ${timeLeft} seconds before asking for another trading plan.`,
      show_alert: true,
    });
    return;
  }

  // Check daily limit for trading plans
  if (ctx.session.tradingPlanCount >= tier.tradingPlanLimit) {
    await ctx.answerCallbackQuery({
      text: "🚫 Daily trading plan limit reached. Upgrade your plan!",

      show_alert: true,
    });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("📈 Forex", "select_market_forex_plan")
    .text("💰 Crypto", "select_market_crypto_plan")
    .row()
    .text("🔙 Back to Main Menu", "menu");

  await ctx.editMessageText(
    `📝 *Select a market type for your trading plan:*`,
    {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    }
  );
  await ctx.answerCallbackQuery();
});

// Handle market type selection for trading plan
bot.callbackQuery(/select_market_(forex|crypto)_plan/, async (ctx) => {
  const marketType = ctx.match[1];
  ctx.session.selectedMarketType = marketType; // Reuse session variable
  const symbols = MARKET_SYMBOLS[marketType];
  const keyboard = new InlineKeyboard();

  symbols.forEach((symbol) => {
    keyboard.text(symbol, `select_symbol_${marketType}_${symbol}_plan`);
  });

  keyboard.row().text("🔙 Back", "ask_trading_plan");

  await ctx.editMessageText(`📊 *Select a symbol for your trading plan:*`, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
  await ctx.answerCallbackQuery();
});

// Handle symbol selection for trading plan
bot.callbackQuery(/select_symbol_(forex|crypto)_(.+)_plan/, async (ctx) => {
  const [, marketType, symbol] = ctx.match;
  ctx.session.selectedSymbol = symbol; // Reuse session variable
  const keyboard = new InlineKeyboard();

  TIMEFRAMES.forEach((timeframe) => {
    keyboard.text(timeframe, `select_timeframe_${timeframe}_plan`);
  });

  keyboard.row().text("🔙 Back", `select_market_${marketType}_plan`);

  await ctx.editMessageText(`⏰ *Select a timeframe for your trading plan:*`, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
  await ctx.answerCallbackQuery();
});

// Handle timeframe selection and send trading plan request
bot.callbackQuery(/select_timeframe_(.+)_plan/, async (ctx) => {
  const timeframe = ctx.match[1];
  ctx.session.selectedTimeframe = timeframe;

  const {
    selectedAI,
    selectedSymbol,
    selectedMarketType,
    selectedTimeframe,
    tier,
  } = ctx.session;

  if (!selectedAI || !selectedSymbol || !selectedTimeframe) {
    await ctx.answerCallbackQuery({
      text: "❌ Missing selection. Please start over.",
      show_alert: true,
    });
    await ctx.editMessageText(createMainMenu(ctx, "Please try again.").text, {
      reply_markup: createMainMenu(ctx).reply_markup,
    });
    return;
  }

  await ctx.answerCallbackQuery("📝 Generating trading plan, please wait...");

  await ctx.reply(
    `Generating a trading plan for *${selectedSymbol}* on *${selectedTimeframe}* using *${AI_MODELS[selectedAI].name}*...`,
    { parse_mode: "Markdown" }
  );

  // Kirim pesan awal progress bar dan simpan ID pesannya
  const initialMessage = await ctx.reply(
    `Generating a trading plan for *${selectedSymbol}* on *${selectedTimeframe}* using *${
      AI_MODELS[selectedAI].name
    }*...\n${getDynamicProgressBar(0, 3)}`,
    { parse_mode: "Markdown" }
  );
  const messageIdToEdit = initialMessage.message_id;
  const chatIdToEdit = initialMessage.chat.id;

  try {
    // === Langkah 1: Memulai Pemrosesan ===
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulasi waktu pemrosesan awal
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      `Analyzing Chart Pattern and All indicator...\n${getDynamicProgressBar(
        1,
        3
      )}`,
      { parse_mode: "Markdown" }
    );

    // === Langkah 2: Memanggil Webhook ===
    const webhookUrl = AI_MODELS[selectedAI].webhook;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: ctx.from.id,
        marketType: selectedMarketType,
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        ai: selectedAI, // Send selected AI to webhook
        type: "trading_plan", // Indicate this is a trading plan request
        plan_details:
          "Generate a comprehensive trading plan based on the market conditions.", // Placeholder, extend as needed
        indicators: INDICATOR_GROUPS[tier], // <-- MENAMBAHKAN INDIKATOR SESUAI TIER
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook API error: ${response.status} - ${errorText}`);
    }

    // === Langkah 2: Menerima & Memproses Respons dari n8n ===
    // PENTING: Asumsikan n8n mengembalikan JSON dengan teks trading plan di dalamnya.
    // Misalnya, n8nResponseData = { "trading_plan_text": "Ini adalah rencana trading Anda..." }
    const n8nResponseData = await response.json(); // Ubah ke .text() jika responsnya hanya teks polos
    const tradingPlanText =
      n8nResponseData.trading_plan_text || n8nResponseData.text; // Ambil teks dari respons

    // === Langkah 3: Menerima dan Memproses Respons ===
    await new Promise((resolve) => setTimeout(resolve, 15000)); // Simulasi waktu pemrosesan respons
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      `AI Analyzing the best trading plan for *${selectedSymbol}* on *${selectedTimeframe}* using *${
        AI_MODELS[selectedAI].name
      }*...\n${getDynamicProgressBar(2, 3)}`,
      { parse_mode: "Markdown" }
    );

    console.log("Trading plan request sent to n8n successfully.");

    // Update session stats for trading plans
    ctx.session.tradingPlanCount++;
    ctx.session.lastTradingPlanTime = Date.now();

    // === Langkah 4: Finalisasi dan Pesan Sukses ===
    await new Promise((resolve) => setTimeout(resolve, 10000)); // Simulasi finalisasi
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      `✅ Your trading plan has been sent! Check your chat for details.\n${getDynamicProgressBar(
        3,
        3
      )}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error generating trading plan:", error);
    // Perbarui pesan progress bar dengan status error
    await ctx.api.editMessageText(
      chatIdToEdit,
      messageIdToEdit,
      `❌ Failed to generate trading plan. Please try again later.\nError: ${error.message}`,
      { parse_mode: "Markdown" }
    );
  } finally {
    // Reset selections
    ctx.session.selectedMarketType = null;
    ctx.session.selectedSymbol = null;
    ctx.session.selectedTimeframe = null;
    // Beri jeda singkat sebelum menampilkan menu utama lagi agar pengguna bisa membaca pesan terakhir
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await ctx.reply(createMainMenu(ctx).text, {
      reply_markup: createMainMenu(ctx).reply_markup,
    });
  }
});

// === PLAN STATUS MENU (NEW) ===
bot.callbackQuery("menu_plan_status", async (ctx) => {
  const tier = TIERS[ctx.session.tier];
  const progress = getProgressBar(ctx.session.signalCount, tier.dailyLimit);
  const tradingPlanProgress = getProgressBar(
    ctx.session.tradingPlanCount,
    tier.tradingPlanLimit
  );

  const lastUpgradeDate = ctx.session.lastUpgradeDate
    ? new Date(ctx.session.lastUpgradeDate).toLocaleDateString()
    : "N/A";
  const tierExpiryDate = ctx.session.tierExpiryDate
    ? new Date(ctx.session.tierExpiryDate).toLocaleDateString()
    : "N/A";

  await ctx.editMessageText(
    `🧾 *YOUR PLAN STATUS*\n\n` +
      `🆔 Tier: ${tier.icon} ${ctx.session.tier.toUpperCase()}\n` +
      `📊 Signals today: ${progress}\n` +
      `📝 Trading Plans today: ${tradingPlanProgress}\n` +
      `📈 Total Signals Generated: ${ctx.session.totalSignalCount}\n` +
      `⏱️ Cooldown: ${tier.cooldown}s\n` +
      `💎 Indicators available: ${tier.indicatorLimit}\n` + // Menampilkan jumlah indikator
      `🗓️ Last Upgrade: ${lastUpgradeDate}\n` +
      `⏳ Tier Expiry: ${tierExpiryDate}\n\n` +
      `👤 Joined: ${new Date(ctx.session.joinDate).toLocaleDateString()}`,
    {
      reply_markup: new InlineKeyboard().text("🔙 Back to Main Menu", "menu"),
      parse_mode: "Markdown",
    }
  );
  await ctx.answerCallbackQuery();
});

// === STATS MENU (NEW) ===
bot.callbackQuery("menu_stats", async (ctx) => {
  const totalMarketTrades = ctx.session.forexUsage + ctx.session.cryptoUsage;
  const forexPercentage =
    totalMarketTrades > 0
      ? ((ctx.session.forexUsage / totalMarketTrades) * 100).toFixed(1)
      : 0;
  const cryptoPercentage =
    totalMarketTrades > 0
      ? ((ctx.session.cryptoUsage / totalMarketTrades) * 100).toFixed(1)
      : 0;

  const totalAITrades =
    ctx.session.aiUsage.gpt4 +
    ctx.session.aiUsage.gemini +
    ctx.session.aiUsage.deepseek;
  const gptPercentage =
    totalAITrades > 0
      ? ((ctx.session.aiUsage.gpt4 / totalAITrades) * 100).toFixed(1)
      : 0;
  const geminiPercentage =
    totalAITrades > 0
      ? ((ctx.session.aiUsage.gemini / totalAITrades) * 100).toFixed(1)
      : 0;
  const deepseekPercentage =
    totalAITrades > 0
      ? ((ctx.session.aiUsage.deepseek / totalAITrades) * 100).toFixed(1)
      : 0;

  await ctx.editMessageText(
    `📊 *YOUR USAGE STATS*\n\n` +
      `🌐 *Market Usage:*\n` +
      `  📈 Forex: ${forexPercentage}%\n` +
      `  💰 Crypto: ${cryptoPercentage}%\n\n` +
      `🧠 *AI Model Usage:*\n` +
      `  🔹 GPT 4.1: ${gptPercentage}%\n` +
      `  🔸 Gemini: ${geminiPercentage}%\n` +
      `  ⚡ Deepseek: ${deepseekPercentage}%\n\n` +
      `Total Signals Generated: ${ctx.session.totalSignalCount}`,
    {
      reply_markup: new InlineKeyboard().text("🔙 Back to Main Menu", "menu"),
      parse_mode: "Markdown",
    }
  );
  await ctx.answerCallbackQuery();
});

// === UPGRADE BUTTON ENHANCEMENT ===
bot.callbackQuery("menu_upgrade", async (ctx) => {
  const currentTier = ctx.session.tier;
  const keyboard = new InlineKeyboard();

  if (currentTier !== "premium") {
    keyboard.text("🌟 Premium (10 signals/day)", "upgrade_premium");
  }
  if (currentTier !== "pro") {
    keyboard.text("🚀 PRO (30 signals/day)", "upgrade_pro");
  }

  keyboard.row().text("🔙 Back to Main Menu", "menu");

  await ctx.editMessageText(
    `💎 Upgrade Options\n\n` +
      `Current plan: ${currentTier.toUpperCase()}\n` +
      `Today's signal usage: ${ctx.session.signalCount}/${TIERS[currentTier].dailyLimit}\n` +
      `Today's trading plan usage: ${ctx.session.tradingPlanCount}/${TIERS[currentTier].tradingPlanLimit}`,
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("upgrade_premium", async (ctx) => {
  ctx.session.tier = "premium";
  ctx.session.lastUpgradeDate = new Date().toISOString().split("T")[0]; // Update upgrade date
  // Anda mungkin ingin mereset daily limits di sini jika upgrade di tengah hari
  // ctx.session.signalCount = 0;
  // ctx.session.tradingPlanCount = 0;
  await ctx.answerCallbackQuery("✅ Upgraded to Premium!");
  await ctx.editMessageText(createMainMenu(ctx).text, {
    reply_markup: createMainMenu(ctx).reply_markup,
  });
});

bot.callbackQuery("upgrade_pro", async (ctx) => {
  ctx.session.tier = "pro";
  ctx.session.lastUpgradeDate = new Date().toISOString().split("T")[0]; // Update upgrade date
  // Anda mungkin ingin mereset daily limits di sini jika upgrade di tengah hari
  // ctx.session.signalCount = 0;
  // ctx.session.tradingPlanCount = 0;
  await ctx.answerCallbackQuery("🚀 Upgraded to PRO!");
  await ctx.editMessageText(createMainMenu(ctx).text, {
    reply_markup: createMainMenu(ctx).reply_markup,
  });
});

bot.callbackQuery("menu", async (ctx) => {
  await ctx.editMessageText(createMainMenu(ctx).text, {
    reply_markup: createMainMenu(ctx).reply_markup,
  });
  await ctx.answerCallbackQuery();
});

bot.start();
console.log("🤖 Bot is running");
