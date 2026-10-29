import { useEffect } from "react";
import type { RefObject } from "react";
import { ArrowRight, Check, ChevronLeft, Search, X } from "lucide-react";
import type { Snapshot } from "../types";
import { zones, type LayoutDocument, type Assignment } from "../zones";
import MonitorPicker from "./MonitorPicker";
import ZoneCanvas from "./ZoneCanvas";
import WindowAccessState from "./WindowAccessState";
export type ArrangeSelection = {
  phase: 0 | 1 | 2;
  windowId: string;
  monitorId: string;
  zoneId: string;
  row: number;
};
export const newSelection = (): ArrangeSelection => ({
  phase: 0,
  windowId: "",
  monitorId: "",
  zoneId: "",
  row: 0,
});
type Props = {
  snapshot: Snapshot;
  document: LayoutDocument;
  assignments: Assignment[];
  selection: ArrangeSelection;
  setSelection: (value: ArrangeSelection) => void;
  surfaceRef: RefObject<HTMLDivElement | null>;
  query: string;
  onQuery: (value: string) => void;
  onAssign: (window: string, monitor: string, zone: string) => void;
  onRemove: (window: string) => void;
  onMonitor: (id: string) => void;
  onEdit: () => void;
  onBack: () => void;
  onPermission: () => void;
  onRefresh: () => void;
  busy: boolean;
};
export default function ArrangeFlow(p: Props) {
  const s = p.selection,
    ms = p.snapshot.monitors;
  const ws = p.snapshot.windows.filter((w) =>
    `${w.app_name} ${w.title}`
      .toLocaleLowerCase()
      .includes(p.query.toLocaleLowerCase()),
  );
  const target = p.snapshot.windows.find((w) => w.id === s.windowId);
  const monitor = ms.find((m) => m.id === s.monitorId) || ms[0];
  const plan = p.document.monitors.find((m) => m.monitor_id === monitor?.id);
  const zs = plan ? zones(plan.root) : [];
  const zone = zs.find((z) => z.id === s.zoneId) || zs[0];
  const update = (v: Partial<ArrangeSelection>) =>
    p.setSelection({ ...s, ...v });
  const pickWindow = (id: string) =>
    update({ phase: 1, windowId: id, monitorId: "", zoneId: "" });
  const pickMonitor = (id: string) => {
    p.onMonitor(id);
    update({ phase: 2, monitorId: id, zoneId: "" });
  };
  const confirm = () => {
    if (!target || !monitor || !zone || s.phase !== 2) return;
    p.onAssign(target.id, monitor.id, zone.id);
    p.setSelection({ ...newSelection(), row: s.row });
    p.onQuery("");
  };
  useEffect(() => {
    p.surfaceRef.current?.focus();
  }, [s.phase]);
  return (
    <div
      className="guided-arrange keyboard-surface"
      data-keyboard-surface
      tabIndex={0}
      ref={p.surfaceRef}
      onKeyDown={(e) => {
        if (e.repeat && ["Enter", " "].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;
        if (
          e.key === "F6" ||
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")
        )
          return;
        if (
          ["INPUT", "TEXTAREA", "SELECT"].includes(
            (e.target as HTMLElement).tagName,
          )
        ) {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            p.onQuery("");
            p.surfaceRef.current?.focus();
          }
          return;
        }
        if (
          (e.target as HTMLElement).tagName === "BUTTON" &&
          e.key === "Enter"
        ) {
          e.stopPropagation();
          return;
        }
        if (e.ctrlKey || e.altKey || e.metaKey) {
          if (e.ctrlKey && e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            if (s.phase === 1 && ms.length) {
              const i = ms.findIndex((m) => m.id === monitor?.id);
              update({
                monitorId:
                  ms[(i + (e.shiftKey ? ms.length - 1 : 1)) % ms.length]?.id ||
                  "",
              });
            }
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          p.onBack();
          return;
        }
        if (e.key === "?") return;
        e.stopPropagation();
        if (p.busy) return;
        if (s.phase === 0) {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab") {
            e.preventDefault();
            const d = e.key === "ArrowUp" || e.shiftKey ? -1 : 1;
            update({ row: (s.row + d + ws.length) % Math.max(1, ws.length) });
          }
          if ((e.key === "Enter" || e.key === " ") && ws[s.row]) {
            e.preventDefault();
            pickWindow(ws[s.row].id);
          }
          if (e.key === "/") {
            e.preventDefault();
            p.surfaceRef.current
              ?.querySelector<HTMLInputElement>("input")
              ?.focus();
          }
        } else if (s.phase === 1) {
          if (
            e.key === "ArrowDown" ||
            e.key === "ArrowRight" ||
            e.key === "Tab" ||
            e.key === "ArrowUp" ||
            e.key === "ArrowLeft"
          ) {
            e.preventDefault();
            if (!ms.length) return;
            const i = ms.findIndex((m) => m.id === monitor?.id),
              d =
                e.shiftKey || ["ArrowUp", "ArrowLeft"].includes(e.key) ? -1 : 1;
            update({
              monitorId: ms[(i + d + ms.length) % ms.length]?.id || "",
            });
          }
          if (/^[1-9]$/.test(e.key) && ms[Number(e.key) - 1]) {
            e.preventDefault();
            pickMonitor(ms[Number(e.key) - 1].id);
          }
          if (e.key === "Enter" && monitor) {
            e.preventDefault();
            pickMonitor(monitor.id);
          }
        } else {
          if (/^[1-9]$/.test(e.key) && zs[Number(e.key) - 1]) {
            e.preventDefault();
            update({ zoneId: zs[Number(e.key) - 1].id });
          }
          if (
            e.key === "ArrowRight" ||
            e.key === "ArrowDown" ||
            e.key === "ArrowLeft" ||
            e.key === "ArrowUp" ||
            e.key === "Tab"
          ) {
            e.preventDefault();
            const i = zs.findIndex((z) => z.id === zone?.id),
              d =
                e.shiftKey || ["ArrowUp", "ArrowLeft"].includes(e.key) ? -1 : 1;
            update({
              zoneId:
                zs[(i + d + zs.length) % Math.max(1, zs.length)]?.id || "",
            });
          }
          if (e.key === "Enter") {
            e.preventDefault();
            confirm();
          }
          if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            p.onEdit();
          }
        }
      }}
    >
      <ol className="flow-steps" aria-label="配置の手順">
        {["アプリ選択", "ディスプレイ選択", "配置決定"].map((name, i) => (
          <li key={name} aria-current={s.phase === i ? "step" : undefined}>
            <button
              disabled={i > s.phase}
              onClick={() => update({ phase: i as 0 | 1 | 2 })}
            >
              <span>{i < s.phase ? <Check size={12} /> : i + 1}</span>
              {name}
            </button>
            {i < 2 && <ArrowRight size={13} />}
          </li>
        ))}
      </ol>
      <div className="flow-instruction" aria-live="polite">
        <h1>
          {
            [
              "配置するウィンドウを選ぶ",
              "移動先のディスプレイを選ぶ",
              "領域を選んで配置を決定",
            ][s.phase]
          }
        </h1>
        <p>
          {
            [
              "クリック、または↑↓で選んでEnter。選ぶまで次へ進みません。",
              "番号で選択、または矢印で選んでEnter。",
              "番号またはプレビューで領域を選び、Enterで配置を追加します。",
            ][s.phase]
          }
        </p>
      </div>
      {s.phase > 0 && (
        <div className="flow-path">
          <b>{target?.app_name || "対象が閉じられました"}</b>
          <small>{target?.title}</small>
          {s.phase === 2 && (
            <>
              <ArrowRight size={12} />
              <b>
                ディスプレイ {ms.findIndex((m) => m.id === monitor?.id) + 1} ·{" "}
                {monitor?.name}
              </b>
            </>
          )}
        </div>
      )}
      {s.phase === 0 && (
        <>
          <section className="window-panel guided-window-panel">
            <div className="search-field">
              <Search size={13} />
              <input
                aria-label="ウィンドウを検索"
                placeholder="アプリ・ウィンドウを検索 /"
                value={p.query}
                onChange={(e) => {
                  p.onQuery(e.target.value);
                  update({ row: 0 });
                }}
              />
            </div>
            <div className="window-list" aria-label="ウィンドウ一覧">
              {ws.map((w, i) => {
                const a = p.assignments.find((a) => a.window_id === w.id);
                return (
                  <button
                    key={w.id}
                    className={`window-item ${i === s.row ? "selected" : ""}`}
                    aria-label={`${w.app_name} ${w.title}`}
                    onClick={() => pickWindow(w.id)}
                  >
                    <span className="app-symbol">{w.app_name[0]}</span>
                    <span>
                      <b>{w.app_name}</b>
                      <small>{w.title || "タイトルなし"}</small>
                    </span>
                    <span className="assignment">
                      {a ? "配置済み" : "選択 →"}
                    </span>
                  </button>
                );
              })}
              {!ws.length && (
                <WindowAccessState
                  trusted={p.snapshot.trusted}
                  filtered={!!p.query}
                  busy={p.busy}
                  onPermission={p.onPermission}
                  onRefresh={p.onRefresh}
                />
              )}
            </div>
          </section>
          {p.assignments.length > 0 && (
            <details className="assignment-summary">
              <summary>
                {p.assignments.length}件の配置を準備済み ·
                一括反映するまで移動しません
              </summary>
              {p.assignments.map((a) => {
                const w = p.snapshot.windows.find((w) => w.id === a.window_id),
                  m = ms.find((m) => m.id === a.monitor_id),
                  root = p.document.monitors.find(
                    (p) => p.monitor_id === a.monitor_id,
                  )?.root,
                  n = root
                    ? zones(root).findIndex((z) => z.id === a.zone_id) + 1
                    : 0;
                return (
                  <div key={a.window_id}>
                    <span>{w?.app_name}</span>
                    <small>
                      → {ms.findIndex((m) => m.id === a.monitor_id) + 1}.{" "}
                      {m?.name} · 領域{n}
                    </small>
                    <button
                      aria-label={`${w?.app_name}の割り当てを解除`}
                      onClick={() => p.onRemove(a.window_id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </details>
          )}
        </>
      )}
      {s.phase === 1 && (
        <MonitorPicker
          monitors={ms}
          selected={monitor?.id || ""}
          onSelect={pickMonitor}
        />
      )}
      {s.phase === 2 && monitor && (
        <>
          <div className="flow-placement">
            <ZoneCanvas
              previewHeight={170}
              snapshot={{ ...p.snapshot, monitors: [monitor] }}
              document={{
                ...p.document,
                monitors: p.document.monitors.filter(
                  (p) => p.monitor_id === monitor.id,
                ),
              }}
              assignments={p.assignments}
              monitorId={monitor.id}
              zoneId={zone?.id}
              onMonitor={() => {}}
              onZone={(_, id) => update({ zoneId: id })}
            />
            <div className="zone-picker" aria-label="領域を選択">
              {zs.map((z, i) => (
                <button
                  key={z.id}
                  aria-pressed={zone?.id === z.id}
                  className={zone?.id === z.id ? "active" : ""}
                  onClick={() => update({ zoneId: z.id })}
                >
                  <kbd>{i + 1}</kbd>領域{i + 1}
                </button>
              ))}
            </div>
          </div>
          <div className="flow-decision">
            <button onClick={p.onEdit}>
              領域・比率を編集 <kbd>R</kbd>
            </button>
            <button
              className="primary"
              disabled={!target || !zone || p.busy}
              onClick={confirm}
            >
              この配置を追加 <kbd>Enter</kbd>
            </button>
          </div>
          <p className="micro">
            同じ領域を複数のウィンドウに指定すると重ね配置になります。
          </p>
        </>
      )}
      {s.phase > 0 && (
        <button className="text-button flow-back" onClick={p.onBack}>
          <ChevronLeft size={12} />
          ひとつ前へ <kbd>Esc</kbd>
        </button>
      )}
    </div>
  );
}
