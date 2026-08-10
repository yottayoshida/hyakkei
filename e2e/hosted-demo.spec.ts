import { expect, test } from "@playwright/test";

/**
 * The same dist artifact that Pages deploys is served by playwright.config.ts.
 * This catches a broken repository-subpath URL, missing gallery files, a
 * missing disclaimer, and an accidental third-party request before merge.
 */
test("hosted demo exposes the verified gallery without third-party requests", async ({ page }) => {
  const thirdPartyRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.origin !== "http://localhost:4173") thirdPartyRequests.push(request.url());
    }
  });

  const response = await page.request.get("/index.html");
  expect(response.ok()).toBe(true);
  const indexHtml = await response.text();
  expect(indexHtml).not.toMatch(/(?:src|href)="\/(?:assets|vendor)\//);
  expect(indexHtml).toMatch(/(?:src|href)="\.\/assets\//);

  await page.goto("/index.html", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "公開ギャラリー" })).toBeVisible();
  await expect(
    page.getByText("Hyakkei はコミュニティプロジェクトです。", { exact: false }),
  ).toBeVisible();

  const sampleLinks = page.getByRole("link", { name: /サンプルを見る:/ });
  await expect(sampleLinks).toHaveCount(3);
  const hrefs = await sampleLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(hrefs).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/gallery\/population\.html$/),
      expect.stringMatching(/\/gallery\/economy\.html$/),
      expect.stringMatching(/\/gallery\/administration\.html$/),
    ]),
  );

  // Each published artifact must name the survey year it froze. The table id
  // alone does not let a reader check anything: the same e-Stat URL serves 50
  // survey years, and the gallery shipped for a day citing three of them
  // without saying which.
  for (const href of hrefs) {
    const artifact = await page.request.get(href!);
    expect(artifact.ok(), `${href} is served`).toBe(true);
    expect(await artifact.text(), `${href} states its survey year`).toContain("1975年度");
  }
  expect(thirdPartyRequests, `unexpected requests: ${thirdPartyRequests.join(", ")}`).toEqual([]);
});
