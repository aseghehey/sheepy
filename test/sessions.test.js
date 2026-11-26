import { test } from "node:test";
import assert from "node:assert/strict";
import { isClaude, statusOf, activityOf, sessionTitle, whereOf, windows, subagentRow } from "../src/lib/sessions.js";

const term = (address, extra = {}) => ({
  address, state: "live", agent: "claude-code", title: "", cwd: "/home/me",
  foreground: { name: "claude", argv: ["claude", "-r"], cwd: "/home/me/dms", pid: 10 },
  labels: { where: "dms / Library work", "herdr.tab": "tb1" },
  status: { app: "claude-code", state: "done" },
  ...extra,
});

test("Claude Code terminals, live only", () => {
  assert.ok(isClaude(term("t1")));
  assert.ok(isClaude(term("t1", { agent: null, foreground: { name: "node", argv: ["/usr/bin/claude"] } })));
  assert.ok(!isClaude(term("t1", { state: "exited" })));
  assert.ok(!isClaude({ address: "t2", state: "live", foreground: { name: "zsh" }, status: null }));
});

test("status words", () => {
  assert.equal(statusOf(term("t", { status: { state: "working" } })), "working");
  assert.equal(statusOf(term("t", { status: { state: "error" } })), "blocked");
  assert.equal(statusOf(term("t", { status: "blocked" })), "blocked");
  assert.equal(statusOf(term("t", { status: null })), "idle");
});

test("a session's name is its title, never a path or the program", () => {
  assert.equal(sessionTitle(term("t", { title: "✳ Fix the login" })), "Fix the login");
  assert.equal(sessionTitle(term("t", { title: "~/projects/dms" })), "dms");
  assert.equal(sessionTitle(term("t", { title: "Claude Code" })), "dms");
  assert.equal(sessionTitle(term("t", { title: null, foreground: null, cwd: "/a/b" })), "b");
});

test("where: space and tab", () => {
  assert.deepEqual(whereOf(term("t")), { where: "dms / Library work", space: "dms", tab: "Library work" });
  assert.deepEqual(whereOf(term("t", { labels: {} })), { where: "", space: "Ungrouped", tab: "Ungrouped" });
  assert.deepEqual(whereOf(term("t", { labels: { where: "solo" } })), { where: "solo", space: "solo", tab: "solo" });
});

test("sessions grouped by window, the window as urgent as its most urgent session", () => {
  const list = windows([
    term("vps/t10", { labels: { where: "dms / Library work", "herdr.tab": "tb1" }, status: { state: "done" } }),
    term("vps/t2", { labels: { where: "dms / Library work", "herdr.tab": "tb1" }, status: { state: "blocked" } }),
    term("vps/t3", { labels: { where: "infra / Deploy", "herdr.tab": "tb2" } }),
    { address: "vps/t4", state: "live", foreground: { name: "zsh" } },
    term("t5", { labels: { where: "dms / Library work", "herdr.tab": "tb1" } }),
  ]);
  assert.deepEqual(list.map((w) => [w.id, w.name, w.status, w.sessions.map((s) => s.address)]), [
    ["vps:tb1", "Library work", "blocked", ["vps/t2", "vps/t10"]],
    ["vps:tb2", "Deploy", "done", ["vps/t3"]],
    ["local:tb1", "Library work", "done", ["t5"]],
  ]);
  assert.equal(list[0].machine, "vps");
  assert.equal(list[2].machine, null);
});

test("sub-agent rows from their metadata", () => {
  assert.deepEqual(subagentRow({ id: "a9d536708fe67e8ab", file: "/x.jsonl", mtime: 5, meta: { description: "Inventory the reviews", agentType: "general-purpose", finished: true, toolUseId: "toolu_1" } }),
    { id: "a9d536708fe67e8ab", file: "/x.jsonl", title: "Inventory the reviews", type: "general-purpose", finished: true, toolUseId: "toolu_1", mtime: 5 });
  assert.equal(subagentRow({ id: "abcdef1234", file: "/y", meta: {} }).title, "Agent abcdef1");
});

import { mergeFacts } from "../src/lib/sessions.js";

test("an update without a terminal list keeps the one from before", () => {
  const a = mergeFacts(null, { terminals: [{ address: "t1" }], machines: [{ name: "m", state: "connected" }], seq: 1 });
  const b = mergeFacts(a, { channel: null, seq: 2 });
  assert.deepEqual(b.terminals, [{ address: "t1" }]);
  assert.deepEqual(b.machines, [{ name: "m", state: "connected" }]);
  assert.equal(b.seq, 2);
  const c = mergeFacts(b, { terminals: null, machines: [{ name: "m", state: "unreachable" }] });
  assert.deepEqual(c.terminals, [{ address: "t1" }]);
  assert.equal(c.machines[0].state, "unreachable");
  assert.deepEqual(mergeFacts(null, null), { terminals: [], machines: [] });
  assert.deepEqual(mergeFacts(null, "garbage"), { terminals: [], machines: [] });
});

import { cleanGroup, GROUP_LABEL } from "../src/lib/sessions.js";

