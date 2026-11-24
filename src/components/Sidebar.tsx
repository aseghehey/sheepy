import { useEffect, useState } from "react";
import { core, machineOf } from "../lib/core";
import { subagentRow } from "../lib/sessions.js";
import { Machines, useHealth, Health } from "./Machines";

export type Target =
  | { kind: "session"; address: string; title: string }
  | { kind: "subagent"; address: string; id: string; file: string; title: string; parentTitle: string };

interface Session { address: string; title: string; status: string; activity: string | null; machine: string | null; cwd?: string | null }
interface Win { id: string; name: string; space: string; machine: string | null; status: string; sessions: Session[] }

export function StatusDot({ status }: { status: string }) {
  return <span className={`dot dot-${status}`} title={status} />;
}

function useFolded() {
  const [folded, setFolded] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("folded") ?? "[]")); } catch { return new Set(); }
  });
  const toggle = (id: string) => setFolded((f) => {
    const n = new Set(f);
    n.has(id) ? n.delete(id) : n.add(id);
    localStorage.setItem("folded", JSON.stringify([...n]));
    return n;
  });
  return [folded, toggle] as const;
}

/** A session's sub-agents, read when it's open (and every 10 s while it is). */
function SubAgents({ session, file, target, onSelect }: { session: Session; file: string; target: Target | null; onSelect: (t: Target) => void }) {
  const [rows, setRows] = useState<ReturnType<typeof subagentRow>[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => core.subagents(machineOf(session.address), file)
      // Running ones first, then the newest.
      .then((l) => { if (alive) setRows(l.map(subagentRow).sort((a: any, b: any) => Number(a.finished) - Number(b.finished) || b.mtime - a.mtime)); })
      .catch(() => { if (alive) setRows([]); });
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [session.address, file]);
  if (!rows?.length) return null;
  const LIMIT = 6;
  const shown = all ? rows : rows.slice(0, LIMIT);
  return (
    <div className="subagents">
      {shown.map((r) => {
        const on = target?.kind === "subagent" && target.id === r.id;
        return (
          <button key={r.id} className={`row sub ${on ? "on" : ""}`} title={r.title}
            onClick={() => onSelect({ kind: "subagent", address: session.address, id: r.id, file: r.file, title: r.title, parentTitle: session.title })}>
            <span className="tree">└</span>
            <span className={`dot ${r.finished ? "dot-done" : "dot-working"}`} />
            <span className="label">{r.title}</span>
            {r.type && r.type !== "general-purpose" && <span className="meta">{r.type}</span>}
          </button>
        );
      })}
      {rows.length > LIMIT && (
        <button className="row sub more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length} sub-agents`}
        </button>
      )}
    </div>
  );
}

