"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type PlayerProps = {
  title: string;
  malId: number;
  episodeCount?: number;
  embedUrl?: string;
  watchUrl?: string;
};

type Episode = {
  malId?: number;
  metadataFallback?: boolean;
  animeTitle?: string;
  episodeNumber: number;
  title: string;
  videoUrl?: string;
  embedUrl?: string;
  watchUrl?: string;
  sources?: string[];
};

type Source =
  | { kind: "media"; url: string }
  | { kind: "iframe"; url: string };

function getSource(raw?: string): Source | null {
  if (!raw) return null;

  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase();
    let id = "";

    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
    ) {
      if (url.pathname === "/watch") {
        id = url.searchParams.get("v") ?? "";
      } else if (
        url.pathname.startsWith("/embed/") ||
        url.pathname.startsWith("/shorts/")
      ) {
        id = url.pathname.split("/")[2] ?? "";
      }
    }

    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return {
        kind: "iframe",
        url: `https://www.youtube-nocookie.com/embed/${id}`,
      };
    }

    if (
      host === "www.youtube-nocookie.com" &&
      /^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)
    ) {
      return { kind: "iframe", url: url.href };
    }

    if (
      host === "player.vimeo.com" &&
      /^\/video\/[0-9]+$/.test(url.pathname)
    ) {
      return { kind: "iframe", url: url.href };
    }

    if (/\.(mp4|m3u8)$/i.test(url.pathname)) {
      return { kind: "media", url: url.href };
    }

    return null;
  } catch {
    return null;
  }
}

function getSources(episode: Episode): string[] {
  return [
    ...(Array.isArray(episode.sources) ? episode.sources : []),
    episode.embedUrl ?? "",
    episode.videoUrl ?? "",
  ]
    .map((value) => value.trim())
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .filter((value) => getSource(value) !== null);
}

