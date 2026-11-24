// Messages sent while the agent works: shown as queued until they're in the
// conversation. Plain functions, tested in test/queue.test.js.

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * What to show under the conversation, oldest first: [{ id, text, state }]
 * with state "queued" (in Claude Code's own queue, as its log says, or sent
 * while it works) or "sending" (just sent, not seen anywhere yet). A sent
 * message drops out once a message of the person's with its text is among
 * the conversation's last ones. `pending`: [{ id, text, at, working }] as
 * sent from here; `entries`: the transcript's; `queue`: the texts Claude
 * Code's log has queued and not yet taken.
 */
export function queuedView(pending, entries, queue) {
  const recent = (entries ?? []).slice(-30).filter((e) => e.kind === "user").map((e) => norm(e.text));
  const taken = new Set(recent);
  const inQueue = (queue ?? []).map(norm).filter(Boolean);
  const out = [];
  const shown = new Set();
  for (const text of inQueue) {
    if (shown.has(text)) continue;
    shown.add(text);
    out.push({ id: `q:${text}`, text, state: "queued" });
  }
  for (const p of pending ?? []) {
    const t = norm(p.text);
    if (!t || taken.has(t) || shown.has(t)) continue;
    shown.add(t);
    out.push({ id: p.id, text: p.text, state: p.working ? "queued" : "sending" });
  }
  return out;
}

/** The sent messages still to show (the others are in the conversation now, or too old). */
export function stillPending(pending, entries, now = Date.now()) {
  const recent = new Set((entries ?? []).slice(-30).filter((e) => e.kind === "user").map((e) => norm(e.text)));
  return (pending ?? []).filter((p) => !recent.has(norm(p.text)) && now - p.at < 30 * 60000);
}
