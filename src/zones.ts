import type { Monitor, Placement, Rect } from "./types";
export type Zone = { id: string; rect: Rect };
export type ZoneNode =
  | { kind: "zone"; id: string }
  | {
      kind: "split";
      id: string;
      axis: "x" | "y";
      ratio: number;
      first: ZoneNode;
      second: ZoneNode;
    }
  | { kind: "freeform"; id: string; zones: Zone[] };
export type MonitorPlan = {
  monitor_id: string;
  root: ZoneNode;
  locked: boolean;
};
export type LayoutDocument = { version: 1; monitors: MonitorPlan[] };
export type Assignment = {
  window_id: string;
  monitor_id: string;
  zone_id: string;
};
export type Boundary = {
  id: string;
  axis: "x" | "y";
  ratio: number;
  rect: Rect;
  position: number;
  equal: number;
};
let sequence = 0;
const id = () => `z-${Date.now().toString(36)}-${++sequence}`;
export const leaf = (): ZoneNode => ({ kind: "zone", id: id() });
const unit: Rect = { x: 0, y: 0, width: 1, height: 1 };
export function partition(
  r: Rect,
  axis: "x" | "y",
  ratio: number,
): [Rect, Rect] {
  return axis === "x"
    ? [
        { ...r, width: r.width * ratio },
        { ...r, x: r.x + r.width * ratio, width: r.width * (1 - ratio) },
      ]
    : [
        { ...r, height: r.height * ratio },
        { ...r, y: r.y + r.height * ratio, height: r.height * (1 - ratio) },
      ];
}
export function zones(node: ZoneNode, r = unit): Zone[] {
  if (node.kind === "zone") return [{ id: node.id, rect: r }];
  if (node.kind === "freeform")
    return node.zones.map((z) => ({
      id: z.id,
      rect: {
        x: r.x + z.rect.x * r.width,
        y: r.y + z.rect.y * r.height,
        width: z.rect.width * r.width,
        height: z.rect.height * r.height,
      },
    }));
  const [a, b] = partition(r, node.axis, node.ratio);
  return [...zones(node.first, a), ...zones(node.second, b)];
}
const count = (n: ZoneNode): number =>
  n.kind === "zone"
    ? 1
    : n.kind === "freeform"
      ? n.zones.length
      : count(n.first) + count(n.second);
