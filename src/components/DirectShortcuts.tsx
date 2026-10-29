import { useEffect, useState } from "react";
import type { Settings } from "../types";
export const directDefaults = () =>
  Object.fromEntries(
    [
      ["left", "Left"],
      ["right", "Right"],
      ["top", "Up"],
      ["bottom", "Down"],
      ["maximize", "Enter"],
    ].map(([a, k]) => [a, `Control+Alt+Super+${k}`]),
  );
const names: Record<string, string> = {
  left: "左半分",
  right: "右半分",
  top: "上半分",
  bottom: "下半分",
  maximize: "最大化",
};
export default function DirectShortcuts({
  settings,
  busy,
  onSave,
}: {
  settings: Settings;
  busy: boolean;
  onSave: (enabled: boolean, keys: Record<string, string>) => void;
}) {
  const [enabled, setEnabled] = useState(settings.quick_enabled),
    [keys, setKeys] = useState(settings.quick_shortcuts),
    [record, setRecord] = useState("");
  useEffect(() => {
    setEnabled(settings.quick_enabled);
    setKeys(settings.quick_shortcuts);
  }, [settings.quick_enabled, settings.quick_shortcuts]);
  return (
    <section className="direct-settings">
      <h2>ハブを開かずに配置（試験機能）</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        直接ショートカットを有効にする
      </label>
      <p className="micro">
        反応しない場合はホームの矢印操作を使ってください。対象アプリを操作中に使います。左右は現在の配置を見て、同じ側にある場合は別のモニターへ移動します。長押しでは移動しません。
      </p>
      <div className="direct-key-list">
        {Object.keys(names).map((action) => (
          <div key={action}>
            <label htmlFor={`direct-${action}`}>{names[action]}</label>
            <input
              id={`direct-${action}`}
              aria-label={`${names[action]}の直接キー`}
              value={keys[action] || ""}
              onChange={(e) => setKeys({ ...keys, [action]: e.target.value })}
              spellCheck={false}
              onKeyDown={(e) => {
                if (!record) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "Escape") {
                  setRecord("");
                  return;
                }
                if (
                  record !== action ||
                  ["Control", "Alt", "Meta", "Shift"].includes(e.key)
                )
                  return;
                if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
                const key = e.code.startsWith("Key")
                  ? e.code.slice(3)
                  : e.code.startsWith("Digit")
                    ? e.code.slice(5)
                    : e.key === " "
                      ? "Space"
                      : e.key.replace("Arrow", "");
                setKeys({
                  ...keys,
                  [action]: [
                    e.ctrlKey ? "Control" : "",
                    e.altKey ? "Alt" : "",
                    e.shiftKey ? "Shift" : "",
                    e.metaKey ? "Super" : "",
                    key,
                  ]
                    .filter(Boolean)
                    .join("+"),
                });
                setRecord("");
              }}
            />
            <button
              disabled={busy}
              onClick={() => {
                setRecord(action);
                document.getElementById(`direct-${action}`)?.focus();
              }}
            >
              {record === action ? "入力中…" : "記録"}
            </button>
          </div>
        ))}
      </div>
      <div className="direct-actions">
        <button onClick={() => setKeys(directDefaults())}>
          標準キーに戻す
        </button>
        <button
          className="primary"
          disabled={busy || !!record}
          onClick={() => onSave(enabled, keys)}
        >
          直接キーを登録・保存
        </button>
      </div>
    </section>
  );
}
