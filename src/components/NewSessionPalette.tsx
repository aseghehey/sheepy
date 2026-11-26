import { useEffect, useMemo, useRef, useState } from "react";
import { core } from "../lib/core";
import { splitPath, intoDir, upDir, baseName, folderItems } from "../lib/paths.js";
import { EFFORTS, MODEL_CHOICES } from "../lib/models.js";

type Listing = { key: string; state: "dir" | "missing" | "file" | "denied" | "error"; path?: string; dirs: string[]; error?: string };
type Item =
  | { kind: "start"; path: string; create: boolean; label: string; detail?: string }
  | { kind: "note"; label: string }
  | { kind: "dir"; name: string }
  | { kind: "recent"; path: string };

// Small line icons, drawn like the rest of the window's.
const ICON = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function Icon({ kind }: { kind: string }) {
  if (kind === "dir") return <svg {...ICON}><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" /></svg>;
  if (kind === "recent") return <svg {...ICON}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>;
  if (kind === "create") return <svg {...ICON}><path d="M12 5v14M5 12h14" /></svg>;
  return <svg {...ICON}><path d="m8 5 11 7-11 7z" /></svg>;
}

// The last folder a session was started in, per host (a folder on this Mac
// means nothing on another machine).
const folderKey = (machine: string) => `new.folder:${machine || "local"}`;
const lastFolder = (machine: string | null) => localStorage.getItem(folderKey(machine ?? "")) ?? "";

/**
 * A new Claude Code session, from a palette at the top of the window: type a
 * folder's path and pick from the folders in it on the chosen host, as an
 * editor's Open Folder does. Enter on a folder goes into it; Enter on the
 * first row (or ⌘Enter) starts there, creating the folder first when it
 * isn't there. Host, group, model and effort sit under the path.
 */
