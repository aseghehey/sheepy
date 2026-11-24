import { test } from "node:test";
import assert from "node:assert/strict";
import { parseView, viewStyle, stepZoom, DEFAULT_VIEW } from "../src/lib/view.js";

test("a stored view comes back, unknown values as defaults", () => {
  assert.deepEqual(parseView('{"font":"serif","width":"wide","zoom":1.25,"theme":"light"}'), { font: "serif", width: "wide", zoom: 1.25, theme: "light" });
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
