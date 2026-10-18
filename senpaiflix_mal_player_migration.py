#!/usr/bin/env python3
"""Safely migrate SenpaiFlix's catalogue/player to MAL-ID episode lookups.

Save this file in the `senpaiflix-web` directory and run:
    python senpaiflix_mal_player_migration.py

This script creates one-time backups before writing. It refuses to apply if the
expected original source patterns are not present, so it won't blindly rewrite a
substantially different checkout.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path.cwd()


def require_file(relative: str) -> Path:
    path = ROOT / relative
    if not path.is_file():
        raise SystemExit(
            f"Missing {relative}. Run this script from the senpaiflix-web folder."
        )
    return path


def backup(path: Path) -> None:
    backup_path = path.with_name(path.name + ".before-mal-player.bak")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)


def exact_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}.")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}.")
    return updated


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, found {count}.")
    return text.replace(old, new)


# Resolve and read every original file first. No writes happen until all transforms pass.
required = {
    "anime": require_file("app/api/anime/route.ts"),
    "episodes": require_file("app/api/episodes/route.ts"),
    "player": require_file("app/components/OfficialPlayer.tsx"),
    "page": require_file("app/page.tsx"),
    "data": require_file("data/episodes.json"),
    "package": require_file("package.json"),
}
contents = {key: path.read_text(encoding="utf-8") for key, path in required.items()}

if 'item.idMal' in contents["anime"] and 'malId={selected.id}' in contents["page"]:
    raise SystemExit("This migration already appears to be applied. No files changed.")

# 1. Keep AniList metadata, but make the UI-facing ID the MAL ID. Preserve AniList ID separately.
anime = contents["anime"]
anime = exact_once(
    anime,
    "        id\n        title { english romaji }",
    "        id\n        idMal\n        title { english romaji }",
    "request AniList idMal",
)
anime = exact_once(
    anime,
    "    const anime = data.media.map((item: {\n      id: number;",
    "    const anime = data.media\n      .filter((item: { idMal: number | null }) => Number.isInteger(item.idMal) && Number(item.idMal) > 0)\n      .map((item: {\n      id: number;\n      idMal: number | null;",
    "exclude titles with no MAL ID",
)
anime = exact_once(
    anime,
    "      id: item.id,\n      title: item.title.english || item.title.romaji,",
    "      id: Number(item.idMal),\n      anilistId: item.id,\n      title: item.title.english || item.title.romaji,",
    "expose MAL ID and retain AniList ID",
)

# 2. Episode API returns Jikan episode metadata, attaching only locally configured sources.
episodes_api = r'''import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfiguredEpisode = {
  malId?: number;
  animeTitle?: string;
  episodeNumber: number;
  title: string;
  videoUrl?: string;
  embedUrl?: string;
  watchUrl?: string;
  sources?: string[];
};

type JikanEpisode = {
  mal_id: number;
  title?: string | null;
  aired?: string | null;
  score?: number | null;
  filler?: boolean;
  recap?: boolean;
};

function configuredSources(episode?: ConfiguredEpisode): string[] {
  if (!episode) return [];
  const candidates = [
    ...(Array.isArray(episode.sources) ? episode.sources : []),
    episode.embedUrl ?? "",
    episode.videoUrl ?? "",
    episode.watchUrl ?? "",
  ];
  return [...new Set(candidates.filter((value): value is string => {
    if (typeof value !== "string") return false;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }))];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const malId = Number(params.get("malId"));
  const requestedCount = Math.min(200, Math.max(0, Number(params.get("count")) || 0));

  if (!Number.isInteger(malId) || malId <= 0) {
    return NextResponse.json(
      { episodes: [], error: "A valid MAL anime ID is required." },
      { status: 400 }
    );
  }

  try {
    const filePath = path.join(process.cwd(), "data", "episodes.json");
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { episodes?: ConfiguredEpisode[] };
    const configured = (parsed.episodes ?? []).filter(
      (episode) => Number(episode.malId) === malId
    );
    const configuredByNumber = new Map(
      configured.map((episode) => [Number(episode.episodeNumber), episode])
    );

    const liveEpisodes: Array<{
      malId: number;
      episodeNumber: number;
      title: string;
      aired: string | null;
      score: number | null;
      filler: boolean;
      recap: boolean;
      metadataFallback?: boolean;
      videoUrl?: string;
      embedUrl?: string;
      watchUrl?: string;
      sources: string[];
    }> = [];
    let metadataSource = "jikan";
    let hasJikanData = false;

    try {
      // Jikan supports up to 100 entries per page; cap calls to keep this route bounded.
      for (let page = 1; page <= 4; page += 1) {
        const response = await fetch(
          `https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`,
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          }
        );
        if (!response.ok) throw new Error(`Jikan returned ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload.data)) throw new Error("Invalid Jikan episode response");

        hasJikanData = hasJikanData || payload.data.length > 0;
        for (const item of payload.data as JikanEpisode[]) {
          const number = Number(item.mal_id);
          if (!Number.isInteger(number) || number <= 0) continue;
          const local = configuredByNumber.get(number);
          liveEpisodes.push({
            malId,
            episodeNumber: number,
            title: String(item.title || `Episode ${number}`),
            aired: item.aired ?? null,
            score: typeof item.score === "number" ? item.score : null,
            filler: Boolean(item.filler),
            recap: Boolean(item.recap),
            sources: configuredSources(local),
            ...(local ? {
              videoUrl: local.videoUrl,
              embedUrl: local.embedUrl,
              watchUrl: local.watchUrl,
            } : {}),
          });
        }

        const hasNextPage = Boolean(payload.pagination?.has_next_page);
        if (!hasNextPage || payload.data.length === 0) break;
        if (page < 4) await delay(400);
      }
    } catch (error) {
      metadataSource = "configured-fallback";
      console.warn("Jikan episode metadata unavailable:", error);
    }

    if (!hasJikanData) {
      metadataSource = "configured-fallback";
      liveEpisodes.length = 0;
      const configuredMax = Math.max(
        0,
        ...configured.map((episode) => Number(episode.episodeNumber) || 0)
      );
      const count = requestedCount || configuredMax || 12;
      for (let number = 1; number <= count; number += 1) {
        const local = configuredByNumber.get(number);
        liveEpisodes.push({
          malId,
          episodeNumber: number,
          title: local?.title || `Episode ${number}`,
          aired: null,
          score: null,
          filler: false,
          recap: false,
          metadataFallback: true,
          sources: configuredSources(local),
          ...(local ? {
            videoUrl: local.videoUrl,
            embedUrl: local.embedUrl,
            watchUrl: local.watchUrl,
          } : {}),
        });
      }
    }

    liveEpisodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    return NextResponse.json(
      { episodes: liveEpisodes, total: liveEpisodes.length, metadataSource },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Episode catalogue error:", error);
    return NextResponse.json(
      { episodes: [], error: "Episode catalogue could not be loaded." },
      { status: 500 }
    );
  }
}
'''

# 3. Stream lookup is deliberately local-config-only: it does not scrape or harvest embeds.
stream_api = r'''import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfiguredEpisode = {
  malId?: number;
  episodeNumber: number;
  title: string;
  videoUrl?: string;
  embedUrl?: string;
  watchUrl?: string;
  sources?: string[];
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const malId = Number(params.get("malId"));
  const episodeNumber = Number(params.get("episode"));

  if (!Number.isInteger(malId) || malId <= 0 ||
      !Number.isInteger(episodeNumber) || episodeNumber <= 0) {
    return NextResponse.json(
      { error: "Valid malId and episode are required.", sources: [] },
      { status: 400 }
    );
  }

  try {
    const filePath = path.join(process.cwd(), "data", "episodes.json");
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw) as { episodes?: ConfiguredEpisode[] };
    const entry = (data.episodes ?? []).find(
      (item) => Number(item.malId) === malId && Number(item.episodeNumber) === episodeNumber
    );

    if (!entry) {
      return NextResponse.json(
        { malId, episode: episodeNumber, title: `Episode ${episodeNumber}`, sources: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const candidates = [
      ...(Array.isArray(entry.sources) ? entry.sources : []),
      entry.embedUrl ?? "",
      entry.videoUrl ?? "",
      entry.watchUrl ?? "",
    ];
    const sources = [...new Set(candidates.filter((value): value is string => {
      if (typeof value !== "string") return false;
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }))];

    return NextResponse.json(
      {
        malId,
        episode: episodeNumber,
        title: entry.title || `Episode ${episodeNumber}`,
        sources,
        watchUrl: entry.watchUrl || entry.videoUrl || null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Stream source lookup error:", error);
    return NextResponse.json(
      { error: "Could not load configured sources.", sources: [] },
      { status: 500 }
    );
  }
}
'''

# 4. Add MAL ID props/types to the existing player and resolve an episode through the local route.
player = contents["player"]
player = exact_once(
    player,
    "type PlayerProps = {\n  title: string;\n  embedUrl?: string;",
    "type PlayerProps = {\n  title: string;\n  malId: number;\n  episodeCount?: number;\n  embedUrl?: string;",
    "player accepts MAL ID and episode count",
)
player = exact_once(
    player,
    "type Episode = {\n  animeTitle: string;",
    "type Episode = {\n  malId?: number;\n  metadataFallback?: boolean;\n  animeTitle?: string;",
    "player episode type",
)
player = exact_once(
    player,
    "export default function OfficialPlayer({\n  title,\n  embedUrl,",
    "export default function OfficialPlayer({\n  title,\n  malId,\n  episodeCount = 0,\n  embedUrl,",
    "player reads MAL ID props",
)
player = exact_once(
    player,
    "`/api/episodes?title=${encodeURIComponent(title)}`",
    "`/api/episodes?malId=${encodeURIComponent(String(malId))}&count=${encodeURIComponent(String(episodeCount))}`",
    "fetch episodes by MAL ID",
)
player = exact_once(
    player,
    "  }, [title, embedUrl, watchUrl]);",
    "  }, [title, malId, episodeCount, embedUrl, watchUrl]);",
    "episode loading dependencies",
)
old_play = '''  function playEpisode(episode: Episode) {
    const list = getSources(episode);

    if (!list.length) {
      setError("Is episode ke liye valid HTTPS MP4, HLS ya supported embed URL add karo.");
      return;
    }

    fallbackLock.current = false;
    setSources(list);
    setSourceIndex(0);
    setSelected(`${episode.episodeNumber}:${episode.title}`);
    setActiveWatchUrl(safeWatchUrl(episode.watchUrl || episode.videoUrl));
    setError("");
    setRetryCount((count) => count + 1);
  }'''
new_play = '''  async function playEpisode(episode: Episode) {
    setError("");
    let resolvedEpisode = episode;

    try {
      const response = await fetch(
        `/api/anime/stream?malId=${encodeURIComponent(String(malId))}&episode=${encodeURIComponent(String(episode.episodeNumber))}`,
        { cache: "no-store" }
      );
      if (response.ok) {
        const data = await response.json() as { sources?: string[]; watchUrl?: string | null };
        resolvedEpisode = {
          ...episode,
          sources: [
            ...(Array.isArray(episode.sources) ? episode.sources : []),
            ...(Array.isArray(data.sources) ? data.sources : []),
          ],
          watchUrl: data.watchUrl || episode.watchUrl,
        };
      }
    } catch {
      // Keep locally configured episode sources if the lookup request fails.
    }

    const list = getSources(resolvedEpisode);
    fallbackLock.current = false;
    setSelected(`${episode.episodeNumber}:${episode.title}`);

    if (!list.length) {
      setSources([]);
      setSourceIndex(0);
      setActiveWatchUrl("");
      setError("Is episode ka playable source configured nahi hai. data/episodes.json mein apna ya authorized HTTPS MP4, HLS, YouTube, ya Vimeo URL add karo.");
      return;
    }

    setSources(list);
    setSourceIndex(0);
    setActiveWatchUrl(safeWatchUrl(resolvedEpisode.watchUrl || resolvedEpisode.videoUrl));
    setError("");
    setRetryCount((count) => count + 1);
  }'''
player = exact_once(player, old_play, new_play, "episode source lookup in player")

# 5. Keep the black/white home and card layout, only change the metadata ID contract and modal player.
page = contents["page"]
page = exact_once(
    page,
    'import { AnimatePresence, motion } from "framer-motion";\nimport {',
    'import { AnimatePresence, motion } from "framer-motion";\nimport OfficialPlayer from "./components/OfficialPlayer";\nimport {',
    "import existing player component",
)
page = exact_once(
    page,
    "type Anime = {\n  id: number;\n  title: string;",
    "type Anime = {\n  id: number; // MyAnimeList ID\n  anilistId?: number;\n  title: string;",
    "document ID contract",
)
page = exact_once(
    page,
    "function normalizeAnime(\n  item: Record<string, unknown>,\n  index: number\n): Anime | null {",
    "function normalizeAnime(item: Record<string, unknown>): Anime | null {",
    "remove synthetic-index ID fallback parameter",
)
page = replace_count(
    page,
    ", index: number) => {",
    ") => {",
    2,
    "remove unused map indexes",
)
page = replace_count(
    page,
    "normalizeAnime(item as Record<string, unknown>, index);",
    "normalizeAnime(item as Record<string, unknown>);",
    2,
    "call normalization without synthetic ID fallback",
)
for old_id, new_id, label in [
    ('''    id: 1,\n    title: "Solo Leveling",''', '''    id: 52299,\n    title: "Solo Leveling",''', "Solo Leveling sample MAL ID"),
    ('''    id: 2,\n    title: "Attack on Titan",''', '''    id: 16498,\n    title: "Attack on Titan",''', "Attack on Titan sample MAL ID"),
    ('''    id: 3,\n    title: "Demon Slayer",''', '''    id: 38000,\n    title: "Demon Slayer",''', "Demon Slayer sample MAL ID"),
    ('''    id: 4,\n    title: "Jujutsu Kaisen",''', '''    id: 40748,\n    title: "Jujutsu Kaisen",''', "Jujutsu Kaisen sample MAL ID"),
    ('''    id: 5,\n    title: "Death Note",''', '''    id: 1535,\n    title: "Death Note",''', "Death Note sample MAL ID"),
    ('''    id: 6,\n    title: "One Punch Man",''', '''    id: 30276,\n    title: "One Punch Man",''', "One Punch Man sample MAL ID"),
    ('''    id: 7,\n    title: "Chainsaw Man",''', '''    id: 44511,\n    title: "Chainsaw Man",''', "Chainsaw Man sample MAL ID"),
    ('''    id: 8,\n    title: "Your Name",''', '''    id: 32281,\n    title: "Your Name",''', "Your Name sample MAL ID"),
]:
    page = exact_once(page, old_id, new_id, label)
page = exact_once(
    page,
    '  if (typeof title !== "string" || typeof image !== "string") {\n    return null;\n  }',
    '  const malId = Number(item.id);\n\n  if (typeof title !== "string" || typeof image !== "string" || !Number.isInteger(malId) || malId <= 0) {\n    return null;\n  }',
    "validate MAL IDs while normalizing cards",
)
page = exact_once(
    page,
    "    id: Number(item.id) || index + 1,\n    title,",
    "    id: malId,\n    anilistId: Number(item.anilistId) || undefined,\n    title,",
    "normalize MAL ID and AniList cross-reference",
)
# Replace exactly the existing inline trailer iframe within the selected-anime modal.
page = regex_once(
    page,
    r'<div className="border-t border-white/10 p-6 sm:p-8">\s*\{\(\(\) => \{.*?\}\)\(\)\}\s*</div>',
    '''<div className="border-t border-white/10 p-6 sm:p-8">
                <OfficialPlayer
                  key={selected.id}
                  title={selected.title}
                  malId={selected.id}
                  episodeCount={selected.episodes}
                />
              </div>''',
    "replace modal iframe with existing multi-source player",
)

# 6. Add MAL ID to the existing Attack on Titan sample source entry; don't invent sources.
episodes_data = json.loads(contents["data"])
if not isinstance(episodes_data, dict) or not isinstance(episodes_data.get("episodes"), list):
    raise RuntimeError("data/episodes.json must contain an episodes array.")
for episode in episodes_data["episodes"]:
    if episode.get("animeTitle", "").strip().lower() == "attack on titan" and int(episode.get("episodeNumber", 0)) == 1:
        episode["malId"] = 16498

# Add stream route as a new file. Refuse to overwrite anything already present.
stream_path = ROOT / "app/api/anime/stream/route.ts"
if stream_path.exists():
    raise RuntimeError("app/api/anime/stream/route.ts already exists; inspect it before applying this migration.")

# Confirm all output is ready before the first write.
changes = {
    required["anime"]: anime,
    required["episodes"]: episodes_api,
    required["player"]: player,
    required["page"]: page,
    required["data"]: json.dumps(episodes_data, ensure_ascii=False, indent=2) + "\n",
    stream_path: stream_api,
}

for path, content in changes.items():
    if path in required.values():
        backup(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

print("SenpaiFlix MAL-ID player migration applied.")
print("UI cards, layout, colours and existing CSS classes were kept.")
print("Updated/created:")
for path in changes:
    print(" -", path.relative_to(ROOT))
print("Backups: *.before-mal-player.bak")
print("Next, run: npm run build")
print("Reminder: metadata sources are not playback sources; add only videos you own or are authorized to embed.")
