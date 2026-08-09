/** @vitest-environment jsdom */
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportSizeDialog } from "./ExportSizeDialog.js";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function renderDialog(props: ComponentProps<typeof ExportSizeDialog>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ExportSizeDialog {...props} />));
  return { host, root };
}

describe("ExportSizeDialog", () => {
  it("offers explicit single-file, folder ZIP, and cancel choices in a labelled modal", async () => {
    const onSingleFile = vi.fn();
    const onFolderZip = vi.fn();
    const onCancel = vi.fn();
    const { host } = await renderDialog({
      bytes: 20 * 1024 * 1024 + 1,
      onSingleFile,
      onFolderZip,
      onCancel,
    });
    const dialog = host.querySelector('[role="alertdialog"]') as HTMLElement;

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("20 MiB");
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "単一HTMLで書き出す",
      "フォルダーZIPで書き出す",
      "キャンセル",
    ]);
    expect(document.activeElement).toBe(buttons[1]);
    await act(async () => buttons[1]!.click());
    expect(onFolderZip).toHaveBeenCalledTimes(1);
    expect(onSingleFile).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
