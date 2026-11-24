// ⌘K, the command palette: actions and the sessions to go to, filtered as
// the person types. Plain functions, tested in test/commands.test.js.
import { FONTS, WIDTHS, THEMES, stepZoom } from "./view.js";

/**
 * Every command: { id, title, group, keys?, run: { kind, ... } }. `run` says
 * what to do; the window carries it out.
 */
export function commandList(hosts, view) {
  const out = [
    { id: "new", title: "New session…", group: "Sessions", keys: "", run: { kind: "new-session" } },
    { id: "search", title: "Search every session…", group: "Search", keys: "⌘⇧F", run: { kind: "search", tab: "search" } },
    { id: "archived", title: "Archived sessions…", group: "Sessions", run: { kind: "search", tab: "archived" } },
    { id: "find", title: "Find in this conversation", group: "Search", keys: "⌘F", run: { kind: "find" } },
    { id: "zoom-in", title: "Zoom in", group: "View", keys: "⌘+", run: { kind: "view", change: { zoom: stepZoom(view?.zoom ?? 1, 1) } } },
    { id: "zoom-out", title: "Zoom out", group: "View", keys: "⌘−", run: { kind: "view", change: { zoom: stepZoom(view?.zoom ?? 1, -1) } } },
    { id: "zoom-reset", title: "Actual size", group: "View", keys: "⌘0", run: { kind: "view", change: { zoom: 1 } } },
    ...THEMES.map((t) => ({ id: `theme-${t.id}`, title: `Appearance: ${t.label}`, group: "View", run: { kind: "view", change: { theme: t.id } }, on: view?.theme === t.id })),
    ...WIDTHS.map((w) => ({ id: `width-${w.id}`, title: `Width: ${w.label}`, group: "View", run: { kind: "view", change: { width: w.id } }, on: view?.width === w.id })),
    ...FONTS.map((f) => ({ id: `font-${f.id}`, title: `Font: ${f.label}`, group: "View", run: { kind: "view", change: { font: f.id } }, on: view?.font === f.id })),
  ];
  for (const h of hosts ?? []) {
    for (const g of h.groups ?? []) {
      for (const s of g.sessions ?? []) {
        out.push({
          id: `go:${s.address}`, title: s.title, group: "Go to", detail: `${h.name} · ${g.name}`, status: s.status,
          run: { kind: "open", target: { kind: "session", address: s.address, title: s.title } },
        });
      }
    }
  }
  return out;
}

/**
 * The commands matching `q`, best first: every word must appear in the
 * title or detail; a title starting with the query, then a word of the
 * title starting with it, rank first. Empty: actions first, then sessions.
 */
export function filterCommands(list, q) {
  const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const scored = [];
  for (const c of list) {
    const hay = `${c.title} ${c.detail ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const title = c.title.toLowerCase();
    const first = words[0];
    const score = title.startsWith(first) ? 3 : title.split(/[\s:·/-]+/).some((t) => t.startsWith(first)) ? 2 : 1;
    scored.push({ c, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.c);
}
