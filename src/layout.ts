import type { Monitor, NativeWindow, Placement, Preset, Rect } from "./types";
export const presetNames: Record<Preset, string> = {
  columns: "左右に分割",
  rows: "上下に分割",
  focus: "メイン＋サブ",
  stack: "重ねて配置",
  grid: "グリッド",
};
export const presets = Object.keys(presetNames) as Preset[];
export function generate(
  ids: string[],
  monitors: Monitor[],
  assignments: Record<string, string>,
  preset: Preset,
  ratio: number,
): Placement[] {
  if (!monitors.length) return [];
  const groups = new Map<string, string[]>();
  ids.forEach((id) => {
    const m =
      monitors.find((m) => m.id === assignments[id])?.id ?? monitors[0].id;
    groups.set(m, [...(groups.get(m) ?? []), id]);
  });
  const result: Placement[] = [];
  for (const [monitor_id, windows] of groups) {
    windows.forEach((window_id, i) => {
      const n = windows.length;
      let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
      if (preset === "stack" && n > 1) {
        rect = { x: 0, y: 0, width: 1, height: 1 };
      } else if ((preset === "grid" || n > 6) && n > 1) {
        const cols = Math.ceil(Math.sqrt(n)),
          rows = Math.ceil(n / cols);
        rect = {
          x: (i % cols) / cols,
          y: Math.floor(i / cols) / rows,
          width: 1 / cols,
          height: 1 / rows,
        };
      } else if (preset === "focus" && n > 1) {
        rect =
          i === 0
            ? { x: 0, y: 0, width: ratio, height: 1 }
            : {
                x: ratio,
                y: (i - 1) / (n - 1),
                width: 1 - ratio,
                height: 1 / (n - 1),
              };
      } else if (n > 1) {
        const first = n === 2 ? ratio : Math.max(0.25, Math.min(0.65, ratio));
        const rest = (1 - first) / (n - 1);
        const offset = i === 0 ? 0 : first + (i - 1) * rest;
        const size = i === 0 ? first : rest;
        rect =
          preset === "rows"
            ? { x: 0, y: offset, width: 1, height: size }
            : { x: offset, y: 0, width: size, height: 1 };
      }
      result.push({ window_id, monitor_id, rect });
    });
  }
  // Preserve original order; later entries are raised last, defining overlap order.
  return ids.map((id) => result.find((p) => p.window_id === id)!);
}
export function monitorFor(w: NativeWindow, monitors: Monitor[]): string {
  const area = (m: Monitor) =>
    Math.max(
      0,
      Math.min(w.rect.x + w.rect.width, m.rect.x + m.rect.width) -
        Math.max(w.rect.x, m.rect.x),
    ) *
    Math.max(
      0,
      Math.min(w.rect.y + w.rect.height, m.rect.y + m.rect.height) -
        Math.max(w.rect.y, m.rect.y),
    );
  return [...monitors].sort((a, b) => area(b) - area(a))[0]?.id ?? "";
}
export function validRect(r: Rect) {
  return (
    Object.values(r).every(Number.isFinite) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width >= 0.05 &&
    r.height >= 0.05 &&
    r.x + r.width <= 1.0001 &&
    r.y + r.height <= 1.0001
  );
}
export function ranked(layouts: import("./types").Layout[]) {
  return [...layouts].sort(
    (a, b) => b.uses - a.uses || b.last_used - a.last_used,
  );
}
