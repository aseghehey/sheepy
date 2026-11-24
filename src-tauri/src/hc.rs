//! herdr-core, the program that keeps terminals (and the agents in them) alive
//! here and on other machines. Sheepy drives it through its CLI, as Herdr's
//! mods do: `ls`, `send`, `keys`, `interrupt`, `exec --on <machine>`, `events`.

use base64::Engine as _;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

/// Where herdr-core is: on PATH, else where its installer puts it.
pub fn bin() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        let local = PathBuf::from(home).join(".local/bin/herdr-core");
        if local.exists() {
            return local;
        }
    }
    PathBuf::from("herdr-core")
}

/// The machine an address is on (`vps/t1f`), or None for this computer.
pub fn machine_of(address: &str) -> Option<&str> {
    address.split_once('/').map(|(m, _)| m)
}

#[derive(Debug, Clone, Serialize)]
pub struct Out {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Out {
    pub fn ok(&self) -> bool {
        self.code == 0
    }
}

/// Runs herdr-core with `args`; what it printed.
pub async fn run(args: &[&str]) -> Result<Out, String> {
    let out = Command::new(bin())
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| format!("can't run herdr-core: {e}"))?;
    Ok(Out {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Runs `argv` on `on` (None: this computer, directly), at most `timeout` seconds.
pub async fn exec(on: Option<&str>, argv: &[String], timeout: u64) -> Result<Out, String> {
    match on {
        None => {
            let (prog, rest) = argv.split_first().ok_or("nothing to run")?;
            let child = Command::new(prog)
                .args(rest)
                .stdin(Stdio::null())
                .output();
            let out = tokio::time::timeout(std::time::Duration::from_secs(timeout), child)
                .await
                .map_err(|_| format!("{prog} took longer than {timeout}s"))?
                .map_err(|e| format!("can't run {prog}: {e}"))?;
            Ok(Out {
                code: out.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            })
        }
        Some(machine) => {
            let t = timeout.to_string();
            let mut args = vec!["exec", "--json", "--on", machine, "--timeout", t.as_str(), "--"];
            args.extend(argv.iter().map(String::as_str));
            let out = run(&args).await?;
            if !out.ok() && out.stdout.trim().is_empty() {
                return Err(out.stderr.trim().to_string());
            }
            let v: serde_json::Value = serde_json::from_str(out.stdout.trim())
                .map_err(|e| format!("herdr-core exec answered something unexpected: {e}"))?;
            let b64 = |k: &str| {
                let s = v.get(k).and_then(|x| x.as_str()).unwrap_or("");
                base64::engine::general_purpose::STANDARD
                    .decode(s)
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
                    .unwrap_or_default()
            };
            if v.get("timed_out").and_then(|x| x.as_bool()) == Some(true) {
                return Err(format!("took longer than {timeout}s on {machine}"));
            }
            Ok(Out {
                code: v.get("code").and_then(|x| x.as_i64()).unwrap_or(-1) as i32,
                stdout: b64("stdout"),
                stderr: b64("stderr"),
            })
        }
    }
}

/// `sh -c script` with `args` as $1.., on `on`.
pub async fn sh(on: Option<&str>, script: &str, args: &[&str], timeout: u64) -> Result<Out, String> {
    let mut argv = vec!["sh".to_string(), "-c".to_string(), script.to_string(), "sh".to_string()];
    argv.extend(args.iter().map(|s| s.to_string()));
    exec(on, &argv, timeout).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn machine_of_reads_the_address() {
        assert_eq!(machine_of("vps/t1f"), Some("vps"));
        assert_eq!(machine_of("t3"), None);
    }

    #[tokio::test]
    async fn local_exec_runs_directly() {
        let out = sh(None, "echo \"$1\"; echo e >&2; exit 4", &["hi there"], 5).await.unwrap();
        assert_eq!(out.code, 4);
        assert_eq!(out.stdout, "hi there\n");
        assert_eq!(out.stderr, "e\n");
    }

    #[tokio::test]
    async fn local_exec_times_out() {
        let err = sh(None, "sleep 3", &[], 1).await.unwrap_err();
        assert!(err.contains("longer than 1s"), "{err}");
    }
}
