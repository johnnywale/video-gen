import { create } from "zustand";
import {
  TextStyle,
  TextStylePosition,
  BUILTIN_TEXT_STYLES,
  makeTextStyle,
} from "@/domain/captions/textStyle";
import { loadTextStyles, saveTextStyles } from "@/infrastructure/storage/textStylesStorage";

interface AddInput {
  name: string;
  color: string;
  position: TextStylePosition;
}

interface UpdateInput {
  name?: string;
  color?: string;
  position?: TextStylePosition;
}

interface TextStylesState {
  styles: TextStyle[];
  hydrated: boolean;
  hydrate: () => void;
  add: (input: AddInput) => TextStyle;
  /** Updates a CUSTOM style only — built-ins are silently ignored. */
  update: (id: string, patch: UpdateInput) => void;
  /** Removes a CUSTOM style only — built-ins are silently ignored. */
  remove: (id: string) => void;
}

export const useTextStylesStore = create<TextStylesState>((set) => ({
  styles: [...BUILTIN_TEXT_STYLES],
  hydrated: false,

  hydrate: () => set({ styles: loadTextStyles(), hydrated: true }),

  add: (input) => {
    const fresh = makeTextStyle(input);
    set((state) => {
      const next = [...state.styles, fresh];
      saveTextStyles(next);
      return { styles: next };
    });
    return fresh;
  },

  update: (id, patch) =>
    set((state) => {
      const next = state.styles.map((s) =>
        s.id === id && !s.builtin ? { ...s, ...patch } : s
      );
      saveTextStyles(next);
      return { styles: next };
    }),

  remove: (id) =>
    set((state) => {
      const target = state.styles.find((s) => s.id === id);
      if (!target || target.builtin) return state;
      const next = state.styles.filter((s) => s.id !== id);
      saveTextStyles(next);
      return { styles: next };
    }),
}));
