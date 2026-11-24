import { useEffect, useState } from "react";
import { core, type Machine } from "../lib/core";

const WORDS: Record<string, string> = { connected: "connected", connecting: "connecting…", unreachable: "can't reach it", login: "needs you to log in" };

// The machines herdr-core reaches: each with its state, and adding one by how
// ssh reaches it. Logging in again (a password or a code) happens in a
// terminal: `herdr-core machine login <name>`, which is shown to copy.
export function Machines({ live }: { live: { name: string; state: string }[] }) {
  const [list, setList] = useState<Machine[]>([]);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => core.machines().then((m) => setList(m.machines ?? [])).catch(() => {});
  useEffect(() => { load(); }, [live.map((m) => `${m.name}:${m.state}`).join(",")]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await core.machineAdd(target);
      setTarget("");
      setAdding(false);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stateOf = (m: Machine) => live.find((x) => x.name === m.name)?.state ?? m.state;
  return (
    <div className="machines">
      <div className="machines-head">
        <span>Machines</span>
        <button className="link" onClick={() => { setAdding(!adding); setError(null); }}>{adding ? "Cancel" : "+ Add"}</button>
      </div>
      <div className="machine"><span className="dot dot-done" /><span className="label">This computer</span></div>
      {list.map((m) => {
        const st = stateOf(m);
        return (
          <div key={m.name} className="machine" title={m.host ?? m.target}>
            <span className={`dot ${st === "connected" ? "dot-done" : st === "connecting" ? "dot-working" : "dot-blocked"}`} />
            <span className="label">{m.name}</span>
            <span className="meta">{WORDS[st] ?? st}</span>
          </div>
        );
      })}
      {list.filter((m) => !["connected", "connecting"].includes(stateOf(m))).map((m) => (
        <div key={`fix-${m.name}`} className="hint">
          To reconnect {m.name}, run in a terminal: <code>herdr-core machine login {m.name}</code>
        </div>
      ))}
      {adding && (
        <form className="machine-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input autoFocus value={target} placeholder="ssh host, e.g. my-server or me@10.0.0.7" onChange={(e) => setTarget(e.target.value)} disabled={busy} />
          <button type="submit" disabled={busy || !target.trim()}>{busy ? "Connecting…" : "Connect"}</button>
          {error && <div className="banner">{error}</div>}
          <div className="hint">Uses your ssh setup (keys, ~/.ssh/config). herdr-core is installed there if it isn't yet.</div>
        </form>
      )}
    </div>
  );
}
