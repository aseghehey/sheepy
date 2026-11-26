// Picking a folder by typing its path, as an editor's Open Folder does: what's
// typed splits into the folder to list and the start of a name in it; the
// list is that folder's folders that match. Plain functions, tested in
// test/paths.test.js.

/**
 * What's typed, as { parent, partial }: the folder to list (ending in "/")
 * and the start of a name in it. "~" alone and an empty path mean the home
 * folder; a bare name ("code") is one in the home folder.
 */
export function splitPath(input) {
  const s = String(input ?? "").trim();
  if (!s || s === "~") return { parent: "~/", partial: "" };
  const cut = s.lastIndexOf("/");
  if (cut < 0) return { parent: "~/", partial: s };
  return { parent: s.slice(0, cut + 1), partial: s.slice(cut + 1) };
}

/**
 * The folders of `dirs` (names) to show for `partial`: those starting with
 * it first, then those containing it, case-insensitively, each group in
 * name order. Hidden ones (".git") only when `partial` starts with ".".
 */
export function matchDirs(dirs, partial) {
  const p = String(partial ?? "").toLowerCase();
  const hidden = p.startsWith(".");
  const names = (dirs ?? []).filter((d) => d && d !== "." && d !== ".." && (hidden || !d.startsWith(".")));
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  if (!p) return [...names].sort(byName);
  const starts = names.filter((d) => d.toLowerCase().startsWith(p)).sort(byName);
  const has = names.filter((d) => !d.toLowerCase().startsWith(p) && d.toLowerCase().includes(p)).sort(byName);
  return [...starts, ...has];
}

/** The path of folder `name` in `parent`, ready to list in turn ("…/name/"). */
export function intoDir(parent, name) {
  const base = String(parent ?? "");
  return `${base.endsWith("/") ? base : `${base}/`}${name}/`;
}

/** One folder up from what's typed: "/a/b/c/" or "/a/b/c" → "/a/b/". The top stays. */
export function upDir(input) {
  const raw = String(input ?? "").trim();
  if (/^\/+$/.test(raw)) return "/";
  const s = raw.replace(/\/+$/, "");
  if (!s || s === "~") return "~/";
  const cut = s.lastIndexOf("/");
  if (cut < 0) return "~/";
  return s.slice(0, cut + 1) || "/";
}

/** The path to start in, as typed, without a trailing "/" (except "/" itself). */
export function finalPath(input) {
  const s = String(input ?? "").trim();
  if (!s) return "~";
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

/** The last part of a path, for naming a session ("~/code/shop/" → "shop"). */
export function baseName(path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "~";
}

/**
 * The rows of the folder picker for what's typed (`path`), given the listing
 * of the folder being typed in (`listing`: { state: dir | missing | file |
 * denied | error, path, dirs, error }, or null while it's coming), the
 * folders sessions ran in before (`recent`) and the host's name (`place`):
 *  - first, what Enter does: start there, create the folder and start, or a
 *    note when neither can happen (still looking, a file, can't open it);
 *  - then the matching folders in it, to go into;
 *  - then, while no name is being typed, the recent folders.
 */
export function folderItems(listing, path, recent = [], place = "this computer") {
  const { parent, partial } = splitPath(path);
  const typed = finalPath(path);
  const out = [];
  if (!listing) out.push({ kind: "note", label: "Looking…" });
  else if (listing.state === "error") out.push({ kind: "note", label: `Couldn't list ${parent} on ${place}: ${listing.error ?? "no answer"}` });
  else if (listing.state === "file") out.push({ kind: "note", label: `${listing.path} is a file, not a folder` });
  else if (listing.state === "denied") out.push({ kind: "note", label: `Can't open ${listing.path}` });
  else if (listing.state === "missing") out.push({ kind: "start", path: typed, create: true, label: `Create ${typed} and start`, detail: "The folder isn't there yet" });
  else if (!partial) out.push({ kind: "start", path: typed, create: false, label: `Start in ${typed}`, detail: listing.path });
  else if ((listing.dirs ?? []).includes(partial)) out.push({ kind: "start", path: typed, create: false, label: `Start in ${typed}` });
  else out.push({ kind: "start", path: typed, create: true, label: `Create ${typed} and start`, detail: "No folder by that name yet" });
  if (listing?.state === "dir") for (const name of matchDirs(listing.dirs, partial).slice(0, 200)) out.push({ kind: "dir", name });
  if (!partial) {
    const seen = new Set([typed]);
    for (const f of recent ?? []) {
      const p = finalPath(f);
      if (!f || seen.has(p)) continue;
      seen.add(p);
      out.push({ kind: "recent", path: p });
    }
  }
  return out;
}
