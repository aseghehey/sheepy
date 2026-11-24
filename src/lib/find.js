// Finding inside a conversation: which words a search matched, and marking them
// in a message's markdown (bold), never inside code.

// The words a hit's highlights cover, lowercased, from every hit given.
export function matchedWords(hits) {
  const words = new Set();
  for (const h of hits ?? []) {
    for (const [s, e] of h.highlights ?? []) {
      const w = (h.snippet ?? "").slice(s, e).trim().toLowerCase();
      if (w.length >= 2) words.add(w);
    }
  }
  return [...words];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `text` with each of `words` in bold where it starts a word, outside fenced
// and inline code (bold there would show the asterisks).
export function markWords(text, words) {
  if (!text || !words?.length) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_*])(${words.map(escapeRe).join("|")})[\\p{L}\\p{N}]*`, "giu");
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/)
    .map((part, i) => (i % 2 === 1 ? part : part.split(/(`[^`\n]*`)/).map((p, j) => (j % 2 === 1 ? p : p.replace(re, "**$&**"))).join("")))
    .join("");
}
