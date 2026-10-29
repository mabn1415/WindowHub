import { Monitor as Display, Check } from "lucide-react";
import type { Monitor } from "../types";
export function displayPosition(m: Monitor, ms: Monitor[]) {
  if (ms.length === 1) return "このディスプレイ";
  const minX = Math.min(...ms.map((m) => m.rect.x)),
    maxX = Math.max(...ms.map((m) => m.rect.x));
  const minY = Math.min(...ms.map((m) => m.rect.y)),
    maxY = Math.max(...ms.map((m) => m.rect.y));
  const x =
    maxX - minX > 100
      ? m.rect.x === minX
        ? "左"
        : m.rect.x === maxX
          ? "右"
          : "中央"
      : "";
  const y =
    maxY - minY > 100
      ? m.rect.y === minY
        ? "上"
        : m.rect.y === maxY
          ? "下"
          : "中央"
      : "";
  return [y, x].filter(Boolean).join("・") || "中央";
}
export default function MonitorPicker({
  monitors,
  selected,
  onSelect,
  compact = false,
}: {
  monitors: Monitor[];
  selected: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const left = Math.min(0, ...monitors.map((m) => m.rect.x)),
    top = Math.min(0, ...monitors.map((m) => m.rect.y));
  const width =
    Math.max(1, ...monitors.map((m) => m.rect.x + m.rect.width)) - left;
  const height =
    Math.max(1, ...monitors.map((m) => m.rect.y + m.rect.height)) - top;
  return (
    <>
      <svg
        className="display-map"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="実際のディスプレイの並び。番号は下の選択肢に対応します。"
      >
        {monitors.map((m, i) => (
          <g key={m.id} className={m.id === selected ? "selected" : ""}>
            <rect
              x={m.rect.x - left + 12}
              y={m.rect.y - top + 12}
              width={Math.max(1, m.rect.width - 24)}
              height={Math.max(1, m.rect.height - 24)}
              rx={40}
            />
            <text
              x={m.rect.x - left + m.rect.width / 2}
              y={m.rect.y - top + m.rect.height / 2}
              dominantBaseline="central"
              textAnchor="middle"
              fontSize={Math.min(m.rect.width, m.rect.height) * 0.28}
            >
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <div
        className={`display-picker ${compact ? "compact" : ""}`}
        aria-label="ディスプレイを選択"
      >
        {monitors.map((m, i) => (
          <button
            key={m.id}
            aria-label={`ディスプレイ${i + 1} ${m.name}`}
            aria-pressed={selected === m.id}
            className={selected === m.id ? "selected" : ""}
            onClick={() => onSelect(m.id)}
          >
            <span className="display-number">{i + 1}</span>
            <Display size={compact ? 17 : 24} />
            <span className="display-description">
              <b>{m.name}</b>
              <small>
                {displayPosition(m, monitors)} · {m.rect.width} ×{" "}
                {m.rect.height}
              </small>
            </span>
            {selected === m.id && <Check size={14} />}
          </button>
        ))}
      </div>
    </>
  );
}
