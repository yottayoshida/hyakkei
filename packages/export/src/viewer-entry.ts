import { mount, normalizeBaked } from "@hyakkei/core/renderer";
import type { BakedDashboard } from "@hyakkei/schema";

const PAYLOAD_ID = "hyakkei-export-payload";

const payload = document.getElementById(PAYLOAD_ID);
const host = document.getElementById("dashboard");
if (!payload || !host) throw new Error("Hyakkei export container is missing");
const dashboard = JSON.parse(payload.textContent ?? "{}") as BakedDashboard;
mount(host, normalizeBaked(dashboard));
