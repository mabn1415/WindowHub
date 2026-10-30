import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  LayoutGrid,
  Monitor as Display,
  Layers,
  Move,
  SlidersHorizontal,
  ChevronLeft,
  Keyboard,
  X,
  RefreshCw,
  Lock,
  Save,
  Trash2,
  Search,
  Plus,
  ArrowRight,
  Check,
  HelpCircle,
} from "lucide-react";
import { api, native } from "./api";
import { themePresets, normalizeTheme, contrast, keyLabel } from "./themes";
import {
  createDocument,
  zones,
  boundaries,
  template,
  setBoundary,
  splitZone,
  removeZone,
  placementsFrom,
  repairAssignments,
  importPlacements,
  validateDocument,
  type LayoutDocument,
  type Assignment,
} from "./zones";
import type {
  Bootstrap,
  Settings,
  Screen,
  Layout,
  Restored,
  Applied,
  MoveResult,
  Theme,
  Rect,
} from "./types";
import ArrangeFlow, {
  newSelection,
  type ArrangeSelection,
} from "./components/ArrangeFlow";
import MonitorPicker, { displayPosition } from "./components/MonitorPicker";
import DirectShortcuts from "./components/DirectShortcuts";
import ZoneCanvas from "./components/ZoneCanvas";
import WindowAccessState from "./components/WindowAccessState";
type Draft = {
  document: LayoutDocument;
  assignments: Assignment[];
  name: string;
  source: Layout | null;
  foreign: boolean;
};
const menu = [
  {
    screen: "arrange",
    name: "Arrange",
    hint: "一括配置",
    key: "A",
    icon: LayoutGrid,
  },
  {
    screen: "quick",
    name: "Quick Move",
    hint: "直前のウィンドウ",
    key: "Q",
    icon: Move,
  },
  {
    screen: "edit",
    name: "Edit Layout",
    hint: "領域と比率",
    key: "E",
    icon: SlidersHorizontal,
  },
  {
    screen: "saved",
    name: "Saved Workspaces",
    hint: "保存した配置",
    key: "S",
    icon: Layers,
  },
] as const;
const colorKeys = [
  "background",
  "surface",
  "border",
  "text",
  "muted",
  "accent",
  "selected",
] as const;
const colorNames = [
  "背景",
  "パネル",
  "境界線",
  "文字",
  "補助文字",
  "アクセント",
  "選択背景",
];
const defaults = () => structuredClone(themePresets[0].theme);
export default function App() {
  const [arrangeSelection, setArrangeSelection] =
    useState<ArrangeSelection>(newSelection);
  const [hubScreen, setHubScreen] = useState<Settings["hub_screen"]>("mouse");
  const [data, setData] = useState<Bootstrap | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [screen, setScreen] = useState<Screen>("home"),
    [trail, setTrail] = useState<Screen[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [visible, setVisible] = useState(true),
    [changed, setChanged] = useState(false);
  const [homeMove, setHomeMove] = useState("");
  const homeMoveBusy = useRef(false),
    homeQueue = useRef<string[]>([]),
    homeGeneration = useRef(0);
  const [row, setRow] = useState(0),
    [monitorId, setMonitorId] = useState(""),
    [zoneId, setZoneId] = useState(""),
    [boundaryIndex, setBoundaryIndex] = useState(0),
    [ratioMode, setRatioMode] = useState(false);
  const [query, setQuery] = useState(""),
    [workspaceQuery, setWorkspaceQuery] = useState(""),
    [savedIndex, setSavedIndex] = useState(0),
    [guide, setGuide] = useState(false),
    [section, setSection] = useState<"appearance" | "keyboard" | "learning">(
      "appearance",
    );
  const [theme, setTheme] = useState<Theme>(defaults),
    [shortcut, setShortcut] = useState(""),
    [recording, setRecording] = useState(false),
    [guideMode, setGuideMode] = useState<Settings["guide_mode"]>("compact"),
    [learning, setLearning] = useState(true);
  const [quickParts, setQuickParts] = useState<3 | 4 | null>(null),
    [missing, setMissing] = useState<string[]>([]),
    [results, setResults] = useState<MoveResult[]>([]),
    [deleteTarget, setDeleteTarget] = useState<{
      id: string;
      profile: string;
    } | null>(null),
    [confirmHistory, setConfirmHistory] = useState(false),
    [historyCount, setHistoryCount] = useState(0);
  const initialized = useRef(false),
    surfaceRef = useRef<HTMLDivElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    toolbarRef = useRef<HTMLDivElement>(null);
  const task = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    const d = await api<Bootstrap>("bootstrap");
    setData(d);
    setTheme(normalizeTheme(d.settings.theme));
    setShortcut(d.settings.shortcut);
    setGuideMode(d.settings.guide_mode);
    setLearning(d.settings.learning_enabled);
    setHubScreen(d.settings.hub_screen);
    setChanged(false);
    if (!initialized.current) {
      setGuide(!d.settings.guide_seen);
      initialized.current = true;
    }
    return d;
  }, []);
  const discard = useCallback(() => {
    setDraft(null);
    setArrangeSelection(newSelection());
    setTrail([]);
    setScreen("home");
    setQuery("");
    setMissing([]);
    setResults([]);
    setRatioMode(false);
    setQuickParts(null);
    homeQueue.current = [];
    homeGeneration.current++;
    setHomeMove("");
  }, []);
  useEffect(() => {
    void task(async () => {
      await refresh();
    });
  }, [task, refresh]);
  useEffect(() => {
    if (!native) return;
    const a = listen("hub-open", () => {
      discard();
      setVisible(true);
      setError("");
      void task(async () => {
        await refresh();
      });
    });
    const b = listen("hub-closed", () => {
      discard();
      setVisible(false);
    });
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, [discard, refresh, task]);
  useEffect(() => {
    if (native && visible)
      void api("set_hub_view", { view: screen }).catch((e) =>
        setError(String(e)),
      );
  }, [screen, visible, data?.snapshot.trusted]);
  useEffect(() => {
    if (!native || !data || !visible) return;
    let running = false;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (running || busy) return;
      running = true;
      try {
        const e = await api<{ topology: string }>("environment");
        if (cancelled) return;
        if (e.topology !== data.topology) {
          if (screen === "home" && !draft) await refresh();
          else setChanged(true);
        }
      } catch {
      } finally {
        running = false;
      }
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [visible, data?.topology, busy, screen, draft, refresh]);
  useEffect(() => {
    if (screen === "settings")
      void api<{ count: number }>("history_info")
        .then((h) => setHistoryCount(h.count))
        .catch((e) => setError(String(e)));
  }, [screen, section]);
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(
      screen === "saved" ? ".workspace-row.selected" : ".window-item.selected",
    );
    const container = row?.parentElement;
    if (!row || !container) return;
    const r = row.getBoundingClientRect(),
      c = container.getBoundingClientRect();
    if (r.top < c.top) container.scrollTop += r.top - c.top;
    else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom;
  }, [
    row,
    savedIndex,
    screen,
    query,
    arrangeSelection.row,
    arrangeSelection.phase,
  ]);
  const palette = screen === "settings" ? theme : data?.settings.theme || theme;
  useEffect(() => {
    const root = document.documentElement;
    for (const k of colorKeys) {
      if (/^#[\da-f]{6}$/i.test(palette[k]))
        root.style.setProperty(`--${k}`, palette[k]);
    }
    root.style.setProperty("--radius", `${palette.radius}px`);
    root.style.setProperty("--duration", `${palette.motion * 160}ms`);
    root.style.setProperty(
      "--hub-opacity",
      `${(palette.opacity ?? 0.82) * 100}%`,
    );
    root.dataset.runtime = native ? "native" : "preview";
    root.style.colorScheme =
      contrast(palette.background, "#000000") >
      contrast(palette.background, "#ffffff")
        ? "light"
        : "dark";
  }, [palette]);
  useEffect(() => {
    if (
      ["arrange", "edit", "quick", "home", "saved"].includes(screen) &&
      !guide
    )
      surfaceRef.current?.focus();
  }, [screen, guide, busy, visible]);
  const allWindows = data?.snapshot.windows || [];
  const windows = allWindows.filter((w) =>
    `${w.app_name} ${w.title}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const activeWindow = windows[Math.min(row, Math.max(0, windows.length - 1))];
  const layouts = [...(data?.settings.profiles[data.topology] || [])].sort(
    (a, b) =>
      Number(b.locked) - Number(a.locked) ||
      Number(b.is_initial) - Number(a.is_initial) ||
      b.uses - a.uses ||
      b.last_used - a.last_used,
  );
  const initial = layouts.find((l) => l.is_initial);
  const saved = layouts.filter((l) =>
    l.name.toLocaleLowerCase().includes(workspaceQuery.toLocaleLowerCase()),
  );
  const plan = draft?.document.monitors.find((m) => m.monitor_id === monitorId);
  const zs = plan ? zones(plan.root) : [];
  const bs = plan ? boundaries(plan.root) : [];
  const boundary = bs[boundaryIndex % Math.max(1, bs.length)];
  const assignments = draft?.assignments || [];
  const placements = draft ? placementsFrom(draft.document, assignments) : [];
  const isInput = (e: KeyboardEvent) =>
    e.target instanceof HTMLElement &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
      e.target.isContentEditable);
  const isSurface = () =>
    !!document.activeElement?.closest("[data-keyboard-surface]");
  const updateSettings = (s: Settings) =>
    setData((d) => (d ? { ...d, settings: s } : d));
  function resetMonitor(d: Draft, preferred?: string) {
    const p =
      d.document.monitors.find((p) => p.monitor_id === preferred) ||
      d.document.monitors[0];
    setMonitorId(p?.monitor_id || "");
    setZoneId(p ? zones(p.root)[0]?.id || "" : "");
    setBoundaryIndex(0);
  }
  function loadResult(d: Bootstrap, r: Restored) {
    const imported = importPlacements(
      r.snapshot.monitors,
      r.placements,
      r.layout.document,
    );
    const next: Draft = {
      ...imported,
      name: r.layout.name,
      source: r.layout,
      foreign: r.foreign,
    };
    setDraft(next);
    setArrangeSelection(newSelection());
    setData({ ...d, snapshot: r.snapshot });
    resetMonitor(next, d.context.monitor?.id);
    setMissing(r.missing);
    setRow(0);
    setQuery("");
    setResults([]);
  }
  async function prepare() {
    if (draft) {
      const environment = await api<{ topology: string }>("environment");
      if (changed || environment.topology !== data?.topology) {
        setChanged(true);
        throw Error("ディスプレイ構成が変わりました。再取得してください");
      }
      return draft;
    }
    const d = await refresh();
    const currentInitial = (d.settings.profiles[d.topology] || []).find((l) => l.is_initial);
    if (currentInitial) {
      const r = await api<Restored>("restore_layout", { id: currentInitial.id });
      loadResult(d, r);
      return null;
    }
    const next: Draft = {
      document: createDocument(d.snapshot.monitors),
      assignments: [],
      name: "ワークスペース",
      source: null,
      foreign: false,
    };
    setDraft(next);
    resetMonitor(next, d.context.monitor?.id);
    return next;
  }
  function go(next: Screen, settingsSection?: typeof section) {
    void task(async () => {
      if (["arrange", "edit"].includes(next)) await prepare();
      if (next === "quick") {
        setMonitorId(
          data?.context.monitor?.id || data?.snapshot.monitors[0]?.id || "",
        );
        setQuickParts(null);
      }
      setTrail((t) => [...t, screen]);
      setScreen(next);
      if (settingsSection) setSection(settingsSection);
      setQuery("");
      setRow(0);
      setRatioMode(false);
    });
  }
  async function close() {
    await api("hide_hub");
    discard();
    if (!native) setNotice("UIプレビュー：ハブを閉じました");
  }
  function back() {
    if (recording) {
      setRecording(false);
      return;
    }
    if (guide) {
      closeGuide();
      return;
    }
    if (deleteTarget) {
      setDeleteTarget(null);
      return;
    }
    if (confirmHistory) {
      setConfirmHistory(false);
      return;
    }
    if (screen === "arrange" && arrangeSelection.phase > 0) {
      setArrangeSelection((s) => ({ ...s, phase: (s.phase - 1) as 0 | 1 }));
      return;
    }
    if (query && screen === "arrange") {
      setQuery("");
      setRow(0);
      return;
    }
    if (workspaceQuery && screen === "saved") {
      setWorkspaceQuery("");
      return;
    }
    if (ratioMode) {
      setRatioMode(false);
      return;
    }
    if (quickParts) {
      setQuickParts(null);
      return;
    }
    if (trail.length) {
      setScreen(trail.at(-1)!);
      setTrail((t) => t.slice(0, -1));
      return;
    }
    if (screen !== "home") {
      setScreen("home");
      return;
    }
    void close();
  }
  function closeGuide() {
    setGuide(false);
    if (data && !data.settings.guide_seen)
      void task(async () => {
        updateSettings(
          await api<Settings>("save_preferences", {
            theme: data.settings.theme,
            guideSeen: true,
          }),
        );
      });
  }
  function cycleMonitor(step = 1) {
    const ms = data?.snapshot.monitors || [];
    if (!ms.length) return;
    const index = ms.findIndex((m) => m.id === monitorId);
    const id = ms[(index + step + ms.length) % ms.length].id;
    setMonitorId(id);
    const p = draft?.document.monitors.find((p) => p.monitor_id === id);
    setZoneId(p ? zones(p.root)[0].id : "");
    setBoundaryIndex(0);
  }
  function assign(zone: string, mon = monitorId, windowId = activeWindow?.id) {
    if (!windowId) return;
    setDraft((d) =>
      d
        ? {
            ...d,
            assignments: [
              ...d.assignments.filter((a) => a.window_id !== windowId),
              { window_id: windowId, monitor_id: mon, zone_id: zone },
            ],
          }
        : d,
    );
    setMonitorId(mon);
    setZoneId(zone);
    setResults([]);
  }
  function mutatePlan(
    fn: (p: NonNullable<typeof plan>) => NonNullable<typeof plan>,
    force = false,
  ) {
    if (!plan || !draft) return;
    if (plan.locked && !force) {
      setNotice("固定を解除すると編集できます");
      return;
    }
    setDraft((d) => {
      if (!d) return d;
      const document = {
        ...d.document,
        monitors: d.document.monitors.map((p) =>
          p.monitor_id === monitorId ? fn(p) : p,
        ),
      };
      return {
        ...d,
        document,
        assignments: repairAssignments(document, d.assignments),
      };
    });
    setResults([]);
  }
  function changeRatio(id: string, value: number) {
    mutatePlan((p) => ({ ...p, root: setBoundary(p.root, id, value) }));
  }
  function setTemplate(value: string) {
    if (plan?.locked) {
      setNotice("固定を解除してください");
      return;
    }
    const root = template(value);
    mutatePlan((p) => ({ ...p, root }));
    setZoneId(zones(root)[0].id);
    setBoundaryIndex(0);
  }
  function split(axis: "x" | "y") {
    if (!plan) return;
    const root = splitZone(plan.root, zoneId, axis);
    if (root === plan.root) {
      setNotice("これ以上分割できません。領域は最大9個です。");
      return;
    }
    mutatePlan((p) => ({ ...p, root }));
  }
  function remove() {
    if (!plan) return;
    const root = removeZone(plan.root, zoneId);
    mutatePlan((p) => ({ ...p, root }));
    setZoneId(zones(root)[0].id);
    setBoundaryIndex(0);
  }
  function enterEditor() {
    void task(async () => {
      await prepare();
      setTrail((t) => [...t, screen]);
      setScreen("edit");
      setRatioMode(true);
      setBoundaryIndex(0);
    });
  }
  function saveLayout(asInitial: boolean) {
    void task(async () => {
      if (!draft || !data) return;
      if (!validateDocument(draft.document))
        throw Error("領域をモニター内の5%以上にしてください");
      const target = asInitial ? initial : null;
      const s = await api<Settings>("save_layout", {
        name: draft.name,
        placements,
        document: draft.document,
        layoutId: target?.id || null,
        isInitial: asInitial,
        updateFixed: asInitial,
      });
      updateSettings(s);
      const saved = s.profiles[data.topology]
        ?.filter((l) =>
          asInitial
            ? l.is_initial
            : l.name === draft.name && l.id !== draft.source?.id,
        )
        .at(-1);
      setDraft((d) =>
        d ? { ...d, source: saved || d.source, foreign: false } : d,
      );
      setNotice(
        asInitial
          ? "初期レイアウトを保存しました"
          : "ワークスペースを保存しました",
      );
    });
  }
  function restore(l: Layout, profile?: string, suggestion = false) {
    void task(async () => {
      const d = await refresh();
      const r = await api<Restored>("restore_layout", {
        id: l.id,
        profileKey: profile || null,
        suggestion,
      });
      loadResult(d, r);
      setTrail((t) => [...t, screen]);
      setScreen("arrange");
    });
  }
  function apply() {
    void task(async () => {
      if (!draft) return;
      if (changed) throw Error("モニター構成を再取得してください");
      if (!validateDocument(draft.document))
        throw Error("領域の比率を確認してください");
      const result = await api<Applied>("apply_layout", {
        placements,
        document: draft.document,
        layoutId: draft.foreign ? null : draft.source?.id || null,
      });
      setResults(result.results);
      updateSettings(result.settings);
      if (result.warning) {
        setError(result.warning);
        return;
      }
      if (result.results.every((r) => r.ok)) {
        if (native) await close();
        else {
          setData(await api<Bootstrap>("bootstrap"));
          setNotice("UIプレビュー：一括配置を反映しました（実際の移動なし）");
        }
      }
    });
  }
  function quick(mode: string, r?: Rect) {
    void task(async () => {
      const result = await api<MoveResult>("quick_move", {
        mode,
        monitorId,
        rect: r || null,
      });
      if (!result.ok) throw Error(result.message);
      if (native) await close();
      else {
        setQuickParts(null);
        setNotice(result.message);
      }
    });
  }
  function moveFromHome(action: string) {
    if (busy || homeQueue.current.length >= 6) return;
    homeQueue.current.push(action);
    if (homeMoveBusy.current) return;
    homeMoveBusy.current = true;
    const generation = homeGeneration.current;
    void (async () => {
      try {
        while (
          homeQueue.current.length &&
          homeGeneration.current === generation
        ) {
          const action = homeQueue.current.shift()!;
          const r = await api<{ result: MoveResult; monitor_id: string }>(
            "hub_move",
            { action },
          );
          if (homeGeneration.current !== generation) break;
          if (!r.result.ok) throw Error(r.result.message);
          const i =
            data?.snapshot.monitors.findIndex((m) => m.id === r.monitor_id) ??
            -1;
          setError("");
          setHomeMove(
            `${{ left: "左半分", right: "右半分", top: "上半分", bottom: "下半分", maximize: "最大化" }[action]} · ディスプレイ ${i + 1} ${data?.snapshot.monitors[i]?.name || ""}`,
          );
        }
      } catch (e) {
        homeQueue.current = [];
        if (homeGeneration.current === generation)
          setError(String(e).replace(/^Error: /, ""));
      } finally {
        homeMoveBusy.current = false;
        if (homeGeneration.current !== generation && homeQueue.current.length) {
          const pending = homeQueue.current.splice(0);
          for (const action of pending) moveFromHome(action);
        }
      }
    })();
  }
  function quickKey(key: number) {
    if (quickParts) {
      const rects = zones(template(quickParts === 3 ? "three" : "grid")).map(
        (z) => z.rect,
      );
      if (rects[key - 1]) quick("move", rects[key - 1]);
      return;
    }
    if (key === 1) quick("move", { x: 0, y: 0, width: 0.5, height: 1 });
    if (key === 2) quick("move", { x: 0.5, y: 0, width: 0.5, height: 1 });
    if (key === 3) quick("move", { x: 0, y: 0, width: 1, height: 0.5 });
    if (key === 4) quick("move", { x: 0, y: 0.5, width: 1, height: 0.5 });
    if (key === 5) quick("maximize");
    if (key === 6) setQuickParts(3);
    if (key === 7) setQuickParts(4);
  }
  function savePrefs() {
    void task(async () => {
      if (!colorKeys.every((k) => /^#[\da-f]{6}$/i.test(theme[k])))
        throw Error("色は #RRGGBB で入力してください");
      updateSettings(
        await api<Settings>("save_preferences", {
          theme,
          guideSeen: data!.settings.guide_seen,
          guideMode,
          learningEnabled: learning,
          hubScreen,
        }),
      );
      setNotice("設定を保存しました");
    });
  }
  function reload() {
    void task(async () => {
      if (data && !data.snapshot.trusted) await api("refresh_permissions");
      const d = await refresh();
      discard();
      setNotice(
        d.snapshot.trusted
          ? `${d.snapshot.windows.length}件のウィンドウを取得しました`
          : "許可がまだ有効になっていません。システム設定でWindowHubをオンにしてください。",
      );
    });
  }
  function requestAccess() {
    void task(async () => {
      await api("request_permission");
    });
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) back();
        return;
      }
      if (busy) return;
      if (recording) {
        e.preventDefault();
        if (["Alt", "Shift", "Control", "Meta"].includes(e.key)) return;
        const mods = [
          e.ctrlKey ? "Control" : "",
          e.altKey ? "Alt" : "",
          e.metaKey ? "Super" : "",
          e.shiftKey ? "Shift" : "",
        ].filter(Boolean);
        if (!mods.some((m) => m !== "Shift")) {
          setError("Ctrl / Alt / Command を含めてください");
          return;
        }
        setShortcut([...mods, e.code.replace(/^Key|^Digit/, "")].join("+"));
        setRecording(false);
        return;
      }
      const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
      if (modal) {
        if (e.key === "Tab") {
          const items = [
            ...modal.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input,select",
            ),
          ];
          if (e.shiftKey && document.activeElement === items[0]) {
            e.preventDefault();
            items.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
            e.preventDefault();
            items[0]?.focus();
          }
        }
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (e.code === "Comma" || e.key === ",")
      ) {
        e.preventDefault();
        if (screen !== "settings") go("settings", "appearance");
        return;
      }
      if (e.repeat && ["Enter", " "].includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.key === "F6") {
        e.preventDefault();
        if (isSurface())
          toolbarRef.current
            ?.querySelector<HTMLElement>("button,input,select")
            ?.focus();
        else surfaceRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && e.ctrlKey && ["edit", "quick"].includes(screen)) {
        e.preventDefault();
        cycleMonitor(e.shiftKey ? -1 : 1);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "s" &&
        ["arrange", "edit"].includes(screen)
      ) {
        e.preventDefault();
        if (screen !== "arrange" || arrangeSelection.phase === 0)
          saveLayout(false);
        return;
      }
      if (
        screen === "arrange" &&
        (e.ctrlKey || e.metaKey) &&
        e.key === "Enter"
      ) {
        e.preventDefault();
        if (arrangeSelection.phase === 0 && !isInput(e)) apply();
        return;
      }
      if (isInput(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setGuide(true);
        return;
      }
      if (screen === "home") {
        const i = menu.findIndex(
          (m) => m.key.toLowerCase() === e.key.toLowerCase(),
        );
        if (i >= 0) {
          e.preventDefault();
          go(menu[i].screen);
          return;
        }
        if (e.key.toLowerCase() === "k") {
          go("settings", "keyboard");
          return;
        }
        if (e.key.toLowerCase() === "t") {
          go("settings", "appearance");
          return;
        }
        const action = (
          {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowUp: "top",
            ArrowDown: "bottom",
          } as Record<string, string>
        )[e.key];
        if (action && isSurface()) {
          e.preventDefault();
          if (!e.repeat) moveFromHome(action);
          return;
        }
        if (
          e.key === "Enter" &&
          document.activeElement === surfaceRef.current
        ) {
          e.preventDefault();
          moveFromHome("maximize");
          return;
        }
        return;
      }
      if (screen === "quick" && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        quickKey(Number(e.key));
        return;
      }
      if (screen === "saved") {
        if (e.key === "/") {
          e.preventDefault();
          searchRef.current?.focus();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setSavedIndex((i) =>
            Math.max(
              0,
              Math.min(saved.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)),
            ),
          );
        }
        if (e.key === "Enter" && saved[savedIndex] && isSurface()) {
          e.preventDefault();
          restore(saved[savedIndex]);
        }
        return;
      }
      if (screen !== "edit") return;
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        setRatioMode(true);
        return;
      }
      if (e.key === "Enter" && isSurface()) {
        e.preventDefault();
        if (ratioMode) setRatioMode(false);
        else back();
        return;
      }
      {
        if (e.key === "[" || e.key === "]") {
          e.preventDefault();
          setBoundaryIndex(
            (i) =>
              (i + (e.key === "]" ? 1 : Math.max(0, bs.length - 1))) %
              Math.max(1, bs.length),
          );
          setRatioMode(true);
          return;
        }
        if (/^[1-9]$/.test(e.key) && zs[Number(e.key) - 1]) {
          setZoneId(zs[Number(e.key) - 1].id);
          return;
        }
        if (e.key.toLowerCase() === "v") {
          split("x");
          return;
        }
        if (e.key.toLowerCase() === "h") {
          split("y");
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove();
          return;
        }
        if (boundary && ratioMode) {
          const along =
            boundary.axis === "x"
              ? ["ArrowLeft", "ArrowRight"]
              : ["ArrowUp", "ArrowDown"];
          if (along.includes(e.key)) {
            e.preventDefault();
            changeRatio(
              boundary.id,
              boundary.ratio +
                (e.key === along[0] ? -1 : 1) * (e.shiftKey ? 0.01 : 0.05),
            );
          }
          if (e.key === "0") {
            e.preventDefault();
            changeRatio(boundary.id, boundary.equal);
          }
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!data)
    return (
      <main className="loading">
        <LayoutGrid size={24} />
        <p>{error || "ウィンドウを取得しています…"}</p>
        {error && (
          <button
            onClick={() =>
              void task(async () => {
                await refresh();
              })
            }
          >
            再試行
          </button>
        )}
      </main>
    );
  const activeMonitor = data.snapshot.monitors.find((m) => m.id === monitorId);
  const monitorSelect = (
    <select
      aria-label="対象モニター"
      value={monitorId}
      onChange={(e) => {
        setMonitorId(e.target.value);
        const p = draft?.document.monitors.find(
          (p) => p.monitor_id === e.target.value,
        );
        setZoneId(p ? zones(p.root)[0].id : "");
        setBoundaryIndex(0);
      }}
    >
      {data.snapshot.monitors.map((m, i) => (
        <option value={m.id} key={m.id}>
          {i + 1}. {m.name}
        </option>
      ))}
    </select>
  );
  const editorSelect = (id: string) => {
    setMonitorId(id);
    const p = draft?.document.monitors.find((p) => p.monitor_id === id);
    setZoneId(p ? zones(p.root)[0].id : "");
    setBoundaryIndex(0);
  };
  const savedControls = draft && (
    <div className="save-controls" ref={toolbarRef}>
      <input
        aria-label="レイアウト名"
        maxLength={60}
        value={draft.name}
        onChange={(e) =>
          setDraft((d) => (d ? { ...d, name: e.target.value } : d))
        }
      />
      <button disabled={busy} onClick={() => saveLayout(false)}>
        <Save size={13} />
        別名保存
      </button>
      <button disabled={busy} onClick={() => saveLayout(true)}>
        <Lock size={12} />
        {initial ? "初期レイアウトを更新" : "初期として保存"}
      </button>
    </div>
  );
  const zonePreview = draft && (
    <ZoneCanvas
      snapshot={data.snapshot}
      document={draft.document}
      assignments={assignments}
      monitorId={monitorId}
      zoneId={zoneId}
      editing={screen === "edit"}
      boundaryId={boundary?.id}
      onMonitor={editorSelect}
      onZone={(mon, zone) => {
        if (screen === "arrange") assign(zone, mon);
        else {
          setMonitorId(mon);
          setZoneId(zone);
        }
      }}
      onBoundary={(id) => {
        setBoundaryIndex(bs.findIndex((b) => b.id === id));
        setRatioMode(true);
      }}
      onRatio={changeRatio}
    />
  );
  return (
    <main className={`app-shell view-${screen}`} aria-busy={busy}>
      <header className="topbar">
        <div className="brand">
          <LayoutGrid size={17} />
          <b>WindowHub</b>
          {screen !== "home" && (
            <span className="breadcrumb">
              /{" "}
              {screen === "edit"
                ? "Edit Layout"
                : screen === "quick"
                  ? "Quick Move"
                  : screen === "saved"
                    ? "Workspaces"
                    : screen === "settings"
                      ? "Settings"
                      : "Arrange"}
            </span>
          )}
        </div>
        <div className="header-actions">
          {screen !== "home" && (
            <button className="icon" aria-label="前の画面へ" onClick={back}>
              <ChevronLeft size={16} />
            </button>
          )}
          <button
            className="icon"
            aria-label="キー操作ガイド"
            onClick={() => setGuide(true)}
          >
            <HelpCircle size={15} />
          </button>
          <button
            className="icon"
            aria-label="ハブを閉じる"
            onClick={() => void close()}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {!native && (
        <div className="preview-banner">
          UIプレビュー · サンプルデータ · 実ウィンドウの移動なし
        </div>
      )}
      <div className="notifications">
        {(error || data.shortcut_error || data.history_error) && (
          <div className="message error" role="alert">
            {error || data.shortcut_error || data.history_error}
            <button
              className="icon"
              aria-label="通知を閉じる"
              onClick={() => {
                setError("");
                setData((d) =>
                  d ? { ...d, shortcut_error: null, history_error: null } : d,
                );
              }}
            >
              <X size={13} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            <Check size={13} />
            {notice}
          </div>
        )}
        {changed && (
          <div className="message warning">
            モニター構成が変わりました。編集内容を破棄して再取得してください。
            <button onClick={reload}>再取得</button>
          </div>
        )}
        {!data.snapshot.trusted && !["arrange", "quick"].includes(screen) && (
          <div className="permission">
            <span>権限が未許可のため、アプリ一覧を取得できません。</span>
            <button onClick={requestAccess}>設定を開く</button>
            <button onClick={reload}>許可を確認</button>
          </div>
        )}
      </div>
      <div className="body">
        {screen === "home" && (
          <>
            <div className="home-quick-hint" aria-label="ホームの配置操作">
              <span>
                <b>
                  {data.context.window?.app_name ||
                    "対象アプリを開いてから起動"}
                </b>
                <small>← → 左右 · ↑ ↓ 上下 · Enter 最大化 · Esc 終了</small>
              </span>
            </div>
            <div className="home-move-result" role="status" aria-live="polite">
              {homeMove}
            </div>
            <div
              className="home-menu keyboard-surface"
              data-keyboard-surface
              ref={surfaceRef}
              tabIndex={0}
              aria-label="主要機能"
            >
              {menu.map((m) => {
                const Icon = m.icon;
                return (
                  <button key={m.key} onClick={() => go(m.screen)}>
                    <Icon size={17} />
                    <b>{m.name}</b>
                    <small>{m.hint}</small>
                    <kbd>{m.key}</kbd>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {screen === "arrange" && draft && (
          <>
            <div className="page-toolbar" ref={toolbarRef}>
              <h1>一括配置</h1>
              <span className="count">{assignments.length}件を準備済み</span>
            </div>
            {missing.length > 0 && (
              <div className="message warning">
                {missing.length}件を取得できません：{missing.join("、")}
              </div>
            )}
            <ArrangeFlow
              snapshot={data.snapshot}
              document={draft.document}
              assignments={assignments}
              selection={arrangeSelection}
              setSelection={setArrangeSelection}
              surfaceRef={surfaceRef}
              query={query}
              onQuery={setQuery}
              onAssign={(w, m, z) => assign(z, m, w)}
              onRemove={(id) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        assignments: d.assignments.filter(
                          (a) => a.window_id !== id,
                        ),
                      }
                    : d,
                )
              }
              onMonitor={setMonitorId}
              onEdit={enterEditor}
              onBack={back}
              onPermission={requestAccess}
              onRefresh={reload}
              busy={busy}
            />
            {results.length > 0 && (
              <div className="result-list">
                {results.map((r) => (
                  <p key={r.id} className={r.ok ? "success" : "failure"}>
                    {allWindows.find((w) => w.id === r.id)?.app_name}:{" "}
                    {r.message}
                  </p>
                ))}
              </div>
            )}
            {arrangeSelection.phase === 0 && savedControls}
            {arrangeSelection.phase === 0 && (
              <div className="action-bar">
                <span>配置を追加し、最後にまとめて反映します。</span>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    changed ||
                    !placements.length ||
                    arrangeSelection.phase !== 0
                  }
                  onClick={apply}
                >
                  {placements.length}件を一括配置 <kbd>Ctrl ↵</kbd>
                </button>
              </div>
            )}
          </>
        )}
        {screen === "edit" && draft && (
          <>
            <div className="page-toolbar" ref={toolbarRef}>
              <h1>領域と比率</h1>
              {monitorSelect}
              <button
                className={plan?.locked ? "active" : ""}
                onClick={() =>
                  mutatePlan((p) => ({ ...p, locked: !p.locked }), true)
                }
              >
                <Lock size={12} />
                {plan?.locked ? "固定中" : "固定する"}
              </button>
            </div>
            <div className="editor-toolbar">
              <label>
                構成
                <select
                  aria-label="分割パターン"
                  defaultValue=""
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    e.target.value = "";
                  }}
                  disabled={plan?.locked}
                >
                  <option value="" disabled>
                    パターンを選択
                  </option>
                  <option value="one">1領域（重ねる）</option>
                  <option value="columns">左右2分割</option>
                  <option value="rows">上下2分割</option>
                  <option value="three">左右3分割</option>
                  <option value="grid">4分割</option>
                </select>
              </label>
              <button disabled={plan?.locked} onClick={() => split("x")}>
                左右に追加 <kbd>V</kbd>
              </button>
              <button disabled={plan?.locked} onClick={() => split("y")}>
                上下に追加 <kbd>H</kbd>
              </button>
              <button disabled={plan?.locked || zs.length < 2} onClick={remove}>
                <Trash2 size={12} />
                領域を削除
              </button>
            </div>
            <div
              className="edit-stage keyboard-surface"
              data-keyboard-surface
              ref={surfaceRef}
              tabIndex={0}
            >
              {zonePreview}
            </div>
            <div className="boundary-controls">
              <button
                className={ratioMode ? "active" : ""}
                onClick={() => {
                  setRatioMode(!ratioMode);
                  surfaceRef.current?.focus();
                }}
              >
                比率編集 <kbd>R</kbd>
              </button>
              <select
                aria-label="編集する分割線"
                value={boundary?.id || ""}
                onChange={(e) => {
                  setBoundaryIndex(
                    bs.findIndex((b) => b.id === e.target.value),
                  );
                  setRatioMode(true);
                }}
                disabled={!bs.length}
              >
                {!bs.length && <option value="">分割線なし</option>}
                {bs.map((b, i) => (
                  <option key={b.id} value={b.id}>
                    分割線 {i + 1} · {b.axis === "x" ? "左右" : "上下"}
                  </option>
                ))}
              </select>
              {boundary && (
                <>
                  <input
                    type="range"
                    aria-label="分割比率"
                    min="5"
                    max="95"
                    step="1"
                    disabled={plan?.locked}
                    value={boundary.ratio * 100}
                    onChange={(e) =>
                      changeRatio(boundary.id, Number(e.target.value) / 100)
                    }
                  />
                  <label className="percent">
                    <input
                      type="number"
                      aria-label="分割比率の数値"
                      min="5"
                      max="95"
                      step="1"
                      value={Math.round(boundary.ratio * 1000) / 10}
                      disabled={plan?.locked}
                      onChange={(e) =>
                        changeRatio(boundary.id, Number(e.target.value) / 100)
                      }
                    />
                    %
                  </label>
                  <button
                    disabled={plan?.locked}
                    onClick={() => changeRatio(boundary.id, boundary.equal)}
                  >
                    等分 <kbd>0</kbd>
                  </button>
                </>
              )}
            </div>
            {plan?.root.kind === "freeform" && (
              <div className="message warning">
                以前の配置形式を保持しています。分割編集にはパターンを選び直してください。
              </div>
            )}
            {savedControls}
            <div className="action-bar">
              <span>
                {ratioMode
                  ? "矢印で5%、Shift＋矢印で1%調整。[]で分割線を切替。"
                  : "分割線をドラッグしても調整できます。"}
              </span>
              <button
                className="primary"
                onClick={() => {
                  setRatioMode(false);
                  if (trail.at(-1) === "arrange") back();
                  else go("arrange");
                }}
              >
                Arrangeへ <ArrowRight size={13} />
              </button>
            </div>
          </>
        )}
        {screen === "quick" && (
          <>
            <div className="page-toolbar" ref={toolbarRef}>
              <h1>Quick Move</h1>
              <span className="count">直前のウィンドウを移動</span>
            </div>
            <div className="quick-destination">
              <small>移動先</small>
              <h2>
                ディスプレイ{" "}
                {data.snapshot.monitors.findIndex((m) => m.id === monitorId) +
                  1}{" "}
                · {data.snapshot.monitors.find((m) => m.id === monitorId)?.name}
              </h2>
              <p>
                {data.snapshot.monitors.find((m) => m.id === monitorId) &&
                  displayPosition(
                    data.snapshot.monitors.find((m) => m.id === monitorId)!,
                    data.snapshot.monitors,
                  )}
              </p>
            </div>
            <MonitorPicker
              monitors={data.snapshot.monitors}
              selected={monitorId}
              onSelect={setMonitorId}
              compact
            />
            <div className="quick-target">
              <b>{data.context.window?.app_name || "対象ウィンドウなし"}</b>
              <small>
                {data.context.window?.title ||
                  "対象アプリから起動キーで開き直してください。"}
              </small>
            </div>
            {!data.snapshot.trusted && (
              <WindowAccessState
                trusted={false}
                onPermission={requestAccess}
                onRefresh={reload}
                busy={busy}
              />
            )}
            <div
              className="quick-grid keyboard-surface"
              data-keyboard-surface
              ref={surfaceRef}
              tabIndex={0}
            >
              {quickParts
                ? zones(template(quickParts === 3 ? "three" : "grid")).map(
                    (z, i) => (
                      <button key={i} onClick={() => quick("move", z.rect)}>
                        <kbd>{i + 1}</kbd>領域 {i + 1}
                      </button>
                    ),
                  )
                : [
                    "左半分",
                    "右半分",
                    "上半分",
                    "下半分",
                    "最大化",
                    "3分割から選択",
                    "4分割から選択",
                  ].map((name, i) => (
                    <button
                      key={name}
                      onClick={() => quickKey(i + 1)}
                      disabled={!data.snapshot.trusted || !data.context.window}
                    >
                      <kbd>{i + 1}</kbd>
                      {name}
                    </button>
                  ))}
            </div>
            <p className="micro">
              番号で即実行 · Ctrl＋Tabで移動先を切替 · 最大化は作業領域いっぱい
            </p>
          </>
        )}
        {screen === "saved" && (
          <>
            <div className="page-toolbar" ref={toolbarRef}>
              <h1>保存した配置</h1>
              <div className="search-field">
                <Search size={13} />
                <input
                  ref={searchRef}
                  aria-label="保存した配置を検索"
                  placeholder="名前で絞り込み /"
                  value={workspaceQuery}
                  onChange={(e) => {
                    setWorkspaceQuery(e.target.value);
                    setSavedIndex(0);
                  }}
                />
              </div>
            </div>
            <div
              className="workspace-list keyboard-surface"
              data-keyboard-surface
              ref={surfaceRef}
              tabIndex={0}
            >
              {saved.map((l, i) => (
                <div
                  key={l.id}
                  className={`workspace-row ${savedIndex === i ? "selected" : ""}`}
                >
                  <button onClick={() => restore(l)}>
                    {l.is_initial ? <Lock size={15} /> : <Layers size={15} />}
                    <span>
                      <b>{l.name}</b>
                      <small>
                        {l.is_initial
                          ? "初期レイアウト · 固定"
                          : "ワークスペース"}{" "}
                        · {l.bindings.length}ウィンドウ
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </button>
                  <button
                    className="icon"
                    aria-label={`${l.name}を削除`}
                    onClick={() =>
                      setDeleteTarget({ id: l.id, profile: data.topology })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {!saved.length && (
                <p className="empty">
                  このモニター構成の保存配置はありません。
                </p>
              )}
              {data.suggestions.length > 0 && (
                <>
                  <h2>履歴からの候補</h2>
                  {data.suggestions.map((c) => (
                    <button
                      className="suggestion"
                      key={c.id}
                      onClick={() => restore(c.layout, undefined, true)}
                    >
                      <span>{c.name}</span>
                      <small>{c.samples}回記録</small>
                      <ArrowRight size={13} />
                    </button>
                  ))}
                </>
              )}
              {data.compatible_profiles.map((p) => (
                <details key={p.key}>
                  <summary>
                    識別情報が異なる類似構成（{p.names.length}件）
                  </summary>
                  {(data.settings.profiles[p.key] || []).map((l) => (
                    <button key={l.id} onClick={() => restore(l, p.key)}>
                      {l.name}を読み込む
                    </button>
                  ))}
                </details>
              ))}
            </div>
            <p className="micro">
              読み込むだけでは移動しません。Arrangeで確認後、Enterで適用します。
            </p>
          </>
        )}
        {screen === "settings" && (
          <>
            <div className="settings-tabs" ref={toolbarRef}>
              {(["appearance", "keyboard", "learning"] as const).map((s, i) => (
                <button
                  key={s}
                  className={section === s ? "active" : ""}
                  onClick={() => setSection(s)}
                >
                  {["外観", "キー操作", "履歴と提案"][i]}
                </button>
              ))}
            </div>
            {section === "appearance" && (
              <>
                <h1>外観</h1>
                <div className="theme-presets">
                  {themePresets.map((t) => (
                    <button
                      key={t.name}
                      className={
                        theme.background.toLowerCase() ===
                        t.theme.background.toLowerCase()
                          ? "active"
                          : ""
                      }
                      onClick={() => setTheme(structuredClone(t.theme))}
                    >
                      <span
                        style={{
                          background: t.theme.background,
                          borderColor: t.theme.border,
                        }}
                      >
                        <i style={{ background: t.theme.accent }} />
                      </span>
                      {t.name}
                    </button>
                  ))}
                </div>
                <div className="color-fields">
                  {colorKeys.map((k, i) => (
                    <label key={k}>
                      <span>{colorNames[i]}</span>
                      <input
                        type="color"
                        aria-label={`${colorNames[i]}の色選択`}
                        value={
                          /^#[\da-f]{6}$/i.test(theme[k]) ? theme[k] : "#000000"
                        }
                        onChange={(e) =>
                          setTheme({ ...theme, [k]: e.target.value })
                        }
                      />
                      <input
                        aria-label={`${colorNames[i]}のHEX`}
                        value={theme[k]}
                        maxLength={7}
                        spellCheck={false}
                        onChange={(e) =>
                          setTheme({ ...theme, [k]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
                {contrast(theme.background, theme.text) < 4.5 && (
                  <div
                    className="message warning contrast-warning"
                    role="alert"
                  >
                    文字と背景のコントラストが低く、読みづらくなる可能性があります。
                  </div>
                )}
                <div className="appearance-controls">
                  <label>
                    背景の濃さ
                    <input
                      aria-label="背景の濃さ"
                      type="range"
                      min="55"
                      max="100"
                      step="1"
                      value={Math.round(theme.opacity * 100)}
                      onChange={(e) =>
                        setTheme({
                          ...theme,
                          opacity: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <output>{Math.round(theme.opacity * 100)}%</output>
                  </label>
                  <label>
                    角丸
                    <input
                      aria-label="角丸"
                      type="number"
                      min="0"
                      max="20"
                      value={theme.radius}
                      onChange={(e) =>
                        setTheme({ ...theme, radius: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    アニメーション
                    <select
                      aria-label="アニメーション"
                      value={theme.motion}
                      onChange={(e) =>
                        setTheme({ ...theme, motion: Number(e.target.value) })
                      }
                    >
                      <option value="1">標準</option>
                      <option value="0.5">控えめ</option>
                      <option value="0">なし</option>
                    </select>
                  </label>
                  <button onClick={() => setTheme(defaults())}>
                    テーマをリセット
                  </button>
                </div>
              </>
            )}
            {section === "keyboard" && (
              <>
                <h1>キー操作</h1>
                <label className="setting-label">
                  ハブを表示するディスプレイ
                  <select
                    aria-label="ハブの表示先"
                    value={hubScreen}
                    onChange={(e) =>
                      setHubScreen(e.target.value as Settings["hub_screen"])
                    }
                  >
                    <option value="mouse">マウスカーソルのある画面</option>
                    <option value="active">操作中のウィンドウがある画面</option>
                    <option value="primary">メイン画面</option>
                  </select>
                </label>
                <label className="setting-label">起動ショートカット</label>
                <div className="shortcut-controls">
                  <input
                    aria-label="起動ショートカット"
                    value={shortcut}
                    onChange={(e) => setShortcut(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    className={recording ? "active" : ""}
                    onClick={() => setRecording(true)}
                  >
                    {recording ? "キーを押してください…" : "キーを記録"}
                  </button>
                  <button
                    className="primary"
                    disabled={busy || recording}
                    onClick={() =>
                      void task(async () => {
                        updateSettings(
                          await api<Settings>("set_shortcut", { shortcut }),
                        );
                        setData((d) =>
                          d ? { ...d, shortcut_error: null } : d,
                        );
                        setNotice("起動キーを登録・保存しました");
                      })
                    }
                  >
                    登録・保存
                  </button>
                </div>
                <button
                  className="text-button"
                  onClick={() => setShortcut("Control+Shift+Space")}
                >
                  Ctrl＋Shift＋Spaceにリセット
                </button>
                <DirectShortcuts
                  settings={data.settings}
                  busy={busy}
                  onSave={(enabled, shortcuts) =>
                    void task(async () => {
                      updateSettings(
                        await api<Settings>("set_quick_shortcuts", {
                          enabled,
                          shortcuts,
                        }),
                      );
                      setData((d) => (d ? { ...d, shortcut_error: null } : d));
                      setNotice("直接キーを登録・保存しました");
                    })
                  }
                />
                <label className="setting-label">
                  操作ヒント
                  <select
                    aria-label="操作ヒントの表示"
                    value={guideMode}
                    onChange={(e) =>
                      setGuideMode(e.target.value as Settings["guide_mode"])
                    }
                  >
                    <option value="full">すべて表示</option>
                    <option value="compact">コンパクト</option>
                    <option value="hidden">非表示</option>
                  </select>
                </label>
                <div className="shortcut-table">
                  <p>
                    <kbd>A Q E S</kbd>Homeから機能を開く
                  </p>
                  <p>
                    <kbd>↑↓ → Enter</kbd>アプリ → ディスプレイ → 配置決定
                  </p>
                  <p>
                    <kbd>Ctrl Tab</kbd>モニター切替
                  </p>
                  <p>
                    <kbd>1–9</kbd>表示中のディスプレイ・領域を選ぶ
                  </p>
                  <p>
                    <kbd>R · [ ] · 矢印</kbd>比率の編集
                  </p>
                  <p>
                    <kbd>Shift 矢印</kbd>1%単位で調整
                  </p>
                  <p>
                    <kbd>F6</kbd>配置操作とコントロールを切替
                  </p>
                  <p>
                    <kbd>Ctrl Enter / Esc</kbd>確定 / 前画面
                  </p>
                </div>
              </>
            )}
            {section === "learning" && (
              <>
                <h1>履歴と配置提案</h1>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={learning}
                    onChange={(e) => setLearning(e.target.checked)}
                  />
                  ローカル履歴と配置提案を有効にする
                </label>
                <p className="description">
                  同じモニター構成・アプリの組み合わせを、利用回数と最近の傾向で優先します。固定した初期レイアウトは変更しません。
                </p>
                <div className="history-summary">
                  保存した履歴 <b>{historyCount}件</b>
                  <button onClick={() => setConfirmHistory(true)}>
                    履歴をリセット
                  </button>
                </div>
                <button
                  disabled={!learning || busy}
                  onClick={() =>
                    void task(async () => {
                      const count = await api<number>("record_current", {
                        windowIds: assignments.length
                          ? assignments.map((a) => a.window_id)
                          : allWindows.map((w) => w.id),
                      });
                      setNotice(`${count}件の現在配置を記録しました`);
                      const h = await api<{ count: number }>("history_info");
                      setHistoryCount(h.count);
                      setData(await api<Bootstrap>("bootstrap"));
                    })
                  }
                >
                  手動で修正した現在の配置を取り込む
                </button>
                <p className="micro">
                  記録するのは確定した配置と明示的な取込みだけです。履歴にウィンドウタイトルや画面内容を保存しません。常時の変更監視は未実装です。
                </p>
              </>
            )}
            <div className="action-bar">
              <span>変更は保存後に次回起動へ引き継ぎます。</span>
              <button className="primary" disabled={busy} onClick={savePrefs}>
                設定を保存
              </button>
            </div>
          </>
        )}
      </div>
      {data.settings.guide_mode !== "hidden" && (
        <footer>
          <div className="footer-hints">
            {screen === "home" ? (
              <>
                <kbd>← ↑ ↓ →</kbd>配置 <kbd>↵</kbd>最大化
              </>
            ) : screen === "arrange" ? (
              <>
                <kbd>↑ ↓</kbd>選択 <kbd>↵</kbd>次へ <kbd>Ctrl ↵</kbd>一括配置
              </>
            ) : screen === "edit" ? (
              <>
                <kbd>[ ]</kbd>分割線 <kbd>矢印</kbd>
                {ratioMode ? "調整中" : "比率"}
                {data.settings.guide_mode === "full" && (
                  <>
                    <kbd>Shift</kbd>1%
                  </>
                )}
              </>
            ) : screen === "quick" ? (
              <>
                <kbd>1–7</kbd>即実行 <kbd>Ctrl Tab</kbd>Monitor
              </>
            ) : (
              <>
                <kbd>Tab</kbd>項目を移動
              </>
            )}
            <kbd>Esc</kbd>戻る
          </div>
          <span className="footer-shortcut">
            {busy ? "処理中…" : keyLabel(data.settings.shortcut)}
          </span>
        </footer>
      )}
      {guide && (
        <div className="modal-backdrop">
          <section
            className="modal guide"
            role="dialog"
            aria-modal="true"
            aria-label="キー操作ガイド"
          >
            <h1>キー操作</h1>
            <div className="shortcut-table">
              <p>
                <kbd>{keyLabel(data.settings.shortcut)}</kbd>ハブを開く
              </p>
              <p>
                <kbd>
                  {navigator.platform.includes("Mac") ? "⌘ ," : "Ctrl ,"}
                </kbd>
                設定を開く
              </p>
              <p>
                <kbd>← ↑ ↓ →</kbd>ホームで配置 · Enter
                最大化（ハブを開いたまま）
              </p>
              <p>
                <kbd>A / Q / E / S</kbd>配置 / 単体移動 / 領域編集 / 保存
              </p>
              <p>
                <kbd>↑ ↓ → Enter</kbd>アプリ → ディスプレイ → 配置決定
              </p>
              <p>
                <kbd>R · [ ] · 矢印</kbd>比率編集（Shiftで1%）
              </p>
              <p>
                <kbd>F6</kbd>配置操作と各コントロールを切替
              </p>
              <p>
                <kbd>Ctrl Enter / Esc</kbd>一括確定 / 前画面へ戻る
              </p>
            </div>
            <button className="primary" autoFocus onClick={closeGuide}>
              閉じる <kbd>↵</kbd>
            </button>
          </section>
        </div>
      )}
      {(deleteTarget || confirmHistory) && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="削除の確認"
          >
            <h2>
              {deleteTarget
                ? "保存した配置を削除しますか？"
                : "配置履歴をリセットしますか？"}
            </h2>
            <p>
              {deleteTarget
                ? "この保存配置だけを削除します。実際のウィンドウは変わりません。"
                : "初期レイアウトとワークスペースは保持します。"}
            </p>
            <div className="modal-actions">
              <button
                autoFocus
                onClick={() => {
                  setDeleteTarget(null);
                  setConfirmHistory(false);
                }}
              >
                キャンセル
              </button>
              <button
                onClick={() =>
                  void task(async () => {
                    if (deleteTarget) {
                      updateSettings(
                        await api<Settings>("delete_layout", {
                          id: deleteTarget.id,
                          profileKey: deleteTarget.profile,
                        }),
                      );
                      setDeleteTarget(null);
                    } else {
                      await api("clear_history");
                      setHistoryCount(0);
                      setConfirmHistory(false);
                      setData((d) =>
                        d ? { ...d, suggestions: [], history_error: null } : d,
                      );
                    }
                  })
                }
              >
                削除する
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
