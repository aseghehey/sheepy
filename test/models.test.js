import { test } from "node:test";
import assert from "node:assert/strict";
import { modelName, shownModel, modelLabel, validModel } from "../src/lib/models.js";

test("model ids as people say them", () => {
  assert.equal(modelName("global.anthropic.claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelName("claude-sonnet-4-6[1m]"), "Sonnet 4.6 (1M)");
  assert.equal(modelName("global.anthropic.claude-opus-5-5[1m]"), "Opus 5.5 (1M)");
  assert.equal(modelName("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(modelName("us.anthropic.claude-3-5-haiku-20241022-v1:0"), "Haiku 3.5");
  assert.equal(modelName("claude-fable-5"), "Fable 5");
  assert.equal(modelName("opus"), "Opus");
  assert.equal(modelName("some-router"), "some-router");
  assert.equal(modelName(""), null);
  assert.equal(modelName(null), null);
});

test("a change made here shows until a later reply says what's in effect", () => {
  const log = { model: "global.anthropic.claude-opus-5-5", effort: "high", at: "2026-11-25T14:00:00Z" };
  assert.deepEqual(shownModel(log, null), { model: "Opus 5.5", effort: "high", pending: false });
  const change = { model: "sonnet", at: Date.parse("2026-11-25T14:05:00Z") };
  assert.deepEqual(shownModel(log, change), { model: "Sonnet", effort: "high", pending: true });
  const later = { model: "global.anthropic.claude-sonnet-5-5", effort: "medium", at: "2026-11-25T14:06:00Z" };
  assert.deepEqual(shownModel(later, change), { model: "Sonnet 5.5", effort: "medium", pending: false });
  assert.deepEqual(shownModel(null, { model: "default", at: 1 }), { model: "Default", effort: null, pending: true });
  assert.deepEqual(shownModel(null, null), { model: null, effort: null, pending: false });
});

test("labels and safe values", () => {
  assert.equal(modelLabel({ model: "Opus 5.5", effort: "xhigh" }), "Opus 5.5 · xhigh");
  assert.equal(modelLabel({ model: null, effort: null }), null);
  assert.ok(validModel("opus[1m]"));
  assert.ok(validModel("global.anthropic.claude-opus-5-5"));
  assert.ok(!validModel("opus; rm -rf"));
  assert.ok(!validModel(""));
});
