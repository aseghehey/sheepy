// Which model and effort a Claude Code session runs with: as its log says
// (every reply records them), or as just changed from here. Plain functions,
// tested in test/models.test.js.

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// What /model takes: Claude Code's aliases, newest of each family.
export const MODEL_CHOICES = [
  { id: "default", label: "Default" },
  { id: "opus", label: "Opus" },
  { id: "opus[1m]", label: "Opus (1M context)" },
  { id: "fable", label: "Fable" },
  { id: "sonnet", label: "Sonnet" },
  { id: "sonnet[1m]", label: "Sonnet (1M context)" },
  { id: "haiku", label: "Haiku" },
];

export const OUTPUT_STYLES = ["default", "Explanatory", "Learning"];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A model id as people say it: "global.anthropic.claude-opus-5-5" → "Opus 5.5",
 * "claude-sonnet-4-6[1m]" → "Sonnet 4.6 (1M)", "claude-3-5-haiku-20241022" →
 * "Haiku 3.5", "opus" → "Opus". Anything else as it is; null when empty.
 */
export function modelName(id) {
  let s = String(id ?? "").trim();
  if (!s) return null;
  const long = /\[1m\]$/i.test(s);
  s = s.replace(/\[1m\]$/i, "").split("/").pop();
  s = s.replace(/^(global|us|eu|apac|jp|au)\./, "").replace(/^anthropic\./, "").replace(/-v\d+(:\d+)?$/, "").replace(/^claude-/, "");
  let name = s;
  const m = /^(opus|sonnet|haiku|fable)(?:-(\d+))?(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(s);
  const old = /^(\d+)(?:-(\d))?-(opus|sonnet|haiku)(?:-\d{8})?$/i.exec(s);
  if (m) name = cap(m[1].toLowerCase()) + (m[2] ? ` ${m[2]}${m[3] ? `.${m[3]}` : ""}` : "");
  else if (old) name = `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ""}`;
  return long ? `${name} (1M)` : name;
}

/**
 * What to show for a session: `log` { model, effort, at } from its log,
 * `change` { model?, effort?, at } made from here (ms). A change wins until
 * a reply after it says what's in effect.
 */
export function shownModel(log, change) {
  const logAt = log?.at ? Date.parse(log.at) : 0;
  const fresh = change && change.at > logAt;
  const model = fresh && change.model ? (change.model === "default" ? null : change.model) : log?.model ?? null;
  const effort = fresh && change.effort ? change.effort : log?.effort ?? null;
  return { model: modelName(model) ?? (fresh && change.model === "default" ? "Default" : null), effort, pending: Boolean(fresh) };
}

/** "Opus 5.5 · high", or null when nothing's known yet. */
export function modelLabel(shown) {
  const parts = [shown?.model, shown?.effort].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** A value /model or /effort can take safely (no spaces or shell-ish characters). */
export function validModel(id) {
  return /^[A-Za-z0-9._:\/\[\]-]{1,80}$/.test(String(id ?? ""));
}
