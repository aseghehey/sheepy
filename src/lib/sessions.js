// Claude Code sessions from herdr-core's terminals, grouped by window: the
// Herdr space and tab a terminal is in ("where": "space / tab"). Plain
// functions, tested in test/sessions.test.js.

/** The terminal runs Claude Code (as its foreground program or as reported). */
export function isClaude(t) {
  const fg = (t?.foreground?.name ?? "").toLowerCase();
  const argv0 = (t?.foreground?.argv?.[0] ?? "").split("/").pop().toLowerCase();
  const app = typeof t?.status === "object" ? (t?.status?.app ?? "") : "";
  return t?.state === "live" && (fg === "claude" || argv0 === "claude" || t?.agent === "claude-code" || app === "claude-code");
}

/** working | blocked | done | idle, from what herdr-core reports. */
export function statusOf(t) {
  const s = typeof t?.status === "object" ? t?.status?.state : t?.status;
  if (s === "working" || s === "blocked" || s === "done") return s;
  if (s === "error") return "blocked";
  return "idle";
}

/** What the agent says it's doing now, if anything. */
export function activityOf(t) {
  return typeof t?.status === "object" ? (t.status.msg ?? null) : null;
}

/** A session's name: its terminal's title (Claude Code sets it from the session's name), else its folder's last part. */
export function sessionTitle(t) {
  // Status glyphs off, but not a path's leading ~ or /.
  const title = (t?.title ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}~/]+/u, "").trim();
  if (title && !/^[~/]/.test(title) && title.toLowerCase() !== "claude" && title.toLowerCase() !== "claude code") return title;
  const cwd = t?.foreground?.cwd ?? t?.cwd ?? "";
  return cwd.split("/").filter(Boolean).pop() ?? t?.address ?? "Session";
}

/** The window ("space / tab") and its parts. */
export function whereOf(t) {
  const where = t?.labels?.where ?? "";
  const [space, tab] = where.includes(" / ") ? where.split(" / ") : [where, ""];
  return { where, space: space || "Other", tab: tab || space || "Other" };
}

const RANK = { blocked: 3, working: 2, done: 1, idle: 0 };

/**
 * [{ id, name, space, machine, status, sessions: [{ address, title, status, activity, machine, terminal }] }]
 * Windows in the order their first session appears; within a window, sessions
 * by address. A window's status is its most urgent session's.
 */
export function windows(terminals) {
  const groups = new Map();
  for (const t of terminals ?? []) {
    if (!isClaude(t)) continue;
    const w = whereOf(t);
    const machine = t.address.includes("/") ? t.address.split("/")[0] : null;
    const id = `${machine ?? "local"}:${t.labels?.["herdr.tab"] ?? w.where}`;
    if (!groups.has(id)) groups.set(id, { id, name: w.tab, space: w.space, machine, status: "idle", sessions: [] });
    const g = groups.get(id);
    const s = { address: t.address, title: sessionTitle(t), status: statusOf(t), activity: activityOf(t), machine, terminal: t };
    g.sessions.push(s);
    if (RANK[s.status] > RANK[g.status]) g.status = s.status;
  }
  for (const g of groups.values()) g.sessions.sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
  return [...groups.values()];
}

/** A sub-agent's row: what it was asked to do, its type, whether it finished. */
export function subagentRow(s) {
  const m = s?.meta ?? {};
  return {
    id: s.id,
    file: s.file,
    title: (typeof m.description === "string" && m.description.trim()) || `Agent ${s.id.slice(0, 7)}`,
    type: typeof m.agentType === "string" ? m.agentType : null,
    finished: m.finished === true,
    toolUseId: typeof m.toolUseId === "string" ? m.toolUseId : null,
    mtime: s.mtime ?? 0,
  };
}
