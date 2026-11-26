import { test } from "node:test";
import assert from "node:assert/strict";
import { queuedView, stillPending } from "../src/lib/queue.js";

const user = (text) => ({ kind: "user", text });

test("a message sent while the agent works shows as queued until it's in the conversation", () => {
  const pending = [{ id: "p1", text: "also check the tests", at: 0, working: true }];
  assert.deepEqual(queuedView(pending, [user("fix it")], []), [{ id: "p1", text: "also check the tests", state: "queued" }]);
  assert.deepEqual(queuedView(pending, [user("fix it"), user("also  check the tests ")], []), [], "taken: in the conversation now");
});

test("Claude Code's own queue (from its log) shows once, with what was sent from here", () => {
  const pending = [{ id: "p1", text: "second", at: 0, working: true }];
  const view = queuedView(pending, [], ["first", "second"]);
  assert.deepEqual(view.map((v) => [v.text, v.state]), [["first", "queued"], ["second", "queued"]]);
});

test("sent while idle and not seen yet: sending", () => {
  assert.deepEqual(queuedView([{ id: "p", text: "hi", at: 0, working: false }], [], []).map((v) => v.state), ["sending"]);
});

test("sent messages drop out when taken, or after half an hour", () => {
  const now = 60 * 60000;
  const pending = [{ id: "a", text: "one", at: now - 1000 }, { id: "b", text: "two", at: now - 1000 }, { id: "c", text: "old", at: 0 }];
  assert.deepEqual(stillPending(pending, [user("one")], now).map((p) => p.id), ["b"]);
});

test("while the agent is idle, its log's queue shows nothing (operations this window didn't see)", () => {
  assert.deepEqual(queuedView([], [], ["left over"], false), []);
  assert.deepEqual(queuedView([], [], ["left over"], true).map((v) => v.text), ["left over"]);
});

test("Claude Code's own queued notifications are not the person's messages", () => {
  const q = ["<task-notification> <task-id>b1</task-id> <summary>Monitor event</summary></task-notification>", "<cross-session-message from=\"x\">hi</cross-session-message>", "real one"];
  assert.deepEqual(queuedView([], [], q, true).map((v) => v.text), ["real one"]);
});

test("a long paste is taken once the conversation has it, wrapped in <pasted_content>", () => {
  const pending = [{ id: "p", text: "The doc has now been updated. Here's the summary", at: 0, working: true }];
  const entries = [user('<pasted_content id="0ca9">\nThe doc has now been updated. Here\'s the summary\n</pasted_content>')];
  assert.deepEqual(queuedView(pending, entries, []), []);
  assert.deepEqual(stillPending(pending, entries, 1000), []);
});

test("once the agent is idle, a sent message still shown goes after 15 s", () => {
  const pending = [{ id: "a", text: "new", at: 100000 - 5000 }, { id: "b", text: "stale", at: 100000 - 20000 }];
  assert.deepEqual(stillPending(pending, [], 100000, false).map((p) => p.id), ["a"]);
  assert.deepEqual(stillPending(pending, [], 100000, true).map((p) => p.id), ["a", "b"]);
});
