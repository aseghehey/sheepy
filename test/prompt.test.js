import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt, menuAtBottom, choose, clean, reflow } from "../src/lib/prompt.js";

const QUESTION = [
  "────────────────────────────────────────",
  " ☐ RM blocker",
  "",
  "The rebuild built every service, but the fleet",
  "refused to start. How should we get past it?",
  "",
  "❯ 1. Pin to an older release (Recommended)",
  "     Point the workspace at the last release.",
  "  2. Approve the new version",
  "     Review what changed and approve it.",
  "  3. Wait",
  "  4. Type something.",
  "",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
].join("\n");

test("reads a question, its options and the selected one", () => {
  const p = parsePrompt(QUESTION);
  assert.equal(p.selected, 0);
  assert.equal(p.options.length, 4);
  assert.match(p.options[0], /^Pin to an older release \(Recommended\) Point the workspace/);
  assert.equal(p.options[3], "Type something.");
  assert.match(p.question, /RM blocker/);
  assert.match(p.question, /The rebuild built every service, but the fleet refused to start\./);
});

test("the selection moved down", () => {
  const moved = QUESTION.replace("❯ 1. Pin", "  1. Pin").replace("  3. Wait", "❯ 3. Wait");
  assert.equal(parsePrompt(moved).selected, 2);
});

test("no menu: null", () => {
  assert.equal(parsePrompt("just output\n$ "), null);
  assert.equal(parsePrompt(""), null);
  assert.equal(parsePrompt(null), null);
  // One option isn't a choice.
  assert.equal(parsePrompt("Question?\n❯ 1. Only\nEnter to select"), null);
});

test("a ✔ in the indent marks the current choice, and lines up with the rest", () => {
  // As pickers draw it: the ✔ takes the place of the indent's two spaces.
  const p = parsePrompt("Pick a model\n❯ 1. Opus\n✔ 2. Sonnet\n  3. Haiku\nEnter to confirm · Esc to cancel");
  assert.deepEqual(p.options, ["Opus", "Sonnet ✓", "Haiku"]);
  assert.equal(p.selected, 0);
});

test("a menu is at the bottom when its hint line is", () => {
  assert.equal(menuAtBottom(QUESTION), "menu");
  assert.equal(menuAtBottom("a\nb\n← → to change · Enter to confirm"), "form");
  assert.equal(menuAtBottom("Enter to select\nmore output\nand more\nand more"), null);
  assert.equal(menuAtBottom(null), null);
});

test("keys to move the selection and confirm", () => {
  assert.deepEqual(choose(0, 2), ["down", "down", "enter"]);
  assert.deepEqual(choose(3, 1), ["up", "up", "enter"]);
  assert.deepEqual(choose(1, 1), ["enter"]);
});

test("terminal frames and checkboxes are cleaned off", () => {
  assert.equal(clean("│ hello │"), "hello");
  assert.equal(clean("☐ Header"), "Header");
  assert.equal(clean("a │ b"), "a b");
  assert.equal(reflow(["one", "two", "", "three"]), "one two\n\nthree");
});
