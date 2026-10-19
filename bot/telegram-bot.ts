
import dotenv from "dotenv";
import { Bot } from "grammy";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.bot") });

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const adminId = Number(process.env.ADMIN_TELEGRAM_ID);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

if (!token || !Number.isSafeInteger(adminId) || adminId <= 0) {
  throw new Error("Check TELEGRAM_BOT_TOKEN and ADMIN_TELEGRAM_ID in .env.bot");
}
if (!accountId || !apiToken) {
  throw new Error("Cloudflare credentials are missing from .env.bot");
}

const bot = new Bot(token);
const pending = new Map<number, {
  fileId: string;
  fileName: string;
  mimeType: string;
  title?: string;
  episode?: string;
}>();

bot.use(async (ctx, next) => {
  if (ctx.from?.id !== adminId) {
    if (ctx.chat) await ctx.reply("This bot is private.");
    return;
  }
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "SenpaiFlix Upload Bot is online! ✅\n\n" +
    "Send a video up to 20 MB to begin.\n" +
    "Use /cancel to cancel an upload."
  );
});

bot.command("ping", async (ctx) => {
  await ctx.reply("Pong! 🟢");
});

bot.command("cancel", async (ctx) => {
  pending.delete(ctx.from.id);
  await ctx.reply("Current upload cancelled.");
});

bot.on(["message:video", "message:document"], async (ctx) => {
  const message = ctx.message;
  const file = message.video ?? message.document;

  if (!file) return;

  if (!file.mime_type?.startsWith("video/") &&
      !message.video) {
    await ctx.reply("Please send a video file.");
    return;
  }

  if (file.file_size && file.file_size > 20 * 1024 * 1024) {
    await ctx.reply(
      "This test bot supports files up to 20 MB only. " +
      "Large-file upload support is not configured yet."
    );
    return;
  }

  pending.set(ctx.from.id, {
    fileId: file.file_id,
    fileName: ("file_name" in file && file.file_name)
      ? file.file_name
      : "video.mp4",
    mimeType: file.mime_type ?? "video/mp4",
  });

  await ctx.reply("Video received! 🎬\nEnter the anime title:");
});

bot.on("message:text", async (ctx) => {
  const state = pending.get(ctx.from.id);
  if (!state) return;

  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  if (!state.title) {
    state.title = text.slice(0, 150);
    await ctx.reply("Now enter the episode number (e.g. 01):");
    return;
  }

  if (!state.episode) {
    if (!/^[a-zA-Z0-9._-]{1,20}$/.test(text)) {
      await ctx.reply("Use a simple episode number, e.g. 01 or 12.");
      return;
    }
    state.episode = text;

    await ctx.reply("Uploading to Cloudflare Stream… Please wait.");

    try {
      const telegramFile = await bot.api.getFile(state.fileId);
      if (!telegramFile.file_path) {
        throw new Error("Telegram did not return a file path.");
      }

      const downloadUrl =
        `https://api.telegram.org/file/bot${token}/${telegramFile.file_path}`;

      const download = await fetch(downloadUrl);
      if (!download.ok) {
        throw new Error("Could not download the Telegram video.");
      }

      const bytes = await download.arrayBuffer();
      if (bytes.byteLength > 20 * 1024 * 1024) {
        throw new Error("Video exceeds the 20 MB test limit.");
      }

      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: state.mimeType }),
        state.fileName
      );
      form.append(
        "meta",
        JSON.stringify({
          name: `${state.title} - Episode ${state.episode}`,
          animeTitle: state.title,
          episode: state.episode,
        })
      );

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}` },
          body: form,
        }
      );

      const result = await response.json() as {
        success?: boolean;
        errors?: { message?: string }[];
        result?: { uid?: string; readyToStream?: boolean };
      };

      if (!response.ok || !result.success || !result.result?.uid) {
        throw new Error(
          result.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
          `Cloudflare upload failed (HTTP ${response.status}).`
        );
      }

      const uid = result.result.uid;
      const hlsUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;

      await ctx.reply(
        `Upload request accepted! ✅\n\n` +
        `Anime: ${state.title}\n` +
        `Episode: ${state.episode}\n` +
        `Cloudflare video ID: ${uid}\n` +
        `HLS playback URL:\n${hlsUrl}\n\n` +
        `Processing may still be in progress. Check Stream status before playback.`
      );
    } catch (error) {
      console.error("Upload failed:", error);
      await ctx.reply(
        `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      pending.delete(ctx.from.id);
    }
  }
});

bot.catch((error) => {
  console.error("Telegram handler error:", error);
});

async function main() {
  const me = await bot.api.getMe();
  console.log(`Connected as @${me.username}`);
  await bot.start({
    onStart: () => console.log("Bot is running."),
  });
}

main().catch((error) => {
  console.error("Bot startup failed:", error);
  process.exitCode = 1;
});