test("a session the person moved into a group is listed there on its host, whatever its Herdr window", () => {
  const list = windows([
    term("vps/t1", { labels: { where: "dms / Library work", "herdr.tab": "tb1", [GROUP_LABEL]: "  Release   week " } }),
    term("t2", { labels: { where: "infra / Deploy", "herdr.tab": "tb2", [GROUP_LABEL]: "Release week" } }),
    term("vps/t3", { labels: { where: "dms / Library work", "herdr.tab": "tb1" } }),
  ]);
  assert.deepEqual(list.map((w) => [w.id, w.name, w.own, w.sessions.map((s) => s.address)]), [
    ["vps:group:Release week", "Release week", true, ["vps/t1"]],
    ["local:group:Release week", "Release week", true, ["t2"]],
    ["vps:tb1", "Library work", false, ["vps/t3"]],
  ]);
  assert.equal(list[0].machine, "vps", "a group belongs to its host");
});

test("group names are kept as one tidy line", () => {
  assert.equal(cleanGroup("  a\n b  "), "a b");
  assert.equal(cleanGroup("x".repeat(80)).length, 60);
  assert.equal(cleanGroup(null), "");
});

test("a group named like a Herdr window joins that window", () => {
  const list = windows([
    term("vps/t1", { labels: { where: "dms / Library work", "herdr.tab": "tb1" } }),
    term("vps/t9", { labels: { [GROUP_LABEL]: "Library work" }, status: { state: "blocked" } }),
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "vps:tb1");
  assert.deepEqual(list[0].sessions.map((s) => s.address), ["vps/t1", "vps/t9"]);
  assert.equal(list[0].status, "blocked");
});

import { agentOf, hosts, AGENTS } from "../src/lib/sessions.js";

test("Claude Code, Codex and Kiro terminals are all agents", () => {
  assert.equal(agentOf(term("t", { foreground: { name: "codex", argv: ["codex"] }, agent: null, status: null })), "codex");
  assert.equal(agentOf(term("t", { foreground: { name: "kiro-cli", argv: ["/home/me/.local/bin/kiro-cli", "chat"] }, agent: null, status: null })), "kiro");
  assert.equal(agentOf(term("t")), "claude");
  assert.equal(agentOf({ state: "live", foreground: { name: "zsh" } }), null);
  assert.equal(agentOf(term("t", { state: "exited" })), null);
  assert.deepEqual(AGENTS.claude.argv, ["claude", "--dangerously-skip-permissions"]);
});

test("groups under their host, this computer first, hosts without sessions listed", () => {
  const h = hosts([
    term("vps/t1", { labels: { where: "dms / A", "herdr.tab": "tb1" } }),
    term("t2", { labels: { where: "x / B", "herdr.tab": "tb2" }, status: { state: "blocked" } }),
    term("alpha/t3", { labels: { where: "y / C", "herdr.tab": "tb3" } }),
  ], [{ name: "vps", state: "connected" }, { name: "zeta", state: "unreachable" }]);
  assert.deepEqual(h.map((x) => [x.name, x.groups.map((g) => g.name)]), [
    ["This computer", ["B"]], ["alpha", ["C"]], ["vps", ["A"]], ["zeta", []],
  ]);
  assert.equal(h[0].status, "blocked");
});

import { orderGroups, moveGroup } from "../src/lib/sessions.js";

test("groups in the person's order, new ones after", () => {
  const groups = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(orderGroups(groups, ["c", "a"]).map((g) => g.id), ["c", "a", "b", "d"]);
  assert.deepEqual(orderGroups(groups, []).map((g) => g.id), ["a", "b", "c", "d"]);
  assert.deepEqual(orderGroups(groups, ["gone", "d"]).map((g) => g.id), ["d", "a", "b", "c"]);
});

test("moving a group before another, or to the end", () => {
  assert.deepEqual(moveGroup(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveGroup(["a", "b", "c"], "a", null), ["b", "c", "a"]);
  assert.deepEqual(moveGroup(["a", "b", "c"], "b", "b"), ["a", "c", "b"], "onto itself: to the end of the rest");
});

import { withMoves, pendingMoves } from "../src/lib/sessions.js";
test("a move shows at once and is dropped once herdr-core has it", () => {
  const ts = [{ address: "t1", labels: { "sheepy.group": "A" } }, { address: "h/t2", labels: {} }];
  const moves = { "h/t2": "B" };
  const shown = withMoves(ts, moves);
  assert.equal(shown[1].labels["sheepy.group"], "B");
  assert.equal(shown[0], ts[0], "the others untouched");
  assert.equal(withMoves(ts, {}), ts);
  assert.deepEqual(pendingMoves(ts, moves), { "h/t2": "B" });
  assert.deepEqual(pendingMoves(shown, moves), {}, "done once the picture shows it");
  assert.deepEqual(pendingMoves([], moves), {}, "a session that's gone");
});

test("a session that has just started (status still null) doesn't break the sidebar", () => {
  const fresh = { address: "devdesk/t20", agent: "claude", status: null, labels: {}, foreground: { cwd: "/w" } };
  assert.equal(activityOf(fresh), null);
  assert.equal(activityOf({ status: { msg: "Reading files" } }), "Reading files");
  assert.equal(activityOf({}), null);
  assert.equal(activityOf(null), null);
  assert.doesNotThrow(() => windows([fresh]));
  assert.doesNotThrow(() => hosts([fresh], []));
});
