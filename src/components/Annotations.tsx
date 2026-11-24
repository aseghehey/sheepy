import { useEffect, useRef, useState } from "react";

export interface Anno { id: string; quote: string; comment: string }

/** A session's queued annotations, kept across restarts. */
export function useAnnotations(address: string) {
  const key = `annos:${address}`;
  const [annos, setAnnos] = useState<Anno[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(v) ? v.filter((a) => a && typeof a.quote === "string" && a.quote.trim()) : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (annos.length) localStorage.setItem(key, JSON.stringify(annos));
    else localStorage.removeItem(key);
  }, [key, annos]);
  const add = (quote: string, comment = "") => setAnnos((l) => [...l, { id: `${Date.now()}-${l.length}`, quote: quote.trim(), comment }]);
  const update = (id: string, comment: string) => setAnnos((l) => l.map((a) => (a.id === id ? { ...a, comment } : a)));
  const remove = (id: string) => setAnnos((l) => l.filter((a) => a.id !== id));
  const clear = () => setAnnos([]);
  return { annos, add, update, remove, clear };
}

interface Picked { text: string; x: number; y: number }

/**
 * The “” button at a highlight inside `root`'s replies, and the comment box
 * it opens there. Enter puts the quote and comment in the queue; Escape
 * cancels. The highlight is read when the mouse is let go, so the button
 * always quotes exactly what's highlighted.
 */
export function QuoteLayer({ root, onAdd }: { root: React.RefObject<HTMLElement | null>; onAdd: (quote: string, comment: string) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [composing, setComposing] = useState<Picked | null>(null);
  const [comment, setComment] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || !text || sel.rangeCount === 0) return setPicked(null);
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
      // Only highlights in the conversation's replies and messages.
      if (!el || !root.current?.contains(el) || !el.closest(".msg-row")) return setPicked(null);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      setPicked({ text, x: last.right, y: last.bottom });
    };
    const up = () => setTimeout(read, 0);
    const keyup = (e: KeyboardEvent) => { if (e.shiftKey || e.key === "a") read(); };
    const changed = () => { if (!window.getSelection()?.toString().trim()) setPicked(null); };
    document.addEventListener("mouseup", up);
    document.addEventListener("keyup", keyup);
    document.addEventListener("selectionchange", changed);
    const scroller = root.current?.querySelector("[data-virtuoso-scroller]");
    const hide = () => setPicked(null);
    scroller?.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("mouseup", up);
      document.removeEventListener("keyup", keyup);
      document.removeEventListener("selectionchange", changed);
      scroller?.removeEventListener("scroll", hide);
    };
  }, [root]);

  useEffect(() => { if (composing) box.current?.focus(); }, [composing]);

  const commit = () => {
    if (composing) onAdd(composing.text, comment.trim());
    setComposing(null);
    setComment("");
  };

  const clamp = (x: number, w: number) => Math.max(8, Math.min(x, window.innerWidth - w - 8));
  return (
    <>
      {picked && !composing && (
        <button className="quote-pill" style={{ left: clamp(picked.x + 4, 44), top: picked.y + 4 }}
          title="Quote this (then comment)"
          onMouseDown={(e) => { e.preventDefault(); setComposing(picked); setPicked(null); window.getSelection()?.removeAllRanges(); }}>
          “”
        </button>
      )}
      {composing && (
        <div className="quote-box" style={{ left: clamp(composing.x - 160, 360), top: Math.min(composing.y + 8, window.innerHeight - 200) }}>
          <div className="quote-text">{composing.text}</div>
          <textarea ref={box} rows={2} value={comment} placeholder="Comment (optional)" spellCheck
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { e.preventDefault(); setComposing(null); setComment(""); }
            }} />
          <div className="quote-actions">
            <span className="hint">Enter adds it to the queue · Esc cancels</span>
            <button onClick={() => { setComposing(null); setComment(""); }}>Cancel</button>
            <button className="primary" onClick={commit}>Add</button>
          </div>
        </div>
      )}
    </>
  );
}

/** The queue above the message box: each quote with its comment, editable. */
export function AnnotationTray({ annos, update, remove, clear }: { annos: Anno[]; update: (id: string, c: string) => void; remove: (id: string) => void; clear: () => void }) {
  const [open, setOpen] = useState(true);
  if (!annos.length) return null;
  return (
    <div className="tray">
      <div className="tray-head">
        <button onClick={() => setOpen(!open)}><span className={`chev ${open ? "open" : ""}`}>›</span> “” {annos.length} quote{annos.length === 1 ? "" : "s"} go with your next message</button>
        <button className="link" onClick={clear}>Clear</button>
      </div>
      {open && (
        <div className="tray-list">
          {annos.map((a) => (
            <div key={a.id} className="tray-item">
              <div className="quote-text">{a.quote}</div>
              <input value={a.comment} placeholder="Comment" spellCheck onChange={(e) => update(a.id, e.target.value)} />
              <button className="x" title="Remove" onClick={() => remove(a.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
