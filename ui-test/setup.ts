// Runs before every window test: Tauri's modules answered by ui-test/tauri.ts,
// and the browser bits jsdom doesn't have.
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { reset } from "./tauri";

vi.mock("@tauri-apps/api/core", async () => {
  const t = await import("./tauri");
  return { invoke: t.invoke };
});
vi.mock("@tauri-apps/api/event", async () => {
  const t = await import("./tauri");
  return { listen: t.listen };
});
vi.mock("@tauri-apps/plugin-log", () => ({ error: async () => {}, warn: async () => {}, info: async () => {} }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {}, revealItemInDir: async () => {} }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => false, requestPermission: async () => "denied", sendNotification: () => {},
}));

Element.prototype.scrollIntoView = function () {};
class NoResize { observe() {} unobserve() {} disconnect() {} }
(globalThis as any).ResizeObserver ??= NoResize;
(globalThis as any).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

afterEach(() => {
  cleanup();
  reset();
  localStorage.clear();
});
