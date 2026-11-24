import { useEffect, useRef, useState } from "react";
import { core, type Terminal } from "../lib/core";
import { mergeResults, sessionLabel, snippetParts, archived, ago, terminalOfLive } from "../lib/palette.js";
import type { Target } from "./Sidebar";

type Tab = "search" | "archived";

/**
 * ⌘K: search what was said in every session on every machine (herdr-search),
 * or browse recent sessions that aren't running: resume one, or rename it.
 * Opening a running one goes to its conversation.
 */
export function Palette({ open, tab: initialTab = "search", onClose, machines, terminals, onOpen }: {
  open: boolean; tab?: Tab; onClose: () => void; machines: (string | null)[]; terminals: Terminal[];
  onOpen: (t: Target) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"best" | "recent">(() => (localStorage.getItem("palette.sort") === "recent" ? "recent" : "best"));
  const [results, setResults] = useState<any[]>([]);
  const [lists, setLists] = useState<{ machine: string | null; answer: any }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => { if (open) setTimeout(() => box.current?.select(), 0); }, [open, tab]);
  useEffect(() => { localStorage.setItem("palette.sort", sort); }, [sort]);

  // Every machine's sessions, for names and Archived (once per opening).
  useEffect(() => {
    if (!open) return;
    Promise.all(machines.map(async (m) => ({ machine: m, answer: await core.search(m, ["sessions", "--update", "--limit", "500"]).catch(() => null) })))
      .then(setLists);
  }, [open, machines.join(",")]);

  // Searching, a quarter second after typing stops; only the latest answer counts.
  useEffect(() => {
    if (!open || tab !== "search") return;
    const query = q.trim();
    if (!query) { setResults([]); return; }
    const id = ++run.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const order = sort === "recent" ? ["--recent"] : [];
      const answers = await Promise.all(machines.map(async (m) => ({
        machine: m,
        answer: await core.search(m, ["query", "--json", "--sessions", "15", "--hits", "3", ...order, query]).catch((e) => { setError(String(e)); return null; }),
      })));
      if (id !== run.current) return;
      setResults(mergeResults(answers, sort));
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, sort, open, tab, machines.join(",")]);

  const info = (machine: string | null, session: string) =>
    lists.find((l) => l.machine === machine)?.answer?.sessions?.find((s: any) => s.session === session);

  const openSession = async (machine: string | null, s: any) => {
    setError(null);
    const full = info(machine, s.session) ?? s;
    const running = terminalOfLive(full.live, machine, terminals);
    if (running) {
      onOpen({ kind: "session", address: running.address, title: sessionLabel(full) });
      return onClose();
    }
    try {
      setBusy(true);
      const address = await core.resume(machine, full.project ?? "", full.session, sessionLabel(full));
      onOpen({ kind: "session", address, title: sessionLabel(full) });
      onClose();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const rename = async (machine: string | null, s: any, name: string) => {
    const clean = name.replace(/\s+/g, " ").trim();
    setRenaming(null);
    if (!clean) return;
    try {
      await core.search(machine, ["rename", "--file", s.file, "--session", s.session, "--name", clean]);
      setLists((ls) => ls.map((l) => l.machine !== machine ? l : { ...l, answer: { ...l.answer, sessions: l.answer.sessions.map((x: any) => x.session === s.session ? { ...x, name: clean } : x) } }));
    } catch (e) { setError(String(e)); }
  };

  if (!open) return null;
  const rows = tab === "archived" ? archived(lists, q).slice(0, 200) : [];
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
        <div className="palette-tabs">
          <button className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>Search</button>
          <button className={tab === "archived" ? "on" : ""} onClick={() => setTab("archived")}>Archived</button>
          <span style={{ flex: 1 }} />
          {tab === "search" && (
            <div className="seg small">
              <button className={sort === "best" ? "on" : ""} onClick={() => setSort("best")}>Best</button>
              <button className={sort === "recent" ? "on" : ""} onClick={() => setSort("recent")}>Newest</button>
            </div>
          )}
        </div>
        <input ref={box} className="palette-input" value={q} spellCheck={false}
          placeholder={tab === "search" ? "Search every session (words, \"a phrase\", -not, in:folder, after:7d)" : "Filter by name or folder"}
          onChange={(e) => setQ(e.target.value)} />
        {error && <div className="banner">{error}</div>}
        <div className="palette-list">
          {tab === "search" && !q.trim() && <div className="hint">Type to search what was said in every session, on every machine.</div>}
          {tab === "search" && q.trim() && !busy && !results.length && <div className="hint">Nothing found.</div>}
          {tab === "search" && results.map((s) => {
            const full = info(s.machine, s.session) ?? s;
            const live = Boolean(full.live);
            return (
              <button key={`${s.machine}:${s.session}`} className="result" onClick={() => openSession(s.machine, s)}>
                <div className="result-head">
                  <span className={`dot ${live ? "dot-working" : ""}`} />
                  <span className="label">{sessionLabel(full)}</span>
                  <span className="meta">{[s.machine, ago(s.last_ts)].filter(Boolean).join(" · ")}</span>
                </div>
                {(s.hits ?? []).map((h: any, i: number) => (
                  <div key={i} className="snippet">
                    <span className="role">{h.role === "user" ? "You" : "Claude"}</span>
                    {snippetParts(h.snippet, h.highlights).map((p, j) => (p.hit ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>))}
                  </div>
                ))}
              </button>
            );
          })}
          {tab === "archived" && rows.map((s: any) => {
            const key = `${s.machine}:${s.session}`;
            return (
              <div key={key} className="result archived">
                <div className="result-head">
                  {renaming?.key === key ? (
                    <input className="rename" autoFocus value={renaming.name} onChange={(e) => setRenaming({ key, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") rename(s.machine, s, renaming.name); else if (e.key === "Escape") setRenaming(null); }}
                      onBlur={() => setRenaming(null)} />
                  ) : <span className="label">{s.label}</span>}
                  <span className="meta">{[s.machine, (s.project ?? "").split("/").filter(Boolean).pop(), ago(s.last_ts)].filter(Boolean).join(" · ")}</span>
                  <button className="link" onClick={() => setRenaming({ key, name: s.label })}>Rename</button>
                  <button className="link" disabled={busy} onClick={() => openSession(s.machine, s)}>Resume</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