export function NewSessionPalette({ hosts, initial, folders, groups, onDone, onStarted }: {
  hosts: string[]; initial: { machine: string | null; folder: string; group: string };
  folders: (machine: string | null) => string[]; groups: (machine: string | null) => string[];
  onDone: () => void; onStarted: (address: string, title: string) => void;
}) {
  const [machine, setMachine] = useState<string>(initial.machine ?? "");
  const startPath = (m: string | null, f?: string) => {
    const p = f || lastFolder(m) || "~/";
    return p.endsWith("/") ? p : `${p}/`;
  };
  const [path, setPath] = useState(() => startPath(initial.machine, initial.folder));
  const [group, setGroup] = useState(initial.group);
  const [naming, setNaming] = useState(false);
  const [model, setModel] = useState(() => localStorage.getItem("new.model") ?? "");
  const [effort, setEffort] = useState(() => localStorage.getItem("new.effort") ?? "");
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { setTimeout(() => input.current?.focus(), 0); }, []);

  // The folder being typed in, listed on the host (each listing kept, so
  // going back and forth is instant).
  const { parent, partial } = splitPath(path);
  const key = `${machine}|${parent}`;
  const cache = useRef(new Map<string, Listing>());
  const [listing, setListing] = useState<Listing | null>(null);
  useEffect(() => {
    const known = cache.current.get(key);
    if (known) { setListing(known); return; }
    let alive = true;
    const t = setTimeout(async () => {
      let l: Listing;
      try {
        const r: any = await core.listDirs(machine || null, parent);
        l = { key, state: r.state, path: r.path, dirs: r.dirs ?? [] };
      } catch (e) {
        l = { key, state: "error", dirs: [], error: String(e) };
      }
      if (l.state !== "error") cache.current.set(key, l);
      if (alive) setListing(l);
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [key]);
  const current = listing?.key === key ? listing : null;

  const items: Item[] = useMemo(
    () => folderItems(current, path, folders(machine || null), machine || "this computer") as Item[],
    [current, path, machine, folders],
  );
  useEffect(() => { setSel(0); }, [path, machine]);
  useEffect(() => { list.current?.querySelector(".cmd.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const start = async (target: string, create: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const address = await core.newSession(machine || null, target, group || null, model || null, effort || null, create);
      localStorage.setItem(folderKey(machine), target);
      localStorage.setItem("new.model", model);
      localStorage.setItem("new.effort", effort);
      onStarted(address, baseName(target));
      onDone();
    } catch (e) {
      const text = String(e);
      // The folder went missing between listing and starting: offer to create it.
      if (text.startsWith("missing-folder:")) setError(`${text.slice("missing-folder:".length)} isn't there: choose “Create … and start”.`);
      else setError(text);
      cache.current.delete(key);
    } finally {
      setBusy(false);
    }
  };

  const choose = (it: Item | undefined) => {
    if (!it) return;
    if (it.kind === "start") start(it.path, it.create);
    else if (it.kind === "dir") setPath(intoDir(parent, it.name));
    else if (it.kind === "recent") setPath(it.path.endsWith("/") ? it.path : `${it.path}/`);
  };
  const highlighted = items[sel];
  const existing = groups(machine || null).filter((g) => g !== "Ungrouped");
  let heading = "";

  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onDone(); }}>
      <div className="palette new-session-palette" role="dialog" aria-label="New Claude Code session">
        <div className="palette-title">New Claude Code session</div>
        <input ref={input} className="palette-input" value={path} spellCheck={false} disabled={busy}
          placeholder="Folder, e.g. ~/code/project" aria-label="Folder"
          onChange={(e) => { setPath(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter" && e.metaKey) { e.preventDefault(); const first = items.find((i) => i.kind === "start"); if (first) choose(first); }
            else if (e.key === "Enter") { e.preventDefault(); choose(highlighted); }
            else if (e.key === "Tab" && !e.shiftKey) {
              // Completes the highlighted folder (or the only one that matches).
              const dirs = items.filter((i) => i.kind === "dir");
              const pick = highlighted?.kind === "dir" ? highlighted : dirs.length === 1 ? dirs[0] : null;
              if (pick) { e.preventDefault(); choose(pick); }
            } else if (e.key === "Backspace" && e.altKey && !partial && parent !== "/") { e.preventDefault(); setPath(upDir(path)); }
            else if (e.key === "Escape") { e.preventDefault(); if (!busy) onDone(); }
          }} />
        <div className="new-session-options">
          <label>Host
            <span className="select"><select value={machine} disabled={busy} onChange={(e) => { const m = e.target.value; setMachine(m); setPath(startPath(m || null)); setGroup(""); setNaming(false); }}>
              <option value="">This computer</option>
              {hosts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></span>
          </label>
          <label>Group
            {naming ? (
              <input autoFocus value={group} placeholder="New group's name" disabled={busy}
                onChange={(e) => setGroup(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setNaming(false); setGroup(""); } else if (e.key === "Enter") { e.preventDefault(); input.current?.focus(); } }} />
            ) : (
              <span className="select"><select value={existing.includes(group) ? group : ""} disabled={busy} onChange={(e) => {
                if (e.target.value === "\u0000new") { setNaming(true); setGroup(""); } else setGroup(e.target.value);
              }}>
                <option value="">Ungrouped</option>
                {existing.map((g) => <option key={g} value={g}>{g}</option>)}
                <option value={"\u0000new"}>New group…</option>
              </select></span>
            )}
          </label>
          <label>Model
            <span className="select"><select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
              <option value="">Claude's default</option>
              {MODEL_CHOICES.filter((m) => m.id !== "default").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select></span>
          </label>
          <label>Effort
            <span className="select"><select value={effort} disabled={busy} onChange={(e) => setEffort(e.target.value)}>
              <option value="">Claude's default</option>
              {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select></span>
          </label>
        </div>
        {error && <div className="banner">{error}</div>}
        <div className="palette-list" ref={list}>
          {items.map((it, i) => {
            const group = it.kind === "dir" ? `Folders in ${parent}` : it.kind === "recent" ? "Recent folders" : "";
            const head = group && group !== heading ? group : null;
            heading = group || heading;
            const on = i === sel ? "on" : "";
            return (
              <div key={`${it.kind}:${"name" in it ? it.name : "path" in it ? it.path : it.label}`}>
                {head && <div className="pop-heading">{head}</div>}
                {it.kind === "note" ? (
                  <div className={`cmd note ${on}`}>{it.label}</div>
                ) : (
                  <button className={`cmd ${on} ${it.kind}`} disabled={busy} onMouseEnter={() => setSel(i)} onClick={() => choose(it)}>
                    <span className="cmd-icon"><Icon kind={it.kind === "start" ? (it.create ? "create" : "start") : it.kind} /></span>
                    <span className="label">
                      {it.kind === "start" ? (busy ? "Starting…" : it.label) : it.kind === "dir" ? <>{it.name}<span className="slash">/</span></> : it.path}
                    </span>
                    {it.kind === "start" && it.detail && <span className="meta">{it.detail}</span>}
                    {i === sel && it.kind === "dir" && <span className="keys"><kbd>Tab</kbd> open</span>}
                    {i === sel && it.kind === "start" && <span className="keys"><kbd>↵</kbd></span>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
          <span><kbd>↵</kbd> open or start</span>
          <span><kbd>Tab</kbd> complete</span>
          <span><kbd>⌘</kbd><kbd>↵</kbd> start here</span>
          <span><kbd>⌥</kbd><kbd>⌫</kbd> up a folder</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
