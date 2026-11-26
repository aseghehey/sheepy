// New session: the palette that picks a host, a folder and settings.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewSessionPalette } from "../src/components/NewSessionPalette";
import { handlers, callsOf } from "./tauri";

const tree: Record<string, string[]> = {
  "~/": ["code", "notes", ".config"],
  "~/code/": ["shop", "shop-api", "blog"],
  "~/code/shop/": [],
};

function serveFolders() {
  handlers.list_dirs = ({ folder }: any) => {
    if (folder === "~/broken/") throw "devdesk is unreachable";
    const dirs = tree[folder];
    if (!dirs) return { state: "missing", path: folder.replace("~", "/home/me"), dirs: [] };
    return { state: "dir", path: folder.replace("~", "/home/me").replace(/\/$/, ""), dirs };
  };
}

function open(extra: Partial<Parameters<typeof NewSessionPalette>[0]> = {}) {
  const onDone = vi.fn();
  const onStarted = vi.fn();
  render(
    <NewSessionPalette hosts={["devdesk"]} initial={{ machine: null, folder: "", group: "" }}
      folders={() => ["/srv/recent"]} groups={() => ["Shop"]} onDone={onDone} onStarted={onStarted} {...extra} />,
  );
  const input = screen.getByLabelText("Folder") as HTMLInputElement;
  return { input, onDone, onStarted };
}

const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
const key = (input: HTMLInputElement, k: string, extra: any = {}) => fireEvent.keyDown(input, { key: k, ...extra });

describe("the new session palette", () => {
  it("lists the folders in the typed folder, without hidden ones, and recent folders", async () => {
    serveFolders();
    open();
    expect(await screen.findByText("Start in ~")).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("notes")).toBeTruthy();
    expect(screen.queryByText(".config")).toBeNull();
    expect(screen.getByText("/srv/recent")).toBeTruthy();
  });

  it("narrows as a name is typed, and offers to create a folder that isn't there", async () => {
    serveFolders();
    const { input } = open();
    type(input, "~/code/sh");
    expect(await screen.findByText("Create ~/code/sh and start")).toBeTruthy();
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("shop-api")).toBeTruthy();
    expect(screen.queryByText("blog")).toBeNull();
  });

  it("goes into a folder with Tab or Enter, and up with ⌥⌫", async () => {
    serveFolders();
    const { input } = open();
    type(input, "~/co");
    await screen.findByText("code");
    key(input, "Tab");
    expect(input.value).toBe("~/code/");
    await screen.findByText("blog");
    key(input, "ArrowDown"); // from "Start in" to the first folder (blog)
    key(input, "Enter");
    expect(input.value).toBe("~/code/blog/");
    key(input, "Backspace", { altKey: true });
    expect(input.value).toBe("~/code/");
  });

  it("starts in the folder with the chosen settings", async () => {
    serveFolders();
    handlers.new_session = () => "devdesk/t9";
    const { input, onStarted, onDone } = open();
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "devdesk" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "opus[1m]" } });
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "xhigh" } });
    type(input, "~/code/shop/");
    await screen.findByText("Start in ~/code/shop");
    key(input, "Enter");
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("devdesk/t9", "shop"));
    expect(onDone).toHaveBeenCalled();
    expect(callsOf("new_session")[0]).toEqual({ machine: "devdesk", folder: "~/code/shop", group: null, model: "opus[1m]", effort: "xhigh", create: false });
    expect(localStorage.getItem("new.folder:devdesk")).toBe("~/code/shop");
  });

  it("creates a missing folder when that's what Enter offers", async () => {
    serveFolders();
    handlers.new_session = () => "t5";
    const { input, onStarted } = open();
    type(input, "~/code/new-thing");
    await screen.findByText("Create ~/code/new-thing and start");
    key(input, "Enter");
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(callsOf("new_session")[0].create).toBe(true);
  });

  it("shows a failure to start in the palette and stays open", async () => {
    serveFolders();
    handlers.new_session = () => { throw "couldn't connect devdesk: Permission denied (publickey)"; };
    const { input, onStarted, onDone } = open();
    await screen.findByText("Start in ~");
    key(input, "Enter", { metaKey: true });
    expect(await screen.findByText(/Permission denied/)).toBeTruthy();
    expect(onStarted).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Folder")).toBeTruthy();
  });

  it("says when a host can't be listed, without an action to run", async () => {
    serveFolders();
    const { input } = open();
    type(input, "~/broken/");
    expect(await screen.findByText(/Couldn't list ~\/broken\/ on this computer: devdesk is unreachable/)).toBeTruthy();
    expect(screen.queryByText(/^Start in/)).toBeNull();
  });

  it("closes with Escape", async () => {
    serveFolders();
    const { input, onDone } = open();
    key(input, "Escape");
    expect(onDone).toHaveBeenCalled();
  });
});
