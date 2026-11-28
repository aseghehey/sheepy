// Hiding and showing the sidebar.
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../src/App";
import { handlers } from "./tauri";

function serve() {
  handlers.terminals = () => ({ terminals: [{ address: "t1", state: "live", agent: "claude", title: "Fix checkout",
    foreground: { name: "claude", pid: 7, cwd: "/srv/shop" }, labels: {}, status: { state: "idle" } }] });
  handlers.machines = () => ({ machines: [] });
  handlers.ssh_hosts = () => [];
  handlers.models = () => [];
  handlers.list_dirs = () => ({ state: "dir", path: "/home/me", dirs: [] });
}
const sidebar = () => document.querySelector("aside.sidebar") as HTMLElement;
const savedView = () => JSON.parse(localStorage.getItem("view") ?? "{}");

describe("the sidebar", () => {
  it("hides with its button and comes back with the one that takes its place", async () => {
    serve();
    render(<App />);
    await screen.findByText("Fix checkout");
    fireEvent.click(screen.getByLabelText("Hide sidebar"));
    expect(sidebar().classList.contains("hidden")).toBe(true);
    expect(sidebar().getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".app")!.classList.contains("no-sidebar")).toBe(true);
    expect(savedView().sidebar).toBe(false);
    fireEvent.click(screen.getByLabelText("Show sidebar"));
    expect(sidebar().classList.contains("hidden")).toBe(false);
    expect(screen.queryByLabelText("Show sidebar")).toBeNull();
    expect(savedView().sidebar).toBe(true);
  });

  it("toggles with ⌃⌘S, and ⌘S alone does nothing", async () => {
    serve();
    render(<App />);
    await screen.findByText("Fix checkout");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(sidebar().classList.contains("hidden")).toBe(false);
    fireEvent.keyDown(window, { key: "s", metaKey: true, ctrlKey: true });
    expect(sidebar().classList.contains("hidden")).toBe(true);
    fireEvent.keyDown(window, { key: "s", metaKey: true, ctrlKey: true });
    expect(sidebar().classList.contains("hidden")).toBe(false);
  });

  it("stays hidden after a restart, and says how to bring it back", async () => {
    serve();
    localStorage.setItem("view", JSON.stringify({ sidebar: false }));
    render(<App />);
    await waitFor(() => expect(sidebar().classList.contains("hidden")).toBe(true));
    expect(screen.getByText(/Show the sidebar \(⌃⌘S\)/)).toBeTruthy();
  });

  it("still starts a new session from ⌘K while hidden", async () => {
    serve();
    localStorage.setItem("view", JSON.stringify({ sidebar: false }));
    render(<App />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(await screen.findByText("New session…"));
    expect(await screen.findByLabelText("Folder")).toBeTruthy();
  });
});
