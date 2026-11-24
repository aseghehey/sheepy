import { test } from "node:test";
import assert from "node:assert/strict";
import { messageMenu, copyableText } from "../src/lib/menu.js";

const ids = (items) => items.map((i) => i.id);

test("a reply with a highlight: copy and quote it, or the whole reply", () => {
  assert.deepEqual(ids(messageMenu({ selection: "some words", quotable: true, whole: "all of it" })), ["copy", "quote", "sep", "copy-message", "quote-message"]);
});

test("no highlight: the whole message only", () => {
  assert.deepEqual(ids(messageMenu({ selection: "  ", quotable: true, whole: "all" })), ["copy-message", "quote-message"]);
});

test("not quotable (tool output, a question): copying only", () => {
  assert.deepEqual(ids(messageMenu({ selection: "x", quotable: false, whole: "y" })), ["copy", "sep", "copy-message"]);
  assert.deepEqual(ids(messageMenu({ quotable: false, whole: "y" })), ["copy-message"]);
});

test("nothing to act on: no menu", () => {
  assert.deepEqual(messageMenu({ selection: "", quotable: true, whole: "" }), []);
  assert.deepEqual(messageMenu({}), []);
});

test("fenced blocks copy without their fences", () => {
  assert.equal(copyableText("~~~~text\nline 1\nline 2\n~~~~"), "line 1\nline 2");
  assert.equal(copyableText("```js\nconst a = 1;\n```"), "const a = 1;");
  assert.equal(copyableText("plain **markdown**"), "plain **markdown**");
  // A fence that doesn't close the text isn't a wrapper.
  assert.equal(copyableText("```\na\n```\nmore"), "```\na\n```\nmore");
  assert.equal(copyableText(null), "");
});
