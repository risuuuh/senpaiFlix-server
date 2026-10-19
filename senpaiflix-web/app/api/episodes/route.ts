import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";


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
