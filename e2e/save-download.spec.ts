// PoC (issue #15 PR-1, `/develop` Phase 3): does a `blob:` object-URL
// download via `URL.createObjectURL` + `<a download>` actually complete
// under `EDITOR_CSP` (`default-src 'self'`, no `blob:` in any directive)
// across all 3 engines this repo tests? Architect confidence was 60% --
// there is a real Firefox report of `download`-attribute blob downloads
// being CSP-blocked (OfficeDev/office-js#1511, citing `frame-src`). This
// spec is the empirical answer PR-1 gates on before any product UI is
// written. It injects the exact save-download primitive PR-1 will ship
// (no product code exists yet), running against the real built+served
// output (packages/app/dist via public/serve.json's CSP header, same
// setup csp-containment.spec.ts uses) -- not a synthetic page, so the
// CSP under test is the one that will actually ship.
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURES_DIR = join(import.meta.dirname, "..", "spikes", "excel-fidelity", "fixtures");
const fixturePath = (name: string) => join(FIXTURES_DIR, name);

test.describe("PoC: blob: download under EDITOR_CSP", () => {
  test("Blob + <a download> completes with zero CSP violations", async ({ page }, testInfo) => {
    const cspViolations: string[] = [];
    await page.exposeFunction("__reportCspViolation", (violatedDirective: string) => {
      cspViolations.push(violatedDirective);
    });

    await page.goto("/");

    // Wire a securitypolicyviolation listener the same way
    // csp-containment.spec.ts does, so a blocked download surfaces as a
    // concrete violated-directive string, not a silent no-op.
    await page.evaluate(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        (window as unknown as { __reportCspViolation: (d: string) => void }).__reportCspViolation(
          e.violatedDirective,
        );
      });
    });

    const downloadPromise = page.waitForEvent("download");

    // The exact primitive PR-1's save path will use: Blob -> createObjectURL
    // -> <a download> -> click() -> revokeObjectURL after a macrotask.
    await page.evaluate(() => {
      const doc = { version: 1, meta: { title: "PoCテスト" } };
      const blob = new Blob([JSON.stringify(doc, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "PoCテスト.json";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("PoCテスト.json");

    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    if (downloadPath) {
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(downloadPath, "utf-8");
      const parsed = JSON.parse(content) as { version: number; meta: { title: string } };
      expect(parsed.meta.title).toBe("PoCテスト");
      expect(content.endsWith("\n")).toBe(true);
    }

    expect(cspViolations, `CSP violations: ${cspViolations.join(", ")}`).toHaveLength(0);

    testInfo.annotations.push({
      type: "poc-result",
      description: `engine=${testInfo.project.name} downloaded=${download.suggestedFilename()} cspViolations=${cspViolations.length}`,
    });
  });
});

// issue #15/F7 (`/develop` Phase 8 QA dry-run, V-005/V-008/V-011/V-016): the
// PoC above proves the raw Blob/CSP primitive works, but exercises no
// product UI -- it never registers a real source, builds a real query, or
// drives the actual 保存 button, so it cannot prove `toDashboard`'s
// name-only-assignment discipline holds against the REAL editor state a
// user produces. This spec drives the full flow through the real built app
// (register -> aggregate -> chart -> title -> save) and inspects the
// downloaded `dashboard.json`'s actual bytes.
test.describe("issue #15/F7: full save flow via the editor UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  });

  test("register -> aggregate -> chart -> title -> save produces a schema-shaped file with provenance intact and zero raw cell values", async ({
    page,
  }) => {
    // `06-shift_jis.csv` columns: 部署(department)/担当者(person name, real
    // values 田中太郎/鈴木花子)/件数(count). The query below only touches
    // 部署+件数 -- 担当者's real names never enter any query, making them a
    // clean canary independent of column-name vs. cell-value ambiguity.
    await page.locator('input[type="file"]').setInputFiles(fixturePath("06-shift_jis.csv"));
    await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();

    await page.getByRole("button", { name: "「06-shift_jis.csv」を集計" }).click();
    await page.getByRole("button", { name: "＋ 単位を追加" }).click();
    await page.getByRole("button", { name: "＋ 値を追加" }).click();
    await page.getByLabel("集計する値1: 列").selectOption("件数");
    await page.getByLabel("集計する値1: 集計方法").selectOption("sum");
    await expect(page.locator(".hyakkei-query-card tbody tr")).toHaveCount(2);

    await page.getByRole("button", { name: "「06-shift_jis.csv」の集計をグラフ化" }).click();
    await expect(page.locator(".hyakkei-chart-card")).toHaveCount(1);

    await page.getByLabel("ダッシュボード名").fill("部署別件数レポート");

    const saveButton = page.getByRole("button", { name: "保存" });
    await expect(saveButton).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await saveButton.click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    if (!downloadPath) return;
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(downloadPath, "utf-8");

    // Canary (V-005): the real cell values must never reach the file,
    // regardless of what structural checks below say about it.
    expect(content).not.toContain("田中太郎");
    expect(content).not.toContain("鈴木花子");

    const parsed = JSON.parse(content) as {
      version: number;
      meta: { title: string };
      sources: { id: string; kind: string; ref: { name: string } }[];
      queries: { id: string; source: string; sql: string; builderState: unknown }[];
      charts: unknown[];
      layout: { grid: string; items: unknown[] };
    };
    expect(parsed.meta.title).toBe("部署別件数レポート");
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]?.ref.name).toBe("06-shift_jis.csv");
    // V-009: the encoding is auto-detected internally, not a user choice --
    // no user intent exists to persist, so the projected ref must not carry
    // one even though the schema allows it and the source file (per its own
    // name) is genuinely Shift-JIS-encoded.
    expect(Object.hasOwn(parsed.sources[0]?.ref ?? {}, "encoding")).toBe(false);
    expect(parsed.queries).toHaveLength(1);
    expect(parsed.queries[0]?.sql).not.toBe("");
    expect(parsed.queries[0]?.source).toBe(parsed.sources[0]?.id);
    expect(parsed.charts).toHaveLength(1);
    expect(parsed.layout.items).toHaveLength(1);
    expect(content.endsWith("\n")).toBe(true);
  });
});
