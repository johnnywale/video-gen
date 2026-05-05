import { describe, it, expect } from "vitest";
import { upsertTopic, removeTopic, findTopic, validateTopic, Topic } from "./topic";

const a: Topic = { id: "a", name: "A", theme: "alpha" };
const b: Topic = { id: "b", name: "B", theme: "beta" };

describe("upsertTopic", () => {
  it("adds a new topic when id is absent", () => {
    const out = upsertTopic([a], { name: "C", theme: "gamma" });
    expect(out).toHaveLength(2);
    expect(out[1].name).toBe("C");
    expect(out[1].id).toBeTruthy();
    expect(out[1].prompt).toBeUndefined();
  });

  it("preserves a non-empty prompt when adding", () => {
    const out = upsertTopic([], { name: "X", theme: "x", prompt: "Generate {count} for {topic}" });
    expect(out[0].prompt).toBe("Generate {count} for {topic}");
  });

  it("drops blank-only prompt when adding (treated as 'use default')", () => {
    const out = upsertTopic([], { name: "X", theme: "x", prompt: "   " });
    expect(out[0].prompt).toBeUndefined();
  });

  it("updates an existing topic by id", () => {
    const out = upsertTopic([a, b], { id: "a", name: "A2", theme: "alpha2" });
    expect(out).toHaveLength(2);
    expect(findTopic(out, "a")?.name).toBe("A2");
    expect(findTopic(out, "a")?.theme).toBe("alpha2");
    expect(findTopic(out, "b")).toEqual(b);
  });

  it("updates topic.prompt by id", () => {
    const out = upsertTopic([a], { id: "a", name: "A", theme: "alpha", prompt: "custom!" });
    expect(findTopic(out, "a")?.prompt).toBe("custom!");
  });

  it("treats unknown id as a new topic, preserving the supplied id", () => {
    const out = upsertTopic([a], { id: "new-id", name: "C", theme: "gamma" });
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("new-id");
  });
});

describe("removeTopic", () => {
  it("drops the matching id", () => {
    expect(removeTopic([a, b], "a")).toEqual([b]);
  });
  it("is a no-op when id is unknown", () => {
    expect(removeTopic([a, b], "zzz")).toEqual([a, b]);
  });
});

describe("validateTopic", () => {
  it("accepts a valid pair", () => {
    expect(validateTopic("Travel", "Travel diary")).toBeNull();
  });
  it("rejects blank name", () => {
    expect(validateTopic("   ", "x")).toMatch(/名称|name/i);
  });
  it("rejects blank theme", () => {
    expect(validateTopic("x", "")).toMatch(/主题|theme/i);
  });
  it("rejects overlong name", () => {
    expect(validateTopic("x".repeat(81), "ok")).toMatch(/过长|too long/i);
  });
});
