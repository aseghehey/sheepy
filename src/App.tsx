import { useEffect, useMemo, useState } from "react";
import { core, type Facts } from "./lib/core";
import { hosts, mergeFacts, withMoves, pendingMoves } from "./lib/sessions.js";
import { Sidebar, type Target } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Palette } from "./components/Palette";
import { CommandPalette } from "./components/CommandPalette";
import { useView } from "./components/ViewMenu";
import type { Machine } from "./lib/core";

export default function App() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(() => {
    try { return JSON.parse(localStorage.getItem("target") ?? "null"); } catch { return null; }
  });
  // Session log files by terminal address, once found (sub-agents live beside them).
  const [logs, setLogs] = useState<Record<string, string>>({});

  useEffect(() => {
    core.terminals().then((f) => setFacts((p) => mergeFacts(p, f))).catch((e) => setCoreError(String(e)));
    const off = core.onTerminals((f) => { setFacts((p) => mergeFacts(p, f)); setCoreError(null); });
    return () => { off.then((u) => u()); };
  }, []);

  useEffect(() => { localStorage.setItem("target", JSON.stringify(target)); }, [target]);

  const [view, setView] = useView();

  // The machines herdr-core reaches and their state (its events don't carry them).
  const [machineList, setMachineList] = useState<Machine[]>([]);
  useEffect(() => {
    const load = () => core.machines().then((m) => setMachineList(m.machines ?? [])).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  const machines = machineList.length ? machineList : (facts?.machines ?? []);

  // ⌘K: the command palette. ⌘⇧F: search every session (or Archived).
  const [commands, setCommands] = useState(false);
  const [search, setSearch] = useState<null | "search" | "archived">(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(null); setCommands((p) => !p); }
      else if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "r") { e.preventDefault(); window.location.reload(); }
      else if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setCommands(false); setSearch((s) => (s ? null : "search")); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Development only: open a session on request (see watch_snapshot_requests).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const off = import("@tauri-apps/api/event").then((ev) => ev.listen<string>("dev-open", (e) => setTarget({ kind: "session", address: e.payload, title: e.payload })));
    return () => { off.then((u) => u()); };
  }, []);

  // A newer Sheepy was installed while this one runs: offer to restart into it.
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const check = () => core.newerInstalled().then(setNewer).catch(() => {});
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, []);
  const reachable = useMemo(() => [null, ...machines.filter((m) => m.state === "connected").map((m) => m.name)], [machines]);

  // Moving sessions to a group shows at once; herdr-core's next picture
  // (asked for right away) confirms it, and a failed move goes back.
  const [moves, setMoves] = useState<Record<string, string>>({});
  useEffect(() => { setMoves((m) => (Object.keys(m).length ? (pendingMoves(facts?.terminals ?? [], m) as Record<string, string>) : m)); }, [facts]);
  const regroup = async (addresses: string[], group: string) => {
    setMoves((m) => ({ ...m, ...Object.fromEntries(addresses.map((a) => [a, group])) }));
    try {
      await Promise.all(addresses.map((a) => core.setGroup(a, group)));
    } catch (e) {
      setMoves((m) => Object.fromEntries(Object.entries(m).filter(([a]) => !addresses.includes(a))));
      throw e;
    } finally {
      core.refreshNow().catch(() => {});
    }
  };
  const list = useMemo(() => hosts(withMoves(facts?.terminals ?? [], moves), machines), [facts, moves, machines]);
  const terminal = target ? (facts?.terminals ?? []).find((t) => t.address === target.address) ?? null : null;

  return (
    <div className="app">
      {newer && (
        <div className="update-bar">
          A newer version of Sheepy is installed.
          <button onClick={() => core.restart()}>Restart now</button>
          <button className="link" onClick={() => setNewer(false)}>Later</button>
        </div>
      )}
      <Palette open={search !== null} tab={search ?? "search"} onClose={() => setSearch(null)} machines={reachable} terminals={facts?.terminals ?? []} onOpen={setTarget} />
      <CommandPalette open={commands} onClose={() => setCommands(false)} hosts={list} view={view} setView={setView}
        onOpen={setTarget} onSearch={(tab) => { setCommands(false); setSearch(tab); }} />
      <ErrorBoundary label="sidebar">
      <Sidebar
        hosts={list}
        target={target}
        logs={logs}
        onSelect={setTarget}
        onRegroup={regroup}
        onClosed={(addresses) => setTarget((t) => (t && addresses.includes(t.address) ? null : t))}
        error={coreError}
        machines={machines}
      />
      </ErrorBoundary>
      <main className="main">
        {target ? (
          <ErrorBoundary key={target.kind === "subagent" ? `${target.address}:${target.id}` : target.address} label="conversation">
          <Chat
            key={target.kind === "subagent" ? `${target.address}:${target.id}` : target.address}
            target={target}
            terminal={terminal}
            onLog={(address, file) => setLogs((l) => (l[address] === file ? l : { ...l, [address]: file }))}
            onOpenSubagent={(t) => setTarget(t)}
            view={view}
            setView={setView}
          />
          </ErrorBoundary>
        ) : (
          <div className="empty">
            <div className="empty-body">Pick a session on the left, or start one with +.</div>
          </div>
        )}
      </main>
    </div>
  );
}
