import { describe, it, expect, beforeEach } from "vitest";
import { useTopicsStore } from "./topicsStore";

// localStorage shim — see storage.test.ts for the rationale.
const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return memStore.size; },
  clear: () => memStore.clear(),
  getItem: (k) => memStore.get(k) ?? null,
  setItem: (k, v) => { memStore.set(k, v); },
  removeItem: (k) => { memStore.delete(k); },
  key: (i) => Array.from(memStore.keys())[i] ?? null,
};

beforeEach(() => {
  memStore.clear();
  // Reset store state between tests so they don't leak.
  useTopicsStore.setState({ topics: [], hydrated: false });
});

describe("useTopicsStore", () => {
  it("hydrate populates topics from storage and marks hydrated=true", () => {
    memStore.set(
      "video-editor-topics",
      JSON.stringify([{ id: "1", name: "X", theme: "x-theme" }])
    );
    useTopicsStore.getState().hydrate();
    const s = useTopicsStore.getState();
    expect(s.topics).toEqual([{ id: "1", name: "X", theme: "x-theme" }]);
    expect(s.hydrated).toBe(true);
  });

  it("upsert adds a new topic and persists to storage", () => {
    useTopicsStore.getState().upsert({ name: "New", theme: "new-theme" });
    const s = useTopicsStore.getState();
    expect(s.topics).toHaveLength(1);
    expect(s.topics[0].name).toBe("New");

    // Persisted to storage with the same content.
    const saved = JSON.parse(memStore.get("video-editor-topics") ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].theme).toBe("new-theme");
  });

  it("upsert with existing id updates in place", () => {
    useTopicsStore.getState().upsert({ id: "fixed-id", name: "Original", theme: "v1" });
    useTopicsStore.getState().upsert({ id: "fixed-id", name: "Updated", theme: "v2" });
    const topics = useTopicsStore.getState().topics;
    expect(topics).toHaveLength(1);
    expect(topics[0]).toEqual({ id: "fixed-id", name: "Updated", theme: "v2" });
  });

  it("remove drops the matching topic and persists", () => {
    useTopicsStore.getState().upsert({ id: "a", name: "A", theme: "a" });
    useTopicsStore.getState().upsert({ id: "b", name: "B", theme: "b" });
    useTopicsStore.getState().remove("a");
    const topics = useTopicsStore.getState().topics;
    expect(topics).toHaveLength(1);
    expect(topics[0].id).toBe("b");
    const saved = JSON.parse(memStore.get("video-editor-topics") ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("b");
  });

  it("remove on unknown id is a no-op", () => {
    useTopicsStore.getState().upsert({ id: "a", name: "A", theme: "a" });
    useTopicsStore.getState().remove("zzz");
    expect(useTopicsStore.getState().topics).toHaveLength(1);
  });
});
