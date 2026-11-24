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
