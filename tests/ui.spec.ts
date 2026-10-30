import { test, expect, type Page } from "@playwright/test";
import { themePresets } from "../src/themes";
async function start(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "キー操作ガイド" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /Arrange 一括配置/ }),
  ).toBeVisible();
}
async function stage(page: Page) {
  await page.locator("[data-keyboard-surface]").focus();
}
async function assign(page: Page, windowIndex = 0, monitor = 1, zone = 1) {
  await stage(page);
  for (let i = 0; i < windowIndex; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "移動先のディスプレイを選ぶ" }),
  ).toBeVisible();
  await page.keyboard.press(String(monitor));
  await expect(
    page.getByRole("heading", { name: "領域を選んで配置を決定" }),
  ).toBeVisible();
  await page.keyboard.press(String(zone));
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "配置するウィンドウを選ぶ" }),
  ).toBeVisible();
}
test("Arrange enforces all three decisions, preserves stacking, and applies only after confirmation", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("a");
  await expect(
    page.getByRole("button", { name: "2 ディスプレイ選択" }),
  ).toBeDisabled();
  await page.keyboard.press("2");
  await expect(
    page.getByRole("heading", { name: "配置するウィンドウを選ぶ" }),
  ).toBeVisible();
  await expect(page.locator(".display-picker")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "3 配置決定" })).toBeDisabled();
  await page.keyboard.press("2");
  await expect(page.locator(".flow-path")).toContainText("縦ディスプレイ");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "移動先のディスプレイを選ぶ" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await assign(page, 0, 1, 2);
  await assign(page, 1, 1, 2);
  await expect(page.locator(".assignment-summary summary")).toContainText(
    "2件",
  );
  await page.getByLabel("レイアウト名").fill("研究環境");
  await page.getByRole("button", { name: "初期として保存" }).click();
  await stage(page);
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("status")).toContainText("一括配置を反映");
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("windowhub-preview")!).profiles[
        "preview-only"
      ][0],
  );
  expect(stored.locked).toBe(true);
  expect(stored.bindings).toHaveLength(2);
  expect(stored.bindings[0].zone_id).toBe(stored.bindings[1].zone_id);
  await stage(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("1");
  await page.keyboard.press("r");
  await expect(page.getByRole("heading", { name: "領域と比率" })).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("分割比率の数値")).toHaveValue("51");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "領域を選んで配置を決定" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("windowhub-preview")!).profiles[
          "preview-only"
        ][0].document,
    ),
  ).toEqual(stored.document);
});
test("Delete and Mac Backspace remove regions but typing in a text field is safe", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("e");
  await stage(page);
  await page.keyboard.press("Backspace");
  await expect(
    page.getByRole("button", { name: "メイン 領域2", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("v");
  await expect(
    page.getByRole("button", { name: "メイン 領域2", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(
    page.getByRole("button", { name: "メイン 領域2", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("v");
  await page.getByLabel("レイアウト名").fill("abc");
  await page.keyboard.press("Backspace");
  await expect(page.getByLabel("レイアウト名")).toHaveValue("ab");
  await expect(
    page.getByRole("button", { name: "メイン 領域2", exact: true }),
  ).toBeVisible();
});
test("Edit changes a second split independently, locks it, and supports pointer dragging", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("e");
  await page.getByLabel("分割パターン").selectOption("three");
  await stage(page);
  await page.keyboard.press("r");
  await page.keyboard.press("]");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("分割比率の数値")).toHaveValue("51");
  await page.getByRole("button", { name: "固定する", exact: true }).click();
  await expect(page.getByLabel("分割比率の数値")).toBeDisabled();
  await stage(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("分割比率の数値")).toHaveValue("51");
  await page.getByRole("button", { name: "固定中", exact: true }).click();
  const slider = page.getByRole("slider", { name: "分割線2", exact: true });
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 35, box!.y + box!.height / 2);
  await page.mouse.up();
  await expect(page.getByLabel("分割比率の数値")).not.toHaveValue("51");
});
test("Quick Move captures the previous window and applies a region without Enter", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("q");
  await expect(page.getByText("リサーチ資料", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "ディスプレイ2 縦ディスプレイ" })
    .click();
  await expect(page.locator(".quick-destination h2")).toContainText(
    "ディスプレイ 2 · 縦ディスプレイ",
  );
  await stage(page);
  await page.keyboard.press("3");
  await expect(page.getByRole("status")).toContainText("UIプレビュー");
});
test("Settings has keyboard HEX editing, a light theme, contrast warning and persistence", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("t");
  await page.getByRole("button", { name: "Sandstone", exact: true }).click();
  await page.getByLabel("アクセントのHEX").fill("#789567");
  await page.getByLabel("背景の濃さ").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "設定を保存" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Arrange 一括配置/ }),
  ).toBeVisible();
  await page.keyboard.press("t");
  await expect(page.getByLabel("背景のHEX", { exact: true })).toHaveValue(
    "#E8E3D9",
  );
  await expect(page.getByLabel("アクセントのHEX")).toHaveValue("#789567");
  await expect(page.getByLabel("背景の濃さ")).toHaveValue("56");
  expect(
    await page
      .locator(".app-shell")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).not.toBe("rgb(232, 227, 217)");
  await page.getByLabel("文字のHEX", { exact: true }).fill("#E8E3D9");
  await expect(page.getByRole("alert")).toContainText("コントラスト");
  await page.getByRole("button", { name: "キー操作", exact: true }).click();
  await page.getByRole("button", { name: "キーを記録", exact: true }).click();
  await page.keyboard.press("Control+Shift+k");
  await expect(page.getByLabel("起動ショートカット")).toHaveValue(
    "Control+Shift+K",
  );
  await page.getByRole("button", { name: "登録・保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("起動キーを登録");
});
test("A and Q explain denied Accessibility access, and refresh recovers real targets", async ({
  page,
}) => {
  await page.addInitScript(
    ({ theme }) => {
      const state = {
        settings: {
          schema_version: 1,
          shortcut: "Control+Shift+Space",
          theme,
          profiles: {},
          guide_seen: true,
          guide_mode: "compact",
          learning_enabled: true,
          configurations: {},
        },
        snapshot: {
          trusted: false,
          platform: "macos",
          monitors: [
            {
              id: "m",
              name: "Test display",
              rect: { x: 0, y: 0, width: 1200, height: 900 },
              scale: 1,
            },
          ],
          windows: [] as any[],
        },
        topology: "test",
        context: { window: null, monitor: null, app_pid: null },
        suggestions: [],
        compatible_profiles: [],
        shortcut_error: null,
        history_error: null,
      };
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener() {},
      };
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        invoke: async (command: string) => {
          if (command === "bootstrap") return structuredClone(state);
          if (command === "environment")
            return { topology: "test", trusted: state.snapshot.trusted };
          if (command === "plugin:event|listen") return 1;
          if (command === "refresh_permissions") {
            state.snapshot.trusted = true;
            state.snapshot.windows = [
              {
                id: "w",
                pid: 10,
                app_id: "test",
                app_name: "Test App",
                title: "Test window",
                resizable: true,
                rect: { x: 10, y: 10, width: 700, height: 600 },
              },
            ];
          }
          return null;
        },
      };
    },
    { theme: themePresets[0].theme },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Arrange 一括配置/ }),
  ).toBeVisible();
  await page.keyboard.press("a");
  await expect(
    page.getByText("ウィンドウの取得に許可が必要です", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("対象のウィンドウがありません。", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("q");
  await expect(
    page.getByText("ウィンドウの取得に許可が必要です", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1 左半分", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "許可を確認", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1件のウィンドウを取得");
  await page.keyboard.press("a");
  await expect(
    page.getByRole("button", { name: "Test App Test window", exact: true }),
  ).toBeVisible();
});
test("History proposals follow two records, contain no titles and leave fixed layouts protected", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("a");
  await assign(page);
  await page.getByLabel("レイアウト名").fill("固定レイアウト");
  await page.getByRole("button", { name: "初期として保存" }).click();
  await expect(page.getByRole("status")).toContainText("保存");
  await stage(page);
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("status")).toContainText("反映");
  await stage(page);
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("status")).toContainText("反映");
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("windowhub-preview-history")!),
  );
  expect(history.length).toBe(2);
  expect(
    history.every((h: any) =>
      h.layout.bindings.every((b: any) => b.title === ""),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("s");
  await expect(
    page.getByRole("heading", { name: "履歴からの候補" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("k");
  await page.getByRole("button", { name: "履歴と提案", exact: true }).click();
  await page.getByRole("button", { name: "履歴をリセット" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除する" })
    .click();
  await expect(page.getByText("0件", { exact: true })).toBeVisible();
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("windowhub-preview")!).profiles[
        "preview-only"
      ],
  );
  expect(saved[0].name).toBe("固定レイアウト");
});
test("Home is a compact placement hub, with reachable actions and modal focus trapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 390 });
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /閉じる/ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /Saved Workspaces/ }),
  ).toBeInViewport({ ratio: 1 });
  await expect(page.getByPlaceholder("レイアウトを検索")).toHaveCount(0);
  await page.keyboard.press("e");
  await page.setViewportSize({ width: 840, height: 630 });
  await expect(
    page.getByRole("button", { name: /初期として保存/ }),
  ).toBeInViewport({ ratio: 1 });
});

