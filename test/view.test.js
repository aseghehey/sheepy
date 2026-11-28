import { test } from "node:test";
import assert from "node:assert/strict";
import { parseView, viewStyle, stepZoom, DEFAULT_VIEW } from "../src/lib/view.js";

test("a stored view comes back, unknown values as defaults", () => {
  assert.deepEqual(parseView('{"font":"serif","width":"wide","zoom":1.25,"theme":"light"}'), { font: "serif", width: "wide", zoom: 1.25, theme: "light", sidebar: true });
  assert.equal(parseView('{"theme":"neon"}').theme, "system");
  assert.deepEqual(parseView('{"font":"comic","width":"huge","zoom":3}'), DEFAULT_VIEW);
  for (const bad of [null, "", "{", "7", '"x"']) assert.deepEqual(parseView(bad), DEFAULT_VIEW);
});

test("a view's CSS variables", () => {
  const s = viewStyle({ font: "mono", width: "small", zoom: 1.5 });
  assert.match(s["--chat-font"], /monospace/);
  assert.equal(s["--col"], "640px");
  assert.equal(s["--zoom"], "1.5");
});

test("zoom steps stop at the ends", () => {
  assert.equal(stepZoom(1, 1), 1.1);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(1.75, 1), 1.75);
  assert.equal(stepZoom(0.8, -1), 0.8);
  assert.equal(stepZoom(1.3, 1), 1.1, "an unknown zoom steps from 100%");
});

import { isSidebarKey } from "../src/lib/view.js";
test("the sidebar's shown unless it was hidden, and an odd stored value doesn't hide it", () => {
  assert.equal(DEFAULT_VIEW.sidebar, true);
  assert.equal(parseView(null).sidebar, true);
  assert.equal(parseView(JSON.stringify({ sidebar: false })).sidebar, false);
  assert.equal(parseView(JSON.stringify({ sidebar: true, zoom: 1.1 })).sidebar, true);
  assert.equal(parseView(JSON.stringify({ sidebar: "no" })).sidebar, true);
  assert.equal(parseView(JSON.stringify({ font: "system" })).sidebar, true, "views saved before there was a setting");
});

test("⌃⌘S hides and shows the sidebar; nothing else does", () => {
  assert.ok(isSidebarKey({ key: "s", metaKey: true, ctrlKey: true }));
  assert.ok(isSidebarKey({ key: "S", metaKey: true, ctrlKey: true }));
  assert.ok(!isSidebarKey({ key: "s", metaKey: true }), "⌘S");
  assert.ok(!isSidebarKey({ key: "s", ctrlKey: true }), "⌃S");
  assert.ok(!isSidebarKey({ key: "s", metaKey: true, ctrlKey: true, shiftKey: true }));
  assert.ok(!isSidebarKey({ key: "s", metaKey: true, ctrlKey: true, altKey: true }));
  assert.ok(!isSidebarKey({ key: "d", metaKey: true, ctrlKey: true }));
  assert.ok(!isSidebarKey(null));
});
