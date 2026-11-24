// Annotations: quotes of an agent's replies, each with a comment, sent together
// as one message. The parts here are plain functions, so they can be tested
// without Herdr (see test/anno.test.js).

// What a text view reported about its selection (on_selection_change), in one
// shape: the text, trimmed, and where the highlight ends inside the view when
// this Herdr says (`lx`, `ly`; `inline` then, so the button can be drawn there).
// Older Herdr builds report a string, or an object without the local point.
export function selectionReport(sel) {
  const text = (typeof sel === "string" ? sel : sel?.text ?? "").trim();
  const lx = typeof sel === "object" && Number.isFinite(sel?.local_x) ? sel.local_x : null;
  const ly = typeof sel === "object" && Number.isFinite(sel?.local_y) ? sel.local_y : null;
  const inline = lx != null && ly != null;
  return inline ? { text, lx, ly, inline } : { text, inline };
}

// Where the “” button goes in a message `width` wide: just after where the
// highlight ends, kept inside the message (a highlight ending at the right
// edge would otherwise put it past the column, out of reach).
export function pillPosition(sel, width, pillWidth = 44) {
  const maxLeft = Math.max(0, width - pillWidth);
  return { left: clamp(sel.lx + 4, 0, maxLeft), top: Math.max(0, sel.ly - 4) };
}

// Where the comment box goes: under the line the highlight ends on, as far
// left as it can start near the highlight's end, inside the message.
export function composerPosition(d, width, boxWidth, lineHeight) {
  return { left: clamp(d.lx - 24, 0, Math.max(0, width - boxWidth)), top: Math.max(0, d.ly + lineHeight * 0.75) };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// A quote as Markdown: every line of it quoted, blank lines included (an
// unquoted blank line would end the quote there), line endings made plain.
export function quoteBlock(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  return lines.map((l) => (l.trim() ? `> ${l.replace(/\s+$/, "")}` : ">")).join("\n");
}

// The message the annotations and what's typed make together: each quote with
// its comment under it, then what was typed. Annotations with nothing quoted
// are skipped; an empty result means there is nothing to send.
export function annotationMessage(annos, typed = "") {
  const parts = [];
  for (const a of annos ?? []) {
    const quote = String(a?.quote ?? "").trim();
    if (!quote) continue;
    const comment = String(a?.comment ?? "").trim();
    parts.push(comment ? `${quoteBlock(quote)}\n\n${comment}` : quoteBlock(quote));
  }
  const extra = String(typed ?? "").trim();
  if (extra) parts.push(extra);
  return parts.join("\n\n");
}

// The unsent message and annotations, as kept across a rebuild of the view.
// `null` when there's nothing worth keeping.
export function draftJSON(text, annos) {
  const kept = (annos ?? [])
    .map((a) => ({ quote: String(a?.quote ?? ""), comment: String(a?.comment ?? "") }))
    .filter((a) => a.quote.trim());
  const t = String(text ?? "");
  if (!t.trim() && !kept.length) return null;
  return JSON.stringify({ v: 1, text: t, annos: kept });
}

// A kept draft back, whatever was stored (an older shape, a broken string,
// nothing): always { text, annos } with strings in it.
export function parseDraft(stored) {
  let d = null;
  try { d = JSON.parse(stored ?? "null"); } catch (_) { d = null; }
  if (!d || typeof d !== "object") return { text: "", annos: [] };
  const text = typeof d.text === "string" ? d.text : "";
  const annos = Array.isArray(d.annos)
    ? d.annos
      .filter((a) => a && typeof a.quote === "string" && a.quote.trim())
      .map((a) => ({ quote: a.quote, comment: typeof a.comment === "string" ? a.comment : "" }))
    : [];
  return { text, annos };
}
