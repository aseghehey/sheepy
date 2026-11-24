import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { core } from "../lib/core";

// The message box: Enter sends, Shift+Enter starts a new line, Escape (or
// Stop) interrupts a working agent. What's typed and not sent is kept per
// session. It's a plain text area: the Mac's own editing, spelling, Look Up,
// Services and right-click menu come with it.
export function Composer({ address, working }: { address: string; working: boolean }) {
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
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await core.send(address, message);
      setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
      box.current?.focus();
    }
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
          placeholder="Message Claude"
          spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            else if (e.key === "Escape" && working) { e.preventDefault(); stop(); }
          }}
        />
        {working && !text.trim() ? (
          <button className="send stop" title="Stop (Esc)" onClick={stop}>■</button>
        ) : (
          <button className="send" title="Send (Enter)" disabled={!text.trim() || sending} onClick={send}>↑</button>
        )}
      </div>
    </div>
  );
}
