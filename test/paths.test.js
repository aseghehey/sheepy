import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPath, matchDirs, intoDir, upDir, finalPath, baseName } from "../src/lib/paths.js";

test("what's typed splits into the folder to list and the start of a name", () => {
  assert.deepEqual(splitPath("/srv/me/sh"), { parent: "/srv/me/", partial: "sh" });
  assert.deepEqual(splitPath("/srv/me/"), { parent: "/srv/me/", partial: "" });
  assert.deepEqual(splitPath("~/code/a"), { parent: "~/code/", partial: "a" });
  assert.deepEqual(splitPath("/"), { parent: "/", partial: "" });
  assert.deepEqual(splitPath("/wo"), { parent: "/", partial: "wo" });
});

test("empty, ~ and a bare name are the home folder", () => {
  assert.deepEqual(splitPath(""), { parent: "~/", partial: "" });
  assert.deepEqual(splitPath("  "), { parent: "~/", partial: "" });
  assert.deepEqual(splitPath(null), { parent: "~/", partial: "" });
  assert.deepEqual(splitPath("~"), { parent: "~/", partial: "" });
  assert.deepEqual(splitPath("code"), { parent: "~/", partial: "code" });
});

test("matching folders: starting with it first, then containing it, case-insensitively", () => {
  const dirs = ["shop-api", "Blog", "workshop", "Shop", "notes", ".git", ".config"];
  assert.deepEqual(matchDirs(dirs, "sh"), ["Shop", "shop-api", "workshop"]);
  assert.deepEqual(matchDirs(dirs, "SHOP"), ["Shop", "shop-api", "workshop"]);
  assert.deepEqual(matchDirs(dirs, "zz"), []);
});

test("all folders in name order when nothing is typed; hidden ones only when asked for", () => {
  const dirs = ["notes", "Blog", ".git", "app10", "app9"];
  assert.deepEqual(matchDirs(dirs, ""), ["app9", "app10", "Blog", "notes"]);
  assert.deepEqual(matchDirs(dirs, "."), [".git"]);
  assert.deepEqual(matchDirs(dirs, ".g"), [".git"]);
  assert.deepEqual(matchDirs([".", "..", "", "x"], ""), ["x"]);
  assert.deepEqual(matchDirs(null, "a"), []);
});

test("into a folder, and up one", () => {
  assert.equal(intoDir("/w/", "shop"), "/w/shop/");
  assert.equal(intoDir("/w", "shop"), "/w/shop/");
  assert.equal(intoDir("~/", "my files"), "~/my files/");
  assert.equal(upDir("/a/b/c/"), "/a/b/");
  assert.equal(upDir("/a/b/c"), "/a/b/");
  assert.equal(upDir("/a"), "/");
  assert.equal(upDir("/"), "/");
  assert.equal(upDir("~/code"), "~/");
  assert.equal(upDir("~"), "~/");
  assert.equal(upDir(""), "~/");
});

test("the path to start in, and its name", () => {
  assert.equal(finalPath("/w/shop/"), "/w/shop");
  assert.equal(finalPath("/w/shop"), "/w/shop");
  assert.equal(finalPath("/"), "/");
  assert.equal(finalPath(""), "~");
  assert.equal(finalPath(" ~/code/ "), "~/code");
  assert.equal(baseName("~/code/shop/"), "shop");
  assert.equal(baseName("/"), "~");
  assert.equal(baseName(""), "~");
});

import { folderItems } from "../src/lib/paths.js";
const kinds = (items) => items.map((i) => i.kind);

test("picker: in an existing folder, start there first, then its folders, then recent ones", () => {
  const listing = { state: "dir", path: "/home/me/code", dirs: ["shop", "blog", ".git"] };
  const items = folderItems(listing, "~/code/", ["/w/api", "~/code"], "devdesk");
  assert.deepEqual(kinds(items), ["start", "dir", "dir", "recent"]);
  assert.deepEqual(items[0], { kind: "start", path: "~/code", create: false, label: "Start in ~/code", detail: "/home/me/code" });
  assert.deepEqual(items.slice(1, 3).map((i) => i.name), ["blog", "shop"]);
  assert.equal(items[3].path, "/w/api", "the folder being typed isn't repeated as recent");
});

test("picker: typing a name narrows the folders and hides recent ones", () => {
  const listing = { state: "dir", path: "/home/me/code", dirs: ["shop", "shop-api", "blog"] };
  const exact = folderItems(listing, "~/code/shop", ["/w/api"]);
  assert.deepEqual(kinds(exact), ["start", "dir", "dir"]);
  assert.equal(exact[0].create, false, "shop is there: start in it");
  const partial = folderItems(listing, "~/code/sh", ["/w/api"]);
  assert.equal(partial[0].create, true, "no folder named 'sh': create it");
  assert.equal(partial[0].label, "Create ~/code/sh and start");
  assert.deepEqual(partial.slice(1).map((i) => i.name), ["shop", "shop-api"]);
});

test("picker: a folder that isn't there offers to create it; problems are notes, not actions", () => {
  assert.deepEqual(kinds(folderItems({ state: "missing", path: "/w/new", dirs: [] }, "/w/new/")), ["start"]);
  assert.equal(folderItems({ state: "missing", path: "/w/new", dirs: [] }, "/w/new/")[0].create, true);
  assert.deepEqual(kinds(folderItems(null, "~/")), ["note"]);
  assert.equal(folderItems(null, "~/")[0].label, "Looking…");
  assert.match(folderItems({ state: "file", path: "/etc/hosts", dirs: [] }, "/etc/hosts/")[0].label, /is a file/);
  assert.match(folderItems({ state: "denied", path: "/root", dirs: [] }, "/root/")[0].label, /Can't open/);
  const err = folderItems({ state: "error", error: "devdesk is unreachable" }, "/w/", [], "devdesk");
  assert.deepEqual(kinds(err), ["note"]);
  assert.match(err[0].label, /Couldn't list \/w\/ on devdesk: devdesk is unreachable/);
});

test("picker: recent folders skip blanks and repeats", () => {
  const listing = { state: "dir", path: "/home/me", dirs: [] };
  const items = folderItems(listing, "~/", ["", "/w/a/", "/w/a", null, "~"]);
  assert.deepEqual(items.filter((i) => i.kind === "recent").map((i) => i.path), ["/w/a"]);
});
