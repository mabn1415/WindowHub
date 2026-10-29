import { describe, it, expect } from "vitest";
import {
  template,
  createDocument,
  zones,
  boundaries,
  setBoundary,
  splitZone,
  removeZone,
  placementsFrom,
  importPlacements,
  repairAssignments,
  validateDocument,
} from "./zones";
import { themePresets, contrast } from "./themes";
const ms = [
  {
    id: "main",
    name: "Main",
    scale: 2,
    rect: { x: 0, y: 0, width: 1512, height: 945 },
  },
  {
    id: "portrait",
    name: "Portrait",
    scale: 1,
    rect: { x: -1080, y: -300, width: 1080, height: 1890 },
  },
];
describe("region layouts", () => {
  it("uses independent 70:30 and 55:45 splits across monitors", () => {
    const d = createDocument(ms);
    d.monitors[0].root = setBoundary(
      d.monitors[0].root,
      boundaries(d.monitors[0].root)[0].id,
      0.7,
    );
    d.monitors[1].root = template("rows");
    d.monitors[1].root = setBoundary(
      d.monitors[1].root,
      boundaries(d.monitors[1].root)[0].id,
      0.55,
    );
    expect(zones(d.monitors[0].root)[0].rect.width).toBe(0.7);
    expect(zones(d.monitors[1].root)[0].rect.height).toBe(0.55);
    expect(validateDocument(d)).toBe(true);
  });
  it("assigns multiple windows to exactly the same region, alongside a tile", () => {
    const d = createDocument(ms),
      zs = zones(d.monitors[0].root);
    const p = placementsFrom(d, [
      { window_id: "a", monitor_id: "main", zone_id: zs[0].id },
      { window_id: "b", monitor_id: "main", zone_id: zs[1].id },
      { window_id: "c", monitor_id: "main", zone_id: zs[1].id },
    ]);
    expect(p[1].rect).toEqual(p[2].rect);
    expect(p[0].rect.x + p[0].rect.width).toBe(p[1].rect.x);
  });
  it("edits the second boundary in a three-column layout independently", () => {
    const root = template("three"),
      bs = boundaries(root),
      updated = setBoundary(root, bs[1].id, 0.7),
      zs = zones(updated);
    expect(zs[0].rect.width).toBeCloseTo(1 / 3);
    expect(zs[1].rect.x + zs[1].rect.width).toBeCloseTo(0.8);
    expect(zs[2].rect.width).toBeCloseTo(0.2);
  });
  it("clamps nested splits so every region remains at least 5% of the monitor", () => {
    let root = template("columns");
    root = splitZone(root, zones(root)[1].id, "x");
    root = setBoundary(root, boundaries(root)[0].id, 0.99);
    expect(zones(root).every((z) => z.rect.width >= 0.05 - 1e-8)).toBe(true);
  });
  it("removes a zone and repairs only missing assignments on its monitor", () => {
    const d = createDocument(ms),
      zs = zones(d.monitors[0].root),
      other = zones(d.monitors[1].root);
    const a = [
      { window_id: "a", monitor_id: "main", zone_id: zs[0].id },
      { window_id: "b", monitor_id: "portrait", zone_id: other[1].id },
    ];
    d.monitors[0].root = removeZone(d.monitors[0].root, zs[0].id);
    const fixed = repairAssignments(d, a);
    expect(fixed[1]).toEqual(a[1]);
    expect(fixed[0].zone_id).toBe(zs[1].id);
  });
  it("preserves arbitrary overlapping legacy rectangles without modifying stored data", () => {
    const p = [
      {
        window_id: "a",
        monitor_id: "main",
        rect: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
      },
      {
        window_id: "b",
        monitor_id: "main",
        rect: { x: 0.2, y: 0.3, width: 0.7, height: 0.6 },
      },
    ];
    const before = JSON.stringify(p);
    const imported = importPlacements(ms, p);
    expect(
      placementsFrom(imported.document, imported.assignments).map(
        (p) => p.rect,
      ),
    ).toEqual(p.map((p) => p.rect));
    expect(JSON.stringify(p)).toBe(before);
  });
  it("preserves exact region IDs and geometry when reloading a saved document", () => {
    const d = createDocument(ms),
      z = zones(d.monitors[0].root)[0];
    const p = placementsFrom(d, [
      { window_id: "a", monitor_id: "main", zone_id: z.id },
    ]);
    const loaded = importPlacements(ms, p, d);
    expect(loaded.document).toEqual(d);
    expect(loaded.document).not.toBe(d);
    expect(placementsFrom(loaded.document, loaded.assignments)).toEqual(p);
  });
  it("offers a readable light theme and validates normal text contrast", () => {
    const t = themePresets.find((p) => p.name === "Sandstone")!.theme;
    expect(contrast(t.text, t.background)).toBeGreaterThan(4.5);
    expect(contrast(t.text, t.surface)).toBeGreaterThan(4.5);
  });
});
