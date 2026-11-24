import { test } from "node:test";
import assert from "node:assert/strict";
import { isClaude, statusOf, sessionTitle, whereOf, windows, subagentRow } from "../src/lib/sessions.js";

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
  assert.equal(sessionTitle(term("t", { title: "~/workplace/dms" })), "dms");
  assert.equal(sessionTitle(term("t", { title: "Claude Code" })), "dms");
  assert.equal(sessionTitle(term("t", { title: null, foreground: null, cwd: "/a/b" })), "b");
});

test("where: space and tab", () => {
  assert.deepEqual(whereOf(term("t")), { where: "dms / Library work", space: "dms", tab: "Library work" });
  assert.deepEqual(whereOf(term("t", { labels: {} })), { where: "", space: "Other", tab: "Other" });
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
