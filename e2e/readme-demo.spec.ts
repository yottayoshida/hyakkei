import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * README の 60 秒クイックスタートをそのまま再生する、個人情報を含まない
 * 小さな CSV。ドキュメントと実際の操作手順が乖離しないよう CI で確認する。
 */
const QUICKSTART_CSV = Buffer.from("分類,件数\nオンライン,120\n窓口,80\n電話,45\n", "utf-8");
const FILE_NAME = "quickstart.csv";
const captureDir = process.env.HYAKKEI_QUICKSTART_FRAME_DIR;

async function captureQuickstartFrame(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  if (!captureDir) return;
  mkdirSync(captureDir, { recursive: true });
  await page.screenshot({ path: join(captureDir, `${name}.png`) });
}

test("README quickstart: CSV を読み込み、集計して、グラフを作成できる", async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });

  await page.locator('input[type="file"][accept=".csv,.xlsx,.parquet"]').setInputFiles({
    name: FILE_NAME,
    mimeType: "text/csv",
    buffer: QUICKSTART_CSV,
  });
  await expect(page.getByRole("heading", { name: "データワークスペース" })).toBeVisible();
  await captureQuickstartFrame(page, "01-import");

  await page.getByRole("button", { name: `「${FILE_NAME}」を集計` }).click();
  await page.getByRole("button", { name: "＋ 単位を追加" }).click();
  await page.getByLabel("集計の単位1", { exact: true }).selectOption("分類");
  await page.getByRole("button", { name: "＋ 値を追加" }).click();
  await page.getByLabel("集計する値1: 列").selectOption("件数");
  await page.getByLabel("集計する値1: 集計方法").selectOption("sum");
  await expect(page.locator(".hyakkei-query-card tbody tr")).toHaveCount(3);
  await captureQuickstartFrame(page, "02-aggregate");

  await page.getByRole("button", { name: `「${FILE_NAME}」の集計をグラフ化` }).click();
  await expect(page.locator(".hyakkei-chart-card .hyakkei-chart-canvas")).toBeVisible();
  await page.getByLabel("ダッシュボード名").fill("受付チャネル別件数");
  await expect(page.getByRole("button", { name: "配布用HTML" })).toBeEnabled();
  await captureQuickstartFrame(page, "03-chart");
});