export function boundaries(node: ZoneNode, r = unit): Boundary[] {
  if (node.kind !== "split") return [];
  const [a, b] = partition(r, node.axis, node.ratio);
  return [
    {
      id: node.id,
      axis: node.axis,
      ratio: node.ratio,
      rect: r,
      position: node.axis === "x" ? a.x + a.width : a.y + a.height,
      equal: count(node.first) / count(node),
    },
    ...boundaries(node.first, a),
    ...boundaries(node.second, b),
  ];
}
export function template(kind: string): ZoneNode {
  if (kind === "one") return leaf();
  if (kind === "grid")
    return {
      kind: "split",
      id: id(),
      axis: "x",
      ratio: 0.5,
      first: template("rows"),
      second: template("rows"),
    };
  if (kind === "three")
    return {
      kind: "split",
      id: id(),
      axis: "x",
      ratio: 1 / 3,
      first: leaf(),
      second: template("columns"),
    };
  return {
    kind: "split",
    id: id(),
    axis: kind === "rows" ? "y" : "x",
    ratio: 0.5,
    first: leaf(),
    second: leaf(),
  };
}
export function createDocument(ms: Monitor[]): LayoutDocument {
  return {
    version: 1,
    monitors: ms.map((m) => ({
      monitor_id: m.id,
      root: template("columns"),
      locked: false,
    })),
  };
}
function required(n: ZoneNode, axis: "x" | "y"): number {
  if (n.kind !== "split") return 0.05;
  return n.axis === axis
    ? required(n.first, axis) + required(n.second, axis)
    : Math.max(required(n.first, axis), required(n.second, axis));
}
export function setBoundary(
  root: ZoneNode,
  key: string,
  ratio: number,
  r = unit,
): ZoneNode {
  if (root.kind !== "split") return root;
  if (root.id === key) {
    const span = root.axis === "x" ? r.width : r.height;
    const lo = required(root.first, root.axis) / span,
      hi = 1 - required(root.second, root.axis) / span;
    return lo > hi
      ? root
      : { ...root, ratio: Math.max(lo, Math.min(hi, ratio)) };
  }
  const [a, b] = partition(r, root.axis, root.ratio);
  return {
    ...root,
    first: setBoundary(root.first, key, ratio, a),
    second: setBoundary(root.second, key, ratio, b),
  };
}
export function splitZone(
  root: ZoneNode,
  key: string,
  axis: "x" | "y",
): ZoneNode {
  const target = zones(root).find((z) => z.id === key);
  if (
    !target ||
    count(root) >= 9 ||
    (axis === "x" ? target.rect.width : target.rect.height) < 0.1 - 1e-8 ||
    root.kind === "freeform"
  )
    return root;
  function visit(n: ZoneNode): ZoneNode {
    if (n.kind === "zone")
      return n.id === key
        ? {
            kind: "split",
            id: id(),
            axis,
            ratio: 0.5,
            first: n,
            second: leaf(),
          }
        : n;
    if (n.kind === "split")
      return { ...n, first: visit(n.first), second: visit(n.second) };
    return n;
  }
  return visit(root);
}
export function removeZone(root: ZoneNode, key: string): ZoneNode {
  if (root.kind === "freeform")
    return root.zones.length > 1
      ? { ...root, zones: root.zones.filter((z) => z.id !== key) }
      : root;
  if (root.kind !== "split") return root;
  if (root.first.kind === "zone" && root.first.id === key) return root.second;
  if (root.second.kind === "zone" && root.second.id === key) return root.first;
  return {
    ...root,
    first: removeZone(root.first, key),
    second: removeZone(root.second, key),
  };
}
export function placementsFrom(
  doc: LayoutDocument,
  assignments: Assignment[],
): Placement[] {
  return assignments.flatMap((a) => {
    const p = doc.monitors.find((p) => p.monitor_id === a.monitor_id);
    const z = p && zones(p.root).find((z) => z.id === a.zone_id);
    return z ? [{ ...a, rect: z.rect }] : [];
  });
}
export function repairAssignments(
  doc: LayoutDocument,
  assignments: Assignment[],
): Assignment[] {
  return assignments.flatMap((a) => {
    const p = doc.monitors.find((p) => p.monitor_id === a.monitor_id);
    if (!p) return [];
    const zs = zones(p.root);
    return [
      {
        ...a,
        zone_id: zs.some((z) => z.id === a.zone_id) ? a.zone_id : zs[0].id,
      },
    ];
  });
}
export function importPlacements(
  ms: Monitor[],
  ps: Placement[],
  stored?: LayoutDocument | null,
): { document: LayoutDocument; assignments: Assignment[] } {
  const doc = stored
    ? structuredClone(stored)
    : {
        version: 1 as const,
        monitors: ms.map((m) => {
          const rects: Zone[] = [];
          ps.filter((p) => p.monitor_id === m.id).forEach((p) => {
            if (!rects.some((z) => same(z.rect, p.rect)))
              rects.push({ id: p.zone_id || id(), rect: p.rect });
          });
          return {
            monitor_id: m.id,
            root: rects.length
              ? { kind: "freeform" as const, id: id(), zones: rects }
              : template("columns"),
            locked: false,
          };
        }),
      };
  const assignments = ps.flatMap((p) => {
    const plan = doc.monitors.find((m) => m.monitor_id === p.monitor_id);
    const z =
      plan &&
      zones(plan.root).find((z) => z.id === p.zone_id || same(z.rect, p.rect));
    return z
      ? [{ window_id: p.window_id, monitor_id: p.monitor_id, zone_id: z.id }]
      : [];
  });
  return { document: doc, assignments };
}
export function same(a: Rect, b: Rect) {
  return (["x", "y", "width", "height"] as const).every(
    (k) => Math.abs(a[k] - b[k]) < 1e-6,
  );
}
export function validateDocument(doc: LayoutDocument): boolean {
  const seen = new Set<string>();
  return (
    doc.version === 1 &&
    doc.monitors.every((p) => {
      const zs = zones(p.root);
      return (
        zs.length > 0 &&
        zs.length <= 9 &&
        zs.every((z) => {
          if (seen.has(z.id)) return false;
          seen.add(z.id);
          const r = z.rect;
          return (
            Object.values(r).every(Number.isFinite) &&
            r.x >= -1e-8 &&
            r.y >= -1e-8 &&
            r.width >= 0.05 - 1e-8 &&
            r.height >= 0.05 - 1e-8 &&
            r.x + r.width <= 1.00001 &&
            r.y + r.height <= 1.00001
          );
        })
      );
    })
  );
}