/** A new session: where (a host and a folder) and which group. */
function NewSession({ hosts, initial, onDone, onStarted }: {
  hosts: string[]; initial: { machine: string | null; folder: string; group: string };
  onDone: () => void; onStarted: (address: string, title: string) => void;
}) {
  const [machine, setMachine] = useState<string>(initial.machine ?? "");
  const [folder, setFolder] = useState(initial.folder);
  const [group, setGroup] = useState(initial.group);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const address = await core.newSession(machine || null, folder || null, group || null);
      localStorage.setItem("new.folder", folder);
      onStarted(address, folder.split("/").filter(Boolean).pop() ?? "New session");
      onDone();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return (
    <form className="new-session" onSubmit={(e) => { e.preventDefault(); start(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onDone(); }}>
      <div className="form-title">New Claude Code session</div>
      <label>Host
        <select value={machine} onChange={(e) => setMachine(e.target.value)}>
          <option value="">This computer</option>
          {hosts.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label>Folder<input autoFocus value={folder} placeholder="~ (home)" spellCheck={false} onChange={(e) => setFolder(e.target.value)} /></label>
      <label>Group<input value={group} placeholder="(none)" onChange={(e) => setGroup(e.target.value)} /></label>
      {error && <div className="banner">{error}</div>}
      <div className="form-actions">
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? "Starting…" : "Start"}</button>
      </div>
    </form>
  );
}

interface Host { id: string; name: string; machine: string | null; status: string; groups: Win[] }

export function Sidebar({ hosts, target, logs, onSelect, error, machines }: {
  hosts: Host[]; target: Target | null; logs: Record<string, string>; onSelect: (t: Target) => void;
  error: string | null; machines: { name: string; state: string }[];
}) {
  const [folded, toggle] = useFolded();
  const down = machines.filter((m) => m.state !== "connected");
  const stateOf = (name: string | null) => (name === null ? "connected" : machines.find((m) => m.name === name)?.state ?? "unknown");
  const health = useHealth(hosts.filter((h) => stateOf(h.machine) === "connected").map((h) => h.machine));
  // The health card beside a host's name, placed in the window (the list
  // scrolls and clips what sticks out of it).
  const [hoverHost, setHoverHost] = useState<{ id: string; x: number; y: number } | null>(null);
  const [sshHosts, setSshHosts] = useState<string[]>([]);
  useEffect(() => { core.sshHosts().then(setSshHosts).catch(() => {}); }, []);
  const choices = [...new Set([...machines.map((m) => m.name), ...sshHosts])].sort();
  const [starting, setStarting] = useState<{ machine: string | null; folder: string; group: string } | null>(null);
  useEffect(() => {
    const open = () => setStarting({ machine: null, folder: localStorage.getItem("new.folder") ?? "", group: "" });
    window.addEventListener("sheepy:new-session", open);
    return () => window.removeEventListener("sheepy:new-session", open);
  }, []);
  // Moving sessions: drag one onto a group of its host (or onto "New group").
  const [dragging, setDragging] = useState<Session | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null); // the session going into a new group
  const [groupName, setGroupName] = useState("");
  // Renaming a group: every session in it takes the new name.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const move = (address: string, group: string) => core.setGroup(address, group).then(() => setMoveError(null)).catch((e) => setMoveError(String(e)));
  const renameGroup = async (g: Win, name: string) => {
    setRenaming(null);
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean || clean === g.name) return;
    try {
      await Promise.all(g.sessions.map((s) => core.setGroup(s.address, clean)));
      setMoveError(null);
    } catch (e) { setMoveError(String(e)); }
  };

  const group = (h: Host, w: Win) => {
    const open = !folded.has(w.id);
    const first = w.sessions[0];
    const canDrop = dragging && dragging.machine === h.machine;
    return (
      <div key={w.id} className={`window ${over === w.id ? "drop" : ""}`}
        onDragOver={(e) => { if (canDrop) { e.preventDefault(); setOver(w.id); } }}
        onDragLeave={() => setOver((o) => (o === w.id ? null : o))}
        onDrop={(e) => { e.preventDefault(); setOver(null); if (canDrop) move(dragging!.address, w.name); }}>
        <div className="window-head">
          {renaming?.id === w.id ? (
            <input className="rename small" autoFocus value={renaming.name}
              onChange={(e) => setRenaming({ id: w.id, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") renameGroup(w, renaming.name); else if (e.key === "Escape") setRenaming(null); }}
              onBlur={() => setRenaming(null)} />
          ) : (
            <button className="window-toggle" onClick={() => toggle(w.id)} onDoubleClick={() => setRenaming({ id: w.id, name: w.name })} title="Double-click to rename">
              <span className={`chev ${open ? "open" : ""}`}>›</span>
              <span className="label">{w.name}</span>
              <span className="count">{w.sessions.length}</span>
              {!open && w.status !== "idle" && <StatusDot status={w.status} />}
            </button>
          )}
          <button className="add" title={`New session in ${w.name}`}
            onClick={() => setStarting({ machine: h.machine, folder: first?.cwd ?? "", group: w.name })}>+</button>
        </div>
        {open && w.sessions.map((s) => {
          const on = target?.address === s.address;
          return (
            <div key={s.address}>
              <button className={`row ${on && target?.kind === "session" ? "on" : ""}`} title={s.activity ?? s.title}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", s.address); e.dataTransfer.effectAllowed = "move"; setDragging(s); }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                onClick={() => onSelect({ kind: "session", address: s.address, title: s.title })}>
                <StatusDot status={s.status} />
                <span className="label">{s.title}</span>
              </button>
              {on && logs[s.address] && <SubAgents session={s} file={logs[s.address]} target={target} onSelect={onSelect} />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head" data-tauri-drag-region>
        <span style={{ flex: 1 }} data-tauri-drag-region />
        <button className="head-btn" title="New session" onClick={() => setStarting({ machine: null, folder: localStorage.getItem("new.folder") ?? "", group: "" })}>+</button>
        <button className="head-btn" title="Search every session (⌘⇧F)" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, shiftKey: true }))}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </button>
      </div>
      {error && <div className="banner">herdr-core: {error}</div>}
      {moveError && <div className="banner">{moveError}</div>}
      {down.map((m) => <div key={m.name} className="banner">{m.name} is {m.state}</div>)}
      {starting && (
        <NewSession hosts={choices} initial={starting} onDone={() => setStarting(null)}
          onStarted={(address, title) => onSelect({ kind: "session", address, title })} />
      )}
      <div className="sidebar-list">
        {hosts.every((h) => !h.groups.length) && !error && <div className="hint">No Claude Code sessions yet. Start one with +.</div>}
        {hosts.map((h) => {
          const open = !folded.has(h.id);
          const st = stateOf(h.machine);
          return (
            <div key={h.id} className="host">
              <div className="host-head"
                onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHoverHost({ id: h.id, x: r.right + 10, y: r.top }); }}
                onMouseLeave={() => setHoverHost((x) => (x?.id === h.id ? null : x))}>
                <button className="host-toggle" onClick={() => toggle(h.id)}>
                  <span className={`chev ${open ? "open" : ""}`}>›</span>
                  <span className={`dot ${st === "connected" ? "dot-done" : st === "connecting" ? "dot-working" : "dot-blocked"}`} />
                  <span className="label">{h.name}</span>
                  {!open && h.status !== "idle" && <StatusDot status={h.status} />}
                </button>
                <button className="add" title={`New session on ${h.name}`}
                  onClick={() => setStarting({ machine: h.machine, folder: "", group: "" })}>+</button>
                {hoverHost?.id === h.id && st === "connected" && (
                  <div className="health-card" style={{ position: "fixed", left: hoverHost.x, top: Math.min(hoverHost.y, window.innerHeight - 220) }}>
                    <div className="health-title">{h.name}</div><Health s={health[h.machine ?? ""] as any} />
                  </div>
                )}
              </div>
              {open && h.groups.map((w) => group(h, w))}
              {open && !h.groups.length && <div className="hint indent">No sessions</div>}
              {open && dragging && dragging.machine === h.machine && (
                <div className={`new-group ${over === `new:${h.id}` ? "drop" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(`new:${h.id}`); }}
                  onDragLeave={() => setOver((o) => (o === `new:${h.id}` ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); setNaming(dragging.address); setGroupName(""); }}>
                  Drop here for a new group
                </div>
              )}
            </div>
          );
        })}
        {naming && (
          <form className="new-group-name" onSubmit={(e) => { e.preventDefault(); if (groupName.trim()) move(naming, groupName); setNaming(null); }}>
            <input autoFocus value={groupName} placeholder="Name the new group" onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setNaming(null); }} onBlur={() => setNaming(null)} />
          </form>
        )}
      </div>
      <Machines live={machines} />
    </aside>
  );
}
