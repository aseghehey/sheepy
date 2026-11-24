import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeResults, sessionLabel, snippetParts, archived, ago, terminalOfLive } from "../src/lib/palette.js";

test("results from every machine, best first or newest first", () => {
  const answers = [
    { machine: null, answer: { sessions: [{ session: "a", best: 3, last_ts: 300 }, { session: "b", best: 9, last_ts: 100 }] } },
    { machine: "vps", answer: { sessions: [{ session: "c", best: 5, last_ts: 900 }] } },
    { machine: "down", answer: null },
  ];
  assert.deepEqual(mergeResults(answers).map((s) => s.session), ["b", "c", "a"]);
  assert.deepEqual(mergeResults(answers, "recent").map((s) => s.session), ["c", "a", "b"]);
  assert.equal(mergeResults(answers)[1].machine, "vps");
  assert.deepEqual(mergeResults(null), []);
});

test("a session's label: its name, title, or how it began", () => {
  assert.equal(sessionLabel({ name: "rebuild", title: "T", first: "F" }), "rebuild");
  assert.equal(sessionLabel({ name: " ", title: "Fix login", first: "F" }), "Fix login");
  assert.equal(sessionLabel({ first: "line one\n  line two" }), "line one line two");
  assert.equal(sessionLabel({ first: "x".repeat(120) }).length, 90);
  assert.equal(sessionLabel({ session: "5791b893-935c" }), "5791b893");
});

test("snippet highlights as parts, bad ranges ignored", () => {
  assert.deepEqual(snippetParts("the rename first", [[4, 10]]), [
    { text: "the ", hit: false }, { text: "rename", hit: true }, { text: " first", hit: false },
  ]);
  assert.deepEqual(snippetParts("abc", [[2, 1], [0, 99], [1, 2]]), [{ text: "a", hit: false }, { text: "b", hit: true }, { text: "c", hit: false }]);
  assert.deepEqual(snippetParts("", []), []);
});

test("archived: not running, newest first, filtered by name or folder", () => {
  const lists = [{ machine: "vps", answer: { sessions: [
    { session: "1", name: "Library work", project: "/w/dms", last_ts: 5 },
    { session: "2", title: "Deploy fix", project: "/w/infra", last_ts: 9 },
    { session: "3", title: "Live one", live: { pid: 7 }, last_ts: 99 },
  ] } }];
  assert.deepEqual(archived(lists).map((s) => s.session), ["2", "1"]);
  assert.deepEqual(archived(lists, "dms").map((s) => s.session), ["1"]);
  assert.deepEqual(archived(lists, "DEPLOY").map((s) => s.label), ["Deploy fix"]);
});

test("ago", () => {
  const now = 10 * 86400000;
  assert.equal(ago(now - 30000, now), "now");
  assert.equal(ago(now - 5 * 60000, now), "5m");
  assert.equal(ago(now - 3 * 3600000, now), "3h");
  assert.equal(ago(now - 2 * 86400000, now), "2d");
});

test("a live session's terminal, through its process or a launcher above it", () => {
  const terminals = [
    { address: "vps/t1", state: "live", foreground: { pid: 40 } },
    { address: "t2", state: "live", foreground: { pid: 7 } },
  ];
  assert.equal(terminalOfLive({ pid: 99, ancestors: [40] }, "vps", terminals)?.address, "vps/t1");
  assert.equal(terminalOfLive({ pid: 7 }, null, terminals)?.address, "t2");
  assert.equal(terminalOfLive({ pid: 7 }, "vps", terminals), null, "same pid, other machine");
  assert.equal(terminalOfLive(null, null, terminals), null);
});
