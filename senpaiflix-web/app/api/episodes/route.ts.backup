import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";


type Episode = {
  animeTitle: string;
  episodeNumber: number;
  title: string;
  videoUrl?: string;
  embedUrl?: string;
  watchUrl?: string;
};

export async function GET(request: Request) {
  try {
    const filePath = path.join(process.cwd(), "data", "episodes.json");
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw) as { episodes?: Episode[] };

    const requestedTitle = new URL(request.url).searchParams
      .get("title")
      ?.trim()
      .toLowerCase();

    const episodes = (data.episodes ?? []).filter((episode) => {
      if (!requestedTitle) return false;

      return episode.animeTitle?.trim().toLowerCase() === requestedTitle;
    });

    return NextResponse.json(
      { episodes },
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
