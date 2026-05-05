import { describe, it, expect } from "vitest";
import {
  CaptionBatch,
  makeBatch,
  addBatch,
  removeBatch,
  pickRandomBatch,
  MAX_BATCHES,
} from "./captionBatch";

const fix = (over: Partial<CaptionBatch> = {}): CaptionBatch => ({
  id: "x",
  topic: "t",
  voiceId: "v",
  captions: ["a", "b"],
  createdAt: 0,
  ...over,
});

describe("makeBatch", () => {
  it("assigns a fresh id and timestamp, copies captions", () => {
    const captions = ["one", "two"];
    const b = makeBatch({ topic: "Trip", voiceId: "Wise_Woman", captions });
    expect(b.id).toBeTruthy();
    expect(b.createdAt).toBeGreaterThan(0);
    expect(b.captions).toEqual(["one", "two"]);
    // Mutating the input array mustn't affect the stored batch.
    captions.push("three");
    expect(b.captions).toEqual(["one", "two"]);
  });
});

describe("addBatch", () => {
  it("prepends newest first", () => {
    const out = addBatch([fix({ id: "old" })], fix({ id: "new" }));
    expect(out.map((b) => b.id)).toEqual(["new", "old"]);
  });

  it("drops the oldest when over MAX_BATCHES", () => {
    // addBatch keeps newest-first order, so simulate that: index 0 is the
    // most-recent entry, the last element is the oldest.
    const list: CaptionBatch[] = Array.from({ length: MAX_BATCHES }, (_, i) =>
      fix({ id: `b${MAX_BATCHES - 1 - i}`, createdAt: MAX_BATCHES - 1 - i })
    );
    const out = addBatch(list, fix({ id: "newest" }));
    expect(out.length).toBe(MAX_BATCHES);
    expect(out[0].id).toBe("newest");
    // Oldest (b0, was at the tail) should have been dropped.
    expect(out.find((b) => b.id === "b0")).toBeUndefined();
    // Second-oldest (b1) survives.
    expect(out.find((b) => b.id === "b1")).toBeDefined();
  });
});

describe("removeBatch", () => {
  it("drops the matching id", () => {
    const out = removeBatch([fix({ id: "a" }), fix({ id: "b" })], "a");
    expect(out.map((x) => x.id)).toEqual(["b"]);
  });
  it("is a no-op when id is unknown", () => {
    const list = [fix({ id: "a" })];
    expect(removeBatch(list, "zzz")).toEqual(list);
  });
});

describe("pickRandomBatch", () => {
  it("returns null on empty", () => {
    expect(pickRandomBatch([])).toBeNull();
  });
  it("picks the only item deterministically", () => {
    const only = fix({ id: "only" });
    expect(pickRandomBatch([only], () => 0.99)).toBe(only);
  });
  it("uses the rng to index", () => {
    const list = [fix({ id: "a" }), fix({ id: "b" }), fix({ id: "c" })];
    expect(pickRandomBatch(list, () => 0)?.id).toBe("a");
    // 0.5 * 3 = 1.5 → floor = 1 → "b"
    expect(pickRandomBatch(list, () => 0.5)?.id).toBe("b");
    // 0.99 * 3 = 2.97 → floor = 2 → "c"
    expect(pickRandomBatch(list, () => 0.99)?.id).toBe("c");
  });
});
