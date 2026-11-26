import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { core, machineOf } from "../lib/core";
import { agentOf } from "../lib/sessions.js";
import { EFFORTS, MODEL_CHOICES, OUTPUT_STYLES, shownModel, modelLabel, validModel } from "../lib/models.js";

export type ModelLog = { model: string | null; effort: string | null; at: string | null };
export type ModelChange = { model?: string; effort?: string; at: number };
export type Shown = { model: string | null; effort: string | null; pending: boolean };

/**
 * Each Claude Code session's model and effort, by terminal address: read
 * from its log every 20 s (one call per machine), with the changes made
 * from here shown at once.
 */
export function useModels(terminals: any[]) {
  const [logs, setLogs] = useState<Record<string, ModelLog>>({});
  const [changes, setChanges] = useState<Record<string, ModelChange>>({});
  // Claude Code sessions with a process, by machine.
  const byMachine = useMemo(() => {
    const out: Record<string, { address: string; pid: number }[]> = {};
    for (const t of terminals ?? []) {
      const pid = t?.foreground?.pid;
      if (!pid || agentOf(t) !== "claude") continue;
      (out[machineOf(t.address) ?? ""] ??= []).push({ address: t.address, pid });
    }
    return out;
  }, [terminals]);
  const key = JSON.stringify(byMachine);
  const read = useCallback(async () => {
    const found: Record<string, ModelLog> = {};
    await Promise.all(Object.entries(byMachine).map(async ([m, list]) => {
      try {
        const got = await core.models(m || null, list.map((s) => s.pid));
        for (const g of got) {
          const s = list.find((x) => x.pid === g.pid);
          if (s) found[s.address] = { model: g.model, effort: g.effort, at: g.at };
        }
      } catch { /* a machine out of reach: keep what was known */ }
    }));
    setLogs((l) => ({ ...l, ...found }));
  }, [key]);
  useEffect(() => {
    read();
    const t = setInterval(read, 20000);
    return () => clearInterval(t);
  }, [read]);
  const shown = useCallback((address: string): Shown => shownModel(logs[address], changes[address]), [logs, changes]);
  const changed = useCallback((address: string, c: Omit<ModelChange, "at">) => {
    setChanges((all) => ({ ...all, [address]: { ...all[address], ...c, at: Date.now() } }));
  }, []);
  return { shown, changed, read };
}

// The chat header's model chip: what this session runs with, and a menu to
// change it. Changes go to Claude Code as /model, /effort and /output-style,
// as if typed: /model is then also the default for new sessions.
export function ModelMenu({ address, status, shown, onChanged }: {
  address: string; status: string; shown: Shown; onChanged: (c: { model?: string; effort?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  const ready = status === "idle" || status === "done";
  const run = async (command: string, change?: { model?: string; effort?: string }) => {
    setError(null);
    try {
      await core.send(address, command);
      if (change) onChanged(change);
      setOpen(false);
    } catch (e) { setError(String(e).replace(/^blocked: /, "")); }
  };
  const label = modelLabel(shown);
  return (
    <div className="view-menu model-menu" ref={box}>
      <button className={`model-chip ${open ? "on" : ""} ${shown.pending ? "pending" : ""}`} onClick={() => setOpen(!open)}
        title={label ? `Model and effort${shown.pending ? " (just changed; Claude confirms it with its next reply)" : ""}` : "Model and effort show after Claude's first reply"}>
        {label ?? "Model…"}
      </button>
      {open && (
        <div className="popover model-pop">
          {!ready && <div className="pop-note">Claude is {status === "blocked" ? "waiting on a question" : "working"}: change these once it's ready.</div>}
          <div className="pop-heading">Model</div>
          {MODEL_CHOICES.map((m) => (
            <button key={m.id} className="pop-item" disabled={!ready} onClick={() => run(`/model ${m.id}`, { model: m.id })}>
              <span className="check">{shown.model && m.label.replace(" (1M context)", " (1M)") === shown.model ? "✓" : ""}</span>{m.label}
            </button>
          ))}
          <form className="pop-other" onSubmit={(e) => { e.preventDefault(); const v = other.trim(); if (validModel(v)) { run(`/model ${v}`, { model: v }); setOther(""); } else setError("Not a model name"); }}>
            <input value={other} placeholder="Other model id" disabled={!ready} onChange={(e) => setOther(e.target.value)} spellCheck={false} />
          </form>
          <div className="pop-heading">Effort</div>
          <div className="seg">
            {EFFORTS.map((e) => (
              <button key={e} className={shown.effort === e ? "on" : ""} disabled={!ready} onClick={() => run(`/effort ${e}`, { effort: e })}>{e}</button>
            ))}
          </div>
          <div className="pop-heading">Output style</div>
          <div className="seg">
            {OUTPUT_STYLES.map((s) => (
              <button key={s} disabled={!ready} onClick={() => run(`/output-style ${s}`)}>{s}</button>
            ))}
          </div>
          <div className="pop-note">Sent to Claude as /model, /effort and /output-style. Like typing them, a model chosen here is also your default for new sessions.</div>
          {error && <div className="banner">{error}</div>}
        </div>
      )}
    </div>
  );
}
