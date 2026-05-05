import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings, clearSettings, DEFAULT_SETTINGS } from "./settingsStorage";
import { loadTopics, saveTopics } from "./topicsStorage";
import { DEFAULT_TOPICS } from "@/domain/topics/topic";

// vitest's default env is "node" which has no localStorage. Shim it with an
// in-memory Map so the storage modules can be exercised end-to-end.
const memStore = new Map<string, string>();
const memLocalStorage: Storage = {
  get length() { return memStore.size; },
  clear: () => memStore.clear(),
  getItem: (k) => memStore.get(k) ?? null,
  setItem: (k, v) => { memStore.set(k, v); },
  removeItem: (k) => { memStore.delete(k); },
  key: (i) => Array.from(memStore.keys())[i] ?? null,
};
(globalThis as unknown as { localStorage: Storage }).localStorage = memLocalStorage;

beforeEach(() => {
  memStore.clear();
});

describe("settingsStorage", () => {
  it("load returns defaults when storage is empty", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("save then load round-trips the values", () => {
    saveSettings({
      anthropicBaseUrl: "https://api.example/v1",
      anthropicApiKey: "sk-test",
      minimaxApiKey: "mm-test",
      minimaxBaseUrl: "https://api.minimaxi.com",
    });
    expect(loadSettings()).toEqual({
      anthropicBaseUrl: "https://api.example/v1",
      anthropicApiKey: "sk-test",
      minimaxApiKey: "mm-test",
      minimaxBaseUrl: "https://api.minimaxi.com",
    });
  });

  it("missing fields fall back to defaults (forwards-compat)", () => {
    memStore.set("video-editor-settings", JSON.stringify({ anthropicBaseUrl: "https://x" }));
    const s = loadSettings();
    expect(s.anthropicBaseUrl).toBe("https://x");
    expect(s.anthropicApiKey).toBe(DEFAULT_SETTINGS.anthropicApiKey);
    expect(s.minimaxApiKey).toBe(DEFAULT_SETTINGS.minimaxApiKey);
  });

  it("malformed JSON returns defaults rather than throwing", () => {
    memStore.set("video-editor-settings", "{not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("clearSettings removes the key from storage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, anthropicApiKey: "sk-clear" });
    expect(memStore.has("video-editor-settings")).toBe(true);
    clearSettings();
    expect(memStore.has("video-editor-settings")).toBe(false);
  });
});

describe("topicsStorage", () => {
  it("load returns the defaults when nothing is saved", () => {
    const topics = loadTopics();
    expect(topics).toHaveLength(DEFAULT_TOPICS.length);
    expect(topics.map((t) => t.theme)).toEqual(DEFAULT_TOPICS.map((t) => t.theme));
  });

  it("save then load round-trips the topics array (incl. optional prompt)", () => {
    const out = [
      { id: "1", name: "A", theme: "alpha" },
      { id: "2", name: "B", theme: "beta", prompt: "Custom for {topic}" },
    ];
    saveTopics(out);
    expect(loadTopics()).toEqual(out);
  });

  it("filters out malformed entries on load", () => {
    memStore.set(
      "video-editor-topics",
      JSON.stringify([
        { id: "ok", name: "OK", theme: "valid" },
        { id: "bad-no-name", theme: "still bad" },
        { id: "bad-no-theme", name: "missing theme" },
        null,
        "string-instead-of-object",
      ])
    );
    const topics = loadTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toEqual({ id: "ok", name: "OK", theme: "valid" });
  });

  it("non-array JSON falls back to defaults", () => {
    memStore.set("video-editor-topics", JSON.stringify({ not: "an array" }));
    expect(loadTopics().length).toBe(DEFAULT_TOPICS.length);
  });

  it("malformed JSON falls back to defaults", () => {
    memStore.set("video-editor-topics", "{[}]");
    expect(loadTopics().length).toBe(DEFAULT_TOPICS.length);
  });
});
