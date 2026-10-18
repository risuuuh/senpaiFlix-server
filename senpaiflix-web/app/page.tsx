
"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  Play,
  Plus,
  Check,
  Sparkles,
  House,
  Compass,
  Bookmark,
  X,
  Flame,
  Clock3,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";

type Anime = {
  id: number;
  title: string;
  genre: string;
  year: string;
  rating: string;
  episodes: number;
  image: string;
  description: string;
  embedUrl?: string;
  watchUrl?: string;
  trailerUrl?: string;
};

const FALLBACK_ANIME: Anime[] = [
  {
    id: 1,
    title: "Solo Leveling",
    genre: "Action · Fantasy",
    year: "2024",
    rating: "9.2",
    episodes: 12,
    image: "https://cdn.myanimelist.net/images/anime/1806/126216l.jpg",
    description:
      "A weak hunter discovers a mysterious system that allows him to become stronger.",
  },
  {
    id: 2,
    title: "Attack on Titan",
    genre: "Action · Drama",
    year: "2013",
    rating: "9.1",
    episodes: 25,
    image: "https://cdn.myanimelist.net/images/anime/10/47347l.jpg",
    description:
      "Humanity fights for survival behind enormous walls in a world threatened by Titans.",
  },
  {
    id: 3,
    title: "Demon Slayer",
    genre: "Action · Supernatural",
    year: "2019",
    rating: "8.7",
    episodes: 26,
    image: "https://cdn.myanimelist.net/images/anime/1286/99889l.jpg",
    description:
      "A young swordsman begins a journey to save his sister and defeat demons.",
  },
  {
    id: 4,
    title: "Jujutsu Kaisen",
    genre: "Action · Dark Fantasy",
    year: "2020",
    rating: "8.6",
    episodes: 24,
    image: "https://cdn.myanimelist.net/images/anime/1171/109222l.jpg",
    description:
      "A student enters the dangerous world of curses and powerful sorcerers.",
  },
  {
    id: 5,
    title: "Death Note",
    genre: "Thriller · Mystery",
    year: "2006",
    rating: "8.6",
    episodes: 37,
    image: "https://cdn.myanimelist.net/images/anime/9/9453l.jpg",
    description:
      "A student discovers a supernatural notebook and faces a legendary detective.",
  },
  {
    id: 6,
    title: "One Punch Man",
    genre: "Action · Comedy",
    year: "2015",
    rating: "8.5",
    episodes: 12,
    image: "https://cdn.myanimelist.net/images/anime/12/76049l.jpg",
    description:
      "An overwhelmingly powerful hero searches for a worthy challenge.",
  },
  {
    id: 7,
    title: "Chainsaw Man",
    genre: "Action · Fantasy",
    year: "2022",
    rating: "8.4",
    episodes: 12,
    image: "https://cdn.myanimelist.net/images/anime/1806/126216l.jpg",
    description:
      "A young devil hunter's life changes after an extraordinary transformation.",
  },
  {
    id: 8,
    title: "Your Name",
    genre: "Romance · Fantasy",
    year: "2016",
    rating: "8.8",
    episodes: 1,
    image: "https://cdn.myanimelist.net/images/5/87048l.jpg",
    description:
      "Two teenagers mysteriously become connected across distance and time.",
  },
];

function cleanDescription(value: unknown): string {
  if (typeof value !== "string") {
    return "No description available.";
  }

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAnime(
  item: Record<string, unknown>,
  index: number
): Anime | null {
  const title = item.title;
  const image = item.image ?? item.coverImage;

  if (typeof title !== "string" || typeof image !== "string") {
    return null;
  }

  const genres = Array.isArray(item.genre)
    ? item.genre.join(" · ")
    : Array.isArray(item.genres)
      ? item.genres.join(" · ")
      : String(item.genre ?? "Anime");

  return {
    id: Number(item.id) || index + 1,
    title,
    genre: genres,
    year: String(item.year ?? "Unknown"),
    rating: String(item.rating ?? "—"),
    episodes: Number(item.episodes) || 0,
    image,
    description: cleanDescription(item.description),
    embedUrl:
      typeof item.embedUrl === "string" ? item.embedUrl : undefined,
    watchUrl:
      typeof item.watchUrl === "string" ? item.watchUrl : undefined,
    trailerUrl:
      typeof item.trailerUrl === "string" ? item.trailerUrl : undefined,
  };
}

function isAllowedEmbed(value?: string): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") return false;

    if (
      url.hostname === "www.youtube-nocookie.com" ||
      url.hostname === "www.youtube.com"
    ) {
      return /^\/embed\/[A-Za-z0-9_-]+$/.test(url.pathname);
    }

    if (url.hostname === "player.vimeo.com") {
      return /^\/video\/[0-9]+$/.test(url.pathname);
    }

    return false;
  } catch {
    return false;
  }
}


