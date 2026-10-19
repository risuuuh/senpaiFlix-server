"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Film,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

type PublicDomainWork = {
  id: string;
  title: string;
  genre: string;
  year: number | null;
  description: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  sourcePageUrl: string;
  mime: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  licenseShortName: string;
  rightsScope: string;
  rightsCategories: string[];
};

type CatalogueResponse = {
  works?: PublicDomainWork[];
  message?: string | null;
  error?: string;
  disclaimer?: string;
};

function formatSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export default function PublicDomainPage() {
  const [works, setWorks] = useState<PublicDomainWork[]>([]);
  const [selected, setSelected] = useState<PublicDomainWork | null>(null);
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalogue() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/public-domain?limit=30", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as CatalogueResponse;

        if (!response.ok) {
          throw new Error(data.error || "Catalogue request failed.");
        }

        const items = Array.isArray(data.works) ? data.works : [];
        setWorks(items);
        setMessage(data.message || "");
        setSelected((current) =>
          current ? items.find((item) => item.id === current.id) ?? null : null
        );
      } catch (cause) {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Catalogue load nahi ho paya."
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadCatalogue();
    return () => controller.abort();
  }, [reload]);

  const genreOptions = useMemo(
    () => [...new Set(works.map((work) => work.genre))].sort(),
    [works]
  );

  const yearOptions = useMemo(
    () =>
      [...new Set(
        works
          .map((work) => work.year)
          .filter((year): year is number => typeof year === "number")
      )].sort((a, b) => b - a),
    [works]
  );

  const filteredWorks = useMemo(() => {
    const term = search.trim().toLowerCase();

    return works.filter((work) => {
      const matchesSearch =
        !term ||
        work.title.toLowerCase().includes(term) ||
        work.description.toLowerCase().includes(term);

      const matchesGenre =
        genreFilter === "All" || work.genre === genreFilter;

      const matchesYear =
        yearFilter === "All" || String(work.year ?? "") === yearFilter;

      return matchesSearch && matchesGenre && matchesYear;
    });
  }, [works, search, genreFilter, yearFilter]);

  return (
    <main className="min-h-screen bg-[#080808] text-white selection:bg-white selection:text-black">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.09),transparent_50%)]" />

      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-black/70 backdrop-blur-2xl">
        <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a
            href="/"
            className="text-lg font-black tracking-[-0.08em] md:text-2xl"
          >
            SENPAI<span className="text-white/40">FLIX</span>
          </a>
          <a
            href="/"
            className="rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-xs text-white/80 transition hover:bg-white/10"
          >
            <ArrowLeft className="mr-2 inline" size={14} />
            Home
          </a>
        </nav>
      </header>

      <section className="relative mx-auto max-w-7xl px-5 pb-16 pt-10 md:px-8 md:pt-16">
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/55">
          <ShieldCheck size={15} />
          Rights-checked source catalogue
          <span className="rounded-full border border-white/15 px-2 py-1">
            Wikimedia Commons
          </span>
        </div>

        <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.06em] sm:text-6xl">
          Public-domain
          <br />
          <span className="text-white/35">anime vault.</span>
        </h1>

        <p className="mt-5 max-w-2xl text-sm leading-7 text-white/55">
          Discover older animation and play verified source files directly
          inside SenpaiFlix. The catalogue is fetched automatically; videos
          are not copied or hosted by this website.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <label className="flex max-w-xl flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <Film size={17} className="text-white/50" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search verified titles..."
              aria-label="Search public-domain titles"
              className="w-full bg-transparent text-sm outline-none placeholder:text-white/35"
            />
          </label>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
            className="rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              size={15}
              className={`mr-2 inline ${loading ? "animate-spin" : ""}`}
            />
            Refresh catalogue
          </button>
        </div>


        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white/55">
            Genre
            <select
              value={genreFilter}
              onChange={(event) => setGenreFilter(event.target.value)}
              className="max-w-[190px] bg-transparent text-sm text-white outline-none"
            >
              <option value="All" className="bg-[#111]">All genres</option>
              {genreOptions.map((genre) => (
                <option key={genre} value={genre} className="bg-[#111]">
                  {genre}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white/55">
            Year
            <select
              value={yearFilter}
              onChange={(event) => setYearFilter(event.target.value)}
              className="max-w-[150px] bg-transparent text-sm text-white outline-none"
            >
              <option value="All" className="bg-[#111]">All years</option>
              {yearOptions.map((year) => (
                <option key={year} value={String(year)} className="bg-[#111]">
                  {year}
                </option>
              ))}
            </select>
          </label>

          {(genreFilter !== "All" || yearFilter !== "All" || search) && (
            <button
              type="button"
              onClick={() => {
                setGenreFilter("All");
                setYearFilter("All");
                setSearch("");
              }}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/60 transition hover:bg-white/10"
            >
              Clear filters
            </button>
          )}
        </div>

        {selected && (
          <section className="mt-10 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                  Playing in SenpaiFlix
                </p>
                <h2 className="mt-2 text-xl font-semibold sm:text-2xl">
                  {selected.title}
                </h2>
                <p className="mt-2 text-xs text-white/45">
                  {selected.year || "Year not verified"}
                  {selected.width && selected.height
                    ? ` · ${selected.width} × ${selected.height}`
                    : ""}
                  {selected.durationSeconds
                    ? ` · ${formatDuration(selected.durationSeconds)}`
                    : ""}
                  {selected.fileSize
                    ? ` · ${formatSize(selected.fileSize)}`
                    : ""}
                </p>
              </div>

              <a
                href={selected.sourcePageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/65 underline underline-offset-4"
              >
                Source and rights <ExternalLink className="ml-1 inline" size={12} />
              </a>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video
                key={selected.id}
                controls
                playsInline
                preload="metadata"
                poster={selected.thumbnailUrl}
                className="aspect-video w-full"
              >
                <source src={selected.mediaUrl} type={selected.mime} />
                Your browser cannot play this video format. Open the original
                source file page for details.
              </video>
            </div>

            <p className="mt-4 text-sm leading-6 text-white/55">
              {selected.description}
            </p>
            <p className="mt-2 text-xs text-white/40">
              Rights evidence: {selected.rightsScope}. This does not guarantee
              public-domain status in every country.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {selected.rightsCategories.map((category) => (
                <span
                  key={category}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] text-white/70"
                >
                  {category}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
              Automatically discovered
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              Verified library
            </h2>
          </div>
          <span className="text-xs text-white/45">
            {filteredWorks.length} titles
          </span>
        </div>

        {loading && (
          <p className="mt-8 text-sm text-white/55" role="status">
            <LoaderCircle className="mr-2 inline animate-spin" size={16} />
            Checking source metadata and rights categories...
          </p>
        )}

        {error && (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && filteredWorks.length === 0 && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-sm text-white/75">
              {message || "No titles matched your search."}
            </p>
            <p className="mt-2 text-xs leading-6 text-white/40">
              Unverified sources are deliberately hidden. Try refreshing or
              clearing your search.
            </p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredWorks.map((work) => (
            <article
              key={work.id}
              className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] transition hover:border-white/25"
            >
              <button
                type="button"
                onClick={() => {
                  setSelected(work);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {work.thumbnailUrl ? (
                  <img
                    src={work.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full bg-black object-cover"
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-white/[0.04]">
                    <Film size={36} className="text-white/30" />
                  </div>
                )}

                <div className="p-4">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-white/45">
                    {work.year || "Year unconfirmed"} · {work.genre}
                  </p>
                  <p className="mt-2 text-[10px] text-white/40">
                    {work.rightsScope} · {work.licenseShortName}
                  </p>
                  <h3 className="mt-2 line-clamp-2 font-semibold">
                    {work.title}
                  </h3>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/50">
                    {work.description}
                  </p>

                  <span className="mt-4 inline-flex items-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
                    <Play className="mr-2 inline fill-current" size={13} />
                    Play on website
                  </span>
                </div>
              </button>
            </article>
          ))}
        </div>

        <aside className="mt-12 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <h3 className="text-sm font-semibold">
            Copyright and source policy
          </h3>
          <p className="mt-2 text-xs leading-6 text-white/50">
            A file appears only when Wikimedia Commons provides public-domain
            license metadata and both PD-Japan-film and PD US expired category
            labels. These labels are not a universal legal guarantee.
            Copyright may vary by country, and every original file page should
            be reviewed before redistribution or commercial use. SenpaiFlix
            streams the source file directly and does not copy it to its own
            servers.
          </p>
        </aside>

        <footer className="mt-8 text-xs text-white/35">
          Media and rights metadata: Wikimedia Commons.
          {" "}
          <a
            href="https://commons.wikimedia.org/wiki/Category:Anime_videos"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Browse source category
          </a>
        </footer>
      </section>
    </main>
  );
}
