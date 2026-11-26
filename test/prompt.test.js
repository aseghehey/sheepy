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
  assert.equal(p.options[0], "Pin to an older release (Recommended)");
  assert.equal(p.details[0], "Point the workspace at the last release.");
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

import { freeTextOption } from "../src/lib/prompt.js";

test("the option that takes the person's own words", () => {
  assert.equal(freeTextOption(["Pin it", "Approve", "Wait", "Type something."]), 3);
  assert.equal(freeTextOption(["Yes", "No", "Other"]), 2);
  assert.equal(freeTextOption(["Yes", "No"]), -1);
  assert.equal(freeTextOption(null), -1);
});

import fs from "node:fs";
import { isTypeOption } from "../src/lib/prompt.js";

test("a question in several parts, as Claude Code draws it", () => {
  const p = parsePrompt(fs.readFileSync(new URL("./fixtures/form-question.txt", import.meta.url), "utf8"));
  assert.deepEqual(p.steps, [
    { label: "Log level", done: false }, { label: "Cache", done: false },
    { label: "Refresh", done: false }, { label: "Submit", done: true },
  ]);
  assert.doesNotMatch(p.question, /Log level|☐/, "the progress row isn't the question");
  assert.match(p.question, /^Review point 4/);
  assert.deepEqual(p.options, ["INFO only for changes (Recommended)", "Keep INFO for every request", "Type something.", "Chat about this"]);
  assert.match(p.details[0], /^changed=true stays at INFO/);
  assert.equal(p.details[2], "");
  assert.equal(p.selected, 0);
});

test("which options take the person's own words", () => {
  assert.ok(isTypeOption("Type something."));
  assert.ok(isTypeOption("3. Other"));
  assert.ok(!isTypeOption("Chat about this"));
  assert.ok(!isTypeOption("Keep INFO"));
  assert.equal(freeTextOption(["A", "Type something.", "Chat about this"]), 1);
  assert.equal(freeTextOption(["A", "Chat about this"]), -1, "never the chat option");
  assert.equal(freeTextOption(["Apple", "Pear", "xyz", "Chat about this"]), 2, "the field, showing what's typed in it");
});

import { typedIn, toFreeText } from "../src/lib/prompt.js";
test("a free-text field that already has something typed is emptied first", () => {
  const q = { options: ["Apple", "Pear", "xyz", "Chat about this"], selected: 1 };
  assert.equal(typedIn(q, 2), "xyz");
  const keys = toFreeText(q, 2);
  assert.deepEqual(keys.slice(0, 2), ["down", "end"]);
  assert.equal(keys.filter((k) => k === "backspace").length, 23);
  assert.ok(!keys.includes("enter"));
  const empty = { options: ["Apple", "Pear", "Type something.", "Chat about this"], selected: 0 };
  assert.equal(typedIn(empty, 2), "");
  assert.deepEqual(toFreeText(empty, 2), ["down", "down"]);
});
