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
                    // Silent for five minutes: start it again (it may have stopped delivering).
                    while let Ok(Ok(Some(line))) = tokio::time::timeout(std::time::Duration::from_secs(300), lines.next_line()).await {
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

/// The first picture a fresh `herdr-core events` sends: everything it knows
/// now, in full.
async fn fresh_picture() -> Result<Value, String> {
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

/// Every 15 s, the full picture again, whatever the event feed does: a feed
/// that stops delivering (after a machine's connection dropped, say) left
/// the window showing old sessions and none of the new.
fn refresh_terminals(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            match fresh_picture().await {
                Ok(v) if v.get("terminals").is_some_and(Value::is_array) => {
                    *app.state::<Latest>().0.lock().unwrap() = Some(v.clone());
                    let _ = app.emit("terminals", v);
                }
                Ok(_) => {}
                Err(e) => log::warn!("refreshing the picture: {e}"),
            }
        }
    });
}

/// The full picture now, sent to the window at once (after closing or
/// starting a session, so it doesn't wait for the next refresh).
#[tauri::command]
async fn refresh_now(app: AppHandle) -> Result<(), String> {
    let v = fresh_picture().await?;
    if v.get("terminals").is_some_and(Value::is_array) {
        *app.state::<Latest>().0.lock().unwrap() = Some(v.clone());
        let _ = app.emit("terminals", v);
    }
    Ok(())
}

/// Everything herdr-core knows now, in full (the same shape as an event):
/// the latest event's picture, else the first one a fresh `events` sends.
#[tauri::command]
async fn terminals(latest: State<'_, Latest>) -> Result<Value, String> {
    if let Some(v) = latest.0.lock().unwrap().clone() {
        return Ok(v);
    }
    fresh_picture().await
}

#[tauri::command]
async fn terminal(address: String) -> Result<Value, String> {
    let out = hc::run(&["get", &address, "--json"]).await?;
    serde_json::from_str(out.stdout.trim()).map_err(|_| out.stderr.trim().to_string())
}

/// herdr-core's error in plain words: its JSON `{"error": {"message"}}`
/// (on stdout or stderr), else the last line it printed.
fn core_error(out: &hc::Out) -> String {
    for text in [&out.stdout, &out.stderr] {
        if let Ok(v) = serde_json::from_str::<Value>(text.trim()) {
            if let Some(m) = v.pointer("/error/message").and_then(Value::as_str) {
                return m.to_string();
            }
        }
    }
    out.stderr.trim().lines().last().or(out.stdout.trim().lines().last()).unwrap_or("herdr-core failed").to_string()
}

/// Types `text` into the agent's terminal and presses Enter. herdr-core
/// refuses while the agent shows a question (typing would answer it);
/// `force`: the window chose the answer to type into on purpose. A refusal
/// comes back as "blocked: …".
#[tauri::command]
async fn send(address: String, text: String, force: Option<bool>) -> Result<(), String> {
    let mut args = vec!["send", address.as_str(), text.as_str()];
    if force == Some(true) {
        args.push("--force");
    }
    let out = hc::run(&args).await?;
    if out.ok() {
        return Ok(());
    }
    let blocked = serde_json::from_str::<Value>(out.stdout.trim()).ok()
        .and_then(|v| v.pointer("/error/kind").and_then(Value::as_str).map(|k| k == "blocked"))
        .unwrap_or(false);
    let e = core_error(&out);
    log::warn!("sending to {address} failed: {e}");
    Err(if blocked { format!("blocked: {e}") } else { e })
}

/// When this process started, to tell whether a newer build was installed since.
static STARTED: std::sync::OnceLock<std::time::SystemTime> = std::sync::OnceLock::new();

/// A newer build of this app was installed after it started (the stable
/// install script replaces the app in place): the window offers a restart.
#[tauri::command]
fn newer_installed() -> bool {
    let Some(started) = STARTED.get() else { return false };
    std::env::current_exe()
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .is_some_and(|built| built > *started)
}

