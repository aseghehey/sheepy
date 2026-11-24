import { useEffect, useState } from "react";
import { core } from "../lib/core";
import { parsePrompt, choose, clean } from "../lib/prompt.js";
import { Markdown } from "./Markdown";

// The agent is waiting on a menu (a question it asked, a permission): its
// choices as buttons. The terminal's screen says what's selected; the log has
// the question in the agent's own words (AskUserQuestion), when it is one.
export function QuestionCard({ address, transcript }: { address: string; transcript: any; version?: number }) {
  const [screen, setScreen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => core.screen(address, 60).then((s) => alive && setScreen(s)).catch(() => {});
    read();
    const t = setInterval(read, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [address]);

  const q = screen ? parsePrompt(screen) : null;
  const items = (transcript?.entries ?? []).flatMap((e: any) => (e.kind === "tools" ? e.items : []));
  const ask = [...items].reverse().find((i: any) => i.name === "AskUserQuestion" && i.result == null && i.questions?.length);
  const norm = (x: string) => (x ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const question = ask ? (ask.questions.find((x: any) => q && norm(q.question).includes(norm(x.question).slice(0, 40))) ?? ask.questions[0]) : null;
  const keys = (k: string[]) => core.keys(address, k).then(() => setTimeout(() => core.screen(address, 60).then(setScreen), 300));

  return (
    <div className="question">
      <div className="question-head">The agent is asking</div>
      {question?.header && <div className="chip">{question.header}</div>}
      {(question?.question || q?.question) && <Markdown text={question?.question ?? q!.question} />}
      {q ? (
        <div className="choices">
          {q.options.map((o: string, n: number) => {
            const opt = question?.options?.[n];
            return (
              <button key={n} className={`choice ${n === q.selected ? "on" : ""}`} onClick={() => keys(choose(q.selected, n))}>
                <span className="choice-n">{n + 1}</span>
                <span className="choice-body">
                  <span className="choice-label">{opt?.label ?? clean(o)}</span>
                  {opt?.description && <span className="choice-desc">{opt.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ) : screen ? <pre className="output">{screen.split("\n").filter((l) => l.trim()).slice(-20).join("\n")}</pre> : null}
      <div className="question-keys">
        {!q && <><button onClick={() => keys(["up"])}>↑</button><button onClick={() => keys(["down"])}>↓</button><button onClick={() => keys(["enter"])}>Enter</button></>}
        <button onClick={() => keys(["esc"])}>Esc</button>
      </div>
    </div>
  );
}
