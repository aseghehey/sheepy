import { useEffect, useRef, useState } from "react";
import { FONTS, WIDTHS, ZOOMS, THEMES, parseView, stepZoom, DEFAULT_VIEW } from "../lib/view.js";

export type View = typeof DEFAULT_VIEW;

/** The view, kept across sessions and restarts; ⌘+ / ⌘− / ⌘0 zoom the conversation. */
export function useView() {
  const [view, setViewState] = useState<View>(() => parseView(localStorage.getItem("view")));
  const setView = (change: Partial<View>) => setViewState((v) => {
    const next = { ...v, ...change };
    localStorage.setItem("view", JSON.stringify(next));
    return next;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); setViewState((v) => save({ ...v, zoom: stepZoom(v.zoom, 1) })); }
      else if (e.key === "-") { e.preventDefault(); setViewState((v) => save({ ...v, zoom: stepZoom(v.zoom, -1) })); }
      else if (e.key === "0") { e.preventDefault(); setViewState((v) => save({ ...v, zoom: 1 })); }
    };
    const save = (v: View) => { localStorage.setItem("view", JSON.stringify(v)); return v; };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Light, dark, or as the Mac is set.
  useEffect(() => { document.documentElement.dataset.theme = view.theme; }, [view.theme]);
  return [view, setView] as const;
}

// "Aa": font, column width and zoom.
export function ViewMenu({ view, setView }: { view: View; setView: (c: Partial<View>) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="view-menu" ref={box}>
      <button className={`head-btn ${open ? "on" : ""}`} title="Font, width and zoom" onClick={() => setOpen(!open)}>Aa</button>
      {open && (
        <div className="popover">
          <div className="pop-heading">Font</div>
          {FONTS.map((f) => (
            <button key={f.id} className="pop-item" style={{ fontFamily: f.css }} onClick={() => setView({ font: f.id })}>
              <span className="check">{view.font === f.id ? "✓" : ""}</span>{f.label}
            </button>
          ))}
          <div className="pop-heading">Width</div>
          <div className="seg">
            {WIDTHS.map((w) => (
              <button key={w.id} className={view.width === w.id ? "on" : ""} onClick={() => setView({ width: w.id })}>{w.label}</button>
            ))}
          </div>
          <div className="pop-heading">Appearance</div>
          <div className="seg">
            {THEMES.map((t) => (
              <button key={t.id} className={view.theme === t.id ? "on" : ""} onClick={() => setView({ theme: t.id })}>{t.label}</button>
            ))}
          </div>
          <div className="pop-heading">Zoom</div>
          <div className="pop-row">
            <select value={view.zoom} onChange={(e) => setView({ zoom: Number(e.target.value) })}>
              {ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </div>
          <div className="pop-hint">⌘+ and ⌘− zoom, ⌘0 resets</div>
        </div>
      )}
    </div>
  );
}
