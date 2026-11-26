// The parts of a conversation the person acts through: the question card,
// the message box, the model menu, and what catches a part that breaks.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuestionCard } from "../src/components/QuestionCard";
import { Composer } from "../src/components/Composer";
import { ModelMenu } from "../src/components/ModelMenu";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { handlers, callsOf } from "./tauri";

const MENU = `Which size?

❯ 1. S
     Small
  2. L
     Large
  3. Type something.
────────────────────────────────────────
  4. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel`;

describe("the question card", () => {
  it("shows the agent's choices and picks one with the keys that select it", async () => {
    handlers.screen = () => MENU;
    render(<QuestionCard address="t1" transcript={null} />);
    expect(await screen.findByText("Which size?")).toBeTruthy();
    fireEvent.click(screen.getByText("L"));
    await waitFor(() => expect(callsOf("keys")[0]).toEqual({ address: "t1", keys: ["down", "enter"] }));
  });

  it("types an answer of the person's own: moves to the field without Enter, then sends it once", async () => {
    handlers.screen = () => MENU;
    render(<QuestionCard address="t1" transcript={null} />);
    fireEvent.click(await screen.findByText("Type something"));
    const box = screen.getByPlaceholderText("Your answer");
    fireEvent.change(box, { target: { value: "Medium" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(callsOf("send")).toEqual([{ address: "t1", text: "Medium", force: true }]));
    expect(callsOf("keys")[0].keys).toEqual(["down", "down"]);
    expect(callsOf("keys").flatMap((k) => k.keys)).not.toContain("enter");
  });

  it("draws nothing when there's no menu on the screen", async () => {
    handlers.screen = () => "just some output\n$ ";
    const { container } = render(<QuestionCard address="t1" transcript={null} />);
    await waitFor(() => expect(callsOf("screen").length).toBeGreaterThan(0));
    expect(container.innerHTML).toBe("");
  });

  it("shows a failed key press instead of breaking", async () => {
    handlers.screen = () => MENU;
    handlers.keys = () => { throw "devdesk is unreachable"; };
    render(<QuestionCard address="t1" transcript={null} />);
    fireEvent.click(await screen.findByText("L"));
    expect(await screen.findByText(/devdesk is unreachable/)).toBeTruthy();
  });
});

describe("the message box", () => {
  it("sends on Enter, keeps Shift+Enter for a new line, and clears after sending", async () => {
    const onSent = vi.fn();
    render(<Composer address="t1" working={false} onSent={onSent} />);
    const box = screen.getByPlaceholderText("Message Claude") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Fix the tests" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(callsOf("send")).toEqual([]);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(callsOf("send")).toEqual([{ address: "t1", text: "Fix the tests", force: false }]));
    await waitFor(() => expect(box.value).toBe(""));
    expect(onSent).toHaveBeenCalledWith("Fix the tests", false);
  });

  it("keeps a draft per session", () => {
    const { unmount } = render(<Composer address="t1" working={false} />);
    fireEvent.change(screen.getByPlaceholderText("Message Claude"), { target: { value: "half a thought" } });
    unmount();
    render(<Composer address="t1" working={false} />);
    expect((screen.getByPlaceholderText("Message Claude") as HTMLTextAreaElement).value).toBe("half a thought");
  });

  it("answers a waiting question through its own field when the message can't go in as typed", async () => {
    handlers.send = ({ force }: any) => { if (!force) throw "blocked: t1 is blocked (question)"; };
    handlers.screen = () => MENU;
    render(<Composer address="t1" working={false} blocked />);
    const box = screen.getByPlaceholderText(/Answer the question above/);
    fireEvent.change(box, { target: { value: "Medium" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(callsOf("send").slice(-1)[0]).toEqual({ address: "t1", text: "Medium", force: true }));
    expect(callsOf("keys")[0].keys).toEqual(["down", "down"]);
  });

  it("says why a message didn't go, and keeps it", async () => {
    handlers.send = () => { throw "lost the line to devdesk during the call"; };
    render(<Composer address="devdesk/t1" working={false} />);
    const box = screen.getByPlaceholderText("Message Claude") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText(/lost the line to devdesk/)).toBeTruthy();
    expect(box.value).toBe("hello");
  });

  it("stops a working agent with the stop button", async () => {
    render(<Composer address="t1" working />);
    fireEvent.click(screen.getByTitle("Stop (Esc)"));
    await waitFor(() => expect(callsOf("interrupt")).toEqual([{ address: "t1" }]));
  });
});

describe("the model menu", () => {
  const shown = { model: "Opus 5.5", effort: "high", pending: false };

  it("shows the model and effort, and changes them with Claude Code's own commands", async () => {
    const onChanged = vi.fn();
    render(<ModelMenu address="t1" status="idle" shown={shown} onChanged={onChanged} />);
    fireEvent.click(screen.getByText("Opus 5.5 · high"));
    fireEvent.click(screen.getByText("Sonnet"));
    await waitFor(() => expect(callsOf("send")).toEqual([{ address: "t1", text: "/model sonnet", force: false }]));
    expect(onChanged).toHaveBeenCalledWith({ model: "sonnet" });
    fireEvent.click(screen.getByText("Opus 5.5 · high"));
    fireEvent.click(screen.getByText("xhigh"));
    await waitFor(() => expect(callsOf("send").slice(-1)[0].text).toBe("/effort xhigh"));
  });

  it("can't change anything while Claude works", () => {
    render(<ModelMenu address="t1" status="working" shown={shown} onChanged={() => {}} />);
    fireEvent.click(screen.getByText("Opus 5.5 · high"));
    expect(screen.getByText(/Claude is working/)).toBeTruthy();
    expect((screen.getByText("Sonnet").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a model name that isn't one", () => {
    render(<ModelMenu address="t1" status="idle" shown={shown} onChanged={() => {}} />);
    fireEvent.click(screen.getByText("Opus 5.5 · high"));
    const other = screen.getByPlaceholderText("Other model id");
    fireEvent.change(other, { target: { value: "opus; rm -rf ~" } });
    fireEvent.submit(other.closest("form")!);
    expect(screen.getByText("Not a model name")).toBeTruthy();
    expect(callsOf("send")).toEqual([]);
  });

  it("says so before the first reply, when nothing is known yet", () => {
    render(<ModelMenu address="t1" status="idle" shown={{ model: null, effort: null, pending: false }} onChanged={() => {}} />);
    expect(screen.getByText("Model…")).toBeTruthy();
  });
});

describe("a part of the window that breaks", () => {
  function Broken(): never { throw new Error("drawing failed"); }

  it("shows what went wrong with a way to try again, instead of a blank window", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary label="sidebar"><Broken /></ErrorBoundary>);
    expect(screen.getByText("The sidebar hit a problem")).toBeTruthy();
    expect(screen.getByText(/drawing failed/)).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("offers a reload for the whole window", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary label="window"><Broken /></ErrorBoundary>);
    expect(screen.getByText("Reload")).toBeTruthy();
  });
});
