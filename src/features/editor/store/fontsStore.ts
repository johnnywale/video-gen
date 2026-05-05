import { create } from "zustand";
import { FontInfo, listSystemFonts } from "@/infrastructure/tauri/commands";

interface FontsState {
  fonts: FontInfo[];
  hydrated: boolean;
  /** Best-effort CJK-capable font, picked once at hydrate time. UI uses
   *  this as the default for new stages so captions render correctly
   *  out of the box on whatever OS the app is running on. */
  defaultCjkFamily: string | null;
  hydrate: () => Promise<void>;
}

/** Pure helper exported for testing. Picks the family most likely to
 *  render Chinese captions cleanly, with a hard preference for entries
 *  whose face_index is 0 — ffmpeg's drawtext can only address the
 *  default face of a .ttc, so picking PingFang SC (face 6 inside
 *  PingFang.ttc) would still render PingFang HK glyphs and miss
 *  Simplified-specific characters like 问/时/负.
 *
 *  Order:
 *    1. Arial Unicode MS — single-face .ttf on macOS, covers all CJK
 *    2. Other well-known SC families that ship as standalone faces
 *    3. Any face_index==0 CJK-capable font
 *    4. Any CJK-capable font (last resort, may face the .ttc problem)
 */
export function pickDefaultCjkFamily(fonts: FontInfo[]): string | null {
  // Preferred family names. Arial Unicode MS leads on macOS because
  // it's a single-face .ttf so the rendered glyphs match exactly what
  // the picker labels.
  const PREFERRED = [
    "Arial Unicode MS",
    "PingFang SC",
    "PingFang TC",
    "Heiti SC",
    "Hiragino Sans GB",
    "Microsoft YaHei",
    "Microsoft JhengHei",
    "Noto Sans CJK SC",
    "Noto Sans SC",
    "Source Han Sans SC",
  ];
  for (const wanted of PREFERRED) {
    // Prefer the face_index==0 entry first (ffmpeg-safe).
    const safe = fonts.find((f) => f.family === wanted && f.supports_cjk && f.face_index === 0);
    if (safe) return safe.family;
  }
  for (const wanted of PREFERRED) {
    const any = fonts.find((f) => f.family === wanted && f.supports_cjk);
    if (any) return any.family;
  }
  // Fall back to any face_index==0 CJK font; only then to any CJK at all.
  const safeCjk = fonts.find((f) => f.supports_cjk && f.face_index === 0);
  if (safeCjk) return safeCjk.family;
  const anyCjk = fonts.find((f) => f.supports_cjk);
  return anyCjk?.family ?? null;
}

export const useFontsStore = create<FontsState>((set, get) => ({
  fonts: [],
  hydrated: false,
  defaultCjkFamily: null,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const fonts = await listSystemFonts();
      set({
        fonts,
        hydrated: true,
        defaultCjkFamily: pickDefaultCjkFamily(fonts),
      });
    } catch (e) {
      console.error("[fonts] enumeration failed:", e);
      // Mark as hydrated so the UI doesn't retry forever; an empty list
      // means the picker just shows "(default)".
      set({ fonts: [], hydrated: true, defaultCjkFamily: null });
    }
  },
}));
