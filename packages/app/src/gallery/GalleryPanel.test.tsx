/** @vitest-environment jsdom */
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryPanel } from "./GalleryPanel.js";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => vi.unstubAllGlobals());

async function renderInJsdom(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, unmount: async () => act(async () => root.unmount()) };
}

describe("GalleryPanel", () => {
  it("loads the same-origin build manifest and links to its static artifacts", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          samples: [
            {
              id: "applications",
              title: "都道府県別人口",
              description: "固定データです。",
              href: "applications.html",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { host, unmount } = await renderInJsdom(<GalleryPanel />);
    await act(async () => Promise.resolve());

    const manifestUrl = new URL("gallery/manifest.json", document.baseURI).href;
    expect(fetchSpy).toHaveBeenCalledWith(manifestUrl, {
      signal: expect.any(AbortSignal),
    });
    const artifactUrl = new URL("applications.html", manifestUrl).href;
    const link = host.querySelector(`a[href="${artifactUrl}"]`);
    expect(link?.textContent).toContain("都道府県別人口");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await unmount();
  });

  it("keeps the editor usable and shows retry guidance when the build manifest is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));

    const { host, unmount } = await renderInJsdom(<GalleryPanel />);
    await act(async () => Promise.resolve());

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "ギャラリーを読み込めませんでした",
    );
    expect(host.querySelector("button")?.textContent).toContain("再試行");
    await unmount();
  });
});
