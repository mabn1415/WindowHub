import { useRef } from "react";
import { Monitor as Display, Layers, Lock } from "lucide-react";
import {
  zones,
  boundaries,
  type LayoutDocument,
  type Assignment,
  type Boundary,
} from "../zones";
import type { Snapshot } from "../types";
type Props = {
  snapshot: Snapshot;
  document: LayoutDocument;
  assignments: Assignment[];
  monitorId: string;
  zoneId?: string;
  boundaryId?: string;
  editing?: boolean;
  previewHeight?: number;
  onMonitor: (id: string) => void;
  onZone: (id: string, zone: string) => void;
  onBoundary?: (id: string) => void;
  onRatio?: (id: string, ratio: number) => void;
};
export default function ZoneCanvas(p: Props) {
  const drag = useRef<{ boundary: Boundary; canvas: HTMLElement } | null>(null);
  return (
    <div className={`monitor-grid ${p.editing ? "editing" : ""}`}>
      {p.document.monitors
        .filter((plan) => !p.editing || plan.monitor_id === p.monitorId)
        .map((plan) => {
          const m = p.snapshot.monitors.find((m) => m.id === plan.monitor_id);
          if (!m) return null;
          const zs = zones(plan.root);
          const bs = boundaries(plan.root);
          return (
            <section
              key={m.id}
              className={`monitor-card ${m.id === p.monitorId ? "active" : ""}`}
              aria-label={m.name}
            >
              <button
                className="monitor-label"
                onClick={() => p.onMonitor(m.id)}
              >
                <Display size={13} />
                <span>{m.name}</span>
                {plan.locked && <Lock size={11} />}
                <small>
                  {m.rect.width} × {m.rect.height}
                </small>
              </button>
              <div
                className="zone-canvas"
                style={{
                  aspectRatio: `${m.rect.width}/${m.rect.height}`,
                  width: `min(100%, ${((p.previewHeight ?? (p.editing ? 210 : 120)) * m.rect.width) / m.rect.height}px)`,
                }}
              >
                {zs.map((z, i) => {
                  const assigned = p.assignments.filter(
                    (a) => a.monitor_id === m.id && a.zone_id === z.id,
                  );
                  return (
                    <button
                      key={z.id}
                      className={`zone ${p.zoneId === z.id && p.monitorId === m.id ? "selected" : ""}`}
                      style={{
                        left: `${z.rect.x * 100}%`,
                        top: `${z.rect.y * 100}%`,
                        width: `${z.rect.width * 100}%`,
                        height: `${z.rect.height * 100}%`,
                      }}
                      onClick={() => p.onZone(m.id, z.id)}
                      aria-label={`${m.name} 領域${i + 1}${assigned.length ? ` ${assigned.length}ウィンドウ` : ""}`}
                    >
                      <b>{i + 1}</b>
                      <span>
                        {assigned
                          .map(
                            (a) =>
                              p.snapshot.windows.find(
                                (w) => w.id === a.window_id,
                              )?.app_name ?? "閉じたウィンドウ",
                          )
                          .join(" + ")}
                      </span>
                      {assigned.length > 1 && (
                        <small>
                          <Layers size={10} />
                          {assigned.length}
                        </small>
                      )}
                    </button>
                  );
                })}
                {p.editing &&
                  bs.map((b, i) => (
                    <div
                      key={b.id}
                      role="slider"
                      tabIndex={0}
                      aria-label={`分割線${i + 1}`}
                      aria-valuenow={Math.round(b.ratio * 100)}
                      aria-valuemin={5}
                      aria-valuemax={95}
                      aria-orientation={
                        b.axis === "x" ? "horizontal" : "vertical"
                      }
                      className={`split-handle ${b.axis} ${p.boundaryId === b.id ? "selected" : ""} ${plan.locked ? "locked" : ""}`}
                      style={
                        b.axis === "x"
                          ? {
                              left: `${b.position * 100}%`,
                              top: `${b.rect.y * 100}%`,
                              height: `${b.rect.height * 100}%`,
                            }
                          : {
                              top: `${b.position * 100}%`,
                              left: `${b.rect.x * 100}%`,
                              width: `${b.rect.width * 100}%`,
                            }
                      }
                      onFocus={() => p.onBoundary?.(b.id)}
                      onPointerDown={(e) => {
                        if (plan.locked) return;
                        e.preventDefault();
                        p.onBoundary?.(b.id);
                        e.currentTarget.focus();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = {
                          boundary: b,
                          canvas: e.currentTarget.parentElement!,
                        };
                      }}
                      onPointerMove={(e) => {
                        if (!drag.current || !(e.buttons & 1) || plan.locked)
                          return;
                        const { boundary, canvas } = drag.current;
                        const r = canvas.getBoundingClientRect();
                        const global =
                          boundary.axis === "x"
                            ? (e.clientX - r.left) / r.width
                            : (e.clientY - r.top) / r.height;
                        const value =
                          boundary.axis === "x"
                            ? (global - boundary.rect.x) / boundary.rect.width
                            : (global - boundary.rect.y) / boundary.rect.height;
                        p.onRatio?.(boundary.id, value);
                      }}
                      onPointerUp={() => (drag.current = null)}
                      onLostPointerCapture={() => (drag.current = null)}
                    />
                  ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
