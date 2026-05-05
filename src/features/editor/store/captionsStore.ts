import { create } from "zustand";
import { CaptionBatch, addBatch, removeBatch } from "@/domain/captions/captionBatch";
import { loadCaptionBatches, saveCaptionBatches } from "@/infrastructure/storage/captionsStorage";

interface CaptionsState {
  batches: CaptionBatch[];
  hydrated: boolean;
  hydrate: () => void;
  add: (batch: CaptionBatch) => void;
  remove: (id: string) => void;
}

export const useCaptionsStore = create<CaptionsState>((set) => ({
  batches: [],
  hydrated: false,

  hydrate: () => set({ batches: loadCaptionBatches(), hydrated: true }),

  add: (batch) =>
    set((state) => {
      const next = addBatch(state.batches, batch);
      saveCaptionBatches(next);
      return { batches: next };
    }),

  remove: (id) =>
    set((state) => {
      const next = removeBatch(state.batches, id);
      saveCaptionBatches(next);
      return { batches: next };
    }),
}));