export default function Home() {
  const [anime, setAnime] = useState<Anime[]>(FALLBACK_ANIME);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Anime | null>(null);
  const [watchlist, setWatchlist] = useState<number[]>([]);
  const [tab, setTab] = useState("Home");

  const [category, setCategory] = useState("popular");
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadAnime() {
      setLoading(true);

      try {
        const params = new URLSearchParams({
          page: "1",
          limit: "24",
          category,
        });

        if (search.trim()) {
          params.set("search", search.trim());
        }

        const response = await fetch(`/api/anime?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Anime API returned ${response.status}`);
        }

        const data = await response.json();

        if (cancelled || !Array.isArray(data.anime)) return;

        const results = data.anime
          .map((item: unknown, index: number) => {
            if (typeof item !== "object" || item === null) return null;
            return normalizeAnime(item as Record<string, unknown>, index);
          })
          .filter((item: Anime | null): item is Anime => item !== null);

        setAnime(results);
        setPage(1);
        setHasNextPage(Boolean(data.pageInfo?.hasNextPage));
        setApiConnected(true);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        console.error("Anime API error:", error);
        if (!cancelled) setApiConnected(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const delay = window.setTimeout(loadAnime, search.trim() ? 350 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(delay);
      controller.abort();
    };
  }, [category, search]);

  async function loadMoreAnime() {
    if (loadingMore || !hasNextPage) return;

    setLoadingMore(true);

    try {
      const nextPage = page + 1;
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: "24",
        category,
      });

      if (search.trim()) params.set("search", search.trim());

      const response = await fetch(`/api/anime?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Anime API returned ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data.anime)) return;

      const results = data.anime
        .map((item: unknown, index: number) => {
          if (typeof item !== "object" || item === null) return null;
          return normalizeAnime(item as Record<string, unknown>, index);
        })
        .filter((item: Anime | null): item is Anime => item !== null);

      setAnime((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...results.filter((item: Anime) => !existing.has(item.id))];
      });

      setPage(nextPage);
      setHasNextPage(Boolean(data.pageInfo?.hasNextPage));
    } catch (error) {
      console.error("Load more anime error:", error);
    } finally {
      setLoadingMore(false);
    }
  }

  const filteredAnime = useMemo(() => {
    return anime.filter((item) => {
      return tab !== "Watchlist" || watchlist.includes(item.id);
    });
  }, [anime, tab, watchlist]);

  const featured = anime[0] ?? FALLBACK_ANIME[0];

  function toggleWatchlist(id: number) {
    setWatchlist((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function showTab(name: string) {
    setTab(name);

    document.getElementById("catalogue")?.scrollIntoView({
      behavior: "smooth",
    });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#080808] text-white selection:bg-white selection:text-black">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.09),transparent_48%)]" />

      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-black/65 backdrop-blur-2xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 md:px-8">
          <button
            onClick={() => {
              setTab("Home");
              setSearch("");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="shrink-0 text-xl font-black tracking-[-0.08em] md:text-2xl"
          >
            SENPAI<span className="text-white/40">FLIX</span>
            <span className="ml-1 text-[9px] tracking-normal text-white/40">
              BETA
            </span>
          </button>

          <div className="hidden items-center gap-6 text-sm text-white/55 md:flex">
            <button
              onClick={() => {
                setTab("Home");
                setSearch("");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="transition hover:text-white"
            >
              <House className="mr-1 inline" size={15} /> Home
            </button>

            <button
              onClick={() => showTab("Explore")}
              className="transition hover:text-white"
            >
              <Compass className="mr-1 inline" size={15} /> Explore
            </button>

            <button
              onClick={() => showTab("Watchlist")}
              className="transition hover:text-white"
            >
              <Bookmark className="mr-1 inline" size={15} /> My List
            </button>
          </div>

          <label className="flex w-36 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 transition focus-within:border-white/30 sm:w-52">
            <Search size={15} className="shrink-0 text-white/45" />

            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setTab("Explore");
              }}
              placeholder="Search anime..."
              className="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-white/35"
            />

            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </label>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 pb-14 pt-12 md:grid-cols-[1.2fr_0.8fr] md:px-8 md:pb-20 md:pt-20">
        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white/70"
          >
            <Sparkles size={13} /> Your anime universe
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl text-5xl font-semibold leading-[0.98] tracking-[-0.07em] sm:text-7xl md:text-8xl"
          >
            Stories worth
            <br />
            staying <span className="text-white/35">up for.</span>
          </motion.h1>

          <p className="mt-6 max-w-md text-sm leading-7 text-white/50 md:text-base">
            Discover your next obsession. Explore unforgettable characters,
            new worlds and stories that stay with you.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => showTab("Explore")}
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:scale-[1.03]"
            >
              <Compass className="mr-2 inline" size={16} />
              Explore library
            </button>

            <button
              onClick={() => showTab("Watchlist")}
              className="rounded-full border border-white/15 bg-white/[0.05] px-6 py-3 text-sm transition hover:bg-white/10"
            >
              <Bookmark className="mr-2 inline" size={16} />
              My watchlist
            </button>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-5 text-xs text-white/40">
            <span>
              <Flame size={14} className="mr-1 inline" />
              Discover anime
            </span>

            <span>
              <Clock3 size={14} className="mr-1 inline" />
              {loading
                ? "Loading catalogue..."
                : apiConnected
                  ? "Live metadata connected"
                  : "Sample catalogue"}
            </span>
          </div>
        </div>

        {featured && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="relative mx-auto w-full max-w-md"
          >
            <div className="absolute -inset-5 rounded-[40px] bg-white/[0.06] blur-3xl" />

            <div className="relative overflow-hidden rounded-[28px] border border-white/15 bg-white/[0.06] p-3 shadow-2xl backdrop-blur-xl">
              <img
                src={featured.image}
                alt={featured.title}
                className="h-[320px] w-full rounded-[20px] object-cover object-top sm:h-[390px]"
              />

              <div className="absolute inset-x-3 bottom-3 rounded-b-[20px] bg-gradient-to-t from-black via-black/85 to-transparent px-5 pb-5 pt-20">
                <p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-white/55">
                  Featured selection
                </p>

                <h2 className="text-3xl font-semibold tracking-tight">
                  {featured.title}
                </h2>

                <p className="mt-2 text-xs text-white/60">
                  {featured.genre} · {featured.year}
                </p>

                <button
                  onClick={() => setSelected(featured)}
                  className="mt-4 rounded-full bg-white px-5 py-2.5 text-xs font-semibold text-black transition hover:scale-105"
                >
                  <Play size={14} className="mr-2 inline fill-current" />
                  View details
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </section>

      <section
        id="catalogue"
        className="relative mx-auto max-w-7xl scroll-mt-24 px-5 pb-20 md:px-8"
      >
        {tab !== "Watchlist" && (
          <div className="mb-6 flex flex-wrap gap-2">
            {[
              { label: "Popular", value: "popular" },
              { label: "Trending", value: "trending" },
              { label: "Top Rated", value: "top" },
              { label: "Newest", value: "newest" },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setCategory(option.value)}
                className={`rounded-full border px-4 py-2 text-xs transition ${
                  category === option.value
                    ? "border-white bg-white text-black"
                    : "border-white/15 bg-white/[0.04] text-white/65 hover:bg-white/10 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-white/40">
              {tab === "Watchlist" ? "Saved for later" : "Handpicked for you"}
            </p>

            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {tab === "Watchlist"
                ? "My watchlist"
                : search
                  ? "Search results"
                  : "Explore the collection"}
            </h2>
          </div>

          <span className="text-xs text-white/40">
            {filteredAnime.length} titles
          </span>
        </div>

        {filteredAnime.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] py-16 text-center">
            <p className="text-lg font-medium">
              {loading ? "Loading anime..." : "Nothing here yet"}
            </p>

            <p className="mt-2 text-sm text-white/45">
              {tab === "Watchlist"
                ? "Add anime to your list using the + button."
                : "Try another search."}
            </p>

            <button
              onClick={() => {
                setTab("Home");
                setSearch("");
              }}
              className="mt-5 rounded-full border border-white/15 px-4 py-2 text-sm"
            >
              Browse all anime
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {filteredAnime.map((item, index) => (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.04, 0.4) }}
                className="group min-w-0"
              >
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                  <button
                    onClick={() => setSelected(item)}
                    className="block w-full text-left"
                  >
                    <img
                      src={item.image}
                      alt={item.title}
                      loading="lazy"
                      className="h-52 w-full object-cover transition duration-500 group-hover:scale-105 sm:h-64 md:h-72"
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/10" />

                    <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-2 py-1 text-[10px] backdrop-blur-md">
                      ★ {item.rating}
                    </span>

                    <span className="absolute bottom-3 left-3 right-3 text-sm font-semibold leading-snug">
                      {item.title}
                    </span>
                  </button>

                  <button
                    aria-label={
                      watchlist.includes(item.id)
                        ? "Remove from watchlist"
                        : "Add to watchlist"
                    }
                    onClick={() => toggleWatchlist(item.id)}
                    className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/60 p-2 backdrop-blur-md transition hover:bg-white hover:text-black"
                  >
                    {watchlist.includes(item.id) ? (
                      <Check size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                  </button>
                </div>

                <p className="mt-2 truncate text-[11px] text-white/45">
                  {item.genre}
                </p>

                <p className="mt-1 text-[10px] text-white/30">
                  {item.year} · {item.episodes || "Unknown"} episodes
                </p>
              </motion.article>
            ))}
          </div>
        )}

        {tab !== "Watchlist" && hasNextPage && (
          <div className="mt-10 flex justify-center">
            <button
              onClick={loadMoreAnime}
              disabled={loadingMore || loading}
              className="rounded-full border border-white/15 bg-white/[0.05] px-6 py-3 text-sm text-white/80 backdrop-blur-xl transition hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? "Loading more..." : "Load more anime"}
            </button>
          </div>
        )}
      </section>

      <footer className="border-t border-white/[0.08] px-5 py-8 text-center text-xs text-white/35">
        <span className="font-bold tracking-tight text-white/65">
          SENPAIFLIX
        </span>

        <span className="mx-2">·</span>
        A universe of stories.
          <p className="mt-2 text-sm text-white/60">
            Created by <span className="text-white">Rishu</span>
            {" · "}
            <a
              href="https://www.instagram.com/zero_.amz/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/70 transition-colors hover:text-white hover:underline"
            >
              Instagram: @zero_.amz
            </a>
          </p>


        <p className="mt-2">
          Anime metadata and video playback are separate services.
        </p>
      </footer>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              onClick={(event) => event.stopPropagation()}
              className="relative my-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/15 bg-[#111] shadow-2xl"
            >
              <button
                onClick={() => setSelected(null)}
                aria-label="Close details"
                className="absolute right-4 top-4 z-10 rounded-full border border-white/15 bg-black/70 p-2"
              >
                <X size={16} />
              </button>

              <div className="grid sm:grid-cols-[0.8fr_1.2fr]">
                <img
                  src={selected.image}
                  alt={selected.title}
                  className="h-56 w-full object-cover sm:h-full sm:min-h-[350px]"
                />

                <div className="p-6 sm:p-8">
                  <p className="text-xs text-white/45">
                    ★ {selected.rating} · {selected.year} ·{" "}
                    {selected.episodes || "Unknown"} episodes
                  </p>

                  <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                    {selected.title}
                  </h2>

                  <p className="mt-3 text-xs text-white/45">
                    {selected.genre}
                  </p>

                  <p className="mt-5 text-sm leading-7 text-white/65">
                    {selected.description}
                  </p>

                  <button
                    onClick={() => toggleWatchlist(selected.id)}
                    className="mt-6 w-full rounded-full border border-white/20 bg-white/[0.06] px-5 py-3 text-sm transition hover:bg-white/10"
                  >
                    {watchlist.includes(selected.id) ? (
                      <>
                        <Check className="mr-2 inline" size={15} />
                        Added to watchlist
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 inline" size={15} />
                        Add to watchlist
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="border-t border-white/10 p-6 sm:p-8">
                {(() => {
                  const raw = selected.embedUrl || selected.watchUrl || selected.trailerUrl || "";
                  let src = "";

                  try {
                    const url = new URL(raw);
                    const host = url.hostname.toLowerCase();

                    if (host === "youtu.be") {
                      const id = url.pathname.split("/").filter(Boolean)[0];
                      if (id) src = `https://www.youtube-nocookie.com/embed/${id}`;
                    } else if (
                      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
                    ) {
                      const id = url.pathname === "/watch"
                        ? url.searchParams.get("v")
                        : url.pathname.startsWith("/embed/")
                          ? url.pathname.split("/")[2]
                          : null;
                      if (id) src = `https://www.youtube-nocookie.com/embed/${id}`;
                    } else if (
                      host === "www.youtube-nocookie.com" &&
                      url.pathname.startsWith("/embed/")
                    ) {
                      src = url.href;
                    } else if (
                      host === "player.vimeo.com" &&
                      url.pathname.startsWith("/video/")
                    ) {
                      src = url.href;
                    }
                  } catch {}

                  return src ? (
                    <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
                      <iframe
                        src={src}
                        title={`${selected.title} embedded video`}
                        className="h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/60">
                      Embedded video source abhi configured nahi hai.
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
