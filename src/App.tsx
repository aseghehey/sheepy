import { useEffect, useMemo, useState } from "react";
import { core, type Facts } from "./lib/core";
import { windows } from "./lib/sessions.js";
import { Sidebar, type Target } from "./components/Sidebar";
import { Chat } from "./components/Chat";

export default function App() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(() => {
    try { return JSON.parse(localStorage.getItem("target") ?? "null"); } catch { return null; }
  });
  // Session log files by terminal address, once found (sub-agents live beside them).
  const [logs, setLogs] = useState<Record<string, string>>({});

  useEffect(() => {
    core.terminals().then(setFacts).catch((e) => setCoreError(String(e)));
    const off = core.onTerminals((f) => { setFacts(f); setCoreError(null); });
    return () => { off.then((u) => u()); };
  }, []);

  useEffect(() => { localStorage.setItem("target", JSON.stringify(target)); }, [target]);

  const list = useMemo(() => windows(facts?.terminals ?? []), [facts]);
  const terminal = target ? facts?.terminals.find((t) => t.address === target.address) ?? null : null;

  return (
    <div className="app">
      <Sidebar
        windows={list}
        target={target}
        logs={logs}
        onSelect={setTarget}
        error={coreError}
        machines={facts?.machines ?? []}
      />
      <main className="main">
        {target ? (
          <Chat
            key={target.kind === "subagent" ? `${target.address}:${target.id}` : target.address}
            target={target}
            terminal={terminal}
            onLog={(address, file) => setLogs((l) => (l[address] === file ? l : { ...l, [address]: file }))}
            onOpenSubagent={(t) => setTarget(t)}
          />
        ) : (
          <div className="empty">
            <div className="empty-title">Sheepy</div>
            <div className="empty-body">Pick a session on the left.</div>
          </div>
        )}
      </main>
    </div>
  );
}
