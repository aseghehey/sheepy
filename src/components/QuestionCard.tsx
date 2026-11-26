import { useEffect, useRef, useState } from "react";
import { core } from "../lib/core";
import { parsePrompt, choose, clean, freeTextOption, typedIn, toFreeText } from "../lib/prompt.js";
import { Markdown } from "./Markdown";

// The agent is waiting on a menu (a question it asked, a permission): its
// choices as buttons. The terminal's screen says what's selected and, for a
// question in several parts, which parts are answered; the log has the
// question in the agent's own words (AskUserQuestion), when it is one.
//
// An option that takes the person's own words ("Type something.") opens a
// field here: Enter moves the agent's selection to that option (arrow keys
// only, no Enter there, which would submit it empty), empties what's already
// typed there, then types the answer and presses Enter once.
export function QuestionCard({ address, transcript }: { address: string; transcript: any; version?: number }) {
  const [screen, setScreen] = useState<string | null>(null);
  const [typing, setTyping] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const read = () => core.screen(address, 60).then(setScreen).catch(() => {});
  useEffect(() => {
    let alive = true;
    const tick = () => core.screen(address, 60).then((s) => alive && setScreen(s)).catch(() => {});
    tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [address]);
  useEffect(() => { if (typing != null) field.current?.focus(); }, [typing]);

  const q: any = screen ? parsePrompt(screen) : null;
  const items = (transcript?.entries ?? []).flatMap((e: any) => (e.kind === "tools" ? e.items : []));
  const ask = [...items].reverse().find((i: any) => i.name === "AskUserQuestion" && i.result == null && i.questions?.length);
  const norm = (x: string) => (x ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const question = ask ? (ask.questions.find((x: any) => q && norm(q.question).includes(norm(x.question).slice(0, 40))) ?? null) : null;

  const keys = async (k: string[]) => {
    setError(null);
    try { await core.keys(address, k); } catch (e) { setError(String(e)); }
    setTimeout(read, 250);
  };
  const submit = async (n: number) => {
    const text = answer.trim();
    if (!text || !q) return;
    setBusy(true);
    setError(null);
    try {
      const moves = toFreeText(q, n);
      if (moves.length) await core.keys(address, moves);
      await new Promise((r) => setTimeout(r, 250));
      await core.send(address, text, true);
      setTyping(null);
      setAnswer("");
    } catch (e) { setError(String(e).replace(/^blocked: /, "")); } finally { setBusy(false); setTimeout(read, 300); }
  };

  // Only a real question: a menu on the screen, or one the agent asked in the
  // log that's waiting for its answer. Never the terminal's raw screen.
  if (!q && !question) return null;
  return (
    <div className="question">
      <div className="question-head">
        <span>The agent is asking</span>
        {q?.steps && (
          <span className="steps">
            {q.steps.map((st: any, i: number) => <span key={i} className={`step ${st.done ? "done" : ""}`}>{st.done ? "✓ " : ""}{st.label}</span>)}
          </span>
        )}
      </div>
      {question?.header && <div className="chip">{question.header}</div>}
      {(question?.question || q?.question) && <Markdown text={question?.question ?? q!.question} />}
      {q && (() => { const freeAt = freeTextOption(q.options); return (
        <div className="choices">
          {q.options.map((o: string, n: number) => {
            const opt = question?.options?.[n];
            const free = n === freeAt;
            const draft = free ? typedIn(q, n) : "";
            const label = free ? "Type something" : opt?.label ?? clean(o);
            const desc = free ? (draft ? `Typed so far: ${draft}` : "Your own answer") : opt?.description ?? q.details?.[n] ?? "";
            if (free && typing === n) {
              return (
                <div key={n} className="choice on typing">
                  <span className="choice-n">{n + 1}</span>
                  <span className="choice-body">
                    <textarea ref={field} rows={2} value={answer} placeholder="Your answer" spellCheck disabled={busy}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(n); }
                        else if (e.key === "Escape") { e.preventDefault(); setTyping(null); }
                      }} />
                    <span className="choice-desc">{busy ? "Sending…" : "Enter sends this answer · Esc goes back"}</span>
                  </span>
                </div>
              );
            }
            return (
              <button key={n} className={`choice ${n === q.selected ? "on" : ""}`} disabled={busy}
                onClick={() => (free ? (setTyping(n), setAnswer(draft)) : keys(choose(q.selected, n)))}>
                <span className="choice-n">{n + 1}</span>
                <span className="choice-body">
                  <span className="choice-label">{label}</span>
                  {desc && <span className="choice-desc">{desc}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ); })()}
      {error && <div className="banner">{error}</div>}
      <div className="question-keys">
        {q?.steps && <><button onClick={() => keys(["left"])} title="The previous part">← Back</button><button onClick={() => keys(["right"])} title="The next part">Next →</button></>}
        <button onClick={() => keys(["esc"])}>Esc</button>
      </div>
    </div>
  );
}
