import { test } from "node:test";
import assert from "node:assert/strict";
import { Transcript } from "../src/lib/parse.js";

const line = (o) => JSON.stringify(o);
const user = (text, extra = {}) => line({ type: "user", message: { role: "user", content: text }, ...extra });
const assistant = (content, extra = {}) => line({ type: "assistant", message: { id: extra.id ?? "m1", model: "claude-x", content, usage: { input_tokens: 10, output_tokens: 5 } } });

function feed(lines) {
  const t = new Transcript("claude");
  let at = 0;
  for (const l of lines) { t.feed(l, at); at += Buffer.byteLength(l) + 1; }
  return t;
}

test("prompts and replies, with the byte offsets of their lines", () => {
  const lines = [user("hello"), assistant([{ type: "text", text: "Hi!" }]), assistant([{ type: "text", text: "More." }], { id: "m2" })];
  const t = feed(lines);
  assert.deepEqual(t.entries.map((e) => [e.kind, e.text]), [["user", "hello"], ["assistant", "Hi!\n\nMore."]]);
  assert.equal(t.entries[0].from, 0);
  const second = Buffer.byteLength(lines[0]) + 1;
  assert.equal(t.entries[1].from, second);
  assert.ok(t.entries[1].to > t.entries[1].from, "the reply's end moves with its second line");
});

test("entryAt finds the entry a log offset falls in", () => {
  const lines = [user("one"), assistant([{ type: "text", text: "two" }]), user("three")];
  const t = feed(lines);
  const third = Buffer.byteLength(lines[0]) + Buffer.byteLength(lines[1]) + 2;
  assert.equal(t.entryAt(0), 0);
  assert.equal(t.entryAt(third), 2);
  assert.equal(t.entryAt(third + 5), 2);
  assert.equal(t.entryAt(-1), -1);
});

test("a name the person gave wins over the generated title, whatever the order", () => {
  assert.equal(feed([line({ type: "ai-title", aiTitle: "Generated" }), line({ type: "custom-title", customTitle: "Mine" })]).title, "Mine");
  assert.equal(feed([line({ type: "custom-title", customTitle: "Mine" }), line({ type: "ai-title", aiTitle: "Generated" })]).title, "Mine");
  assert.equal(feed([line({ type: "ai-title", aiTitle: "Generated" })]).title, "Generated");
});

test("an AskUserQuestion keeps its questions, and its answer when it comes", () => {
  const questions = [{ header: "Pick", question: "Which?", options: [{ label: "A", description: "first" }, { label: "B", description: "second" }] }];
  const t = feed([assistant([{ type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions } }])]);
  const item = t.entries[0].items[0];
  assert.deepEqual(item.questions, questions);
  assert.equal(item.result, null);
  t.feed(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "q1", content: "A" }] } }), 999);
  assert.equal(item.result, "A");
});

test("injected context, reminders and side chains are left out", () => {
  const t = feed([
    user("<system-reminder>noise</system-reminder>"),
    user("real <system-reminder>x</system-reminder>question"),
    user("hidden", { isMeta: true }),
    line({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "sub" }] } }),
    user("<task-notification><id>1</id></task-notification>"),
  ]);
  assert.deepEqual(t.entries.map((e) => e.text), ["real question"]);
});

test("broken lines are skipped, not fatal", () => {
  const t = feed(["{not json", "", user("after")]);
  assert.deepEqual(t.entries.map((e) => e.text), ["after"]);
});

test("slash commands show as the person typed them", () => {
  const t = feed([user("<command-name>/model</command-name><command-args>opus</command-args>")]);
  assert.equal(t.entries[0].text, "/model opus");
  assert.equal(t.entries[0].command, true);
});

test("unicode in messages survives", () => {
  const t = feed([user("héllo 😀 世界")]);
  assert.equal(t.entries[0].text, "héllo 😀 世界");
});

test("a sub-agent's own log: its side-chain lines are its conversation", () => {
  const lines = [
    JSON.stringify({ type: "user", isSidechain: true, agentId: "a1", message: { role: "user", content: "Inventory the reviews" } }),
    JSON.stringify({ type: "assistant", isSidechain: true, message: { id: "m1", model: "claude-x", content: [{ type: "text", text: "Found 3." }] } }),
  ];
  const main = new Transcript("claude");
  const sub = new Transcript("claude", { sidechain: true });
  lines.forEach((l, i) => { main.feed(l, i); sub.feed(l, i); });
  assert.equal(main.entries.length, 0, "a session's log leaves side chains out");
  assert.deepEqual(sub.entries.map((e) => [e.kind, e.text]), [["user", "Inventory the reviews"], ["assistant", "Found 3."]]);
});
