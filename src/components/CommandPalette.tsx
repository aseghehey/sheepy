import { useEffect, useMemo, useRef, useState } from "react";
import { commandList, filterCommands } from "../lib/commands.js";
import { StatusDot, type Target } from "./Sidebar";
import type { View } from "./ViewMenu";

// ⌘K: every action, and every session to go to. Type to filter; ↑↓ to choose;
// Enter runs it; Escape closes.
export function CommandPalette({ open, onClose, hosts, view, setView, onOpen, onSearch }: {
  open: boolean; onClose: () => void; hosts: any[]; view: View; setView: (c: Partial<View>) => void;
  onOpen: (t: Target) => void; onSearch: (tab: "search" | "archived") => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const items = useMemo(() => filterCommands(commandList(hosts, view), q), [hosts, view, q]);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => box.current?.focus(), 0); } }, [open]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector(".cmd.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const run = (c: any) => {
    const r = c.run;
    onClose();
    if (r.kind === "open") onOpen(r.target);
    else if (r.kind === "search") onSearch(r.tab);
    else if (r.kind === "view") setView(r.change);
    else if (r.kind === "find") setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true })), 0);
    else if (r.kind === "new-session") window.dispatchEvent(new Event("sheepy:new-session"));
  };

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette commands">
        <input ref={box} className="palette-input" value={q} placeholder="Type a command or a session" spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) run(items[sel]); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }} />
        <div className="palette-list" ref={list}>
          {!items.length && <div className="hint">No command or session matches.</div>}
          {items.map((c: any, i: number) => {
            const heading = !q && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {heading && <div className="pop-heading">{heading}</div>}
                <button className={`cmd ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
                  {c.status ? <StatusDot status={c.status} /> : <span className="check">{c.on ? "✓" : ""}</span>}
                  <span className="label">{c.title}</span>
                  {c.detail && <span className="meta">{c.detail}</span>}
                  {c.keys && <span className="keys">{c.keys}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
