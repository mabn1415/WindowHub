import { describe, it, expect } from "vitest";
import { generate, validRect, monitorFor, ranked, presets } from "./layout";
import type { Monitor, NativeWindow } from "./types";
const monitors: Monitor[] = [
  {
    id: "left",
    name: "Left",
    rect: { x: -1920, y: 0, width: 1920, height: 1080 },
    scale: 1,
  },
  {
    id: "main",
    name: "Main",
    rect: { x: 0, y: 0, width: 1512, height: 945 },
    scale: 2,
  },
];
describe("layout geometry", () => {
  it("all presets keep 1–12 windows within each monitor and retain stack order", () => {
    for (const p of presets)
      for (let n = 1; n <= 12; n++) {
        const ids = Array.from({ length: n }, (_, i) => String(i));
        const ps = generate(ids, monitors, {}, p, 0.6);
        expect(ps.map((p) => p.window_id)).toEqual(ids);
        expect(ps.every((p) => validRect(p.rect))).toBe(true);
      }
  });
  it("splits two windows at the specified ratio", () => {
    const ps = generate(["a", "b"], monitors, {}, "columns", 0.65);
    expect(ps[0].rect.width).toBe(0.65);
    expect(ps[1].rect.x).toBe(0.65);
    expect(ps[1].rect.width).toBeCloseTo(0.35);
  });
  it("groups windows by target monitor independently", () => {
    const ps = generate(
      ["a", "b", "c"],
      monitors,
      { a: "left", b: "main", c: "main" },
      "rows",
      0.4,
    );
    expect(ps[0].rect.height).toBe(1);
    expect(ps[1].rect.height).toBe(0.4);
    expect(ps[2].rect.y).toBe(0.4);
  });
  it("handles unplugged assignments by selecting an available monitor", () => {
    expect(
      generate(["a"], monitors, { a: "removed" }, "columns", 0.5)[0].monitor_id,
    ).toBe("left");
    expect(generate(["a"], [], {}, "columns", 0.5)).toEqual([]);
  });
  it("chooses the monitor by intersection, including negative origins", () => {
    const w = {
      rect: { x: -1000, y: 100, width: 800, height: 600 },
    } as NativeWindow;
    expect(monitorFor(w, monitors)).toBe("left");
  });
  it("rejects offscreen or invalid custom regions", () => {
    expect(validRect({ x: 0.8, y: 0, width: 0.5, height: 1 })).toBe(false);
    expect(validRect({ x: 0, y: 0, width: NaN, height: 1 })).toBe(false);
  });
  it("ranks manual layouts by successful uses then recency", () => {
    const items = [
      { id: "a", uses: 1, last_used: 9 },
      { id: "b", uses: 3, last_used: 1 },
      { id: "c", uses: 3, last_used: 2 },
    ] as any;
    expect(ranked(items).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(items[0].id).toBe("a");
  });
});
