//! Claude Code's session logs: finding the one an agent terminal is writing,
//! reading it from its end and following it as it grows (through encontra
//! on the agent's machine, with a plain `tail` when that isn't installed), its
//! sub-agents' logs, and searching every session.

use crate::hc;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri::async_runtime::JoinHandle;

/// encontra (https://github.com/aseghehey/encontra) on the agent's machine;
/// herdr-search, its earlier name, where it isn't installed yet.
const SEARCH: &str = r#"for s in "$HOME/.local/bin/encontra" "$(command -v encontra 2>/dev/null)" "$HOME/.local/share/herdr-search/bin/herdr-search"; do
  [ -n "$s" ] && [ -x "$s" ] && exec "$s" "$@"
done
exit 127"#;

/// How much of a log's end to read first.
const TAIL_BYTES: u64 = 24 * 1024 * 1024;

/// Every process under pid $1, nearest first, four levels at most (a launcher
/// or wrapper can start the real CLI a few levels down). For each, Claude
/// Code's ~/.claude/sessions/<pid>.json names the live session; its log is the
/// newest copy of <session>.jsonl in the projects folder.
const LOCATE: &str = r#"
desc=$(ps -e -o pid= -o ppid= | awk -v root="$1" '
  { kids[$2] = kids[$2] " " $1 }
  END { q = root; for (d = 0; d < 4 && q != ""; d++) { n = split(q, a, " "); q = "";
        for (i = 1; i <= n; i++) { print a[i]; q = q " " kids[a[i]] } } }' | tr '\n' ' ')
for p in $desc; do
  f="$HOME/.claude/sessions/$p.json"
  [ -f "$f" ] || continue
  id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$f")
  [ -n "$id" ] || continue
  log=$(ls -t "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
  [ -n "$log" ] && echo "$log" && exit 0
done
exit 1"#;

/// A session's sub-agents: each agent-<id>.jsonl beside <session>/, with its
/// size, last change and the .meta.json Claude Code writes next to it.
const SUBAGENTS: &str = r#"
dir="${1%.jsonl}/subagents"
[ -d "$dir" ] || exit 0
for f in "$dir"/agent-*.jsonl; do
  [ -f "$f" ] || continue
  id=$(basename "$f" .jsonl); id=${id#agent-}
  size=$(wc -c < "$f" | tr -d ' ')
  mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")
  meta=$(tr -d '\n\t' < "${f%.jsonl}.meta.json" 2>/dev/null)
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$f" "$size" "$mtime" "${meta:-{\}}"
done"#;

async fn search(on: Option<&str>, args: &[&str], timeout: u64) -> Result<Option<Value>, String> {
    let out = hc::sh(on, SEARCH, args, timeout).await?;
    if out.code == 127 {
        return Ok(None);
    }
    serde_json::from_str(out.stdout.trim())
        .map(Some)
        .map_err(|_| out.stderr.trim().lines().last().unwrap_or("encontra failed").to_string())
}

/// The log an agent terminal's Claude Code is writing, from its foreground pid.
pub async fn locate(address: &str, pid: u64) -> Result<Option<String>, String> {
    let pid = pid.to_string();
    let out = hc::sh(hc::machine_of(address), LOCATE, &[&pid], 30).await?;
    Ok(out.stdout.lines().next().map(str::trim).filter(|s| !s.is_empty()).map(String::from))
}

/// For each Claude Code process under the pids given (as LOCATE finds them):
/// the model and effort of its session's latest reply, and when it was.
/// Claude Code logs both on every reply (`requestedModel`, `effort`); before
/// the first one there's nothing to show.
const MODELS: &str = r#"
tree=$(ps -e -o pid= -o ppid=)
for root in "$@"; do
  desc=$(printf '%s\n' "$tree" | awk -v root="$root" '
    { kids[$2] = kids[$2] " " $1 }
    END { q = root; for (d = 0; d < 4 && q != ""; d++) { n = split(q, a, " "); q = "";
          for (i = 1; i <= n; i++) { print a[i]; q = q " " kids[a[i]] } } }' | tr '\n' ' ')
  for p in $desc; do
    f="$HOME/.claude/sessions/$p.json"
    [ -f "$f" ] || continue
    id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$f")
    [ -n "$id" ] || continue
    log=$(ls -t "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
    line=""
    [ -n "$log" ] && line=$(tail -c 3000000 "$log" | grep '"requestedModel"' | tail -1)
    m=$(printf '%s' "$line" | grep -o '"requestedModel":"[^"]*"' | tail -1 | cut -d'"' -f4)
    e=$(printf '%s' "$line" | grep -o '"effort":"[^"]*"' | tail -1 | cut -d'"' -f4)
    t=$(printf '%s' "$line" | grep -o '"timestamp":"[^"]*"' | tail -1 | cut -d'"' -f4)
    printf '%s\t%s\t%s\t%s\n' "$root" "$m" "$e" "$t"
    break
  done
done"#;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModelOf {
    pub pid: u64,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub at: Option<String>,
}

pub async fn models(on: Option<&str>, pids: &[u64]) -> Result<Vec<ModelOf>, String> {
    if pids.is_empty() {
        return Ok(vec![]);
    }
    let args: Vec<String> = pids.iter().map(u64::to_string).collect();
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = hc::sh(on, MODELS, &refs, 30).await?;
    Ok(parse_models(&out.stdout))
}

pub fn parse_models(text: &str) -> Vec<ModelOf> {
    let some = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    text.lines()
        .filter_map(|l| {
            let mut p = l.split('\t');
            let pid = p.next()?.trim().parse().ok()?;
            Some(ModelOf { pid, model: some(p.next()), effort: some(p.next()), at: some(p.next()) })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SubAgent {
    pub id: String,
    pub file: String,
    pub size: u64,
    pub mtime: u64,
    pub meta: Value,
}

pub async fn subagents(on: Option<&str>, file: &str) -> Result<Vec<SubAgent>, String> {
    let out = hc::sh(on, SUBAGENTS, &[file], 30).await?;
    Ok(parse_subagents(&out.stdout))
}

pub fn parse_subagents(text: &str) -> Vec<SubAgent> {
    let mut list: Vec<SubAgent> = text
        .lines()
        .filter_map(|l| {
            let mut p = l.splitn(5, '\t');
            let id = p.next()?.to_string();
            let file = p.next()?.to_string();
            let size = p.next()?.parse().unwrap_or(0);
            let mtime = p.next()?.parse().unwrap_or(0);
            let meta = serde_json::from_str(p.next().unwrap_or("{}")).unwrap_or(json!({}));
            Some(SubAgent { id, file, size, mtime, meta })
        })
        .collect();
    list.sort_by_key(|s| s.mtime);
    list
}

/// A page of a log, [from, to), without its bookkeeping lines.
pub async fn page(on: Option<&str>, file: &str, from: u64, to: u64) -> Result<Value, String> {
    let (f, t) = (from.to_string(), to.to_string());
    search(on, &["page", "--file", file, "--from", &f, "--to", &t], 120)
        .await?
        .ok_or_else(|| "Reading earlier history needs encontra on that machine (github.com/aseghehey/encontra)".into())
}

/// encontra with `args` on `on` (query, sessions, rename, …).
pub async fn search_json(on: Option<&str>, args: Vec<String>) -> Result<Value, String> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    search(on, &args, 60).await?.ok_or_else(|| "encontra isn't installed on that machine (github.com/aseghehey/encontra)".into())
}

/// The logs being followed, by the id the window gave each.
#[derive(Default)]
pub struct Follows(pub Mutex<HashMap<String, JoinHandle<()>>>);

/// Reads `file` from its end, then follows it: "log" events carry
/// { id, lines: [{ at, line }], from, to, first, reset, truncated, error }.
/// `plain`: read the file itself, not through encontra, whose pages leave
/// out side-chain lines — every line of a sub-agent's own log is one.
pub fn follow(app: AppHandle, follows: &Follows, id: String, on: Option<String>, file: String, plain: bool) {
    let task_id = id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let emit = |v: Value| {
            if let Some(e) = v.get("error") {
                log::warn!("reading {}: {}", task_id, e);
            }
            let _ = app.emit("log", v);
        };
        let on = on.as_deref();
        if plain {
            return plain_tail(&emit, &task_id, on, &file).await;
        }
        let tail = TAIL_BYTES.to_string();
        loop {
            // The end of the log first.
            let first = match search(on, &["page", "--file", &file, "--tail", &tail], 120).await {
                Ok(Some(p)) if p.get("lines").is_some() => p,
                Ok(Some(p)) => {
                    emit(json!({ "id": task_id, "error": p.get("error").cloned().unwrap_or(json!("can't read the log")) }));
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    continue;
                }
                Ok(None) => return plain_tail(&emit, &task_id, on, &file).await,
                Err(e) => {
                    emit(json!({ "id": task_id, "error": e }));
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    continue;
                }
            };
            let mut offset = first["to"].as_u64().unwrap_or(0);
            emit(json!({
                "id": task_id, "first": true, "lines": first["lines"], "from": first["from"], "to": offset,
                "truncated": first["from"].as_u64().unwrap_or(0) > 0,
            }));
            // Then whatever is written next, as soon as it is.
            loop {
                let from = offset.to_string();
                match search(on, &["follow", "--file", &file, "--from", &from, "--wait", "20"], 45).await {
                    Ok(Some(f)) if f.get("reset").and_then(Value::as_bool) == Some(true) => {
                        emit(json!({ "id": task_id, "reset": true }));
                        break;
                    }
                    Ok(Some(f)) if f.get("lines").is_some() => {
                        let to = f["to"].as_u64().unwrap_or(offset);
                        if f["lines"].as_array().is_some_and(|l| !l.is_empty()) {
                            emit(json!({ "id": task_id, "lines": f["lines"], "from": offset, "to": to }));
                        }
                        offset = to;
                    }
                    Ok(other) => {
                        let e = other.and_then(|f| f.get("error").cloned()).unwrap_or(json!("can't follow the log"));
                        emit(json!({ "id": task_id, "error": e }));
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    }
                    Err(e) => {
                        emit(json!({ "id": task_id, "error": e }));
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    }
                }
            }
        }
    });
    if let Some(old) = follows.0.lock().unwrap().insert(id, handle) {
        old.abort();
    }
}

pub fn unfollow(follows: &Follows, id: &str) {
    if let Some(h) = follows.0.lock().unwrap().remove(id) {
        h.abort();
    }
}

/// Without encontra: the last few megabytes, then new bytes every two seconds.
async fn plain_tail(emit: &impl Fn(Value), id: &str, on: Option<&str>, file: &str) {
    const START: u64 = 4 * 1024 * 1024;
    let size = |out: &hc::Out| out.stdout.trim().parse::<u64>().unwrap_or(0);
    let Ok(out) = hc::sh(on, r#"wc -c < "$1""#, &[file], 30).await else { return };
    let mut offset = size(&out).saturating_sub(START);
    let mut first = true;
    loop {
        let from = (offset + 1).to_string();
        match hc::sh(on, r#"tail -c "+$2" "$1""#, &[file, &from], 30).await {
            Ok(out) if out.ok() => {
                let (lines, next) = split_lines(&out.stdout, offset, first && offset > 0);
                if first || !lines.is_empty() {
                    emit(json!({ "id": id, "first": first, "lines": lines, "from": offset, "to": next, "truncated": first && offset > 0 }));
                }
                first = false;
                offset = next;
            }
            Ok(out) => emit(json!({ "id": id, "error": out.stderr.trim() })),
            Err(e) => emit(json!({ "id": id, "error": e })),
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

/// Complete lines in `text` (read from byte `offset`), each with the offset it
/// starts at, and where the next read starts (after the last complete line).
/// `skip_first`: the read began mid-line.
pub fn split_lines(text: &str, offset: u64, skip_first: bool) -> (Vec<Value>, u64) {
    let Some(cut) = text.rfind('\n') else { return (vec![], offset) };
    let mut at = offset;
    let mut out = vec![];
    for (i, line) in text[..cut].split('\n').enumerate() {
        let start = at;
        at += line.len() as u64 + 1;
        if i == 0 && skip_first {
            continue;
        }
        if !line.is_empty() {
            out.push(json!({ "at": start, "line": line }));
        }
    }
    (out, at)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_read_from_the_script() {
        let got = parse_models("101\tglobal.anthropic.claude-opus-5-5\thigh\t2026-11-25T14:19:49.117Z\n202\t\t\t\nnot a pid\tx\n");
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], ModelOf { pid: 101, model: Some("global.anthropic.claude-opus-5-5".into()), effort: Some("high".into()), at: Some("2026-11-25T14:19:49.117Z".into()) });
        assert_eq!(got[1], ModelOf { pid: 202, model: None, effort: None, at: None });
    }

    #[test]
    fn complete_lines_with_their_offsets() {
        let (lines, next) = split_lines("ab\ncdé\npartial", 10, false);
        assert_eq!(lines, vec![json!({"at": 10, "line": "ab"}), json!({"at": 13, "line": "cdé"})]);
        assert_eq!(next, 10 + 3 + 5, "bytes, not characters: é is two");
    }

    #[test]
    fn a_read_from_mid_line_skips_that_line() {
        let (lines, next) = split_lines("tail of one\nnext\n", 100, true);
        assert_eq!(lines, vec![json!({"at": 112, "line": "next"})]);
        assert_eq!(next, 117);
    }

    #[test]
    fn nothing_complete_yet() {
        assert_eq!(split_lines("no newline", 5, false), (vec![], 5));
        assert_eq!(split_lines("", 5, false), (vec![], 5));
    }

    #[test]
    fn subagent_rows() {
        let text = "a1\t/p/s/subagents/agent-a1.jsonl\t120\t1700000002\t{\"description\":\"Inventory\",\"finished\":true}\n\
                    b2\t/p/s/subagents/agent-b2.jsonl\t9\t1700000001\t{}\n\
                    broken line\n";
        let list = parse_subagents(text);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "b2", "oldest first");
        assert_eq!(list[1].meta["description"], "Inventory");
        assert_eq!(list[1].size, 120);
    }

    #[tokio::test]
    async fn locating_finds_nothing_for_a_process_without_a_session() {
        // This test's own process has no Claude Code session file.
        let found = locate("local", std::process::id() as u64).await.unwrap();
        assert_eq!(found, None);
    }
}