test("Hub screen choice and configurable direct keys persist, with duplicate rejection", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("k");
  await page.getByLabel("ハブの表示先").selectOption("active");
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await page.getByLabel("左半分の直接キー").fill("Control+Alt+Super+H");
  await page
    .getByRole("button", { name: "直接キーを登録・保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("直接キーを登録");
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Arrange 一括配置/ }),
  ).toBeVisible();
  await page.keyboard.press("k");
  await expect(page.getByLabel("ハブの表示先")).toHaveValue("active");
  await expect(page.getByLabel("左半分の直接キー")).toHaveValue(
    "Control+Alt+Super+H",
  );
  await page.getByLabel("左半分の直接キー").fill("Control+Shift+Space");
  await page
    .getByRole("button", { name: "直接キーを登録・保存", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("同じキー");
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("windowhub-preview")!),
  );
  expect(settings.quick_shortcuts.left).toBe("Control+Alt+Super+H");
});

test("Guided placement fits the native hub and does not overlap the next action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 840, height: 610 });
  await start(page);
  await page.keyboard.press("a");
  await page.keyboard.press("Enter");
  await page.keyboard.press("2");
  const confirm = page.getByRole("button", {
    name: "この配置を追加 Enter",
    exact: true,
  });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: /件を一括配置/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /1件を一括配置/ }),
  ).toBeInViewport({ ratio: 1 });
});

