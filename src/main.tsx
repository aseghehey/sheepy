import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./styles.css";
import { parseView } from "./lib/view.js";
import { error as logError } from "@tauri-apps/plugin-log";

// The window's own errors go to the log file too (Show logs in ⌘K).
window.addEventListener("error", (e) => { logError(`window: ${e.message} at ${e.filename}:${e.lineno}`).catch(() => {}); });
window.addEventListener("unhandledrejection", (e) => { logError(`window: unhandled ${String(e.reason?.stack ?? e.reason)}`).catch(() => {}); });

// Light, dark, or as the Mac is set: before the first frame, so it doesn't flash.
document.documentElement.dataset.theme = parseView(localStorage.getItem("view")).theme;

// Development only: draw the window to a PNG when Sheepy's Rust side asks
// (see watch_snapshot_requests), for checking changes without a screen capture.
if (import.meta.env.DEV) {
  Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core"), import("html-to-image")]).then(([ev, core, h2i]) => {
    ev.listen("snapshot", async () => {
      const data = await h2i.toPng(document.body, { pixelRatio: 1, backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#fff" });
      await core.invoke("save_snapshot", { data });
      const entries = [...document.querySelectorAll(".entry")];
      console.warn("SNAPSHOT entries", entries.length, JSON.stringify(entries.slice(0, 3).map((e) => [e.getBoundingClientRect().top, e.getBoundingClientRect().height, (e as HTMLElement).innerText.slice(0, 80)])),
        "scroller", JSON.stringify([...document.querySelectorAll("[data-virtuoso-scroller]")].map((e) => [e.scrollTop, e.scrollHeight, e.clientHeight])));
    });
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary label="window">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
