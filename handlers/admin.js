import { InlineKeyboard } from "grammy";
import fs from "fs";
import path from "path";

// Array of Telegram User IDs who are admins.
// !!! PENTING: GANTI INI DENGAN USER ID TELEGRAM ANDA !!!
// Anda bisa mendapatkan User ID Telegram Anda dari bot seperti @userinfobot
const ADMIN_IDS = [
  1224691426, // Contoh: 123456789
  //YOUR_TELEGRAM_USER_ID_2, // Contoh: 987654321
];

// --- UTILITY FUNCTIONS ---

const isAdmin = (userId) => ADMIN_IDS.includes(userId);

// --- ADMIN MENU KEYBOARD ---

const createAdminKeyboard = () => {
  return new InlineKeyboard()
    .text("📢 Broadcast Message", "admin_broadcast_start")
    .row()
    .text("🔄 Reset All Daily Limits", "admin_reset_limits_confirm")
    .row()
    .text("📊 Show Global Stats", "admin_show_global_stats");
};

// --- ADMIN COMMAND HANDLERS ---

export const setupAdminHandlers = (bot) => {
  // Command: /admin
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("🚫 Access Denied: You are not an admin.");
      return;
    }

    await ctx.reply("⚙️ Admin Panel", {
      reply_markup: createAdminKeyboard(),
    });
  });

  // Callback Query: Start Broadcast
  bot.callbackQuery("admin_broadcast_start", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery("🚫 Access Denied", { show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery(); // Dismiss loading on button
    await ctx.reply(
      "📝 Please send the message you want to broadcast to all users. I will send it exactly as you type/send it. (e.g., text, photo, sticker)."
    );
    // Set admin's session to broadcast mode to capture the next message
    ctx.session.adminBroadcastMode = true;
  });

  // Handle incoming message when in broadcast mode
  bot.on("message", async (ctx) => {
    if (ctx.session.adminBroadcastMode && isAdmin(ctx.from.id)) {
      delete ctx.session.adminBroadcastMode; // Exit broadcast mode immediately

      await ctx.reply("⏳ Broadcasting message, please wait...");

      const sessionDir = path.resolve("./sessions");
      let sentCount = 0;
      let errorCount = 0;

      try {
        const files = fs.readdirSync(sessionDir);

        for (const file of files) {
          if (file.endsWith(".json")) {
            const filePath = path.join(sessionDir, file);
            try {
              const rawData = fs.readFileSync(filePath);
              const sessionData = JSON.parse(rawData);
              const userId = parseInt(file.replace(".json", "")); // User ID is the filename

              if (userId === ctx.from.id) {
                // Don't send broadcast to admin themselves
                continue;
              }

              // Forward the message to each user
              await ctx.copyMessage(userId);
              sentCount++;
              // Add a small delay to avoid hitting Telegram API limits
              await new Promise((resolve) => setTimeout(resolve, 50));
            } catch (fileError) {
              console.error(
                `Error processing session file ${file}:`,
                fileError
              );
              errorCount++;
            }
          }
        }
        await ctx.reply(
          `✅ Broadcast finished!\nSent to ${sentCount} users. Failed for ${errorCount} users.`
        );
      } catch (dirError) {
        console.error("Error reading session directory:", dirError);
        await ctx.reply("❌ Failed to read user sessions for broadcast.");
      }
    }
  });

  // Callback Query: Confirm Reset All Daily Limits
  bot.callbackQuery("admin_reset_limits_confirm", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery("🚫 Access Denied", { show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery(); // Dismiss loading on button
    await ctx.reply(
      "⚠️ Are you sure you want to reset ALL daily signal and trading plan limits for ALL users? This action cannot be undone.",
      {
        reply_markup: new InlineKeyboard()
          .text("✅ Yes, Reset All", "admin_reset_limits_execute")
          .text("❌ No, Cancel", "admin_cancel"),
      }
    );
  });

  // Callback Query: Execute Reset All Daily Limits
  bot.callbackQuery("admin_reset_limits_execute", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery("🚫 Access Denied", { show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery(); // Dismiss loading on button
    await ctx.reply("⏳ Resetting all daily limits, please wait...");

    const sessionDir = path.resolve("./sessions");
    let resetCount = 0;
    let errorCount = 0;

    try {
      const files = fs.readdirSync(sessionDir);

      files.forEach((file) => {
        if (file.endsWith(".json")) {
          const filePath = path.join(sessionDir, file);
          try {
            const rawData = fs.readFileSync(filePath);
            const session = JSON.parse(rawData);

            // Reset signal and trading plan counts
            session.signalCount = 0;
            session.tradingPlanCount = 0;
            // Also update date to current day to ensure daily limit calculation resets correctly
            session.lastSignalDate = new Date().toISOString().split("T")[0];
            session.lastTradingPlanDate = new Date()
              .toISOString()
              .split("T")[0];

            fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
            resetCount++;
          } catch (fileError) {
            console.error(
              `Error resetting limits for session file ${file}:`,
              fileError
            );
            errorCount++;
          }
        }
      });
      await ctx.reply(
        `✅ All daily limits have been reset for ${resetCount} users. Failed for ${errorCount} users.`
      );
    } catch (dirError) {
      console.error("Error reading session directory for reset:", dirError);
      await ctx.reply("❌ Failed to reset all daily limits.");
    }
  });

  // Callback Query: Show Global Stats
  bot.callbackQuery("admin_show_global_stats", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery("🚫 Access Denied", { show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery(); // Dismiss loading on button

    const sessionDir = path.resolve("./sessions");
    let totalUsers = 0;
    let totalSignalsGenerated = 0;
    let totalTradingPlansGenerated = 0;
    let freeUsers = 0;
    let premiumUsers = 0;
    let proUsers = 0;

    try {
      const files = fs.readdirSync(sessionDir);
      totalUsers = files.filter((file) => file.endsWith(".json")).length;

      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(sessionDir, file);
          try {
            const rawData = fs.readFileSync(filePath);
            const session = JSON.parse(rawData);

            totalSignalsGenerated += session.signalCount || 0; // Sum up signal counts
            totalTradingPlansGenerated += session.tradingPlanCount || 0; // Sum up trading plan counts

            // Count users by tier
            if (session.tier === "free") {
              freeUsers++;
            } else if (session.tier === "premium") {
              premiumUsers++;
            } else if (session.tier === "pro") {
              proUsers++;
            }
          } catch (fileError) {
            console.error(
              `Error reading stats from session file ${file}:`,
              fileError
            );
          }
        }
      }

      await ctx.reply(
        `📊 *GLOBAL BOT STATS*\n\n` +
          `Total Users: ${totalUsers}\n` +
          `  - Free: ${freeUsers}\n` +
          `  - Premium: ${premiumUsers}\n` +
          `  - Pro: ${proUsers}\n\n` +
          `Total Signals Generated (today/since last reset): ${totalSignalsGenerated}\n` +
          `Total Trading Plans Generated (today/since last reset): ${totalTradingPlansGenerated}`
      );
    } catch (dirError) {
      console.error("Error reading session directory for stats:", dirError);
      await ctx.reply("❌ Failed to retrieve global stats.");
    }
  });

  // Callback Query: Cancel action (for confirmations)
  bot.callbackQuery("admin_cancel", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery("🚫 Access Denied", { show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery(); // Dismiss loading on button
    await ctx.reply("Action cancelled.");
  });
};
