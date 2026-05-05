import { create } from "zustand";
import { Topic, upsertTopic, removeTopic } from "@/domain/topics/topic";
import { loadTopics, saveTopics } from "@/infrastructure/storage/topicsStorage";

interface TopicsState {
  topics: Topic[];
  hydrated: boolean;
  hydrate: () => void;
  upsert: (topic: Omit<Topic, "id"> & { id?: string }) => void;
  remove: (id: string) => void;
}

export const useTopicsStore = create<TopicsState>((set) => ({
  topics: [],
  hydrated: false,

  hydrate: () => set({ topics: loadTopics(), hydrated: true }),

  upsert: (topic) =>
    set((state) => {
      const next = upsertTopic(state.topics, topic);
      saveTopics(next);
      return { topics: next };
    }),

  remove: (id) =>
    set((state) => {
      const next = removeTopic(state.topics, id);
      saveTopics(next);
      return { topics: next };
    }),
}));
