// A stand-in for Tauri in the window's tests: commands answer from
// `handlers` (each call kept in `calls`), and events can be sent to what
// the window listens for.
type Handler = (args: any) => any;

export const calls: { cmd: string; args: any }[] = [];
export const handlers: Record<string, Handler> = {};
const listeners = new Map<string, Set<(e: { payload: any }) => void>>();

export async function invoke(cmd: string, args?: any) {
  calls.push({ cmd, args });
  const h = handlers[cmd];
  if (!h) return null;
  return h(args ?? {});
}

export async function listen(name: string, fn: (e: { payload: any }) => void) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  return () => listeners.get(name)?.delete(fn);
}

/** Sends an event to the window, as the Rust side would. */
export function emit(name: string, payload: any) {
  for (const fn of listeners.get(name) ?? []) fn({ payload });
}

/** The calls of one command, in order. */
export const callsOf = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

export function reset() {
  calls.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  listeners.clear();
}
