import { Dashboard } from "@hyakkei/schema";
import { describe, expect, it } from "vitest";
import { SAVE_NARRATIVE_COVERED_KEYS } from "./save-narrative.js";

describe("save narrative key coverage", () => {
  // issue #15/F7, Security review T7: forces the narrative copy to be
  // updated the day `Dashboard` gains a new top-level field -- without
  // this, the save-time "含まれるもの" text could silently fall behind
  // what `toDashboard` actually emits.
  it("SAVE_NARRATIVE_COVERED_KEYS matches Dashboard's known top-level keys exactly", () => {
    expect(SAVE_NARRATIVE_COVERED_KEYS.slice().sort()).toEqual(
      Object.keys(Dashboard.properties).sort(),
    );
  });
});
