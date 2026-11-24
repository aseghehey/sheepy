// The window's side of Sheepy's Rust commands (src-tauri/src/lib.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Foreground { argv?: string[]; cwd?: string; name?: string; pid?: number }
export interface Terminal {
  address: string;
  state: string;
  title?: string | null;
  cwd?: string;
  turn?: number;
  agent?: string | null;
  foreground?: Foreground | null;
  labels?: Record<string, string>;
  status?: { app?: string; state?: string; msg?: string } | string | null;
  status_ms?: number;
  records?: Record<string, { app?: string; state?: string; title?: string }>;
  parent?: string | null;
}
export interface Machine { name: string; state: string; host?: string; target?: string; version?: string }
export interface Facts { terminals: Terminal[]; machines?: { name: string; state: string }[]; seq?: number }

export interface LogLine { at: number; line: string }
export interface LogEvent {
  id: string;
  lines?: LogLine[];
  from?: number;
  to?: number;
  first?: boolean;
  reset?: boolean;
  truncated?: boolean;
  error?: string;
}
export interface SubAgent { id: string; file: string; size: number; mtime: number; meta: Record<string, unknown> }

export const machineOf = (address: string): string | null => (address.includes("/") ? address.split("/")[0] : null);

export const core = {
  terminals: () => invoke<Facts>("terminals"),
  terminal: (address: string) => invoke<Terminal>("terminal", { address }),
  send: (address: string, text: string) => invoke<void>("send", { address, text }),
  keys: (address: string, keys: string[]) => invoke<void>("keys", { address, keys }),
  interrupt: (address: string) => invoke<string>("interrupt", { address }),
  screen: (address: string, lines = 60) => invoke<string>("screen", { address, lines }),
  locate: (address: string, pid: number) => invoke<string | null>("locate", { address, pid }),
  subagents: (machine: string | null, file: string) => invoke<SubAgent[]>("subagents", { machine, file }),
  page: (machine: string | null, file: string, from: number, to: number) =>
    invoke<{ lines: LogLine[]; from: number; to: number }>("page", { machine, file, from, to }),
  search: (machine: string | null, args: string[]) => invoke<any>("search", { machine, args }),
  follow: (id: string, machine: string | null, file: string) => invoke<void>("follow", { id, machine, file }),
  unfollow: (id: string) => invoke<void>("unfollow", { id }),
  machines: () => invoke<{ machines: Machine[] }>("machines"),
  machineAdd: (target: string, name?: string) => invoke<unknown>("machine_add", { target, name: name ?? null }),
  onTerminals: (fn: (f: Facts) => void): Promise<UnlistenFn> => listen<Facts>("terminals", (e) => fn(e.payload)),
  onLog: (fn: (e: LogEvent) => void): Promise<UnlistenFn> => listen<LogEvent>("log", (e) => fn(e.payload)),
};
