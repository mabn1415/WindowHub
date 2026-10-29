import type { LayoutDocument } from "./zones";
export type Rect = { x: number; y: number; width: number; height: number };
export type Monitor = { id: string; name: string; rect: Rect; scale: number };
export type NativeWindow = {
  id: string;
  pid: number;
  app_id: string;
  app_name: string;
  title: string;
  rect: Rect;
  resizable: boolean;
};
export type Snapshot = {
  monitors: Monitor[];
  windows: NativeWindow[];
  trusted: boolean;
  platform: string;
};
export type Placement = {
  window_id: string;
  monitor_id: string;
  zone_id?: string | null;
  rect: Rect;
};
export type Binding = {
  app_id: string;
  title: string;
  ordinal: number;
  monitor_id: string;
  zone_id?: string | null;
  rect: Rect;
};
export type Layout = {
  id: string;
  name: string;
  bindings: Binding[];
  uses: number;
  last_used: number;
  document?: LayoutDocument | null;
  is_initial?: boolean;
  locked?: boolean;
};
export type Theme = {
  background: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  selected: string;
  radius: number;
  motion: number;
  opacity: number;
};
export type Settings = {
  hub_screen: "mouse" | "active" | "primary";
  quick_enabled: boolean;
  quick_shortcuts: Record<string, string>;
  schema_version: number;
  shortcut: string;
  theme: Theme;
  profiles: Record<string, Layout[]>;
  guide_seen: boolean;
  guide_mode: "full" | "compact" | "hidden";
  learning_enabled: boolean;
  configurations: Record<string, Monitor[]>;
};
export type NativeContext = {
  window: NativeWindow | null;
  monitor: Monitor | null;
  app_pid: number | null;
};
export type Suggestion = {
  id: string;
  name: string;
  samples: number;
  score: number;
  layout: Layout;
};
export type Bootstrap = {
  settings: Settings;
  snapshot: Snapshot;
  topology: string;
  context: NativeContext;
  suggestions: Suggestion[];
  compatible_profiles: { key: string; names: string[] }[];
  shortcut_error: string | null;
  history_error: string | null;
};
export type Restored = {
  placements: Placement[];
  missing: string[];
  layout: Layout;
  snapshot: Snapshot;
  foreign: boolean;
};
export type MoveResult = {
  id: string;
  ok: boolean;
  message: string;
  actual?: Rect | null;
};
export type Applied = {
  results: MoveResult[];
  settings: Settings;
  warning?: string | null;
};
export type Preset = "columns" | "rows" | "focus" | "stack" | "grid";
export type Screen =
  "home" | "arrange" | "edit" | "quick" | "saved" | "settings";
