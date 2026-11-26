// The whole window, drawn from what herdr-core reports.
import { describe, expect, it } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import App from "../src/App";
import { handlers, emit, callsOf } from "./tauri";

const claude = (address: string, extra: any = {}) => ({
  address, state: "live", agent: "claude", title: null,
  foreground: { name: "claude", pid: 100 + address.length, cwd: "/home/me/code/shop" },
  labels: {}, status: { app: "claude-code", state: "idle" }, ...extra,
});

function serve(terminals: any[]) {
  handlers.terminals = () => ({ terminals });
  handlers.machines = () => ({ machines: [{ name: "devdesk", state: "connected" }] });
  handlers.ssh_hosts = () => ["devdesk"];
  handlers.machine_stats = () => { throw "no stats in tests"; };
  handlers.newer_installed = () => false;
  handlers.models = ({ pids }: any) => pids.map((pid: number) => ({ pid, model: "global.anthropic.claude-opus-5-5", effort: "high", at: "2026-11-25T10:00:00Z" }));
}

describe("the window", () => {
  it("lists sessions under their host and group, with model and effort", async () => {
    serve([
      claude("t1", { title: "Fix checkout", labels: { "sheepy.group": "Shop" } }),
      claude("devdesk/t2", { title: "Router work", foreground: { name: "claude", pid: 7, cwd: "/srv/api" } }),
    ]);
    render(<App />);
    expect(await screen.findByText("Fix checkout")).toBeTruthy();
    expect(screen.getByText("Router work")).toBeTruthy();
    expect(screen.getByText("Shop")).toBeTruthy();
    expect(screen.getByText("devdesk")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Opus 5.5 · high").length).toBe(2));
  });

  it("still draws when a session has only just started (no status yet)", async () => {
    // A terminal herdr-core has just started reports status: null; this once
    // blanked the whole window.
    serve([claude("devdesk/t20", { title: "New one", status: null }), claude("t1", { title: "Other" })]);
    render(<App />);
    expect(await screen.findByText("New one")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
    expect(screen.queryByText(/hit a problem/)).toBeNull();
  });

  it("updates from the event feed, and leaves out what isn't Claude Code", async () => {
    serve([claude("t1", { title: "First" })]);
    render(<App />);
    await screen.findByText("First");
    emit("terminals", { terminals: [
      claude("t1", { title: "First" }),
      claude("t3", { title: "Second" }),
      { address: "t4", state: "live", foreground: { name: "zsh", pid: 9 }, title: "a shell", labels: {} },
    ] });
    expect(await screen.findByText("Second")).toBeTruthy();
    expect(screen.queryByText("a shell")).toBeNull();
  });

  it("shows when herdr-core can't be reached instead of breaking", async () => {
    serve([]);
    handlers.terminals = () => { throw "can't run herdr-core: No such file or directory"; };
    render(<App />);
    expect(await screen.findByText(/can't run herdr-core/)).toBeTruthy();
  });

  it("opens a session in the conversation pane when clicked", async () => {
    serve([claude("t1", { title: "Fix checkout" })]);
    handlers.locate = () => null; // no log written yet
    render(<App />);
    fireEvent.click(await screen.findByText("Fix checkout"));
    const header = await waitFor(() => document.querySelector(".chat-head") as HTMLElement);
    expect(within(header).getByText("Fix checkout")).toBeTruthy();
    await waitFor(() => expect(callsOf("locate").length).toBeGreaterThan(0));
  });
});