/// Restarts the app (⌘K "Restart Sheepy").
#[tauri::command]
fn restart(app: AppHandle) {
    log::info!("restarting");
    app.restart();
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

/// The model and effort of each Claude Code session under these pids on
/// `machine` (one call per machine).
#[tauri::command]
async fn models(machine: Option<String>, pids: Vec<u64>) -> Result<Vec<logs::ModelOf>, String> {
    logs::models(machine.as_deref(), &pids).await
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

/// How Claude Code is started (with the person's flags), on `machine`.
///
/// herdr-core runs in the background, without the PATH a login shell sets up
/// (where installers put claude, ~/.local/bin and the like), so claude is
/// looked up the way the person's own shell would, once per machine, and
/// started by its full path.
async fn claude_argv(machine: Option<&str>) -> Vec<String> {
    static FOUND: std::sync::OnceLock<Mutex<std::collections::HashMap<String, String>>> = std::sync::OnceLock::new();
    let cache = FOUND.get_or_init(Default::default);
    let key = machine.unwrap_or("").to_string();
    let cached = cache.lock().unwrap().get(&key).cloned();
    let path = match cached {
        Some(p) => p,
        None => {
            // The answer is marked: a login shell can print other things
            // first (a terminal's shell integration codes, greetings).
            let look = r#"p=$(command -v claude 2>/dev/null) || p=$("${SHELL:-/bin/sh}" -lic 'command -v claude' 2>/dev/null | tail -1); printf 'SHEEPY-PATH:%s\n' "$p""#;
            let found = hc::sh(machine, look, &[], 20).await.ok().and_then(|o| claude_path(&o.stdout));
            match found {
                Some(p) => { cache.lock().unwrap().insert(key, p.clone()); p }
                None => "claude".into(),
            }
        }
    };
    vec![path, "--dangerously-skip-permissions".into()]
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
    let v: Value = serde_json::from_str(out.stdout.trim())
        .or_else(|_| serde_json::from_str(out.stderr.trim()))
        .unwrap_or(Value::Null);
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
    log::warn!("starting a session on {host} failed: {text} (stdout: {}; stderr: {})", out.stdout.trim(), out.stderr.trim());
    Err(text)
}

/// Ends a session: its program (Claude Code), then its terminal. Its log
/// stays, so it can be resumed later (Archived).
///
/// A terminal started with --keep (as Sheepy starts sessions) gets a shell
/// in place of a program that ends, and only a finished terminal can be
/// removed: so keep goes off first, and removing waits for it to finish.
#[tauri::command]
async fn close_session(address: String) -> Result<(), String> {
    let _ = hc::run(&["keep", &address, "--off"]).await;
    let kill = hc::run(&["kill", &address]).await?;
    let mut finished = false;
    for _ in 0..30 {
        let got = hc::run(&["get", &address, "--json"]).await?;
        let state = serde_json::from_str::<Value>(got.stdout.trim()).ok()
            .and_then(|v| v.get("state").and_then(Value::as_str).map(String::from));
        // Gone already, or no longer running.
        if !got.ok() || state.as_deref().is_some_and(|s| s != "live") {
            finished = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    let rm = hc::run(&["rm", &address]).await?;
    let gone = rm.ok() || core_error(&rm).contains("no terminal");
    log::info!("closing {address}: kill {}, finished {finished}, rm {}", kill.code, rm.code);
    if gone {
        Ok(())
    } else {
        let e = core_error(&rm);
        log::warn!("closing {address} failed: {e}");
        Err(format!("Couldn't close it: {e}"))
    }
}

/// Restarts a session: ends its Claude Code and starts it again on the same
/// conversation (--resume), in the same folder, machine, group and window
/// labels. `log`: the session's log, whose name is its id. The new address.
#[tauri::command]
async fn restart_session(address: String, log: String) -> Result<String, String> {
    let session = std::path::Path::new(&log).file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("couldn't tell which conversation this is".into());
    }
    let got = hc::run(&["get", &address, "--json"]).await?;
    let t: Value = serde_json::from_str(got.stdout.trim()).map_err(|_| core_error(&got))?;
    let machine = hc::machine_of(&address).map(String::from);
    let folder = t.pointer("/foreground/cwd").or(t.get("cwd")).and_then(Value::as_str).unwrap_or("").to_string();
    // The labels that place it: its group, and the window it's in.
    let labels: Vec<String> = t.get("labels").and_then(Value::as_object).map(|m| {
        m.iter().filter(|(k, _)| k.as_str() == "sheepy.group" || k.as_str() == "where" || k.starts_with("herdr."))
            .filter_map(|(k, v)| v.as_str().map(|v| format!("{k}={v}"))).collect()
    }).unwrap_or_default();
    close_session(address.clone()).await?;
    let mut args: Vec<String> = vec!["run".into(), "--bg".into(), "--json".into(), "--no-parent".into(), "--keep".into()];
    if !folder.is_empty() {
        args.extend(["--cwd".into(), folder.clone()]);
    }
    if let Some(m) = &machine {
        args.extend(["--on".into(), m.clone()]);
    }
    for l in labels {
        args.extend(["--label".into(), l]);
    }
    args.push("--".into());
    args.extend(claude_argv(machine.as_deref()).await);
    args.extend(["--resume".into(), session.clone()]);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = hc::run(&refs).await?;
    let new = started(&out, machine.as_deref(), (!folder.is_empty()).then_some(folder.as_str()))?;
    log::info!("restarted {address} as {new} (session {session})");
    Ok(new)
}

/// Where Sheepy writes its log.
#[tauri::command]
fn log_dir(app: AppHandle) -> Result<String, String> {
    app.path().app_log_dir().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

/// The path in the lookup's marked answer: what follows "SHEEPY-PATH:", from
/// its last "/" run that starts a path (escape codes before it dropped).
fn claude_path(out: &str) -> Option<String> {
    let line = out.lines().rev().find_map(|l| l.split_once("SHEEPY-PATH:").map(|(_, p)| p))?;
    let line = line.rsplit(['\x07', '\x1b']).next().unwrap_or(line).trim();
    let start = line.find('/')?;
    let path = &line[start..];
    (path.ends_with("/claude") && !path.contains(char::is_whitespace)).then(|| path.to_string())
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
    args.extend(claude_argv(machine.as_deref()).await);
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
async fn new_session(machine: Option<String>, folder: Option<String>, group: Option<String>, model: Option<String>, effort: Option<String>) -> Result<String, String> {
    let flags = launch_flags(model.as_deref(), effort.as_deref())?;
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
    // No folder: the home folder (on another machine herdr-core starts there;
    // on this one it would start where herdr-core itself runs, "/").
    let folder = folder.map(|f| f.trim().to_string()).filter(|f| !f.is_empty())
        .or_else(|| if machine.is_none() { std::env::var("HOME").ok() } else { None });
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
    args.extend(claude_argv(machine.as_deref()).await);
    args.extend(flags);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = hc::run(&refs).await?;
    let address = started(&out, machine.as_deref(), folder.as_deref())?;
    log::info!("started {address} on {} in {}", machine.as_deref().unwrap_or("this computer"), folder.as_deref().unwrap_or("~"));
    tauri::async_runtime::spawn(trust_folder(address.clone()));
    Ok(address)
}

/// Claude Code's own flags for a new session's model and effort, when chosen
/// (else its defaults). Only names Claude Code could take.
fn launch_flags(model: Option<&str>, effort: Option<&str>) -> Result<Vec<String>, String> {
    let mut out = vec![];
    if let Some(m) = model.map(str::trim).filter(|m| !m.is_empty() && *m != "default") {
        let ok = m.len() <= 80 && !m.starts_with('-') && m.chars().all(|c| c.is_ascii_alphanumeric() || "._:/[]-".contains(c));
        if !ok {
            return Err(format!("not a model name: {m}"));
        }
        out.extend(["--model".to_string(), m.to_string()]);
    }
    if let Some(e) = effort.map(str::trim).filter(|e| !e.is_empty() && *e != "default") {
        if !["low", "medium", "high", "xhigh", "max"].contains(&e) {
            return Err(format!("not an effort level: {e}"));
        }
        out.extend(["--effort".to_string(), e.to_string()]);
    }
    Ok(out)
}

/// Claude Code asks whether to trust a folder the first time it starts in
/// it. For a session Sheepy started, the person chose the folder: answer Yes.
/// Watches for the question for 30 s, and acts only on that exact menu.
async fn trust_folder(address: String) {
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let Ok(got) = hc::run(&["get", &address, "--json"]).await else { return };
        let Ok(t) = serde_json::from_str::<Value>(got.stdout.trim()) else { return };
        if t.get("state").and_then(Value::as_str) != Some("live") {
            return;
        }
        let status = t.get("status").cloned().unwrap_or(Value::Null);
        let asking = status.get("state").and_then(Value::as_str) == Some("blocked")
            && status.get("msg").and_then(Value::as_str).is_some_and(|m| m.contains("trust"));
        if !asking {
            // Working, or waiting at its prompt: past the question (or never asked).
            if status.get("state").and_then(Value::as_str).is_some_and(|s| s == "working" || s == "done" || s == "idle") {
                return;
            }
            continue;
        }
        let Ok(screen) = hc::run(&["read", &address, "--lines", "30"]).await else { return };
        if let Some(keys) = trust_keys(&screen.stdout) {
            let mut args = vec!["keys", address.as_str()];
            args.extend(keys.iter().map(String::as_str));
            let r = hc::run(&args).await;
            log::info!("{address}: trusted its folder ({})", r.map(|o| o.code).unwrap_or(-1));
        }
        return;
    }
}

/// The keys that answer Claude Code's trust question with "Yes, I trust this
/// folder": from the selected option (❯) down or up to it, then Enter. None
/// when the screen isn't that menu.
fn trust_keys(screen: &str) -> Option<Vec<String>> {
    let options: Vec<&str> = screen.lines().map(str::trim).filter(|l| {
        let l = l.trim_start_matches('❯').trim();
        l.starts_with("No, exit") || l.starts_with("Yes, I trust this folder") || l.starts_with("Yes, proceed")
    }).collect();
    let yes = options.iter().position(|l| l.trim_start_matches('❯').trim().starts_with("Yes"))?;
    let at = options.iter().position(|l| l.starts_with('❯'))?;
    let step = if yes > at { "down" } else { "up" };
    let mut keys: Vec<String> = std::iter::repeat_n(step.to_string(), yes.abs_diff(at)).collect();
    keys.push("enter".into());
    Some(keys)
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
            // /tmp/sheepy-open.request holding a terminal address opens it.
            let open = std::path::Path::new("/tmp/sheepy-open.request");
            if let Ok(address) = std::fs::read_to_string(open) {
                let _ = std::fs::remove_file(open);
                let _ = app.emit("dev-open", address.trim().to_string());
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
    let _ = STARTED.set(std::time::SystemTime::now());
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
            refresh_terminals(app.handle().clone());
            #[cfg(debug_assertions)]
            watch_snapshot_requests(app.handle().clone());
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            terminals, terminal, send, keys, interrupt, screen, locate, subagents, page, search, follow, unfollow,
            machines, machine_add, models, save_snapshot, resume, machine_stats, set_group, new_session, ssh_hosts,
            close_session, log_dir, restart, newer_installed, refresh_now, restart_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sheepy");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_flags_for_model_and_effort() {
        assert_eq!(launch_flags(None, None).unwrap(), Vec::<String>::new());
        assert_eq!(launch_flags(Some("default"), Some("")).unwrap(), Vec::<String>::new());
        assert_eq!(launch_flags(Some("opus[1m]"), Some("xhigh")).unwrap(), vec!["--model", "opus[1m]", "--effort", "xhigh"]);
        assert!(launch_flags(Some("--dangerous"), None).is_err());
        assert!(launch_flags(Some("opus; rm"), None).is_err());
        assert!(launch_flags(None, Some("extreme")).is_err());
    }

    #[test]
    fn core_errors_in_plain_words() {
        let o = hc::Out { code: 1, stdout: r#"{"error":{"hint":"read its screen first","kind":"blocked","message":"t14 is blocked (question)"}}"#.into(), stderr: String::new() };
        assert_eq!(core_error(&o), "t14 is blocked (question)");
        let o = hc::Out { code: 1, stdout: String::new(), stderr: "first\nno such terminal".into() };
        assert_eq!(core_error(&o), "no such terminal");
    }

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
    fn the_trust_question_is_answered_yes() {
        let screen = " Accessing workspace:\n\n /\n\n Quick safety check: Is this a project you created or one you trust?\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel\n";
        assert_eq!(trust_keys(screen), Some(vec!["down".to_string(), "enter".to_string()]));
        let already = " ❯ Yes, I trust this folder\n   No, exit\n";
        assert_eq!(trust_keys(already), Some(vec!["enter".to_string()]));
        assert_eq!(trust_keys("❯ 1. Pin it\n  2. Approve\n"), None, "another menu: nothing pressed");
    }

    #[test]
    fn claude_is_found_in_a_login_shells_noisy_answer() {
        assert_eq!(claude_path("SHEEPY-PATH:/home/me/.local/bin/claude\n").as_deref(), Some("/home/me/.local/bin/claude"));
        let noisy = "SHEEPY-PATH:\x1b]1337;RemoteHost=me@mac\x07\x1b]1337;CurrentDir=/Users/me\x07/Users/me/.local/bin/claude\n";
        assert_eq!(claude_path(noisy).as_deref(), Some("/Users/me/.local/bin/claude"));
        assert_eq!(claude_path("SHEEPY-PATH:\n"), None);
        assert_eq!(claude_path("nothing marked"), None);
    }

    #[test]
    fn an_error_printed_on_stderr_is_read_too() {
        let o = hc::Out { code: 1, stdout: String::new(), stderr: r#"{"error":{"kind":"spawn_failed","message":"cannot start \"claude\": No such file or directory (os error 2)"}}"#.into() };
        assert_eq!(started(&o, None, Some("/Users/me")).unwrap_err(), "There's no folder /Users/me on this computer (or Claude Code isn't installed there).");
    }

    #[test]
    fn other_errors_keep_herdr_cores_words() {
        let o = out(r#"{"error":{"kind":"unreachable","message":"vps isn't reachable"}}"#);
        assert_eq!(started(&o, Some("vps"), None).unwrap_err(), "vps isn't reachable");
        let o = hc::Out { code: 1, stdout: "".into(), stderr: "boom\nlast line".into() };
        assert_eq!(started(&o, None, None).unwrap_err(), "last line");
    }
}
