// Claude Code sessions from herdr-core's terminals, grouped: by the group the
// person put a session in (its "sheepy.group" label), else by the Herdr
// window (space and tab) it's in. Plain functions, tested in test/sessions.test.js.

/** The label that holds a session's group. */
export const GROUP_LABEL = "sheepy.group";

/** A group name as kept: one line, trimmed, at most 60 characters. */
export function cleanGroup(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** The agents Sheepy knows: how each is started, and what it's called. */
export const AGENTS = {
  claude: { label: "Claude Code", short: "Claude", argv: ["claude", "--dangerously-skip-permissions"] },
  codex: { label: "Codex", short: "Codex", argv: ["codex"] },
  kiro: { label: "Kiro", short: "Kiro", argv: ["kiro-cli", "chat"] },
};

/** Which agent a terminal runs (claude, codex, kiro), or null: its foreground program, else what it reports. */
export function agentOf(t) {
  if (t?.state !== "live") return null;
  const names = [
    t?.foreground?.name, (t?.foreground?.argv?.[0] ?? "").split("/").pop(),
    t?.agent, typeof t?.status === "object" ? t?.status?.app : null,
  ].map((x) => String(x ?? "").toLowerCase());
  if (names.some((n) => n === "claude" || n === "claude-code")) return "claude";
  if (names.some((n) => n === "codex")) return "codex";
  if (names.some((n) => n === "kiro-cli" || n === "kiro" || n === "kiro-cli-chat" || n === "q")) return "kiro";
  return null;
}

/** The terminal runs one of the agents. */
export function isClaude(t) {
  return agentOf(t) === "claude";
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
  const where = t?.labels?.where ?? t?.where ?? "";
  const [space, tab] = where.includes(" / ") ? where.split(" / ") : [where, ""];
  return { where, space: space || "Ungrouped", tab: tab || space || "Ungrouped" };
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
    const agent = agentOf(t);
    // Claude Code for now (Codex and Kiro come later).
    if (agent !== "claude") continue;
    const w = whereOf(t);
    const machine = t.address.includes("/") ? t.address.split("/")[0] : null;
    const own = cleanGroup(t.labels?.[GROUP_LABEL]);
    // Groups are a host's: the person's own, or the Herdr window it's in.
    const id = own ? `${machine ?? "local"}:group:${own}` : `${machine ?? "local"}:${t.labels?.["herdr.tab"] ?? w.where}`;
    if (!groups.has(id)) groups.set(id, { id, name: own || w.tab, space: own ? null : w.space, machine, own: Boolean(own), status: "idle", sessions: [] });
    const g = groups.get(id);
    const s = { address: t.address, title: sessionTitle(t), status: statusOf(t), activity: activityOf(t), machine, agent, cwd: t.foreground?.cwd ?? t.cwd ?? null, terminal: t };
    g.sessions.push(s);
    if (RANK[s.status] > RANK[g.status]) g.status = s.status;
  }
  // A group the person named like a Herdr window is that window (so a
  // session started in or moved to a window joins it).
  for (const [id, g] of [...groups]) {
    if (!g.own) continue;
    const win = [...groups.values()].find((w) => !w.own && w.machine === g.machine && w.name === g.name);
    if (!win) continue;
    win.sessions.push(...g.sessions);
    if (RANK[g.status] > RANK[win.status]) win.status = g.status;
    groups.delete(id);
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

/**
 * What herdr-core knows after an update. An event can carry only part of the
 * picture (no terminal list, say, when only a machine changed): what it
 * leaves out is kept from before, and lists are always lists.
 */
export function mergeFacts(prev, next) {
  const base = prev ?? { terminals: [], machines: [] };
  if (!next || typeof next !== "object") return base;
  return {
    ...base,
    ...next,
    terminals: Array.isArray(next.terminals) ? next.terminals : (base.terminals ?? []),
    machines: Array.isArray(next.machines) ? next.machines : (base.machines ?? []),
  };
}

/**
 * The groups under their host: [{ id, name, machine, status, groups }], this
 * computer first, then the other machines by name. `machines`: every machine
 * herdr-core reaches, so a host with no sessions is still listed.
 */
export function hosts(terminals, machines = []) {
  const list = windows(terminals);
  const byHost = new Map([[null, []]]);
  for (const m of machines ?? []) if (m?.name && !byHost.has(m.name)) byHost.set(m.name, []);
  for (const g of list) {
    if (!byHost.has(g.machine)) byHost.set(g.machine, []);
    byHost.get(g.machine).push(g);
  }
  return [...byHost.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([machine, groups]) => ({
      id: `host:${machine ?? "local"}`,
      name: machine ?? "This computer",
      machine,
      status: groups.reduce((s, g) => (RANK[g.status] > RANK[s] ? g.status : s), "idle"),
      groups,
    }));
}

/** Groups in the person's order (ids, as kept), the rest after them as they came. */
export function orderGroups(groups, order) {
  const at = new Map((order ?? []).map((id, i) => [id, i]));
  return [...(groups ?? [])].map((g, i) => ({ g, i })).sort((a, b) => {
    const x = at.has(a.g.id) ? at.get(a.g.id) : Infinity;
    const y = at.has(b.g.id) ? at.get(b.g.id) : Infinity;
    return x === y ? a.i - b.i : x - y;
  }).map((x) => x.g);
}

/** The order after moving group `id` to just before `before` (null: to the end). */
export function moveGroup(ids, id, before) {
  const rest = ids.filter((x) => x !== id);
  const at = before == null ? rest.length : rest.indexOf(before);
  rest.splice(at < 0 ? rest.length : at, 0, id);
  return rest;
}
