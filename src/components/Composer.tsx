import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { core } from "../lib/core";
import { annotationMessage } from "../lib/anno.js";
import { parsePrompt, choose, freeTextOption } from "../lib/prompt.js";
import type { Anno } from "./Annotations";

// The message box: Enter sends, Shift+Enter starts a new line, Escape (or
// Stop) interrupts a working agent. What's typed and not sent is kept per
// session. It's a plain text area: the Mac's own editing, spelling, Look Up,
// Services and right-click menu come with it.
export function Composer({ address, working, blocked = false, annos = [], onSentAnnos }: { address: string; working: boolean; blocked?: boolean; annos?: Anno[]; onSentAnnos?: () => void }) {
  const key = `draft:${address}`;
  const [text, setText] = useState(() => localStorage.getItem(key) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  }, [key, text]);

  // Grows with what's typed, up to a third of the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 3)}px`;
  }, [text]);

  useEffect(() => { box.current?.focus(); }, [address]);

  const send = async () => {
    // Queued annotations go with it: each quote and its comment, then what's typed.
    const message = annos.length ? annotationMessage(annos, text) : text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      try {
        await core.send(address, message);
      } catch (e) {
        if (!String(e).startsWith("blocked:")) throw e;
        await answerWith(message);
      }
      setText("");
      if (annos.length) onSentAnnos?.();
    } catch (e) {
      setError(String(e).replace(/^blocked: /, ""));
    } finally {
      setSending(false);
      box.current?.focus();
    }
  };

  // The agent waits on a question: a message is its answer when the
  // question takes the person's own words ("Type something."), chosen first;
  // else it has to be answered in the card.
  const answerWith = async (message: string) => {
    const q = parsePrompt(await core.screen(address, 60));
    const i = q ? freeTextOption(q.options) : -1;
    if (!q || i < 0) throw new Error("The agent is waiting on a question: answer it in the card above (or press Esc there to dismiss it).");
    // Only move to it (no Enter: that could submit it empty), then type the
    // answer and press Enter once.
    const moves = choose(q.selected, i).slice(0, -1);
    if (moves.length) await core.keys(address, moves);
    await new Promise((r) => setTimeout(r, 300));
    await core.send(address, message, true);
  };

  const stop = () => core.interrupt(address).catch((e) => setError(String(e)));

  return (
    <div className="composer-wrap">
      {error && <div className="banner">{error}</div>}
      <div className="composer">
        <textarea
          ref={box}
          value={text}
          rows={1}
          placeholder={blocked ? "Answer the question above, or type your own answer" : "Message Claude"}
          spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            else if (e.key === "Escape" && working) { e.preventDefault(); stop(); }
          }}
        />
        {working && !text.trim() && !annos.length ? (
          <button className="send stop" title="Stop (Esc)" onClick={stop}>■</button>
        ) : (
          <button className="send" title="Send (Enter)" disabled={(!text.trim() && !annos.length) || sending} onClick={send}>↑</button>
        )}
      </div>
    </div>
  );
}
