import { NextResponse } from "next/server";

const QUERY = `
  query (
    $page: Int!
    $perPage: Int!
    $search: String
    $sort: [MediaSort!]
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        currentPage
        hasNextPage
        total
      }
      media(
        type: ANIME
        search: $search
        sort: $sort
        isAdult: false
      ) {
        id
        idMal
        title { english romaji }
        description(asHtml: false)
        coverImage { extraLarge large }
        averageScore
        episodes
        seasonYear
        genres
        trailer { id site thumbnail }
      }
    }
  }
`;

const SORTS: Record<string, string[]> = {
  popular: ["POPULARITY_DESC"],
  trending: ["TRENDING_DESC"],
  top: ["SCORE_DESC"],
  newest: ["START_DATE_DESC"],
};

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;

    const page = Math.min(
      500,
      Math.max(1, Number(params.get("page")) || 1)
    );

    const perPage = Math.min(
      50,
      Math.max(1, Number(params.get("limit")) || 24)
    );

    const search = params.get("search")?.trim().slice(0, 100) || null;
    const category = (params.get("category") || "popular").toLowerCase();
    const sort = SORTS[category] ?? SORTS.popular;

    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { page, perPage, search, sort },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Anime metadata service unavailable" },
        { status: 502 }
      );
    }

    const result = await response.json();
    const data = result.data?.Page;

    if (result.errors || !data?.media) {
      return NextResponse.json(
        { error: "Could not load anime metadata" },
        { status: 502 }
      );
    }

    const anime = data.media
      .filter((item: { idMal: number | null }) => Number.isInteger(item.idMal) && Number(item.idMal) > 0)
      .map((item: {
      id: number;
      idMal: number | null;
      title: { english: string | null; romaji: string };
      description: string | null;
      coverImage: { extraLarge: string | null; large: string | null };
      averageScore: number | null;
      episodes: number | null;
      seasonYear: number | null;
      genres: string[];
      trailer: { id: string | null; site: string | null; thumbnail: string | null } | null;
    }) => ({
      id: Number(item.idMal),
      anilistId: item.id,
      title: item.title.english || item.title.romaji,
      description: item.description || "No description available.",
      image: item.coverImage.extraLarge || item.coverImage.large || "",
      rating: item.averageScore
        ? (item.averageScore / 10).toFixed(1)
        : "N/A",
      episodes: item.episodes ?? 0,
      year: item.seasonYear?.toString() ?? "Unknown",
      genre: item.genres.slice(0, 2).join(" · ") || "Anime",
      trailerUrl:
        item.trailer?.site === "youtube" && item.trailer.id
          ? `https://www.youtube-nocookie.com/embed/${item.trailer.id}`
          : undefined,
    }));

    return NextResponse.json({
      anime,
      pageInfo: data.pageInfo,
      category,
      search,
    });
  } catch (error) {
    console.error("Anime API error:", error);

    return NextResponse.json(
      { error: "Unable to connect to anime metadata service" },
      { status: 502 }
    );
  }
}
