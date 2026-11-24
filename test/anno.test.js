import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionReport, pillPosition, composerPosition, quoteBlock, annotationMessage, draftJSON, parseDraft } from "../src/lib/anno.js";

test("a selection report in any shape a Herdr build sends", () => {
  assert.deepEqual(selectionReport("  some words \n"), { text: "some words", inline: false });
  assert.deepEqual(selectionReport({ text: "a b", x: 10, y: 20 }), { text: "a b", inline: false });
  assert.deepEqual(selectionReport({ text: "a b", local_x: 3, local_y: 4 }), { text: "a b", lx: 3, ly: 4, inline: true });
  assert.deepEqual(selectionReport({ text: "", local_x: 3, local_y: 4 }), { text: "", lx: 3, ly: 4, inline: true });
  assert.deepEqual(selectionReport(null), { text: "", inline: false });
  assert.deepEqual(selectionReport({ text: "x", local_x: NaN, local_y: 1 }), { text: "x", inline: false });
});

test("the quote button stays inside the message", () => {
  assert.deepEqual(pillPosition({ lx: 100, ly: 30 }, 600, 44), { left: 104, top: 26 });
  // A highlight ending at the right edge: pulled back in.
  assert.deepEqual(pillPosition({ lx: 598, ly: 30 }, 600, 44), { left: 556, top: 26 });
  // At the very top: not above the message.
  assert.deepEqual(pillPosition({ lx: 0, ly: 0 }, 600, 44), { left: 4, top: 0 });
  // A message narrower than the button.
  assert.deepEqual(pillPosition({ lx: 20, ly: 10 }, 30, 44), { left: 0, top: 6 });
});

test("the comment box goes under the highlight's line, inside the message", () => {
  assert.deepEqual(composerPosition({ lx: 300, ly: 40 }, 700, 380, 20), { left: 276, top: 55 });
  assert.deepEqual(composerPosition({ lx: 690, ly: 40 }, 700, 380, 20), { left: 320, top: 55 });
  assert.deepEqual(composerPosition({ lx: 5, ly: 0 }, 700, 380, 20), { left: 0, top: 15 });
});

test("a quote is a Markdown quote on every line", () => {
  assert.equal(quoteBlock("one line"), "> one line");
  assert.equal(quoteBlock("first\nsecond"), "> first\n> second");
  // A blank line inside the quote must not end it.
  assert.equal(quoteBlock("para one\n\npara two"), "> para one\n>\n> para two");
  // Windows and old Mac line endings, trailing spaces.
  assert.equal(quoteBlock("a\r\nb\rc   \n\n"), "> a\n> b\n> c");
  // Lines that already start with > or are code stay as they are, quoted.
  assert.equal(quoteBlock("> nested\n```js\nx()\n```"), "> > nested\n> ```js\n> x()\n> ```");
});

test("the annotations and what's typed make one message", () => {
  const annos = [
    { quote: "today i will eat hot dog", comment: "why hot dog?" },
    { quote: "and then go home", comment: "   " },
    { quote: "   ", comment: "nothing quoted" },
  ];
  assert.equal(
    annotationMessage(annos, "  also, thanks  "),
    "> today i will eat hot dog\n\nwhy hot dog?\n\n> and then go home\n\nalso, thanks",
  );
  assert.equal(annotationMessage([], "just text"), "just text");
  assert.equal(annotationMessage([], "  "), "");
  assert.equal(annotationMessage(null), "");
  assert.equal(annotationMessage([{ quote: "a\n\nb", comment: "c" }]), "> a\n>\n> b\n\nc");
});

test("a draft is kept only when there's something in it, and always comes back usable", () => {
  assert.equal(draftJSON("", []), null);
  assert.equal(draftJSON("  \n", [{ quote: "  ", comment: "x" }]), null);
  const kept = draftJSON("hello", [{ quote: "q", comment: "c" }, { quote: "", comment: "dropped" }]);
  assert.deepEqual(parseDraft(kept), { text: "hello", annos: [{ quote: "q", comment: "c" }] });
  // Only annotations, nothing typed.
  assert.deepEqual(parseDraft(draftJSON("", [{ quote: "q" }])), { text: "", annos: [{ quote: "q", comment: "" }] });
  // What an earlier version stored (no version field) still reads.
  assert.deepEqual(parseDraft('{"text":"old","annos":[{"quote":"q","comment":"c"}]}'), { text: "old", annos: [{ quote: "q", comment: "c" }] });
  // Broken or foreign values: an empty draft, never a throw.
  for (const bad of [null, undefined, "", "{", "42", '"str"', "[]", '{"text":5,"annos":"x"}', '{"annos":[null,{"quote":3}]}']) {
    assert.deepEqual(parseDraft(bad), { text: "", annos: [] }, String(bad));
  }
  // Unicode survives.
  const u = draftJSON("héllo 😀 世界", [{ quote: "“quoted” — 🙂", comment: "ok" }]);
  assert.deepEqual(parseDraft(u), { text: "héllo 😀 世界", annos: [{ quote: "“quoted” — 🙂", comment: "ok" }] });
});
