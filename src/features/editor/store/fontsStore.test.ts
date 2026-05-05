import { describe, it, expect } from "vitest";
import { pickDefaultCjkFamily } from "./fontsStore";
import type { FontInfo } from "@/infrastructure/tauri/commands";

const fi = (family: string, cjk: boolean = false, face_index: number = 0): FontInfo => ({
  family,
  postscript_name: family,
  path: `/x/${family}.ttc`,
  face_index,
  supports_cjk: cjk,
});

describe("pickDefaultCjkFamily", () => {
  it("returns null for an empty list", () => {
    expect(pickDefaultCjkFamily([])).toBeNull();
  });

  it("returns null when no font supports CJK", () => {
    expect(pickDefaultCjkFamily([fi("Helvetica"), fi("Arial")])).toBeNull();
  });

  it("prefers Arial Unicode MS first — single-face TTF, renders correctly", () => {
    const out = pickDefaultCjkFamily([
      fi("Heiti SC", true),
      fi("PingFang SC", true),
      fi("Arial Unicode MS", true),
    ]);
    expect(out).toBe("Arial Unicode MS");
  });

  it("falls back to PingFang SC when Arial Unicode MS isn't installed", () => {
    const out = pickDefaultCjkFamily([
      fi("Heiti SC", true),
      fi("PingFang SC", true),
      fi("Noto Sans CJK SC", true),
    ]);
    expect(out).toBe("PingFang SC");
  });

  it("falls back to a later preferred family if PingFang isn't installed", () => {
    const out = pickDefaultCjkFamily([
      fi("Heiti SC", true),
      fi("Noto Sans CJK SC", true),
    ]);
    expect(out).toBe("Heiti SC");
  });

  it("prefers a face_index==0 entry of a preferred family over a face>0 sibling", () => {
    // Realistic macOS case: PingFang.ttc lists "PingFang HK" at face 0
    // and "PingFang SC" at face 6. ffmpeg can only address face 0 of a
    // file, so picking the face-0 entry is the only one that renders
    // the labelled family. (Better-coverage CJK font in this case.)
    const out = pickDefaultCjkFamily([
      fi("PingFang SC", true, 6),
      fi("PingFang HK", true, 0),
      fi("Heiti SC", true, 0),
    ]);
    // None of the preferred families are face 0 + cjk, except Heiti SC.
    expect(out).toBe("Heiti SC");
  });

  it("if only non-zero-face preferred fonts exist, accepts them rather than nothing", () => {
    const out = pickDefaultCjkFamily([
      fi("PingFang SC", true, 6),
      fi("Heiti SC", true, 2),
    ]);
    expect(out).toBe("PingFang SC");
  });

  it("falls back to the first CJK font when no preferred name matches", () => {
    const out = pickDefaultCjkFamily([
      fi("Helvetica"),
      fi("SomeRandomChineseFont", true),
      fi("AnotherCJK", true),
    ]);
    expect(out).toBe("SomeRandomChineseFont");
  });

  it("ignores preferred names that aren't actually CJK-capable", () => {
    // Defensive: if an OS happens to ship a "PingFang SC" face that
    // somehow doesn't pass the cmap probe, skip it.
    const out = pickDefaultCjkFamily([
      fi("PingFang SC", false),
      fi("Heiti SC", true),
    ]);
    expect(out).toBe("Heiti SC");
  });
});
