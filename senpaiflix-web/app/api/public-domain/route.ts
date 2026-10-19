import { NextResponse } from "next/server";

const API = "https://commons.wikimedia.org/w/api.php";
const MAX_FILE_BYTES = 700 * 1024 * 1024;

const DISCOVERY_CATEGORIES = [
  { title: "Category:Anime videos", genre: "Anime" },
  { title: "Category:1929 anime films", genre: "Anime" },
  { title: "Category:1931 animated films of Japan", genre: "Anime" },
] as const;

type Meta = { value?: string };

type FileInfo = {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  extmetadata?: Record<string, Meta | undefined>;
};

type CommonsPage = {
  pageid?: number;
  title: string;
  categories?: { title: string }[];
  imageinfo?: FileInfo[];
};

type CommonsResponse = {
  query?: { pages?: CommonsPage[] };
  error?: { info?: string };
};

type DiscoveredFile = {
  page: CommonsPage;
  genre: string;
};

function clean(value?: string) {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#039;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCategory(value: string) {
  return value
    .replace(/^Category:/i, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function queryCommons(
  extra: Record<string, string>,
  hiddenCategoriesOnly = false
): Promise<CommonsResponse> {
  const url = new URL(API);

  const params: Record<string, string> = {
    action: "query",
    format: "json",
    formatversion: "2",
    prop: hiddenCategoriesOnly ? "categories" : "imageinfo|categories",
    cllimit: "max",
    ...(hiddenCategoriesOnly
      ? { clshow: "hidden" }
      : {
          iiprop: "url|mime|size|extmetadata",
          iiurlwidth: "640",
        }),
    ...extra,
  };

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "SenpaiFlix/0.1 (public-domain animation catalogue)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Wikimedia Commons returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as CommonsResponse;
  if (data.error) {
    throw new Error(data.error.info || "Wikimedia Commons API error");
  }

  return data;
}

function verifiedWork(
  candidate: DiscoveredFile,
  hiddenCategories: string[]
) {
  const page = candidate.page;
  const info = page.imageinfo?.[0];

  if (!info?.url || !info.mime?.startsWith("video/")) return null;
  if (info.size && info.size > MAX_FILE_BYTES) return null;

  let fileUrl: URL;

  try {
    fileUrl = new URL(info.url);
  } catch {
    return null;
  }

  // Only direct HTTPS video files hosted by Wikimedia Commons.
  if (
    fileUrl.protocol !== "https:" ||
    fileUrl.hostname !== "upload.wikimedia.org" ||
    !/\.(webm|ogv|mp4)$/i.test(fileUrl.pathname)
  ) {
    return null;
  }

  const metadata = info.extmetadata ?? {};
  const license = clean(metadata.LicenseShortName?.value);
  const usageTerms = clean(metadata.UsageTerms?.value);
  const publicDomainEvidence = /public[\s-]domain/i.test(
    `${license} ${usageTerms}`
  );

  // Rights categories are hidden on Commons, so verify them separately.
  const normalizedHidden = hiddenCategories.map(normalizeCategory);
  const hasUsExpiredTag = normalizedHidden.includes("pd us expired");
  const hasJapanFilmTag = normalizedHidden.includes("pd japan film");

  // Fail closed: require public-domain metadata AND the explicit US expiry tag.
  // The Japan film tag is reported separately; it is not treated as a
  // universal guarantee of public-domain status in every country.
  if (!publicDomainEvidence || !hasUsExpiredTag) return null;

  // Require source-country evidence for Japanese animation.
  if (candidate.genre === "Anime" && !hasJapanFilmTag) return null;

  // For Japanese-origin animation, require source-country PD evidence too.
  const appearsJapanese =
    candidate.genre === "Anime" ||
    (page.categories ?? []).some(({ title }) =>
      /japan|japanese/i.test(title)
    );

  if (appearsJapanese && !hasJapanFilmTag) return null;

  // Music can have a separate licence from the underlying film.
  // Do not automatically play music-labelled versions without
  // explicit attribution handling.
  if (/\b(with music|soundtrack)\b/i.test(page.title)) return null;

  const normalizedRightsFilename = page.title.replace(/_/g, " ");
  if (/\bwith\s+music\b/i.test(normalizedRightsFilename)) return null;

  const rawFilename = page.title
    .replace(/^File:/i, "")
    .replace(/\.(webm|ogv|mp4)$/i, "")
    .replace(/_/g, " ")
    .trim();

  const isNamakura = rawFilename.toLowerCase().includes("namakura gatana");
  const title = isNamakura
    ? "Namakura Gatana (The Dull Sword)"
    : rawFilename;

  const yearMatch = rawFilename.match(/\b(18|19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  let sourcePageUrl = "";

  try {
    const sourcePage = new URL(info.descriptionurl ?? "");

    if (
      sourcePage.protocol === "https:" &&
      sourcePage.hostname === "commons.wikimedia.org"
    ) {
      sourcePageUrl = sourcePage.href;
    }
  } catch {
    // A trusted fallback URL is created below.
  }

  if (!sourcePageUrl) {
    sourcePageUrl =
      "https://commons.wikimedia.org/wiki/" +
      encodeURIComponent(page.title.replace(/ /g, "_"));
  }

  let thumbnailUrl: string | undefined;

  try {
    const thumbnail = new URL(info.thumburl ?? "");

    if (
      thumbnail.protocol === "https:" &&
      thumbnail.hostname === "upload.wikimedia.org"
    ) {
      thumbnailUrl = thumbnail.href;
    }
  } catch {
    // Thumbnails are optional.
  }

  const rightsCategories = [
    ...(hasJapanFilmTag ? ["PD-Japan-film"] : []),
    "PD US expired",
  ];

  return {
    id: String(page.pageid ?? page.title),
    title,
    year,
    genre: candidate.genre,
    description: isNamakura
      ? "A 1917 Japanese animated short. Wikimedia Commons lists public-domain metadata plus PD-Japan-film and PD US expired categories."
      : clean(metadata.ImageDescription?.value) ||
        "See the original Wikimedia Commons file page for the work description.",
    mediaUrl: fileUrl.href,
    thumbnailUrl,
    sourcePageUrl,
    mime: info.mime,
    fileSize: info.size ?? null,
    width: info.width ?? null,
    height: info.height ?? null,
    licenseShortName: license || usageTerms || "Public domain",
    rightsScope: hasJapanFilmTag
      ? "Japan-film + US-expired tags"
      : "US-expired tag",
    rightsCategories,
  };
}

export async function GET(request: Request) {
  const requestedLimit = Number(
    new URL(request.url).searchParams.get("limit")
  );

  const limit = Math.min(
    50,
    Math.max(
      1,
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : 30
    )
  );

  try {
    // Discover files from several Commons animation categories.
    const discoveryResults = await Promise.allSettled(
      DISCOVERY_CATEGORIES.map((category) =>
        queryCommons({
          generator: "categorymembers",
          gcmtitle: category.title,
          gcmtype: "file",
          gcmnamespace: "6",
          gcmlimit: "50",
        })
      )
    );

    const candidates = new Map<string, DiscoveredFile>();

    discoveryResults.forEach((result, index) => {
      if (result.status !== "fulfilled") return;

      const genre = DISCOVERY_CATEGORIES[index].genre;
      const pages = result.value.query?.pages ?? [];

      for (const page of pages) {
        const key = page.title.toLowerCase();

        // Category order gives Anime first choice when a file is shared
        // between categories.
        if (!candidates.has(key) && page.imageinfo?.[0]) {
          candidates.set(key, { page, genre });
        }
      }
    });

    if (candidates.size === 0) {
      throw new Error("No candidate files were returned by Commons.");
    }

    const candidateList = [...candidates.values()];

    // Ask for hidden categories separately: the API does not allow
    // hidden and visible category filters together.
    const chunks: DiscoveredFile[][] = [];

    for (let index = 0; index < candidateList.length; index += 50) {
      chunks.push(candidateList.slice(index, index + 50));
    }

    const rightsResults = await Promise.allSettled(
      chunks.map((chunk) =>
        queryCommons(
          { titles: chunk.map((item) => item.page.title).join("|") },
          true
        )
      )
    );

    if (rightsResults.every((result) => result.status === "rejected")) {
      throw new Error("Could not verify file rights categories.");
    }

    const hiddenByTitle = new Map<string, string[]>();

    for (const result of rightsResults) {
      if (result.status !== "fulfilled") continue;

      for (const page of result.value.query?.pages ?? []) {
        const hidden = (page.categories ?? []).map((item) =>
          item.title.replace(/^Category:/i, "").trim()
        );

        hiddenByTitle.set(page.title.toLowerCase(), hidden);
      }
    }

    const works = candidateList
      .map((candidate) => {
        const hidden = hiddenByTitle.get(
          candidate.page.title.toLowerCase()
        );

        // No rights response means no automatic playback listing.
        if (!hidden) return null;

        return verifiedWork(candidate, hidden);
      })
      .filter((work) => work !== null)
      .filter(
        (work, index, all) =>
          all.findIndex(
            (other) =>
              other.title.trim().toLowerCase() ===
              work.title.trim().toLowerCase()
          ) === index
      )
      .sort((a, b) => {
        if (a.year === null && b.year !== null) return 1;
        if (a.year !== null && b.year === null) return -1;
        if (a.year !== null && b.year !== null && a.year !== b.year) {
          return a.year - b.year;
        }
        return a.title.localeCompare(b.title);
      })
      .slice(0, limit);

    return NextResponse.json(
      {
        works,
        total: works.length,
        source: "Wikimedia Commons",
        checkedAt: new Date().toISOString(),
        message:
          works.length === 0
            ? "No files passed all public-domain checks. Unverified files are not shown."
            : null,
        disclaimer:
          "Commons metadata and categories are evidence, not legal advice or a worldwide rights guarantee. PD US expired is a US copyright-status indicator. Check the original file page and applicable local law before redistribution or commercial use.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Public-domain catalogue error:", error);

    return NextResponse.json(
      {
        works: [],
        error: "The public-domain catalogue could not be verified.",
      },
      { status: 502 }
    );
  }
}
