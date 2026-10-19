import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";


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
