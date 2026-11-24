import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { core, machineOf, type Terminal, type SubAgent } from "../lib/core";
import { Transcript } from "../lib/parse.js";
import { statusOf, activityOf, subagentRow } from "../lib/sessions.js";
import { Markdown } from "./Markdown";
import { Composer } from "./Composer";
import { QuestionCard } from "./QuestionCard";
import { StatusDot, type Target } from "./Sidebar";

type Entry = any;

/** Follows a log: its transcript, re-read when the log is rewritten. */
function useTranscript(id: string, machine: string | null, file: string | null, sidechain: boolean) {
  const t = useRef<any>(null);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ loading: boolean; error: string | null; truncated: boolean; from: number }>({ loading: true, error: null, truncated: false, from: 0 });
  useEffect(() => {
    if (!file) return;
    t.current = new Transcript("claude", { sidechain });
    setState({ loading: true, error: null, truncated: false, from: 0 });
    let alive = true;
    const off = core.onLog((e) => {
      if (!alive || e.id !== id) return;
      if (e.error) return setState((s) => ({ ...s, loading: false, error: String(e.error) }));
      if (e.reset || e.first) t.current = new Transcript("claude", { sidechain });
      for (const l of e.lines ?? []) t.current.feed(l.line, l.at);
      if (e.first) setState({ loading: false, error: null, truncated: Boolean(e.truncated), from: e.from ?? 0 });
      else setState((s) => (s.error ? { ...s, error: null } : s));
      setVersion((v) => v + 1);
    });
    core.follow(id, machine, file).catch((err) => setState((s) => ({ ...s, loading: false, error: String(err) })));
    return () => { alive = false; off.then((u) => u()); core.unfollow(id); };
  }, [id, machine, file, sidechain]);
  return { transcript: t.current, version, ...state };
}

function ToolGroup({ items, subagents, onOpenSubagent }: { items: any[]; subagents: SubAgent[]; onOpenSubagent: (s: SubAgent) => void }) {
  const [open, setOpen] = useState(false);
  const names = [...new Set(items.map((i) => i.name))].join(", ");
  return (
    <div className="tools">
      <button className="tools-head" onClick={() => setOpen(!open)}>
        <span className={`chev ${open ? "open" : ""}`}>›</span>
        {items.length} tool call{items.length === 1 ? "" : "s"} · {names}
      </button>
      {items.filter((i) => i.name === "Task" || i.name === "Agent").map((i) => {
        const sub = subagents.find((s) => s.meta?.toolUseId === i.id);
        return sub ? (
          <button key={i.id} className="subagent-link" onClick={() => onOpenSubagent(sub)}>
            ↳ Sub-agent: {subagentRow(sub).title}
          </button>
        ) : null;
      })}
      {open && items.map((i, n) => (
        <div key={i.id ?? n} className={`tool ${i.error ? "tool-error" : ""}`}>
          <div className="tool-name">{i.name} <span className="tool-summary">{i.summary}</span></div>
          {i.result != null && <pre className="tool-result">{String(i.result).slice(0, 4000)}</pre>}
        </div>
      ))}
    </div>
  );
}

function EntryView({ e, subagents, onOpenSubagent }: { e: Entry; subagents: SubAgent[]; onOpenSubagent: (s: SubAgent) => void }) {
  switch (e.kind) {
    case "user":
      return (
        <div className="msg-row mine">
          <div className={`bubble ${e.command ? "command" : ""}`}>
            {e.text && (e.command ? <code>{e.text}</code> : <Markdown text={e.text} />)}
            {(e.images ?? []).map((im: any, i: number) => <img key={i} className="msg-img" src={`data:image/${im.ext ?? "png"};base64,${im.data}`} />)}
          </div>
        </div>
      );
    case "assistant":
      return <div className="msg-row theirs"><Markdown text={e.text} /></div>;
    case "tools":
      return <ToolGroup items={e.items} subagents={subagents} onOpenSubagent={onOpenSubagent} />;
    case "note":
      return <div className="note">{e.text}{e.summary && <details><summary>Summary</summary><Markdown text={e.summary} /></details>}</div>;
    case "output":
      return <pre className="output">{e.text}</pre>;
    case "card":
      return e.card === "context" ? <div className="note">Context: {e.used} / {e.max} ({e.pct}%)</div> : null;
    default:
      return null;
  }
}

