// ⌘K: searching every session on every machine, and the Archived list.
// Plain functions, tested in test/palette.test.js.

/**
 * One list from each machine's herdr-search answer: [{ machine, session,
 * project, file, best, last_ts, matches, hits }], best match first or newest
 * first. A machine that failed or has no herdr-search adds nothing.
 */
export function mergeResults(answers, sort = "best") {
  const all = [];
  for (const { machine, answer } of answers ?? []) {
    for (const s of answer?.sessions ?? []) all.push({ machine: machine ?? null, ...s });
  }
  const key = sort === "recent" ? (s) => s.last_ts ?? 0 : (s) => s.best ?? 0;
  return all.sort((a, b) => key(b) - key(a));
}

/** A session's name: the one the person gave it, else Claude Code's title, else how it began. */
export function sessionLabel(s) {
  const pick = [s?.name, s?.title, s?.first].find((x) => typeof x === "string" && x.trim());
  const label = (pick ?? "").replace(/\s+/g, " ").trim();
  return label.length > 90 ? `${label.slice(0, 89)}…` : label || (s?.session ?? "").slice(0, 8) || "Session";
}

/** A snippet with its highlighted ranges ([start, end) UTF-16 offsets) as parts. */
export function snippetParts(snippet, highlights) {
  const text = String(snippet ?? "");
  const parts = [];
  let at = 0;
  for (const [a, b] of [...(highlights ?? [])].sort((x, y) => x[0] - y[0])) {
    if (a < at || a >= b || b > text.length) continue;
    if (a > at) parts.push({ text: text.slice(at, a), hit: false });
    parts.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** Recent sessions that aren't running, newest first, matching `filter` in their name or folder. */
export function archived(lists, filter = "") {
  const f = filter.trim().toLowerCase();
  const out = [];
  for (const { machine, answer } of lists ?? []) {
    for (const s of answer?.sessions ?? []) {
      if (s.live) continue;
      const row = { machine: machine ?? null, ...s, label: sessionLabel(s) };
      if (f && !`${row.label} ${s.project ?? ""}`.toLowerCase().includes(f)) continue;
      out.push(row);
    }
  }
  return out.sort((a, b) => (b.last_ts ?? 0) - (a.last_ts ?? 0));
}

/** How long ago, briefly. */
export function ago(ts, now = Date.now()) {
  const m = Math.floor((now - (ts ?? 0)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`;
}

/** The running terminal of a live session: its Claude Code process, or one above it, in the foreground. */
export function terminalOfLive(live, machine, terminals) {
  if (!live) return null;
  const pids = new Set([live.pid, ...(live.ancestors ?? [])]);
  return (terminals ?? []).find((t) => {
    const m = t.address.includes("/") ? t.address.split("/")[0] : null;
    return m === (machine ?? null) && t.state === "live" && pids.has(t.foreground?.pid);
  }) ?? null;
}