test("Home arrows keep the hub open, queue repeats, maximize with Enter and retain menu keys", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".home-move-result")).toContainText("左半分");
  await expect(
    page.getByRole("button", { name: /Arrange 一括配置/ }),
  ).toBeVisible();
  for (const [key, label] of [
    ["ArrowRight", "右半分"],
    ["ArrowUp", "上半分"],
    ["ArrowDown", "下半分"],
    ["Enter", "最大化"],
  ]) {
    await page.keyboard.press(key);
    await expect(page.locator(".home-move-result")).toContainText(label);
  }
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".home-move-result")).toContainText("左半分");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "一括配置", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("q");
  await expect(
    page.getByRole("heading", { name: "Quick Move", exact: true }),
  ).toBeVisible();
});

test("Compact Home hides settings, opens them with Command-comma, and has no drag region", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 300 });
  await start(page);
  await expect(page.locator(".home-menu>button")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: /Settings テーマ/ }),
  ).toHaveCount(0);
  await expect(page.locator("[data-tauri-drag-region]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Saved Workspaces/ }),
  ).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Meta+Comma");
  await expect(
    page.getByRole("heading", { name: "外観", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("a");
  await page.keyboard.press("Meta+Comma");
  await expect(
    page.getByRole("heading", { name: "外観", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "一括配置", exact: true }),
  ).toBeVisible();
});

test("Arrange reads the latest display configuration and preserves a draft on disconnection", async ({ page }) => {
  await page.addInitScript(({ theme }) => {
    const display = (id: string, x: number) => ({ id, name: id, scale: 1, rect: { x, y: 0, width: 1200, height: 900 } });
    const state: any = {
      settings: { schema_version: 1, shortcut: "Control+Shift+Space", theme, profiles: {}, guide_seen: true, guide_mode: "compact", learning_enabled: true, configurations: {}, hub_screen: "mouse", quick_enabled: false, quick_shortcuts: {} },
      snapshot: { trusted: true, platform: "macos", monitors: [display("First", 0)], windows: [{ id: "w", pid: 10, app_id: "test", app_name: "Test App", title: "Test", resizable: true, rect: { x: 20, y: 20, width: 700, height: 600 } }] },
      topology: "one", context: { window: null, monitor: null, app_pid: null }, suggestions: [], compatible_profiles: [], shortcut_error: null, history_error: null,
    };
    (window as any).setTestDisplays = (two: boolean) => {
      state.snapshot.monitors = two ? [display("First", 0), display("Second", 1200)] : [display("First", 0)];
      state.topology = two ? "two" : "one";
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (command: string) => {
        if (command === "bootstrap") return structuredClone(state);
        if (command === "environment") return { topology: state.topology };
        if (command === "plugin:event|listen") return 1;
        return null;
      },
    };
  }, { theme: themePresets[0].theme });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Arrange 一括配置/ })).toBeVisible();
  await page.evaluate(() => (window as any).setTestDisplays(true));
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "配置するウィンドウを選ぶ" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "移動先のディスプレイを選ぶ" })).toBeVisible();
  await expect(page.getByText("Second", { exact: false }).first()).toBeVisible();
  await page.evaluate(() => (window as any).setTestDisplays(false));
  await expect(page.getByText("モニター構成が変わりました。編集内容を破棄して再取得してください。", { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("Second", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "再取得", exact: true }).click();
  await expect(page.getByRole("button", { name: /Arrange 一括配置/ })).toBeVisible();
  await page.keyboard.press("a");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Second", { exact: false })).toHaveCount(0);
});
