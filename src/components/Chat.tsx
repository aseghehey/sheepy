import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { core, machineOf, type Terminal, type SubAgent } from "../lib/core";
import { Transcript } from "../lib/parse.js";
import { statusOf, activityOf, subagentRow } from "../lib/sessions.js";
import { Markdown } from "./Markdown";
import { Composer } from "./Composer";
import { QuestionCard } from "./QuestionCard";
import { StatusDot, type Target } from "./Sidebar";
import { ViewMenu, type View } from "./ViewMenu";
import { viewStyle } from "../lib/view.js";
import { QuoteLayer, AnnotationTray, useAnnotations } from "./Annotations";
import { findEntries, queryWords, step } from "../lib/findin.js";
import { markWords } from "../lib/find.js";

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
    core.follow(id, machine, file, sidechain).catch((err) => setState((s) => ({ ...s, loading: false, error: String(err) })));
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

function EntryView({ e, subagents, onOpenSubagent, words }: { e: Entry; subagents: SubAgent[]; onOpenSubagent: (s: SubAgent) => void; words?: string[] }) {
  const mark = (t: string) => (words?.length ? markWords(t, words) : t);
  switch (e.kind) {
    case "user":
      return (
        <div className="msg-row mine">
          <div className={`bubble ${e.command ? "command" : ""}`}>
            {e.text && (e.command ? <code>{e.text}</code> : <Markdown text={mark(e.text)} />)}
            {(e.images ?? []).map((im: any, i: number) => <img key={i} className="msg-img" src={`data:image/${im.ext ?? "png"};base64,${im.data}`} />)}
          </div>
        </div>
      );
    case "assistant":
      return <div className="msg-row theirs"><Markdown text={mark(e.text)} /></div>;
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

export function Chat({ target, terminal, onLog, onOpenSubagent, view, setView }: {
  target: Target; terminal: Terminal | null;
  onLog: (address: string, file: string) => void; onOpenSubagent: (t: Target) => void;
  view: View; setView: (c: Partial<View>) => void;
}) {
  const machine = machineOf(target.address);
  const isSub = target.kind === "subagent";
  const pid = terminal?.foreground?.pid ?? null;

  // A session's log: found from its Claude Code process (again if that changes).
  const [file, setFile] = useState<string | null>(isSub ? target.file : null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [waitingForLog, setWaitingForLog] = useState(false);
  useEffect(() => {
    if (isSub) return setFile(target.file);
    if (!pid) return;
    // Claude Code writes a session's log with its first message: until then
    // there's none to find, so look again every two seconds.
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => core.locate(target.address, pid)
      .then((f) => {
        if (!alive) return;
        setLocateError(null);
        if (f) { setFile(f); onLog(target.address, f); }
        else { setFile(null); setWaitingForLog(true); timer = setTimeout(look, 2000); }
      })
      .catch((e) => { if (alive) { setLocateError(String(e)); timer = setTimeout(look, 5000); } });
    setWaitingForLog(false);
    look();
    return () => { alive = false; clearTimeout(timer); };
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
  // Entering a conversation: at its latest message. Rows are measured as they
  // draw, so the end moves for a moment; go there again once it has settled.
  const landedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !entries.length || landedFor.current === file) return;
    landedFor.current = file;
    const end = () => list.current?.scrollToIndex({ index: "LAST", align: "end" });
    // Not cleared when more lines arrive meanwhile (that reruns this effect);
    // after the chat closes, list.current is null and they do nothing.
    [50, 250, 700].forEach((ms) => setTimeout(end, ms));
  }, [loading, entries.length, file]);
  const [atBottom, setAtBottom] = useState(true);
  const status = terminal ? statusOf(terminal) : "idle";
  const title = isSub ? target.title : (transcript?.title ?? target.title);

  // Find in the conversation (⌘F): every entry with all the words; Enter goes
  // to the previous (older) match, Shift+Enter to the next.
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(-1);
  const findBox = useRef<HTMLInputElement>(null);
  const hits: number[] = useMemo(() => (finding ? findEntries(entries, query) : []), [finding, query, entries]);
  const words: string[] = useMemo(() => (finding ? queryWords(query) : []), [finding, query]);
  useEffect(() => { setHit(-1); }, [query]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setFinding(true); setTimeout(() => findBox.current?.select(), 0); }
      else if (e.metaKey && e.key === "g") { e.preventDefault(); go(e.shiftKey ? 1 : -1); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const go = (dir: number) => {
    const next = step(hits, hit, dir);
    setHit(next);
    if (next >= 0) list.current?.scrollToIndex({ index: hits[next], align: "center", behavior: "smooth" });
  };
  const notes = useAnnotations(target.address);
  const conv = useRef<HTMLDivElement>(null);

  // Renaming the session: Claude Code's /rename keeps the name in its log (so
  // search and its own resume list show it). Not while the agent shows a
  // menu, where the typed keys would pick an option.
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const rename = async () => {
    const name = newName.replace(/\s+/g, " ").trim();
    setRenaming(false);
    if (!name || name === title) return;
    if (status === "blocked") return setRenameError("The agent is waiting for an answer; rename the session once it has one.");
    try {
      await core.send(target.address, `/rename ${name}`);
      setRenameError(null);
      if (transcript) { transcript.title = name; transcript.named = true; }
    } catch (e) { setRenameError(String(e)); }
  };

  return (
    <div className="chat" style={viewStyle(view) as React.CSSProperties}>
      <header className="chat-head" data-tauri-drag-region>
        {isSub ? (
          <button className="back" onClick={() => onOpenSubagent({ kind: "session", address: target.address, title: target.parentTitle })}>‹ {target.parentTitle}</button>
        ) : <StatusDot status={status} />}
        {renaming ? (
          <input className="rename" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => { if (e.key === "Enter") rename(); else if (e.key === "Escape") setRenaming(false); }} />
        ) : (
          <div className={`chat-title ${isSub ? "" : "editable"}`} title={isSub ? undefined : "Double-click to rename the session"}
            onDoubleClick={() => { if (!isSub) { setNewName(title); setRenaming(true); } }}>{title}</div>
        )}
        <div className="chat-sub" style={{ flex: 1 }}>{isSub ? "sub-agent" : [machine ?? "this computer", terminal?.foreground?.cwd?.replace(/^\/(local\/)?home\/[^/]+/, "~")].filter(Boolean).join(" · ")}</div>
        <button className={`head-btn ${finding ? "on" : ""}`} title="Find in this conversation (⌘F)" onClick={() => { setFinding(!finding); setTimeout(() => findBox.current?.focus(), 0); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </button>
        <ViewMenu view={view} setView={setView} />
      </header>
      {finding && (
        <div className="find-bar">
          <input ref={findBox} autoFocus value={query} placeholder="Find in this conversation" spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? 1 : -1); }
              else if (e.key === "Escape") { e.preventDefault(); setFinding(false); setQuery(""); }
            }} />
          <span className="find-count">{query.trim() ? (hits.length ? `${hit >= 0 ? hit + 1 : "–"} of ${hits.length}` : "No matches") : ""}</span>
          <button onClick={() => go(-1)} title="Previous (Enter)" disabled={!hits.length}>↑</button>
          <button onClick={() => go(1)} title="Next (Shift+Enter)" disabled={!hits.length}>↓</button>
          <button onClick={() => { setFinding(false); setQuery(""); }} title="Close (Esc)">Done</button>
          {truncated && <span className="find-note">Searches what's loaded</span>}
        </div>
      )}
      <div className="conversation" ref={conv}>
        {!isSub && <QuoteLayer root={conv} onAdd={notes.add} />}
        {(locateError || error || renameError) && <div className="banner">{error ?? locateError ?? renameError}</div>}
        {loading && file && <div className="hint center">Loading…</div>}
        {!file && !isSub && (
          <div className="new-chat">
            {waitingForLog || !pid ? (
              <>
                <div className="new-chat-title">New conversation</div>
                <div className="hint center">Send a message to start. It shows here as soon as Claude Code writes it.</div>
              </>
            ) : <div className="hint center">Finding this session…</div>}
          </div>
        )}
        {!loading && <Virtuoso
          key={file ?? "none"}
          ref={list}
          className="virtuoso"
          data={entries}
          initialTopMostItemIndex={{ index: "LAST", align: "end" }}
          followOutput={(bottom) => (bottom ? "smooth" : false)}
          atBottomStateChange={setAtBottom}
          atBottomThreshold={80}
          increaseViewportBy={{ top: 800, bottom: 400 }}
          components={{ Header: () => (truncated ? <div className="hint center">Earlier messages aren't loaded.</div> : <div style={{ height: 12 }} />), Footer: () => <div style={{ height: 16 }} /> }}
          itemContent={(i, e) => (
            <div className={`entry ${hit >= 0 && hits[hit] === i ? "found" : ""}`}>
              <EntryView e={e} subagents={subagents} onOpenSubagent={openSub} words={hits.includes(i) ? words : undefined} />
            </div>
          )}
          computeItemKey={(_, e) => e.key}
        />}
        {!atBottom && (
          <button className="to-latest" onClick={() => list.current?.scrollToIndex({ index: entries.length - 1, behavior: "smooth", align: "end" })}>↓ Latest</button>
        )}
      </div>
      {!isSub && terminal && (
        <>
          {status === "working" && <div className="activity"><span className="spinner" /> {activityOf(terminal) ?? "Working…"}</div>}
          {status === "blocked" && <QuestionCard address={target.address} transcript={transcript} version={version} />}
          <AnnotationTray {...notes} />
          <Composer address={target.address} working={status === "working"} annos={notes.annos} onSentAnnos={notes.clear} />
        </>
      )}
      {isSub && <div className="readonly">A sub-agent's conversation, read-only.</div>}
    </div>
  );
}
