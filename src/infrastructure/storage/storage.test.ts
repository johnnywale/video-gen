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
      litellmApiKey: "sk-test",
      speechCacheDir: "/Users/x/cache",
    });
    expect(loadSettings()).toEqual({
      litellmApiKey: "sk-test",
      speechCacheDir: "/Users/x/cache",
    });
  });

  it("missing fields fall back to defaults (forwards-compat)", () => {
    memStore.set("video-editor-settings", JSON.stringify({ litellmApiKey: "sk-only" }));
    const s = loadSettings();
    expect(s.litellmApiKey).toBe("sk-only");
    expect(s.speechCacheDir).toBe(DEFAULT_SETTINGS.speechCacheDir);
  });

  it("migrates the legacy anthropicApiKey field into litellmApiKey", () => {
    // Pre-rebrand projects stored the LiteLLM proxy key under
    // `anthropicApiKey`. On load we lift it into the new field so users
    // don't lose their key after upgrade.
    memStore.set(
      "video-editor-settings",
      JSON.stringify({ anthropicApiKey: "sk-legacy-anthropic" })
    );
    expect(loadSettings().litellmApiKey).toBe("sk-legacy-anthropic");
  });

  it("falls back to legacy minimaxApiKey when no anthropicApiKey is present", () => {
    memStore.set(
      "video-editor-settings",
      JSON.stringify({ minimaxApiKey: "sk-legacy-mm" })
    );
    expect(loadSettings().litellmApiKey).toBe("sk-legacy-mm");
  });

  it("malformed JSON returns defaults rather than throwing", () => {
    memStore.set("video-editor-settings", "{not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("clearSettings removes the key from storage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, litellmApiKey: "sk-clear" });
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
