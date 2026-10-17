"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type PlayerProps = {
  title: string;
  embedUrl?: string;
  watchUrl?: string;
};

type Episode = {
  animeTitle: string;
  episodeNumber: number;
  title: string;
  videoUrl?: string;
  embedUrl?: string;
  watchUrl?: string;
};

type PlayerSource =
  | { kind: "media"; url: string }
  | { kind: "iframe"; url: string }
  | null;

function getYouTubeEmbedUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    let id = "";

    if (url.hostname === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
        url.hostname
      )
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

    return /^[a-zA-Z0-9_-]{11}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
}

function getSource(raw?: string): PlayerSource {
  if (!raw) return null;

  const youtube = getYouTubeEmbedUrl(raw);
  if (youtube) return { kind: "iframe", url: youtube };

  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;

    if (
      ["youtube.com", "www.youtube.com", "www.youtube-nocookie.com"].includes(
        url.hostname
      ) &&
      /^\/embed\/[A-Za-z0-9_-]+$/.test(url.pathname)
    ) {
      return { kind: "iframe", url: url.href };
    }

    if (
      url.hostname === "player.vimeo.com" &&
      /^\/video\/[0-9]+$/.test(url.pathname)
    ) {
      return { kind: "iframe", url: url.href };
    }

    if (/\.(m3u8|mp4)(?:$)/i.test(url.pathname)) {
      return { kind: "media", url: url.href };
    }

    return null;
  } catch {
    return null;
  }
}

function getSafeWatchUrl(raw?: string): string {
  if (!raw) return "";

  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export default function OfficialPlayer({
  title,
  embedUrl,
  watchUrl,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState("");
  const [source, setSource] = useState<PlayerSource>(
    () => getSource(embedUrl)
  );
  const [activeWatchUrl, setActiveWatchUrl] = useState(
    () => getSafeWatchUrl(watchUrl)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadEpisodes() {
      setLoading(true);
      setError("");
      setEpisodes([]);
      setSelected("");
      setSource(getSource(embedUrl));
      setActiveWatchUrl(getSafeWatchUrl(watchUrl));

      try {
        const response = await fetch(
          `/api/episodes?title=${encodeURIComponent(title)}`,
          { cache: "no-store" }
        );

        if (!response.ok) {
          throw new Error("Episode catalogue request failed.");
        }

        const data = (await response.json()) as {
          episodes?: Episode[];
        };

        if (!cancelled) {
          setEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
        }
      } catch {
        if (!cancelled) {
          setError("Episode list load nahi ho saki. Server check karo.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEpisodes();

    return () => {
      cancelled = true;
    };
  }, [title, embedUrl, watchUrl]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || source?.kind !== "media") return;

    setError("");
    video.pause();
    video.removeAttribute("src");
    video.load();

    if (/\.m3u8(?:$)/i.test(new URL(source.url).pathname)) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source.url;
        video.load();
      } else if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(source.url);
        hls.attachMedia(video);

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError(
              "Stream load nahi ho saka. Source, CORS aur provider permissions check karo."
            );
            hls.destroy();
          }
        });

        return () => hls.destroy();
      } else {
        setError("Is browser mein HLS playback supported nahi hai.");
      }
    } else {
      video.src = source.url;
      video.load();
    }
  }, [source, retryCount]);

  function playEpisode(episode: Episode) {
    const nextSource = getSource(episode.embedUrl || episode.videoUrl);
    const externalUrl = getSafeWatchUrl(
      episode.watchUrl || episode.videoUrl
    );

    if (!nextSource) {
      setError(
        "Supported HTTPS MP4, HLS, ya provider embed source configure karo."
      );
      return;
    }

    setSource(nextSource);
    setActiveWatchUrl(externalUrl);
    setSelected(`${episode.episodeNumber}:${episode.title}`);
    setError("");
    setRetryCount(0);
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
    (episode) =>
      `${episode.episodeNumber}:${episode.title}` === selected
  );

  return (
    <section className="mt-6 w-full space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/60">
        <span className="h-2 w-2 rounded-full bg-white/70" />
        SenpaiFlix Player
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
            onError={() =>
              setError(
                "Video play nahi hua. URL, format, CORS aur stream access check karo."
              )
            }
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
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-base font-semibold text-white">{title}</p>
            <p className="max-w-sm text-xs leading-6 text-white/50">
              Authorized video source configure karne ke baad playback yahan
              chalega.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!source}
          onClick={() => {
            setError("");
            setRetryCount((count) => count + 1);
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10 disabled:opacity-40"
        >
          Retry playback
        </button>

        <span className="text-xs text-white/40">
          {source?.kind === "media"
            ? "Native video / HLS"
            : source?.kind === "iframe"
              ? "Provider embed"
              : "No source configured"}
        </span>
      </div>

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
              if (selectedIndex > 0) {
                playEpisode(sortedEpisodes[selectedIndex - 1]);
              }
            }}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>

          <button
            type="button"
            disabled={
              selectedIndex < 0 ||
              selectedIndex >= sortedEpisodes.length - 1
            }
            onClick={() => {
              if (
                selectedIndex >= 0 &&
                selectedIndex < sortedEpisodes.length - 1
              ) {
                playEpisode(sortedEpisodes[selectedIndex + 1]);
              }
            }}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
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
                  <span className="mt-1 block opacity-70">
                    {episode.title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <p role="status" className="text-sm text-red-400">
          {error}
        </p>
      )}

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
        Playback requires an authorized source that permits your website to
        access or embed it. HLS streams may also require suitable CORS headers.
      </p>
    </section>
  );
}
