import { test } from "node:test";
import assert from "node:assert/strict";
import { entryText, queryWords, findEntries, step } from "../src/lib/findin.js";

const entries = [
  { kind: "user", text: "Fix the login bug" },
  { kind: "assistant", text: "The login check compared the wrong token." },
  { kind: "tools", items: [{ name: "Bash", summary: "npm test", result: "12 passed, LOGIN ok" }] },
  { kind: "note", text: "Conversation compacted", summary: "We fixed login" },
  { kind: "assistant", text: "Done." },
];

test("what's searchable in each entry", () => {
  assert.match(entryText(entries[2]), /npm test[\s\S]*LOGIN ok/);
  assert.match(entryText(entries[3]), /We fixed login/);
  assert.equal(entryText(null), "");
});

test("words and quoted phrases", () => {
  assert.deepEqual(queryWords('login "wrong token"  Fix'), ["login", "wrong token", "fix"]);
  assert.deepEqual(queryWords("   "), []);
});

test("entries with every word, in order, any case", () => {
  assert.deepEqual(findEntries(entries, "login"), [0, 1, 2, 3]);
  assert.deepEqual(findEntries(entries, "login token"), [1]);
  assert.deepEqual(findEntries(entries, '"wrong token"'), [1]);
  assert.deepEqual(findEntries(entries, "nothing-like-this"), []);
  assert.deepEqual(findEntries(entries, ""), []);
});

test("stepping wraps both ways and starts from the newest going back", () => {
  const hits = [0, 1, 2];
  assert.equal(step(hits, -1, -1), 2);
  assert.equal(step(hits, -1, 1), 0);
  assert.equal(step(hits, 0, -1), 2);
  assert.equal(step(hits, 2, 1), 0);
  assert.equal(step([], 0, 1), -1);
});
