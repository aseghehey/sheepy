import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The window's tests (ui-test/): its screens drawn in jsdom, with Tauri
// answered by ui-test/tauri.ts. The plain-logic tests in test/ run with
// node --test.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["ui-test/**/*.test.tsx"],
    setupFiles: ["ui-test/setup.ts"],
  },
});
