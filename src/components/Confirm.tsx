import { useEffect, useRef } from "react";

export interface ConfirmRequest {
  title: string;
  body: string;
  action: string;
  run: () => Promise<void> | void;
}

// Asking before something that can't be undone. The focus starts on Cancel,
// so Enter alone never confirms; Escape or a click outside cancels.
export function Confirm({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (request) setTimeout(() => cancel.current?.focus(), 0); }, [request]);
  if (!request) return null;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
      <div className="confirm" role="alertdialog" aria-labelledby="confirm-title">
        <div id="confirm-title" className="confirm-title">{request.title}</div>
        <div className="confirm-body">{request.body}</div>
        <div className="form-actions">
          <button ref={cancel} onClick={onClose}>Cancel</button>
          <button className="danger" onClick={async () => { onClose(); await request.run(); }}>{request.action}</button>
        </div>
      </div>
    </div>
  );
}