export function Chat({ target, terminal, onLog, onOpenSubagent }: {
  target: Target; terminal: Terminal | null;
  onLog: (address: string, file: string) => void; onOpenSubagent: (t: Target) => void;
}) {
  const machine = machineOf(target.address);
  const isSub = target.kind === "subagent";
  const pid = terminal?.foreground?.pid ?? null;

  // A session's log: found from its Claude Code process (again if that changes).
  const [file, setFile] = useState<string | null>(isSub ? target.file : null);
  const [locateError, setLocateError] = useState<string | null>(null);
  useEffect(() => {
    if (isSub) return setFile(target.file);
    if (!pid) return;
    let alive = true;
    core.locate(target.address, pid)
      .then((f) => { if (!alive) return; setFile(f); setLocateError(f ? null : "Couldn't find this session's log yet."); if (f) onLog(target.address, f); })
      .catch((e) => alive && setLocateError(String(e)));
    return () => { alive = false; };
  }, [target.address, pid, isSub]);

  const followId = isSub ? `sub:${target.address}:${target.id}` : `session:${target.address}`;
  const { transcript, version, loading, error, truncated } = useTranscript(followId, machine, file, isSub);
  const entries: Entry[] = useMemo(() => (transcript?.entries ?? []).slice(), [transcript, version]);

  // The session's sub-agents, to link each Task call to its own transcript.
  const [subagents, setSubagents] = useState<SubAgent[]>([]);
  useEffect(() => {
    if (isSub || !file) return;
    core.subagents(machine, file).then(setSubagents).catch(() => {});
  }, [file, isSub, machine, Math.floor(version / 20)]);
  const openSub = useCallback((s: SubAgent) => {
    onOpenSubagent({ kind: "subagent", address: target.address, id: s.id, file: s.file, title: subagentRow(s).title, parentTitle: target.title });
  }, [target.address, target.title]);

  const list = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const status = terminal ? statusOf(terminal) : "idle";
  const title = isSub ? target.title : (transcript?.title ?? target.title);

  return (
    <div className="chat">
      <header className="chat-head">
        {isSub ? (
          <button className="back" onClick={() => onOpenSubagent({ kind: "session", address: target.address, title: target.parentTitle })}>‹ {target.parentTitle}</button>
        ) : <StatusDot status={status} />}
        <div className="chat-title">{title}</div>
        <div className="chat-sub">{isSub ? "sub-agent" : [machine ?? "this computer", terminal?.foreground?.cwd?.replace(/^\/(local\/)?home\/[^/]+/, "~")].filter(Boolean).join(" · ")}</div>
      </header>
      <div className="conversation">
        {(locateError || error) && <div className="banner">{error ?? locateError}</div>}
        {loading && file && <div className="hint center">Loading…</div>}
        <Virtuoso
          ref={list}
          className="virtuoso"
          data={entries}
          initialTopMostItemIndex={Math.max(0, entries.length - 1)}
          followOutput={(bottom) => (bottom ? "smooth" : false)}
          atBottomStateChange={setAtBottom}
          atBottomThreshold={80}
          increaseViewportBy={{ top: 800, bottom: 400 }}
          components={{ Header: () => (truncated ? <div className="hint center">Earlier messages aren't loaded.</div> : <div style={{ height: 12 }} />), Footer: () => <div style={{ height: 16 }} /> }}
          itemContent={(_, e) => <div className="entry"><EntryView e={e} subagents={subagents} onOpenSubagent={openSub} /></div>}
          computeItemKey={(_, e) => e.key}
        />
        {!atBottom && (
          <button className="to-latest" onClick={() => list.current?.scrollToIndex({ index: entries.length - 1, behavior: "smooth", align: "end" })}>↓ Latest</button>
        )}
      </div>
      {!isSub && terminal && (
        <>
          {status === "working" && <div className="activity"><span className="spinner" /> {activityOf(terminal) ?? "Working…"}</div>}
          {status === "blocked" && <QuestionCard address={target.address} transcript={transcript} version={version} />}
          <Composer address={target.address} working={status === "working"} />
        </>
      )}
      {isSub && <div className="readonly">A sub-agent's conversation, read-only.</div>}
    </div>
  );
}
