import { directDefaults } from "./components/DirectShortcuts";
import { invoke } from "@tauri-apps/api/core";
import type {
  Bootstrap,
  Settings,
  Snapshot,
  Placement,
  Layout,
  Applied,
  MoveResult,
  Restored,
} from "./types";
import { normalizeTheme, themePresets } from "./themes";
export const native = "__TAURI_INTERNALS__" in window;
const snapshot: Snapshot = {
  trusted: true,
  platform: "preview",
  monitors: [
    {
      id: "demo-main",
      name: "メイン",
      rect: { x: 0, y: 0, width: 1512, height: 945 },
      scale: 2,
    },
    {
      id: "demo-sub",
      name: "縦ディスプレイ",
      rect: { x: -1080, y: -300, width: 1080, height: 1890 },
      scale: 1,
    },
  ],
  windows: [
    {
      id: "w1",
      pid: 1,
      app_id: "safari",
      app_name: "Safari",
      title: "リサーチ資料",
      rect: { x: 0, y: 0, width: 756, height: 945 },
      resizable: true,
    },
    {
      id: "w2",
      pid: 2,
      app_id: "code",
      app_name: "Code",
      title: "WindowHub",
      rect: { x: 756, y: 0, width: 756, height: 945 },
      resizable: true,
    },
    {
      id: "w3",
      pid: 3,
      app_id: "notes",
      app_name: "メモ",
      title: "作業メモ",
      rect: { x: -1080, y: -300, width: 1080, height: 900 },
      resizable: true,
    },
    {
      id: "w4",
      pid: 4,
      app_id: "terminal",
      app_name: "Terminal",
      title: "開発環境",
      rect: { x: 0, y: 0, width: 600, height: 500 },
      resizable: true,
    },
  ],
};
const fresh = (): Settings => ({
  hub_screen: "mouse",
  quick_enabled: true,
  quick_shortcuts: directDefaults(),
  schema_version: 1,
  shortcut: "Control+Shift+Space",
  theme: themePresets[0].theme,
  profiles: {},
  guide_seen: false,
  guide_mode: "compact",
  learning_enabled: true,
  configurations: {},
});
let settings: Settings = {
  ...fresh(),
  ...JSON.parse(localStorage.getItem("windowhub-preview") || "null"),
};
settings.theme = normalizeTheme(settings.theme);
let history = JSON.parse(
  localStorage.getItem("windowhub-preview-history") || "[]",
) as { key: string; layout: Layout; used_at: number }[];
let undo: Snapshot | null = null;
const save = () => {
  localStorage.setItem("windowhub-preview", JSON.stringify(settings));
  return structuredClone(settings);
};
function record(ps: Placement[], document: Layout["document"]) {
  if (!settings.learning_enabled) return;
  history.push({
    key: "preview-only",
    used_at: Date.now() / 1000,
    layout: {
      id: `history-${Date.now()}`,
      name: "履歴候補",
      uses: 1,
      last_used: Date.now() / 1000,
      document,
      bindings: bind(ps).map((b) => ({ ...b, title: "" })),
    },
  });
  history = history.slice(-200);
  localStorage.setItem("windowhub-preview-history", JSON.stringify(history));
}
function bind(ps: Placement[]) {
  return ps.map((p) => {
    const w = snapshot.windows.find((w) => w.id === p.window_id);
    if (!w) throw Error("ウィンドウを再取得してください");
    return {
      app_id: w.app_id,
      title: w.title,
      ordinal: snapshot.windows
        .filter((o) => o.app_id === w.app_id)
        .findIndex((o) => o.id === w.id),
      monitor_id: p.monitor_id,
      zone_id: p.zone_id,
      rect: p.rect,
    };
  });
}
function suggestions() {
  if (!settings.learning_enabled) return [];
  const groups = new Map<string, typeof history>();
  for (const h of history) {
    const key = JSON.stringify(
      h.layout.bindings.map((b) => [b.app_id, b.monitor_id, b.rect]),
    );
    groups.set(key, [...(groups.get(key) || []), h]);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => {
      const l = g.at(-1)!.layout;
      return {
        id: l.id,
        name: `${l.bindings.length}ウィンドウの配置`,
        samples: g.length,
        score: g.length,
        layout: l,
      };
    });
}
export async function api<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (native) return invoke<T>(command, args);
  const result = (() => {
    switch (command) {
      case "bootstrap":
        return {
          settings: structuredClone(settings),
          snapshot: structuredClone(snapshot),
          topology: "preview-only",
          context: {
            window: structuredClone(snapshot.windows[0]),
            monitor: structuredClone(snapshot.monitors[0]),
            app_pid: 1,
          },
          suggestions: suggestions(),
          compatible_profiles: [],
          shortcut_error: null,
          history_error: null,
        } satisfies Bootstrap;
      case "environment":
        return {
          topology: "preview-only",
          window_count: snapshot.windows.length,
          trusted: true,
        };
      case "set_hub_view":
      case "hide_hub":
      case "refresh_permissions":
        return null;
      case "request_permission":
        return false;
      case "set_quick_shortcuts": {
        const keys = args.shortcuts as Record<string, string>;
        const all = [settings.shortcut, ...Object.values(keys)].map((k) =>
          k.toLowerCase(),
        );
        if (new Set(all).size !== all.length)
          throw Error("同じキーを複数の操作に登録できません");
        settings.quick_enabled = !!args.enabled;
        settings.quick_shortcuts = keys;
        return save();
      }
      case "save_preferences":
        if (args.hubScreen)
          settings.hub_screen = args.hubScreen as Settings["hub_screen"];
        settings.theme = args.theme as Settings["theme"];
        settings.guide_seen = args.guideSeen as boolean;
        if (args.guideMode)
          settings.guide_mode = args.guideMode as Settings["guide_mode"];
        if (typeof args.learningEnabled === "boolean")
          settings.learning_enabled = args.learningEnabled;
        return save();
      case "set_shortcut":
        if (
          !/^(Control|Alt|Super|Command|CommandOrControl)\+/.test(
            args.shortcut as string,
          )
        )
          throw Error("修飾キーを含めてください");
        settings.shortcut = args.shortcut as string;
        return save();
      case "save_layout": {
        const ps = args.placements as Placement[];
        const id = (args.layoutId as string) || `layout-${Date.now()}`;
        const ls = settings.profiles["preview-only"] || [];
        const old = ls.find((l) => l.id === id);
        if (old?.locked && !args.updateFixed)
          throw Error("固定レイアウトの更新を明示してください");
        const l: Layout = {
          id,
          name: args.name as string,
          bindings: bind(ps),
          document: args.document as Layout["document"],
          is_initial: !!args.isInitial,
          locked: !!args.isInitial,
          uses: old?.uses || 0,
          last_used: old?.last_used || 0,
        };
        if (l.is_initial) ls.forEach((l) => (l.is_initial = false));
        settings.profiles["preview-only"] = [
          ...ls.filter((l) => l.id !== id),
          l,
        ];
        settings.configurations["preview-only"] = snapshot.monitors;
        return save();
      }
      case "delete_layout": {
        const key = (args.profileKey as string) || "preview-only";
        settings.profiles[key] = (settings.profiles[key] || []).filter(
          (l) => l.id !== args.id,
        );
        return save();
      }
      case "restore_layout": {
        const l = (
          args.suggestion
            ? suggestions().map((s) => s.layout)
            : settings.profiles[
                (args.profileKey as string) || "preview-only"
              ] || []
        ).find((l) => l.id === args.id);
        if (!l) throw Error("保存した配置がありません");
        const used = new Set<string>();
        const missing: string[] = [];
        const placements: Placement[] = [];
        l.bindings.forEach((b) => {
          const candidates = snapshot.windows.filter(
            (w) => w.app_id === b.app_id && !used.has(w.id),
          );
          const w =
            candidates.find((w) => w.title === b.title) || candidates[0];
          if (!w) {
            missing.push(b.app_id);
            return;
          }
          used.add(w.id);
          placements.push({
            window_id: w.id,
            monitor_id: b.monitor_id,
            zone_id: b.zone_id,
            rect: b.rect,
          });
        });
        return {
          placements,
          missing,
          layout: structuredClone(l),
          snapshot: structuredClone(snapshot),
          foreign: false,
        } satisfies Restored;
      }
      case "apply_layout": {
        const ps = args.placements as Placement[];
        if (!ps.length) throw Error("ウィンドウを領域へ割り当ててください");
        undo = structuredClone(snapshot);
        ps.forEach((p) => {
          const w = snapshot.windows.find((w) => w.id === p.window_id)!,
            m = snapshot.monitors.find((m) => m.id === p.monitor_id)!;
          w.rect = {
            x: m.rect.x + p.rect.x * m.rect.width,
            y: m.rect.y + p.rect.y * m.rect.height,
            width: p.rect.width * m.rect.width,
            height: p.rect.height * m.rect.height,
          };
        });
        const l = settings.profiles["preview-only"]?.find(
          (l) => l.id === args.layoutId,
        );
        if (l) {
          l.uses++;
          l.last_used = Date.now() / 1000;
        }
        record(ps, args.document as Layout["document"]);
        return {
          results: ps.map((p) => ({
            id: p.window_id,
            ok: true,
            message: "UIプレビュー（実際の移動なし）",
          })),
          settings: save(),
        } satisfies Applied;
      }
      case "hub_move":
        return {
          result: { id: "w1", ok: true, message: "UIプレビュー" },
          monitor_id: snapshot.monitors[0].id,
        };
      case "quick_move":
        return {
          id: "w1",
          ok: true,
          message: "UIプレビュー（実際の移動なし）",
        } satisfies MoveResult;
      case "undo_layout":
        if (undo) snapshot.windows = undo.windows;
        return [
          { id: "preview", ok: true, message: "UIプレビュー" },
        ] satisfies MoveResult[];
      case "record_current": {
        const ps = (args.windowIds as string[]).flatMap((id) => {
          const w = snapshot.windows.find((w) => w.id === id);
          if (!w) return [];
          const m = snapshot.monitors.find(
            (m) =>
              w.rect.x >= m.rect.x &&
              w.rect.x + w.rect.width <= m.rect.x + m.rect.width &&
              w.rect.y >= m.rect.y &&
              w.rect.y + w.rect.height <= m.rect.y + m.rect.height,
          );
          return m
            ? [
                {
                  window_id: id,
                  monitor_id: m.id,
                  rect: {
                    x: (w.rect.x - m.rect.x) / m.rect.width,
                    y: (w.rect.y - m.rect.y) / m.rect.height,
                    width: w.rect.width / m.rect.width,
                    height: w.rect.height / m.rect.height,
                  },
                },
              ]
            : [];
        });
        record(ps, null);
        return ps.length;
      }
      case "history_info":
        return {
          count: history.length,
          last: history.at(-1)?.used_at || null,
          error: null,
        };
      case "clear_history":
        history = [];
        localStorage.removeItem("windowhub-preview-history");
        return null;
      default:
        throw Error(command);
    }
  })();
  return result as T;
}
