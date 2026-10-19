
import dotenv from "dotenv";
import { Bot } from "grammy";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env.bot");
const envResult = dotenv.config({ path: envPath });

if (envResult.error) {
  throw new Error(`Could not load .env.bot at ${envPath}`);
}

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const adminIdText = process.env.ADMIN_TELEGRAM_ID?.trim();
const adminId = Number(adminIdText);

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing in .env.bot");
}


if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing in .env.bot");
}

if (!adminIdText || !Number.isSafeInteger(adminId) || adminId <= 0) {
  throw new Error("ADMIN_TELEGRAM_ID must be your numeric Telegram user ID");
}

const bot = new Bot(token);

bot.use(async (ctx, next) => {
  if (ctx.message) {
    console.log(
      "[DEBUG] Incoming message:",
      ctx.message.video ? "VIDEO" :
      ctx.message.document ? "DOCUMENT" :
      ctx.message.text ? "TEXT" : "OTHER"
    );
  }
  await next();
});


bot.command("start", async (ctx) => {
  if (ctx.from?.id !== adminId) {
    await ctx.reply("This bot is private.");
    console.log(`Unauthorized /start attempt from Telegram user ${ctx.from?.id}`);
    return;
  }

  await ctx.reply(
    "SenpaiFlix bot is online! ✅\n\n" +
    "Telegram connection is working.\n" +
    "Video upload integration is the next step."
  );
});

bot.command("ping", async (ctx) => {
  if (ctx.from?.id !== adminId) {
    await ctx.reply("This bot is private.");
    return;
  }

  await ctx.reply("Pong! 🟢 SenpaiFlix bot is running.");
});


// VIDEO_RECEIVE_HANDLER
type PendingUpload = {
  fileId: string;
  fileName: string;
  mimeType: string;
  title?: string;
  episode?: string;
};

const pendingUploads = new Map<number, PendingUpload>();

bot.on(["message:video", "message:document"], async (ctx) => {
  if (ctx.from?.id !== adminId) {
    await ctx.reply("This bot is private.");
    return;
  }

  const message = ctx.message;
  const file = message.video ?? message.document;
  if (!file) return;

  if (!message.video && !file.mime_type?.startsWith("video/")) {
    await ctx.reply("Please send a video file.");
    return;
  }

  if (file.file_size && file.file_size > 20 * 1024 * 1024) {
    await ctx.reply("Test upload limit is 20 MB. Please send a smaller video.");
    return;
  }

  pendingUploads.set(ctx.from.id, {
    fileId: file.file_id,
    fileName: ("file_name" in file && file.file_name) || "video.mp4",
    mimeType: file.mime_type || "video/mp4",
  });

  console.log("[VIDEO] Received video; waiting for anime title.");
  await ctx.reply("Video received! 🎬\nEnter the anime title:");
});

bot.on("message:text", async (ctx) => {
  if (ctx.from?.id !== adminId) return;

  const state = pendingUploads.get(ctx.from.id);
  if (!state) return;

  const value = ctx.message.text.trim();
  if (!value || value.startsWith("/")) return;

  if (!state.title) {
    state.title = value.slice(0, 150);
    await ctx.reply("Enter the episode number (e.g. 01):");
    return;
  }

  if (!state.episode) {
    if (!/^[a-zA-Z0-9._-]{1,20}$/.test(value)) {
      await ctx.reply("Use a simple episode number, e.g. 01 or 12.");
      return;
    }

    state.episode = value;
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
        throw new Error(`Telegram download failed (HTTP ${download.status}).`);
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
      form.append("meta", JSON.stringify({
        name: `${state.title} - Episode ${state.episode}`,
        animeTitle: state.title,
        episode: state.episode,
      }));

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
        result?: { uid?: string };
      };

      if (!response.ok || !result.success || !result.result?.uid) {
        const reason = result.errors?.map((e) => e.message).filter(Boolean).join("; ");
        throw new Error(reason || `Cloudflare upload failed (HTTP ${response.status}).`);
      }

      const uid = result.result.uid;
      const hlsUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;

      await ctx.reply(
        `Cloudflare upload accepted! ✅\n\n` +
        `Anime: ${state.title}\nEpisode: ${state.episode}\n` +
        `Video ID: ${uid}\nHLS URL:\n${hlsUrl}\n\n` +
        `Wait for Cloudflare processing before testing playback.`
      );
      console.log("[UPLOAD] Cloudflare accepted video:", uid);
    } catch (error) {
      console.error("[UPLOAD] Failed:", error instanceof Error ? error.message : "Unknown error");
      await ctx.reply(
        `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      pendingUploads.delete(ctx.from.id);
    }
  }
});

bot.catch((error) => {
  console.error("Telegram handler error:", error);
});

async function main() {
  console.log(`Loading environment from: ${envPath}`);

  const me = await bot.api.getMe();
  console.log(`Connected to Telegram as @${me.username}`);

  await bot.start({
    onStart: () => {
      console.log("Bot is running. Send /start on Telegram.");
    },
  });
}

main().catch((error) => {
  console.error("Bot startup failed:", error.message ?? error);
  process.exitCode = 1;
});
