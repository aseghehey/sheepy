// Reads a question an agent asks on its terminal screen (a trust or
// permission prompt): the question's text and its choices, if it has any.

const MARKER = /^(\s*)([❯›>])\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HINT = /(Enter to (confirm|select)|Esc to (cancel|exit)|↑\/↓|to navigate)/i;
const RULE = /^\s*[─━—\-▔▁═]{8,}\s*$/;

// A menu waiting at the bottom of the screen: its hint line ("Enter to confirm ·
// Esc to cancel") is among the last lines. "form" when ←/→ change its values,
// which a pick-one list can't show.
export function menuAtBottom(screen) {
  let lines = (screen ?? "").split("\n").filter((l) => l.trim());
  // Claude keeps its input box (a rule, ❯, a rule, its footer) under the menu.
  const rules = lines.flatMap((l, i) => (RULE.test(l) ? [i] : []));
  const box = rules.at(-2);
  if (box !== undefined && lines.length - box <= 6 && /^\s*❯/.test(lines[box + 1] ?? "")) lines = lines.slice(0, box);
  const hint = lines.slice(-2).find((l) => HINT.test(l));
  return hint ? (/←|→|to change/.test(hint) ? "form" : "menu") : null;
}

// The progress row of a question in several parts ("← ☐ Log level ☐ Cache
// ✔ Submit →"): each part and whether it's answered (✔/☒).
const STEPS = /^\s*←?\s*((?:[☐☑☒✔✓□■]\s*[^☐☑☒✔✓□■←→]+?\s*)+)→?\s*$/u;
function stepsOf(line) {
  const m = STEPS.exec(line ?? "");
  if (!m) return null;
  const out = [...m[1].matchAll(/([☐☑☒✔✓□■])\s*([^☐☑☒✔✓□■]+)/gu)].map((x) => ({ label: x[2].trim(), done: /[☑☒✔✓■]/u.test(x[1]) }));
  return out.length >= 2 ? out : null;
}

// { question, options: [label], details: [text], selected, steps } or null
// when the screen has no menu. `details`: each option's description, the
// lines under its label. `steps`: the parts of a question in several.
export function parsePrompt(screen) {
  // A ✔ marks the current choice; read it as an indent, so its line lines up.
  const current = new Set();
  const lines = (screen ?? "").split("\n").map((l, i) => {
    const m = /^(\s*(?:[❯›>]\s+)?)[✔✓]\s/.exec(l);
    if (!m) return l;
    current.add(i);
    return m[1] + "  " + l.slice(m[0].length);
  });
  const at = lines.findLastIndex((l) => MARKER.test(l) && !HINT.test(l));
  if (at < 0) return null;
  // Unselected options sit where the marker's text starts; deeper lines continue one.
  const indent = MARKER.exec(lines[at])[0].length;
  const depth = (l) => l.length - l.trimStart().length;
  const isOption = (l) => MARKER.test(l) || (l.trim() && depth(l) === indent && !HINT.test(l) && !RULE.test(l));
  const continues = (l) => l.trim() && depth(l) > indent && !HINT.test(l) && !RULE.test(l);

  let first = at;
  while (first > 0 && (isOption(lines[first - 1]) || continues(lines[first - 1]))) first--;
  while (first < at && !isOption(lines[first])) first++;
  let last = at;
  while (last + 1 < lines.length && (isOption(lines[last + 1]) || continues(lines[last + 1]))) last++;
  const options = [];
  const details = [];
  let selected = 0;
  const take = (i) => {
    const l = lines[i];
    const text = clean(l.replace(MARKER, "").replace(NUMBER, ""));
    if (!isOption(l)) { details[details.length - 1] = `${details[details.length - 1]} ${text}`.trim(); return; }
    if (i === at) selected = options.length;
    options.push(current.has(i) ? `${text} ✓` : text);
    details.push("");
  };
  for (let i = first; i <= last; i++) take(i);
  // Numbered options can go on past a rule line ("4. Chat about this").
  for (let i = last + 1; i < lines.length; i++) {
    if (RULE.test(lines[i]) || !lines[i].trim()) continue;
    const n = /^\s*(?:[❯›>]\s+)?(\d+)[.)]\s+/.exec(lines[i]);
    if (!n || Number(n[1]) !== options.length + 1) break;
    if (MARKER.test(lines[i])) selected = options.length;
    options.push(clean(lines[i].replace(MARKER, "").replace(NUMBER, "")));
    details.push("");
  }
  if (options.length < 2) return null;

  // The question: what's above the options, back to the last rule line,
  // without a progress row (kept as `steps`).
  let top = first;
  while (top > 0 && !RULE.test(lines[top - 1])) top--;
  let steps = null;
  const above = lines.slice(top, first).filter((l) => {
    const st = stepsOf(l);
    if (st) { steps = st; return false; }
    return true;
  });
  const question = reflow(above);
  return { question, options, details, selected, steps };
}

// Terminal-wrapped text as paragraphs, without the frame the terminal draws
// around it (box edges) or its checkbox and tab glyphs.
export function reflow(lines) {
  return lines.map((l) => clean(l)).join("\n").replace(/\n{2,}/g, "\u0000").replace(/\n/g, " ")
    .split("\u0000").map((p) => p.trim()).filter(Boolean).join("\n\n");
}

export function clean(l) {
  return l.replace(/^[\s│┃|]+|[\s│┃|]+$/g, "").replace(/^[□☐☑☒■◻◼]\s*/u, "").replace(/\s+[│┃]\s+/g, " ").trim();
}

// The keys that move the selection from `from` to `to` and confirm it.
export function choose(from, to) {
  const keys = Array(Math.abs(to - from)).fill(to > from ? "down" : "up");
  return [...keys, "enter"];
}

// The option of a question menu that takes the person's own words ("Type
// something.", "Other"), or -1. Once something is typed in it, it shows that
// instead: then it's the one just above "Chat about this". Never "Chat about
// this" itself, which sets the question aside.
export function freeTextOption(options) {
  const o = options ?? [];
  const i = o.findIndex((x) => isTypeOption(x));
  if (i >= 0) return i;
  const chat = o.findIndex((x) => /^chat about this\b/i.test(String(x).trim()));
  return chat >= 2 ? chat - 1 : -1;
}

// What's already typed in the free-text option `i` ("" when it's empty).
export function typedIn(q, i) {
  const o = String(q?.options?.[i] ?? "").replace(/ ✓$/, "");
  return i < 0 || isTypeOption(o) ? "" : o;
}

// The keys that put the selection on the free-text option `i` and empty it,
// without Enter (that would submit it): then the answer is pasted and sent.
export function toFreeText(q, i) {
  const moves = choose(q.selected, i).slice(0, -1);
  const typed = typedIn(q, i);
  return typed ? [...moves, "end", ...Array(typed.length + 20).fill("backspace")] : moves;
}

// An option whose answer is the person's own words: "Type something.", "Other".
export function isTypeOption(label) {
  return /^(type something|other|something else)\b/i.test(String(label ?? "").replace(/^\d+[.)]\s*/, "").trim());
}
