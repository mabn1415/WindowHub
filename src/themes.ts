import type { Theme } from "./types";
export const themePresets: { name: string; theme: Theme }[] = [
  {
    name: "Olive Graphite",
    theme: {
      background: "#181B18",
      surface: "#272C27",
      border: "#465047",
      text: "#EEEDE4",
      muted: "#A9B1A7",
      accent: "#A4B094",
      selected: "#39473B",
      radius: 8,
      motion: 1,
      opacity: 0.82,
    },
  },
  {
    name: "Clay & Stone",
    theme: {
      background: "#1D1B19",
      surface: "#2C2925",
      border: "#51483F",
      text: "#F2ECE2",
      muted: "#B6ACA0",
      accent: "#C39C80",
      selected: "#493C32",
      radius: 8,
      motion: 1,
      opacity: 0.82,
    },
  },
  {
    name: "Sandstone",
    theme: {
      background: "#E8E3D9",
      surface: "#F6F2EA",
      border: "#CAC4B6",
      text: "#30362F",
      muted: "#616B5C",
      accent: "#73856C",
      selected: "#D8DFD0",
      radius: 8,
      motion: 1,
      opacity: 0.88,
    },
  },
];
export function normalizeTheme(t: Partial<Theme>): Theme {
  return { ...themePresets[0].theme, ...t };
}
export function contrast(a: string, b: string): number {
  const lum = (s: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(s.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export const keyLabel = (s: string) =>
  s
    .replace(
      /CommandOrControl|CmdOrCtrl/g,
      navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
    )
    .replace(
      /Super|Meta|Command/g,
      navigator.platform.includes("Mac") ? "⌘" : "Win",
    )
    .replace(/Control/g, "Ctrl")
    .replace(/Alt/g, navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace(/Shift/g, "⇧")
    .replaceAll("+", " ");
