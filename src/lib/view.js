// How the conversation is drawn: font, column width, zoom. Kept in
// localStorage; anything stored that isn't a known choice falls back to the
// default. Tested in test/view.test.js.

export const FONTS = [
  { id: "system", label: "System", css: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif' },
  { id: "rounded", label: "Rounded", css: 'ui-rounded, "SF Pro Rounded", -apple-system, sans-serif' },
  { id: "serif", label: "New York", css: 'ui-serif, "New York", Georgia, serif' },
  { id: "avenir", label: "Avenir", css: '"Avenir Next", Avenir, -apple-system, sans-serif' },
  { id: "mono", label: "Monospace", css: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

export const WIDTHS = [
  { id: "small", label: "Small", px: 640 },
  { id: "medium", label: "Medium", px: 820 },
  { id: "wide", label: "Wide", px: 1120 },
];

export const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75];

export const THEMES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export const DEFAULT_VIEW = { font: "system", width: "medium", zoom: 1, theme: "system" };

/** A view from whatever was stored. */
export function parseView(stored) {
  let v = null;
  try { v = JSON.parse(stored ?? "null"); } catch { v = null; }
  if (!v || typeof v !== "object") return { ...DEFAULT_VIEW };
  return {
    font: FONTS.some((f) => f.id === v.font) ? v.font : DEFAULT_VIEW.font,
    width: WIDTHS.some((w) => w.id === v.width) ? v.width : DEFAULT_VIEW.width,
    zoom: ZOOMS.includes(v.zoom) ? v.zoom : DEFAULT_VIEW.zoom,
    theme: THEMES.some((t) => t.id === v.theme) ? v.theme : DEFAULT_VIEW.theme,
  };
}

/** The CSS variables a view sets on the conversation. */
export function viewStyle(v) {
  const font = FONTS.find((f) => f.id === v.font) ?? FONTS[0];
  const width = WIDTHS.find((w) => w.id === v.width) ?? WIDTHS[1];
  return { "--chat-font": font.css, "--col": `${width.px}px`, "--zoom": String(v.zoom) };
}

/** The next zoom step up (+1) or down (-1), staying within the steps. */
export function stepZoom(zoom, dir) {
  const i = ZOOMS.indexOf(zoom);
  const at = i < 0 ? ZOOMS.indexOf(1) : i;
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + dir))];
}
