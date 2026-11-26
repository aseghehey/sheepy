// Messages sent while the agent works: shown as queued until they're in the
// conversation. Plain functions, tested in test/queue.test.js.

const norm = (s) => String(s ?? "").replace(/<\/?pasted_content[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// What Claude Code queues for itself (a background task's or monitor's
// notification, another session's message): not the person's.
const OWN = /^<(task-notification|cross-session-message|system-reminder|local-command|command-)/;

// A message of the person's in the conversation is this one: the same text,
// or one holding it (Claude Code wraps a long paste in <pasted_content>).
const taken = (recent, t) => recent.some((r) => r === t || (t.length >= 12 && r.includes(t)));

/**
 * What to show under the conversation, oldest first: [{ id, text, state }]
 * with state "queued" (in Claude Code's own queue, as its log says, or sent
 * while it works) or "sending" (just sent, not seen anywhere yet). A sent
 * message drops out once a message of the person's with its text is among
 * the conversation's last ones. `pending`: [{ id, text, at, working }] as
 * sent from here; `entries`: the transcript's; `queue`: the texts Claude
 * Code's log has queued and not yet taken. `busy`: the agent is working
 * (or asking). Claude Code takes what's queued as soon as it's ready, so
 * while it's idle nothing is: the log's queue then is only operations this
 * window didn't see (an older part of a long log, a restart), never shown.
 */
export function queuedView(pending, entries, queue, busy = true) {
  const recent = (entries ?? []).slice(-30).filter((e) => e.kind === "user").map((e) => norm(e.text));
  const inQueue = busy ? (queue ?? []).filter((q) => !OWN.test(String(q ?? "").trimStart())).map(norm).filter(Boolean) : [];
  const out = [];
  const shown = new Set();
  for (const text of inQueue) {
    if (shown.has(text)) continue;
    shown.add(text);
    out.push({ id: `q:${text}`, text, state: "queued" });
  }
  for (const p of pending ?? []) {
    const t = norm(p.text);
    if (!t || taken(recent, t) || shown.has(t)) continue;
    shown.add(t);
    out.push({ id: p.id, text: p.text, state: p.working ? "queued" : "sending" });
  }
  return out;
}

/**
 * The sent messages still to show: not in the conversation yet, sent less
 * than half an hour ago, and, once the agent is idle again, sent in the last
 * 15 s (an idle agent has taken whatever it was sent).
 */
export function stillPending(pending, entries, now = Date.now(), busy = true) {
  const recent = (entries ?? []).slice(-30).filter((e) => e.kind === "user").map((e) => norm(e.text));
  return (pending ?? []).filter((p) => !taken(recent, norm(p.text)) && now - p.at < (busy ? 30 * 60000 : 15000));
}
