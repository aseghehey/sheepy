import { test } from "node:test";
import assert from "node:assert/strict";
import { commandList, filterCommands } from "../src/lib/commands.js";

const hosts = [
  { name: "This computer", groups: [{ name: "Random", sessions: [{ address: "t1", title: "Fix login", status: "idle" }] }] },
  { name: "vps", groups: [{ name: "Library work", sessions: [{ address: "vps/t2", title: "Release notes", status: "working" }] }] },
];
const view = { font: "system", width: "medium", zoom: 1, theme: "system" };

test("actions and every session to go to", () => {
  const list = commandList(hosts, view);
  assert.ok(list.find((c) => c.id === "search" && c.keys === "⌘⇧F"));
  assert.ok(list.find((c) => c.id === "find" && c.keys === "⌘F"));
  assert.equal(list.find((c) => c.id === "zoom-in").run.change.zoom, 1.1);
  assert.equal(list.find((c) => c.id === "theme-system").on, true);
  const go = list.filter((c) => c.group === "Go to");
  assert.deepEqual(go.map((c) => [c.title, c.detail]), [["Fix login", "This computer · Random"], ["Release notes", "vps · Library work"]]);
  assert.deepEqual(go[1].run.target, { kind: "session", address: "vps/t2", title: "Release notes" });
});

test("filtering: all words, titles starting with the query first", () => {
  const list = commandList(hosts, view);
  assert.equal(filterCommands(list, "").length, list.length);
  assert.deepEqual(filterCommands(list, "release").map((c) => c.title), ["Release notes"]);
  assert.deepEqual(filterCommands(list, "vps").map((c) => c.title), ["Release notes"], "the detail counts");
  const zoom = filterCommands(list, "zoom");
  assert.deepEqual(zoom.slice(0, 2).map((c) => c.id), ["zoom-in", "zoom-out"]);
  assert.equal(filterCommands(list, "appearance dark")[0].id, "theme-dark");
  assert.deepEqual(filterCommands(list, "nothing like this"), []);
});

test("the palette hides the sidebar when it's shown, and shows it when it's hidden", () => {
  const shown = commandList([], { sidebar: true, zoom: 1 }).find((c) => c.id === "sidebar");
  assert.equal(shown.title, "Hide sidebar");
  assert.deepEqual(shown.run, { kind: "view", change: { sidebar: false } });
  assert.equal(shown.keys, "⌃⌘S");
  const hidden = commandList([], { sidebar: false, zoom: 1 }).find((c) => c.id === "sidebar");
  assert.equal(hidden.title, "Show sidebar");
  assert.deepEqual(hidden.run, { kind: "view", change: { sidebar: true } });
});
