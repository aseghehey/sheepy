import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Text to the clipboard: the browser's way, else the old one. */
export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
  }
}

// A code block with a Copy button (shown on hover), copying the code as it
// is, without the Markdown fence.
function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyToClipboard((pre.current?.innerText ?? "").replace(/\n$/, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="code-block">
      <pre ref={pre}>{children}</pre>
      <button className={`code-copy ${copied ? "done" : ""}`} onClick={copy} title="Copy code">{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

// A message's Markdown. No raw HTML (react-markdown leaves it out), so what an
// agent or a tool printed can't run anything here; links open in the browser.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} onClick={(e) => { e.preventDefault(); if (href && /^https?:/.test(href)) openUrl(href); }}>{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
