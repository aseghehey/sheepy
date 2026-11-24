// node --test tests/mods/
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertsFor, ALERTS, appleScriptString, duration, gb, level } from "../src/lib/stats.js";

const MIN = 60000;
const disk = (mount, pctUsed, sizeGb = 100) => ({ mount, size: sizeGb * 1048576, used: (sizeGb * 1048576 * pctUsed) / 100 });

test("each disk threshold alerts once on the way up", () => {
  const seen = {};
  assert.equal(alertsFor("m", { disks: [disk("/", 89)] }, seen, 0).length, 0);
  const a = alertsFor("m", { disks: [disk("/", 91)] }, seen, 0);
  assert.equal(a.length, 1);
  assert.equal(a[0].title, "m: disk / 91% full");
  assert.equal(a[0].level, "warning");
  assert.match(a[0].body, /^Over 90%: 9\.0 GB free of 100 GB\.$/);
  assert.equal(alertsFor("m", { disks: [disk("/", 93)] }, seen, 0).length, 0, "not again for 90");
  assert.equal(alertsFor("m", { disks: [disk("/", 96)] }, seen, 0)[0].body.slice(0, 9), "Over 95%:");
  const last = alertsFor("m", { disks: [disk("/", 99)] }, seen, 0);
  assert.equal(last[0].level, "error");
});

test("a jump past two thresholds is one alert, for the higher", () => {
  const a = alertsFor("m", { disks: [disk("/", 97)] }, {}, 0);
  assert.equal(a.length, 1);
  assert.match(a[0].body, /^Over 95%/);
});

test("after falling back a few points, a new crossing alerts again", () => {
  const seen = {};
  alertsFor("m", { disks: [disk("/", 91)] }, seen, 0);
  assert.equal(alertsFor("m", { disks: [disk("/", 89)] }, seen, 0).length, 0, "within the slack: still armed off");
  assert.equal(alertsFor("m", { disks: [disk("/", 91)] }, seen, 0).length, 0);
  alertsFor("m", { disks: [disk("/", 85)] }, seen, 0);
  assert.equal(alertsFor("m", { disks: [disk("/", 91)] }, seen, 0).length, 1);
});

test("several disks: each alert carries its own disk's numbers", () => {
  const a = alertsFor("m", { disks: [disk("/Volumes/data", 96, 2000), disk("/", 50), disk("/workplace", 91, 500)] }, {}, 0);
  assert.equal(a.length, 2);
  assert.equal(a[0].title, "m: disk /Volumes/data 96% full");
  assert.match(a[0].body, /free of 2\.0 TB/);
  assert.equal(a[1].title, "m: disk /workplace 91% full");
  assert.match(a[1].body, /free of 500 GB/);
});

test("the Mac's data volume is called /", () => {
  assert.equal(alertsFor("m", { disks: [disk("/System/Volumes/Data", 92)] }, {}, 0)[0].title, "m: disk / 92% full");
});

test("bad readings alert nothing", () => {
  assert.deepEqual(alertsFor("m", { disks: [{ mount: "/", size: 0, used: 5 }, { mount: "/x", size: NaN, used: 1 }] }, {}, 0), []);
  assert.deepEqual(alertsFor("m", { mem_total: 0, mem_used: 5 }, {}, 0), []);
  assert.deepEqual(alertsFor("m", {}, {}, 0), []);
});

test("memory thresholds", () => {
  const seen = {};
  const a = alertsFor("m", { mem_total: 16 * 1048576, mem_used: 15 * 1048576 }, seen, 0);
  assert.equal(a.length, 1);
  assert.equal(a[0].title, "m: memory 94% full");
  assert.equal(a[0].body, "15 GB of 16 GB in use.");
});

test("CPU alerts only after staying high for the whole stretch", () => {
  const seen = {};
  for (let t = 0; t < ALERTS.cpuMinutes; t++) assert.equal(alertsFor("m", { cpu: 95 }, seen, t * MIN).length, 0, `minute ${t}`);
  const a = alertsFor("m", { cpu: 95, load: "8.1 7.9 7.5" }, seen, ALERTS.cpuMinutes * MIN);
  assert.equal(a.length, 1);
  assert.equal(a[0].body, "Now 95%, load 8.1.");
  assert.equal(alertsFor("m", { cpu: 95 }, seen, (ALERTS.cpuMinutes + 1) * MIN).length, 0, "once");
});

test("a short dip doesn't reset the CPU stretch, a real drop does", () => {
  const seen = {};
  const at = (cpu, minute) => alertsFor("m", { cpu }, seen, minute * MIN);
  at(95, 0);
  at(85, 1); // within 10 points: still counting
  at(95, 2); at(95, 3); at(95, 4);
  assert.equal(at(95, 5).length, 1);
  at(20, 6);
  assert.equal(at(95, 7).length, 0, "a new stretch starts");
});

test("a gap in readings doesn't count as time spent high", () => {
  const seen = {};
  alertsFor("m", { cpu: 95 }, seen, 0);
  // The machine was asleep for an hour; high readings each minute once it's back.
  for (let m = 60; m < 65; m++) assert.equal(alertsFor("m", { cpu: 95 }, seen, m * MIN).length, 0, `minute ${m}`);
  assert.equal(alertsFor("m", { cpu: 95 }, seen, 65 * MIN).length, 1);
});

test("AppleScript strings can't be broken out of", () => {
  assert.equal(appleScriptString('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
  assert.equal(appleScriptString("a\nb\tc"), '"a b c"');
  assert.equal(appleScriptString('" & do shell script "rm -rf ~" & "'), '"\\" & do shell script \\"rm -rf ~\\" & \\""');
  assert.equal(appleScriptString("dévdesk 😀"), '"dévdesk 😀"');
  assert.equal(appleScriptString(null), '""');
});

test("formatting", () => {
  assert.equal(duration(59), "0m");
  assert.equal(duration(3 * 3600 + 5 * 60), "3h 5m");
  assert.equal(duration(2 * 86400 + 3600), "2d 1h");
  assert.equal(gb(512 * 1024), "0.5 GB");
  assert.equal(gb(50 * 1048576), "50 GB");
  assert.equal(gb(3 * 1024 * 1048576), "3.0 TB");
  assert.equal(level(10), "#30d158");
  assert.equal(level(60), "#ffd60a");
  assert.equal(level(85), "#ff453a");
});
