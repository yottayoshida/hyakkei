// Shared by golden-palette.test.ts and golden-samples.test.ts (/simplify
// Simplification finding: both independently repeated the identical "SSR
// init (fixed size, svg renderer) -> setOption -> normalize" sequence).
// SSR mode needs no DOM at all (PR-0's chosen renderer, docs/spikes/
// m0-charts.md) -- the real production path, not a test-only shortcut.
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { normalizeSvg } from "./normalize-svg.js";

const GOLDEN_RENDER_WIDTH = 400;
const GOLDEN_RENDER_HEIGHT = 300;

export function renderOptionToSvg(option: EChartsOption): string {
  const chart = echarts.init(null, null, {
    ssr: true,
    renderer: "svg",
    width: GOLDEN_RENDER_WIDTH,
    height: GOLDEN_RENDER_HEIGHT,
  });
  try {
    chart.setOption(option);
    return normalizeSvg(chart.renderToSVGString());
  } finally {
    // /code-review (xhigh): echarts.init() unconditionally registers the
    // instance in ECharts' own module-level `instances` map even in SSR
    // mode; only dispose() removes it. This function runs dozens of times
    // per test run (mount.ts's own unmount() makes the same point for the
    // DOM-mount path) -- without this, every call leaks a chart instance
    // for the life of the test process.
    chart.dispose();
  }
}
