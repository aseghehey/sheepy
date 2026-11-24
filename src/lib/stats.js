// A machine's health: its stats (from src-tauri/src/stats.sh), how full is
// worrying, and when to alert. Tested in test/stats.test.js.



/** The stats script's key=value lines (see src-tauri/src/stats.sh) as an object. */
export function parseStats(stdout) {
  const out = { disks: [] };
  const mounts = new Set();
  for (const line of String(stdout ?? "").split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i), v = line.slice(i + 1);
    if (k === "disk") {
      const [mount, size, used] = v.split("|");
      if (!mounts.has(mount) && Number(size) > 0) { mounts.add(mount); out.disks.push({ mount, size: Number(size), used: Number(used) }); }
    } else if (k === "load") out.load = v.trim();
    else out[k] = Number(v);
  }
  return out;
}

// Apple's system colors: green while there's room, yellow getting full, red full.
export const level = (pct) => (pct >= 85 ? "#ff453a" : pct >= 60 ? "#ffd60a" : "#30d158");

export function duration(secs) {
  const m = Math.floor(secs / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

export const gb = (kb) => {
  const g = kb / 1048576;
  return g >= 1024 ? `${(g / 1024).toFixed(1)} TB` : g >= 10 ? `${Math.round(g)} GB` : `${g.toFixed(1)} GB`;
};

// When to alert: each threshold once on the way up (again only after usage
// falls a few points back below it). CPU only when it stays high.
export const ALERTS = { disk: [90, 95, 98], memory: [90, 95], cpu: 90, cpuMinutes: 5 };
const SLACK = 3;

// The highest threshold `pct` has reached, or 0.
const reached = (pct, steps) => steps.filter((s) => pct >= s).pop() ?? 0;

// A string as an AppleScript literal: quotes and backslashes escaped, control
// characters (which AppleScript can't take escaped) as spaces.
export const appleScriptString = (x) => `"${String(x ?? "").replace(/[\\"]/g, "\\$&").replace(/[\u0000-\u001f\u007f]/g, " ")}"`;

// New alerts for a machine's stats, given what was alerted before (`seen`,
// updated in place): [{ level, title, body }].
export function alertsFor(name, d, seen, now) {
  const out = [];
  // An alert when `pct` reaches a higher threshold than last time; null if not.
  const step = (key, pct, steps, what, body) => {
    if (!Number.isFinite(pct)) return null;
    const was = seen[key] ?? 0, at = reached(pct, steps);
    if (at > was) {
      seen[key] = at;
      const a = { level: at >= steps[steps.length - 1] ? "error" : "warning", title: `${name}: ${what} ${Math.round(pct)}% full`, body: body(at) };
      out.push(a);
      return a;
    }
    if (was && pct < was - SLACK) seen[key] = reached(pct + SLACK, steps); // fell back: a new crossing alerts again
    return null;
  };
  for (const k of d.disks ?? []) {
    if (!(k.size > 0)) continue;
    const mount = k.mount === "/System/Volumes/Data" ? "/" : k.mount;
    step(`disk:${mount}`, (100 * k.used) / k.size, ALERTS.disk, `disk ${mount}`,
      (at) => `Over ${at}%: ${gb(k.size - k.used)} free of ${gb(k.size)}.`);
  }
  if (d.mem_total > 0) {
    step("memory", (100 * d.mem_used) / d.mem_total, ALERTS.memory, "memory",
      () => `${gb(d.mem_used)} of ${gb(d.mem_total)} in use.`);
  }
  if (d.cpu != null) {
    // A gap in the readings (the machine was off, asleep or unreachable): high
    // before it and high after it isn't five minutes of it.
    if (seen.cpuSeen != null && now - seen.cpuSeen > 2 * 60000) seen.cpuSince = null;
    seen.cpuSeen = now;
    if (d.cpu >= ALERTS.cpu) {
      seen.cpuSince ??= now;
      if (!seen.cpuAlerted && now - seen.cpuSince >= ALERTS.cpuMinutes * 60000) {
        out.push({ level: "warning", title: `${name}: CPU over ${ALERTS.cpu}% for ${ALERTS.cpuMinutes} minutes`, body: `Now ${Math.round(d.cpu)}%${d.load ? `, load ${d.load.split(" ")[0]}` : ""}.` });
        seen.cpuAlerted = true;
      }
    } else if (d.cpu < ALERTS.cpu - 10) {
      seen.cpuSince = null;
      seen.cpuAlerted = false;
    }
  }
  return out;
}
