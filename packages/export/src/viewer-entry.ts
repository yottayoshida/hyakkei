import { mount, normalizeBaked } from "@hyakkei/core/renderer";
import type { BakedDashboard } from "@hyakkei/schema";

const PAYLOAD_ID = "hyakkei-export-payload";

const host = document.getElementById("dashboard");
if (!host) throw new Error("Hyakkei export container is missing");

async function readDashboard(): Promise<BakedDashboard> {
  const payload = document.getElementById(PAYLOAD_ID);
  if (payload) return JSON.parse(payload.textContent ?? "{}") as BakedDashboard;
  const response = await fetch("./dashboard.json", { credentials: "same-origin" });
  if (!response.ok) throw new Error("dashboard.json could not be loaded");
  return (await response.json()) as BakedDashboard;
}

void readDashboard()
  .then((dashboard) => mount(host, normalizeBaked(dashboard)))
  .catch(() => {
    host.textContent = "ダッシュボードを読み込めませんでした。";
  });