function safeWatchUrl(raw?: string) {
  try {
    const url = new URL(raw ?? "");
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export default function OfficialPlayer({
  title,
  malId,
  episodeCount = 0,
  embedUrl,
  watchUrl,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackLock = useRef(false);

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState("");
  const [sources, setSources] = useState<string[]>(() =>
    embedUrl ? [embedUrl] : []
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [activeWatchUrl, setActiveWatchUrl] = useState(
    () => safeWatchUrl(watchUrl)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const source = getSource(sources[sourceIndex]);

  const nextSource = useCallback(
    (reason: string) => {
      if (fallbackLock.current) return;
      fallbackLock.current = true;

      if (sourceIndex + 1 < sources.length) {
        setError(`${reason} Trying player ${sourceIndex + 2} of ${sources.length}…`);
        setSourceIndex((index) => index + 1);
      } else {
        setError(`${reason} No more sources available. Check the source URL or try again.`);
      }

      window.setTimeout(() => {
        fallbackLock.current = false;
      }, 800);
    },
    [sourceIndex, sources.length]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadEpisodes() {
      setLoading(true);
      setError("");
      setEpisodes([]);
      setSelected("");
      setSources(embedUrl ? [embedUrl] : []);
      setSourceIndex(0);
      setActiveWatchUrl(safeWatchUrl(watchUrl));

      try {
        const response = await fetch(
          `/api/episodes?malId=${encodeURIComponent(String(malId))}&count=${encodeURIComponent(String(episodeCount))}`,
          { cache: "no-store" }
        );

        if (!response.ok) throw new Error("Episode request failed");

        const data = (await response.json()) as { episodes?: Episode[] };

        if (!cancelled) {
          setEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
        }
      } catch {
        if (!cancelled) {
          setError("Episode list load nahi hui. Server check karo.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadEpisodes();
    return () => {
      cancelled = true;
    };
  }, [title, malId, episodeCount, embedUrl, watchUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || source?.kind !== "media") return;

    setError("");
    video.pause();
    video.removeAttribute("src");
    video.load();

    let hls: Hls | undefined;

    if (/\.m3u8$/i.test(new URL(source.url).pathname)) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source.url;
        video.load();
      } else if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(source.url);
        hls.attachMedia(video);

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            nextSource("Stream failed.");
          }
        });
      } else {
        setError("Is browser mein HLS playback supported nahi hai.");
      }
    } else {
      video.src = source.url;
      video.load();
    }

    return () => {
      hls?.destroy();
    };
  }, [source?.url, source?.kind, retryCount, nextSource]);

  async function playEpisode(episode: Episode) {
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
  }

  const sortedEpisodes = episodes
    .filter(
      (episode) =>
        Number.isInteger(episode.episodeNumber) &&
        episode.episodeNumber > 0 &&
        typeof episode.title === "string"
    )
    .slice()
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  const selectedIndex = sortedEpisodes.findIndex(
    (episode) => `${episode.episodeNumber}:${episode.title}` === selected
  );

  return (
    <section className="mt-6 w-full space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/60">
        <span className="h-2 w-2 rounded-full bg-white/70" />
        SenpaiFlix Multi-Source Player
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
        {source?.kind === "media" ? (
          <video
            key={`${source.url}:${retryCount}`}
            ref={videoRef}
            className="absolute inset-0 h-full w-full bg-black"
            controls
            playsInline
            preload="metadata"
            onError={() => nextSource("Video playback failed.")}
          />
        ) : source?.kind === "iframe" ? (
          <iframe
            key={`${source.url}:${retryCount}`}
            src={source.url}
            title={`${title} video player`}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            onError={() => nextSource("Embedded player failed to load.")}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-base font-semibold text-white">{title}</p>
            <p className="max-w-sm text-xs leading-6 text-white/50">
              Admin se authorized video sources add karne ke baad yahan play hoga.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!source}
          onClick={() => {
            fallbackLock.current = false;
            setError("");
            setRetryCount((count) => count + 1);
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10 disabled:opacity-40"
        >
          Retry player
        </button>

        <button
          type="button"
          disabled={sourceIndex >= sources.length - 1}
          onClick={() => {
            fallbackLock.current = false;
            nextSource("Switching source.");
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10 disabled:opacity-40"
        >
          Try next player
        </button>

        <span className="text-xs text-white/40">
          {source ? `Player ${sourceIndex + 1} / ${sources.length} · ${source.kind}` : "No source"}
        </span>
      </div>

      {error && (
        <p role="status" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Episodes</h3>
          <span className="text-xs text-white/50">
            {sortedEpisodes.length} available
          </span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={selectedIndex <= 0}
            onClick={() => {
              if (selectedIndex > 0) playEpisode(sortedEpisodes[selectedIndex - 1]);
            }}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Previous
          </button>

          <button
            type="button"
            disabled={selectedIndex < 0 || selectedIndex >= sortedEpisodes.length - 1}
            onClick={() => {
              if (selectedIndex >= 0 && selectedIndex < sortedEpisodes.length - 1) {
                playEpisode(sortedEpisodes[selectedIndex + 1]);
              }
            }}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Next
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-white/50">Loading episodes...</p>
        ) : sortedEpisodes.length === 0 ? (
          <p className="text-sm text-white/50">
            Episodes configured nahi hain. data/episodes.json check karo.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sortedEpisodes.map((episode) => {
              const key = `${episode.episodeNumber}:${episode.title}`;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => playEpisode(episode)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm transition ${
                    selected === key
                      ? "border-white bg-white text-black"
                      : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  <span className="block font-medium">
                    Episode {episode.episodeNumber}
                  </span>
                  <span className="mt-1 block opacity-70">{episode.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {activeWatchUrl && (
        <a
          href={activeWatchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm text-white/70 underline"
        >
          Open source in new tab
        </a>
      )}

      <p className="text-xs text-white/50">
        Automatic fallback works for detectable media errors. Some third-party
        embeds hide playback errors; use Try next player for those providers.
        Sources must be authorized and permit embedding.
      </p>
    </section>
  );
}
