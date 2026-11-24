// Find in a conversation: which entries match, in order. Tested in test/findin.test.js.

/** The text of an entry a person would search: messages, notes, tool calls and their results. */
export function entryText(e) {
  if (!e) return "";
  if (e.kind === "tools") return (e.items ?? []).map((i) => `${i.name} ${i.summary ?? ""} ${i.result ?? ""}`).join("\n");
  return `${e.text ?? ""}${e.summary ? `\n${e.summary}` : ""}`;
}

/** The words of a query, lowercased (quoted phrases kept together). */
export function queryWords(q) {
  const words = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q ?? ""))) words.push((m[1] ?? m[2]).toLowerCase());
  return words.filter((w) => w.length > 0);
}

/** Indexes of the entries containing every word of `q`. */
export function findEntries(entries, q) {
  const words = queryWords(q);
  if (!words.length) return [];
  const out = [];
  (entries ?? []).forEach((e, i) => {
    const t = entryText(e).toLowerCase();
    if (words.every((w) => t.includes(w))) out.push(i);
  });
  return out;
}

/** The match to go to from `current` (an index into `hits`), one step `dir` (-1 older, +1 newer), wrapping. */
export function step(hits, current, dir) {
  if (!hits.length) return -1;
  if (current < 0) return dir < 0 ? hits.length - 1 : 0;
  return (current + dir + hits.length) % hits.length;
}
