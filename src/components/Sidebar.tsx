import { useEffect, useState } from "react";
import { core, machineOf } from "../lib/core";
import { subagentRow } from "../lib/sessions.js";
import { Machines } from "./Machines";

export type Target =
  | { kind: "session"; address: string; title: string }
  | { kind: "subagent"; address: string; id: string; file: string; title: string; parentTitle: string };

interface Session { address: string; title: string; status: string; activity: string | null; machine: string | null }
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
  useEffect(() => {
    let alive = true;
    const load = () => core.subagents(machineOf(session.address), file)
      .then((l) => { if (alive) setRows(l.map(subagentRow).reverse()); })
      .catch(() => { if (alive) setRows([]); });
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [session.address, file]);
  if (!rows?.length) return null;
  return (
    <div className="subagents">
      {rows.map((r) => {
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
    </div>
  );
}

export function Sidebar({ windows, target, logs, onSelect, error, machines }: {
  windows: Win[]; target: Target | null; logs: Record<string, string>; onSelect: (t: Target) => void;
  error: string | null; machines: { name: string; state: string }[];
}) {
  const [folded, toggle] = useFolded();
  const many = new Set(windows.map((w) => w.machine)).size > 1;
  const down = machines.filter((m) => m.state !== "connected");
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">Sheepy</span>
      </div>
      {error && <div className="banner">herdr-core: {error}</div>}
      {down.map((m) => <div key={m.name} className="banner">{m.name} is {m.state}</div>)}
      <div className="sidebar-list">
        {windows.length === 0 && !error && <div className="hint">No Claude Code sessions in herdr-core yet.</div>}
        {windows.map((w) => {
          const open = !folded.has(w.id);
          return (
            <div key={w.id} className="window">
              <button className="window-head" onClick={() => toggle(w.id)}>
                <span className={`chev ${open ? "open" : ""}`}>›</span>
                <span className="label">{w.name}</span>
                <span className="count">{w.sessions.length}</span>
                {many && w.machine && <span className="meta">{w.machine}</span>}
                {!open && w.status !== "idle" && <StatusDot status={w.status} />}
              </button>
              {open && w.sessions.map((s) => {
                const on = target?.address === s.address;
                return (
                  <div key={s.address}>
                    <button className={`row ${on && target?.kind === "session" ? "on" : ""}`} title={s.activity ?? s.title}
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
        })}
      </div>
      <Machines live={machines} />
    </aside>
  );
}
