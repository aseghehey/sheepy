import { test } from "node:test";
import assert from "node:assert/strict";
import { matchedWords, markWords } from "../src/lib/find.js";

test("the words a search's highlights cover, once each, lowercased", () => {
  const hits = [
    { snippet: "Hook error in Hook", highlights: [[0, 4], [14, 18]] },
    { snippet: "an ERROR here", highlights: [[3, 8]] },
    { snippet: "a", highlights: [[0, 1]] },
  ];
  assert.deepEqual(matchedWords(hits).sort(), ["error", "hook"]);
  assert.deepEqual(matchedWords(null), []);
  assert.deepEqual(matchedWords([{ snippet: null, highlights: [[0, 3]] }]), []);
});

test("marks words where they start a word, in bold", () => {
  assert.equal(markWords("the hook failed; hooks run", ["hook"]), "the **hook** failed; **hooks** run");
  assert.equal(markWords("webhook", ["hook"]), "webhook");
  assert.equal(markWords("Hook", ["hook"]), "**Hook**");
});

test("never inside code, where the asterisks would show", () => {
  assert.equal(markWords("use `hook` or hook", ["hook"]), "use `hook` or **hook**");
  assert.equal(markWords("```\nhook()\n```\nhook", ["hook"]), "```\nhook()\n```\n**hook**");
  assert.equal(markWords("~~~\nhook\n~~~", ["hook"]), "~~~\nhook\n~~~");
});

test("search words with regex characters are taken literally", () => {
  assert.equal(markWords("a c++ b", ["c++"]), "a **c++** b");
  assert.equal(markWords("cost $5 (x)", ["(x)"]), "cost $5 **(x)**");
});

test("words already in bold aren't doubled", () => {
  assert.equal(markWords("**hook** and hook", ["hook"]), "**hook** and **hook**");
});

test("nothing to mark: the text as it was", () => {
  assert.equal(markWords("text", []), "text");
  assert.equal(markWords("", ["x"]), "");
  assert.equal(markWords(null, ["x"]), null);
});

test("words outside ASCII", () => {
  assert.equal(markWords("über alles", ["über"]), "**über** alles");
  assert.equal(markWords("日本語のテキスト", ["日本"]), "**日本語のテキスト**");
});
