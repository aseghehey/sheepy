//! Sheepy: a chat for Claude Code sessions kept alive by herdr-core.

mod hc;
mod logs;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};

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

/// Everything herdr-core knows now (the same shape as an event).
#[tauri::command]
async fn terminals() -> Result<Value, String> {
    let out = hc::run(&["ls", "--json"]).await?;
    serde_json::from_str(out.stdout.trim()).map_err(|e| e.to_string())
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
fn follow(app: AppHandle, follows: State<'_, logs::Follows>, id: String, machine: Option<String>, file: String) {
    logs::follow(app.clone(), &follows, id, machine, file);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(logs::Follows::default())
        .setup(|app| {
            watch_terminals(app.handle().clone());
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            terminals, terminal, send, keys, interrupt, screen, locate, subagents, page, search, follow, unfollow,
            machines, machine_add
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sheepy");
}
