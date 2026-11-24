//! Sheepy: a chat for Claude Code sessions kept alive by herdr-core.

mod hc;
mod logs;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use std::sync::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};

/// The latest full picture from `herdr-core events` (terminals with their
/// foreground program, labels and title; machines), for a window that opens
/// or reloads after it arrived. `ls --json` is only a summary.
#[derive(Default)]
struct Latest(Mutex<Option<Value>>);

/// Follows herdr-core's facts as they change: every line of `events --json`
/// is the full picture (terminals with their foreground program and status,
/// machines), sent to the window as "terminals". Restarts if it ends.
fn watch_terminals(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let child = tokio::process::Command::new(hc::bin())
                .args(["events", "--json"])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .stdin(std::process::Stdio::null())
                .kill_on_drop(true)
                .spawn();
            match child {
                Ok(mut child) => {
                    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Ok(v) = serde_json::from_str::<Value>(&line) {
                            if v.get("terminals").is_some_and(Value::is_array) {
                                *app.state::<Latest>().0.lock().unwrap() = Some(v.clone());
                            }
                            let _ = app.emit("terminals", v);
                        }
                    }
                    let _ = app.emit("core", serde_json::json!({ "state": "disconnected" }));
                }
                Err(e) => {
                    let _ = app.emit("core", serde_json::json!({ "state": "missing", "error": e.to_string() }));
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
}

/// Everything herdr-core knows now, in full (the same shape as an event):
/// the latest event's picture, else the first one a fresh `events` sends.
#[tauri::command]
async fn terminals(latest: State<'_, Latest>) -> Result<Value, String> {
    if let Some(v) = latest.0.lock().unwrap().clone() {
        return Ok(v);
    }
    let mut child = tokio::process::Command::new(hc::bin())
        .args(["events", "--json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("can't run herdr-core: {e}"))?;
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let first = tokio::time::timeout(std::time::Duration::from_secs(10), lines.next_line())
        .await
        .map_err(|_| "herdr-core didn't answer within 10 s".to_string())?
        .map_err(|e| e.to_string())?
        .ok_or("herdr-core ended without an answer")?;
    serde_json::from_str(&first).map_err(|e| e.to_string())
}

#[tauri::command]
async fn terminal(address: String) -> Result<Value, String> {
    let out = hc::run(&["get", &address, "--json"]).await?;
    serde_json::from_str(out.stdout.trim()).map_err(|_| out.stderr.trim().to_string())
}

/// Types `text` into the agent's terminal and presses Enter.
#[tauri::command]
async fn send(address: String, text: String) -> Result<(), String> {
    let out = hc::run(&["send", &address, &text]).await?;
    if out.ok() { Ok(()) } else { Err(out.stderr.trim().to_string()) }
}

/// Presses `keys` (enter, esc, up, down, ctrl+c…) in the agent's terminal.
#[tauri::command]
async fn keys(address: String, keys: Vec<String>) -> Result<(), String> {
    let mut args = vec!["keys", address.as_str()];
    args.extend(keys.iter().map(String::as_str));
    let out = hc::run(&args).await?;
    if out.ok() { Ok(()) } else { Err(out.stderr.trim().to_string()) }
}

#[tauri::command]
async fn interrupt(address: String) -> Result<String, String> {
    let out = hc::run(&["interrupt", &address]).await?;
    if out.ok() { Ok(out.stdout.trim().to_string()) } else { Err(out.stderr.trim().to_string()) }
}

/// The agent's screen (its last `lines` lines), for menus the log doesn't have.
#[tauri::command]
async fn screen(address: String, lines: u32) -> Result<String, String> {
    let n = lines.to_string();
    let out = hc::run(&["read", &address, "--lines", &n]).await?;
    if out.ok() { Ok(out.stdout) } else { Err(out.stderr.trim().to_string()) }
}

#[tauri::command]
async fn locate(address: String, pid: u64) -> Result<Option<String>, String> {
    logs::locate(&address, pid).await
}

#[tauri::command]
async fn subagents(machine: Option<String>, file: String) -> Result<Vec<logs::SubAgent>, String> {
    logs::subagents(machine.as_deref(), &file).await
}

#[tauri::command]
async fn page(machine: Option<String>, file: String, from: u64, to: u64) -> Result<Value, String> {
    logs::page(machine.as_deref(), &file, from, to).await
}

#[tauri::command]
async fn search(machine: Option<String>, args: Vec<String>) -> Result<Value, String> {
    logs::search_json(machine.as_deref(), args).await
}

#[tauri::command]
fn follow(app: AppHandle, follows: State<'_, logs::Follows>, id: String, machine: Option<String>, file: String, plain: Option<bool>) {
    logs::follow(app.clone(), &follows, id, machine, file, plain.unwrap_or(false));
}

#[tauri::command]
fn unfollow(follows: State<'_, logs::Follows>, id: String) {
    logs::unfollow(&follows, &id);
}

/// The machines herdr-core reaches (with their state), as `machine ls --json`.
#[tauri::command]
async fn machines() -> Result<Value, String> {
    let out = hc::run(&["machine", "ls", "--json"]).await?;
    serde_json::from_str(out.stdout.trim()).map_err(|_| out.stderr.trim().to_string())
}

/// Adds a machine reached with ssh (`target`: a Host from ~/.ssh/config,
/// `user@host`, `user@host:port`), installing herdr-core there if it has none.
#[tauri::command]
async fn machine_add(target: String, name: Option<String>) -> Result<Value, String> {
    let target = target.trim().to_string();
    if target.is_empty() || target.starts_with('-') || target.contains(char::is_whitespace) {
        return Err("Type how ssh reaches it: a Host from ~/.ssh/config, user@host or user@host:port".into());
    }
    let mut args = vec!["machine", "add", target.as_str(), "--json", "--install"];
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    if let Some(n) = &name {
        args.extend(["--name", n.as_str()]);
    }
    let out = hc::run(&args).await?;
    if !out.ok() {
        return Err(out.stderr.trim().lines().last().unwrap_or("couldn't add the machine").to_string());
    }
    Ok(serde_json::from_str(out.stdout.trim()).unwrap_or(Value::Null))
}

/// A machine's health (None: this computer): the stats script's key=value
/// lines, parsed by the window.
#[tauri::command]
async fn machine_stats(machine: Option<String>) -> Result<String, String> {
    let out = hc::sh(machine.as_deref(), include_str!("stats.sh"), &[], 20).await?;
    if out.ok() { Ok(out.stdout) } else { Err(out.stderr.trim().to_string()) }
}

/// How Claude Code is started (with the person's flags).
fn claude_argv() -> Vec<String> {
    vec!["claude".into(), "--dangerously-skip-permissions".into()]
}

/// The hosts in ~/.ssh/config (and the files it includes) a new session can
/// go to: every `Host` name without wildcards or negations.
#[tauri::command]
fn ssh_hosts() -> Vec<String> {
    let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) else { return vec![] };
    let mut seen = std::collections::BTreeSet::new();
    let mut files = vec![home.join(".ssh/config")];
    let mut i = 0;
    while i < files.len() && i < 32 {
        let text = std::fs::read_to_string(&files[i]).unwrap_or_default();
        for line in text.lines() {
            let line = line.trim();
            let (key, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
            if key.eq_ignore_ascii_case("include") {
                for inc in rest.split_whitespace() {
                    let p = if let Some(r) = inc.strip_prefix("~/") { home.join(r) } else if inc.starts_with('/') { inc.into() } else { home.join(".ssh").join(inc) };
                    if !p.to_string_lossy().contains('*') && !files.contains(&p) { files.push(p); }
                }
            } else if key.eq_ignore_ascii_case("host") {
                for h in rest.split_whitespace() {
                    if !h.contains(['*', '?', '!']) { seen.insert(h.to_string()); }
                }
            }
        }
        i += 1;
    }
    seen.into_iter().collect()
}

/// What `herdr-core run --json` answered: the new terminal's address, or its
/// error in plain words (`{"error": {"kind", "message", "hint"}}`).
fn started(out: &hc::Out, machine: Option<&str>, folder: Option<&str>) -> Result<String, String> {
    let v: Value = serde_json::from_str(out.stdout.trim()).unwrap_or(Value::Null);
    if let Some(a) = v.get("address").and_then(Value::as_str) {
        return Ok(a.to_string());
    }
    let host = machine.unwrap_or("this computer");
    let err = v.get("error");
    let message = err.and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or("").to_string();
    let kind = err.and_then(|e| e.get("kind")).and_then(Value::as_str).unwrap_or("");
    let text = if kind == "spawn_failed" && message.contains("No such file or directory") {
        match folder {
            Some(f) => format!("There's no folder {f} on {host} (or Claude Code isn't installed there)."),
            None => format!("Claude Code isn't installed on {host} (claude wasn't found)."),
        }
    } else if !message.is_empty() {
        message
    } else {
        out.stderr.trim().lines().last().unwrap_or("couldn't start it").to_string()
    };
    log::warn!("starting a session on {host} failed: {text} ({})", out.stdout.trim());
    Err(text)
}

/// Ends a session: its program (Claude Code), then its terminal. Its log
/// stays, so it can be resumed later (Archived).
#[tauri::command]
async fn close_session(address: String) -> Result<(), String> {
    let kill = hc::run(&["kill", &address]).await?;
    let rm = hc::run(&["rm", &address]).await?;
    log::info!("closed {address} (kill: {}, rm: {})", kill.code, rm.code);
    if rm.ok() || kill.ok() { Ok(()) } else { Err(rm.stderr.trim().to_string()) }
}

/// Where Sheepy writes its log.
#[tauri::command]
fn log_dir(app: AppHandle) -> Result<String, String> {
    app.path().app_log_dir().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

/// Resumes a session that isn't running: Claude Code with --resume, in its
/// own folder (Claude finds a session only from there), on its machine, in a
/// herdr-core terminal that stays alive. Its address.
#[tauri::command]
async fn resume(machine: Option<String>, project: String, session: String, title: Option<String>) -> Result<String, String> {
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("not a session id".into());
    }
    let where_label = format!("where=Resumed / {}", title.unwrap_or_else(|| session[..8.min(session.len())].to_string()));
    let mut args: Vec<String> = vec!["run".into(), "--bg".into(), "--json".into(), "--no-parent".into(), "--keep".into()];
    if !project.is_empty() {
        args.extend(["--cwd".into(), project]);
    }
    if let Some(m) = &machine {
        args.extend(["--on".into(), m.clone()]);
    }
    args.extend(["--label".into(), where_label, "--".into()]);
    args.extend(claude_argv());
    args.extend(["--resume".into(), session]);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = hc::run(&refs).await?;
    started(&out, machine.as_deref(), None)
}

/// Puts a session in a group of the person's (its `sheepy.group` label), or
/// back in its Herdr window with an empty name.
#[tauri::command]
async fn set_group(address: String, group: String) -> Result<(), String> {
    let group: String = group.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(60).collect();
    let pair = format!("sheepy.group={group}");
    let out = hc::run(&["label", &address, &pair]).await?;
    if out.ok() { Ok(()) } else { Err(out.stderr.trim().to_string()) }
}

/// Starts a new Claude Code session in `folder` on `machine`, in a
/// herdr-core terminal that stays alive, in `group` when given. A host from
/// ~/.ssh/config herdr-core doesn't reach yet is added first (with herdr-core
/// installed there if it has none). Its address.
#[tauri::command]
async fn new_session(machine: Option<String>, folder: Option<String>, group: Option<String>) -> Result<String, String> {
    if let Some(m) = &machine {
        let known = hc::run(&["machine", "ls", "--json"]).await?;
        let listed = serde_json::from_str::<Value>(known.stdout.trim()).ok()
            .and_then(|v| v.get("machines").cloned())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .iter()
            .any(|x| x.get("name").and_then(Value::as_str) == Some(m.as_str()));
        if !listed {
            if m.starts_with('-') || m.contains(char::is_whitespace) {
                return Err("not a host".into());
            }
            let out = hc::run(&["machine", "add", m, "--name", m, "--install", "--json"]).await?;
            if !out.ok() {
                return Err(format!("couldn't connect {m}: {}", out.stderr.trim().lines().last().unwrap_or("")));
            }
        }
    }
    let mut args: Vec<String> = vec!["run".into(), "--bg".into(), "--json".into(), "--no-parent".into(), "--keep".into()];
    let folder = folder.map(|f| f.trim().to_string()).filter(|f| !f.is_empty());
    if let Some(f) = &folder {
        if f.starts_with('-') {
            return Err("not a folder".into());
        }
        args.extend(["--cwd".into(), f.clone()]);
    }
    if let Some(m) = &machine {
        args.extend(["--on".into(), m.clone()]);
    }
    if let Some(g) = group.map(|g| g.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|g| !g.is_empty()) {
        args.extend(["--label".into(), format!("sheepy.group={}", g.chars().take(60).collect::<String>())]);
    }
    args.push("--".into());
    args.extend(claude_argv());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = hc::run(&refs).await?;
    let address = started(&out, machine.as_deref(), folder.as_deref())?;
    log::info!("started {address} on {} in {}", machine.as_deref().unwrap_or("this computer"), folder.as_deref().unwrap_or("~"));
    Ok(address)
}

/// Development only: a screenshot of the window on request, without the
/// Screen Recording permission a screen capture needs. Creating
/// /tmp/sheepy-snap.request asks the window to draw itself (html-to-image);
/// it sends back a PNG, saved as /tmp/sheepy-snap.png.
#[cfg(debug_assertions)]
fn watch_snapshot_requests(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let request = std::path::Path::new("/tmp/sheepy-snap.request");
        loop {
            if request.exists() {
                let _ = std::fs::remove_file(request);
                let _ = app.emit("snapshot", ());
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    });
}

#[tauri::command]
fn save_snapshot(data: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("only in development builds".into());
    }
    use base64::Engine as _;
    let b64 = data.split_once(',').map(|(_, d)| d).unwrap_or(&data);
    let png = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    std::fs::write("/tmp/sheepy-snap.png", png).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // ~/Library/Logs/<app id>/Sheepy.log (rotated), and the terminal in development.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("Sheepy".into()) }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .build(),
        )
        .manage(logs::Follows::default())
        .manage(Latest::default())
        .setup(|app| {
            watch_terminals(app.handle().clone());
            #[cfg(debug_assertions)]
            watch_snapshot_requests(app.handle().clone());
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            terminals, terminal, send, keys, interrupt, screen, locate, subagents, page, search, follow, unfollow,
            machines, machine_add, save_snapshot, resume, machine_stats, set_group, new_session, ssh_hosts,
            close_session, log_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sheepy");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(stdout: &str) -> hc::Out {
        hc::Out { code: 0, stdout: stdout.into(), stderr: String::new() }
    }

    #[test]
    fn a_started_terminal_gives_its_address() {
        assert_eq!(started(&out(r#"{"address":"vps/t1k","state":"live"}"#), Some("vps"), None).unwrap(), "vps/t1k");
    }

    #[test]
    fn a_missing_folder_is_said_plainly() {
        let o = out(r#"{"error":{"hint":"check the program name and cwd","kind":"spawn_failed","message":"cannot start \"claude\": No such file or directory (os error 2)"}}"#);
        assert_eq!(
            started(&o, Some("vps"), Some("/Volumes/x")).unwrap_err(),
            "There's no folder /Volumes/x on vps (or Claude Code isn't installed there)."
        );
        assert_eq!(started(&o, None, None).unwrap_err(), "Claude Code isn't installed on this computer (claude wasn't found).");
    }

    #[test]
    fn other_errors_keep_herdr_cores_words() {
        let o = out(r#"{"error":{"kind":"unreachable","message":"vps isn't reachable"}}"#);
        assert_eq!(started(&o, Some("vps"), None).unwrap_err(), "vps isn't reachable");
        let o = hc::Out { code: 1, stdout: "".into(), stderr: "boom\nlast line".into() };
        assert_eq!(started(&o, None, None).unwrap_err(), "last line");
    }
}
