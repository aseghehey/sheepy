import { useEffect, useRef, useState } from "react";
import { core } from "../lib/core";
import { parseStats, level, duration, gb, alertsFor } from "../lib/stats.js";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

const WORDS: Record<string, string> = { connected: "connected", connecting: "connecting…", unreachable: "can't reach it", login: "needs you to log in" };
const EVERY = 60000;

type Stats = { [k: string]: any; disks: { mount: string; size: number; used: number }[]; at: number };

/** Every minute, each reachable machine's health; alerts when it crosses a threshold. */
export function useHealth(names: (string | null)[]) {
  const [stats, setStats] = useState<Record<string, Stats | { error: string; at: number }>>({});
  const seen = useRef<Record<string, any>>((() => { try { return JSON.parse(localStorage.getItem("alerted") ?? "{}"); } catch { return {}; } })());
  useEffect(() => {
    let alive = true;
    const check = async () => {
      for (const m of names) {
        const key = m ?? "";
        try {
          const d = { ...parseStats(await core.machineStats(m)), at: Date.now() };
          if (!alive) return;
          setStats((s) => ({ ...s, [key]: d }));
          const alerts = alertsFor(m ?? "This computer", d, (seen.current[key] ??= {}), Date.now());
          localStorage.setItem("alerted", JSON.stringify(seen.current));
          if (alerts.length && (await isPermissionGranted() || (await requestPermission()) === "granted")) {
            for (const a of alerts) sendNotification({ title: a.title, body: a.body });
          }
        } catch (e) {
          if (alive) setStats((s) => ({ ...s, [key]: { error: String(e), at: Date.now() } }));
        }
      }
    };
    check();
    const t = setInterval(check, EVERY);
    return () => { alive = false; clearInterval(t); };
  }, [names.join(",")]);
  return stats;
}

function Bar({ pct }: { pct: number }) {
  return <span className="bar"><span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: level(pct) }} /></span>;
}

export function Health({ s }: { s: Stats | { error: string } | undefined }) {
  if (!s) return <div className="health hint">Reading…</div>;
  if ("error" in s) return <div className="health hint">Couldn't read it: {s.error}</div>;
  const mem = s.mem_total > 0 ? (100 * s.mem_used) / s.mem_total : null;
  return (
    <div className="health">
      {s.uptime != null && <div className="stat"><span>Up</span><span className="v">{duration(s.uptime)}</span></div>}
      {s.cpu != null && <div className="stat"><span>CPU</span><Bar pct={s.cpu} /><span className="v">{Math.round(s.cpu)}%</span></div>}
      {s.load && <div className="stat"><span>Load</span><span className="v">{s.load}{s.ncpu ? ` · ${s.ncpu} cores` : ""}</span></div>}
      {mem != null && <div className="stat"><span>Memory</span><Bar pct={mem} /><span className="v">{gb(s.mem_used)} of {gb(s.mem_total)}</span></div>}
      {(s.disks ?? []).map((d: any) => {
        const pct = (100 * d.used) / d.size;
        return <div key={d.mount} className="stat"><span>{d.mount === "/System/Volumes/Data" ? "Disk" : `Disk ${d.mount}`}</span><Bar pct={pct} /><span className="v">{gb(d.size - d.used)} free</span></div>;
      })}
    </div>
  );
}

// Adding a machine by how ssh reaches it, and how to log in again to one
// that needs it (a password or a code, in a terminal). The machines
// themselves, with their health on hover, are the sidebar's host headers.
export function Machines({ live }: { live: { name: string; state: string }[] }) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await core.machineAdd(target);
      setTarget("");
      setAdding(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const needLogin = live.filter((m) => !["connected", "connecting"].includes(m.state));
  return (
    <div className="machines">
      {needLogin.map((m) => (
        <div key={`fix-${m.name}`} className="hint">
          {m.name}: {WORDS[m.state] ?? m.state}. To reconnect, run in a terminal: <code>herdr-core machine login {m.name}</code>
        </div>
      ))}
      {adding ? (
        <form className="machine-add" onSubmit={(e) => { e.preventDefault(); add(); }} onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}>
          <input autoFocus value={target} placeholder="ssh host, e.g. my-server or me@10.0.0.7" onChange={(e) => setTarget(e.target.value)} disabled={busy} />
          <div className="form-actions">
            <button type="button" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !target.trim()}>{busy ? "Connecting…" : "Connect"}</button>
          </div>
          {error && <div className="banner">{error}</div>}
          <div className="hint">Uses your ssh setup (keys, ~/.ssh/config). herdr-core is installed there if it isn't yet.</div>
        </form>
      ) : (
        <button className="link add-machine" onClick={() => { setAdding(true); setError(null); }}>+ Add machine</button>
      )}
    </div>
  );
}
