import { useEffect, useState } from "react";

type GallerySample = {
  id: string;
  title: string;
  description: string;
  href: string;
};

type GalleryManifest = {
  version: number;
  samples: GallerySample[];
};

type GalleryState =
  | { status: "loading" }
  | { status: "ready"; samples: GallerySample[] }
  | { status: "error" };

function manifestUrl(): string {
  const url = new URL("gallery/manifest.json", document.baseURI);
  if (url.origin !== window.location.origin) throw new Error("gallery manifest must be same-origin");
  return url.href;
}

function parseManifest(value: unknown): GalleryManifest {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { samples?: unknown }).samples) ||
    !(value as { samples: unknown[] }).samples.every(
      (sample) =>
        sample &&
        typeof sample === "object" &&
        typeof (sample as GallerySample).id === "string" &&
        typeof (sample as GallerySample).title === "string" &&
        typeof (sample as GallerySample).description === "string" &&
        typeof (sample as GallerySample).href === "string",
    )
  ) {
    throw new Error("invalid gallery manifest");
  }
  return value as GalleryManifest;
}

function artifactUrl(href: string, sourceManifestUrl: string): string {
  const url = new URL(href, sourceManifestUrl);
  if (url.origin !== window.location.origin || !url.pathname.startsWith(new URL("gallery/", document.baseURI).pathname)) {
    throw new Error("gallery artifact must be same-origin");
  }
  return url.href;
}

/**
 * The editor does not import gallery fixtures. This panel only fetches the
 * manifest produced by `scripts/build-gallery.mjs` from the same deployment.
 */
export function GalleryPanel() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GalleryState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let url: string;
    try {
      url = manifestUrl();
    } catch {
      setState({ status: "error" });
      return () => controller.abort();
    }

    setState({ status: "loading" });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`gallery manifest request failed: ${response.status}`);
        return parseManifest(await response.json());
      })
      .then((manifest) => {
        if (active) setState({ status: "ready", samples: manifest.samples });
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  return (
    <section aria-labelledby="gallery-heading">
      <h2 id="gallery-heading">公開ギャラリー</h2>
      <p>e-Stat の固定スナップショットから作成した、オフラインでも開けるサンプルです。</p>
      {state.status === "loading" ? <p role="status">ギャラリーを読み込んでいます…</p> : null}
      {state.status === "error" ? (
        <div role="alert">
          <p>ギャラリーを読み込めませんでした。データの取り込みと編集は引き続き利用できます。</p>
          <button type="button" onClick={() => setAttempt((current) => current + 1)}>
            再試行
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <ul>
          {state.samples.map((sample) => {
            let href: string;
            try {
              href = artifactUrl(sample.href, manifestUrl());
            } catch {
              return null;
            }
            return (
              <li key={sample.id}>
                <a href={href}>{sample.title}</a>
                <p>{sample.description}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
