#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use url::Url;

static NEXT_DOWNLOAD_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadItem {
    id: String,
    name: String,
    url: String,
    size_bytes: Option<u64>,
    downloaded_bytes: Option<u64>,
    speed_bytes_per_sec: Option<u64>,
    status: String,
    category: String,
    added_at: String,
    progress_percent: Option<f64>,
    #[serde(default)]
    eta_seconds: Option<u64>,
    destination: String,
    error: Option<String>,
    #[serde(default)]
    resumable: bool,
    #[serde(default)]
    resume_pending: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    download_directory: String,
    connections: u8,
    max_concurrent_downloads: u8,
    throttle_bytes_per_sec: u64,
    max_retries: u32,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        let home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        Self {
            download_directory: home.join("Downloads").to_string_lossy().into_owned(),
            connections: 4,
            max_concurrent_downloads: 3,
            throttle_bytes_per_sec: 0,
            max_retries: 5,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineState {
    generated_at: String,
    downloads: Vec<DownloadItem>,
}

#[derive(Debug, PartialEq)]
struct ProgressUpdate {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    speed_bytes_per_sec: Option<u64>,
    eta_seconds: Option<u64>,
}

struct AppState {
    state_path: PathBuf,
    downloads: Mutex<Vec<DownloadItem>>,
    settings_path: PathBuf,
    settings: Mutex<DesktopSettings>,
    checkpoint_samples: Mutex<HashMap<String, (u64, Instant)>>,
}

impl AppState {
    fn lock_state_file(&self) -> Result<std::fs::File, String> {
        let lock_path = self.state_path.with_extension("lock");
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock_path)
            .map_err(|error| format!("could not open download state lock: {error}"))?;
        lock.lock_exclusive()
            .map_err(|error| format!("could not lock download state: {error}"))?;
        Ok(lock)
    }

    fn read_disk_locked(&self) -> Result<Vec<DownloadItem>, String> {
        if !self.state_path.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(&self.state_path)
            .map_err(|error| format!("could not read download state: {error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("download state is invalid JSON: {error}"))
    }

    fn write_disk_locked(&self, downloads: &[DownloadItem]) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(downloads)
            .map_err(|error| format!("could not serialize download state: {error}"))?;
        let temporary = self.state_path.with_extension("json.tmp");
        fs::write(&temporary, bytes)
            .map_err(|error| format!("could not write download state: {error}"))?;
        fs::rename(&temporary, &self.state_path)
            .map_err(|error| format!("could not commit download state: {error}"))
    }

    fn persist_locked(&self, downloads: &[DownloadItem]) -> Result<(), String> {
        let _file_lock = self.lock_state_file()?;
        let mut merged = self.read_disk_locked()?;
        for item in downloads {
            if let Some(existing) = merged.iter_mut().find(|existing| existing.id == item.id) {
                *existing = item.clone();
            } else {
                merged.push(item.clone());
            }
        }
        self.write_disk_locked(&merged)
    }

    fn refresh(&self) -> Result<Vec<DownloadItem>, String> {
        let mut downloads = self
            .downloads
            .lock()
            .map_err(|_| "download state is unavailable".to_string())?;
        let _file_lock = self.lock_state_file()?;
        for disk_item in self.read_disk_locked()? {
            if let Some(current) = downloads
                .iter_mut()
                .find(|current| current.id == disk_item.id)
            {
                if current.status == "active" && disk_item.status != "active" {
                    *current = disk_item;
                }
            } else {
                downloads.push(disk_item);
            }
        }
        let mut changed = false;
        let mut samples = self
            .checkpoint_samples
            .lock()
            .map_err(|_| "download samples are unavailable".to_string())?;
        for item in &mut *downloads {
            if matches!(item.status.as_str(), "active" | "interrupted" | "failed")
                && Path::new(&item.destination).is_file()
            {
                if let Ok(metadata) = fs::metadata(&item.destination) {
                    item.status = "completed".to_string();
                    item.size_bytes = Some(metadata.len());
                    item.downloaded_bytes = Some(metadata.len());
                    item.progress_percent = Some(100.0);
                    item.eta_seconds = None;
                    item.error = None;
                    item.resumable = false;
                    changed = true;
                }
            }
            if item.status == "active" {
                if let Some((done, total)) = read_checkpoint_progress(&item.destination) {
                    if item.downloaded_bytes != Some(done) {
                        item.downloaded_bytes = Some(done);
                        changed = true;
                    }
                    if let Some(total) = total {
                        let progress = Some((done as f64 * 100.0 / total.max(1) as f64).min(100.0));
                        if item.size_bytes != Some(total) {
                            item.size_bytes = Some(total);
                            changed = true;
                        }
                        if item.progress_percent != progress {
                            item.progress_percent = progress;
                            changed = true;
                        }
                    }
                    let now = Instant::now();
                    let speed = samples.get(&item.id).map(|(previous, at)| {
                        let elapsed = now.duration_since(*at).as_secs_f64();
                        if elapsed > 0.0 {
                            (done.saturating_sub(*previous) as f64 / elapsed).round() as u64
                        } else {
                            0
                        }
                    });
                    samples.insert(item.id.clone(), (done, now));
                    if let Some(speed) = speed {
                        if item.speed_bytes_per_sec != Some(speed) {
                            item.speed_bytes_per_sec = Some(speed);
                            changed = true;
                        }
                        let eta = total
                            .filter(|total| *total > done && speed > 0)
                            .map(|total| ((total - done) as f64 / speed as f64).ceil() as u64);
                        if item.eta_seconds != eta {
                            item.eta_seconds = eta;
                            changed = true;
                        }
                    }
                    continue;
                }
            }
            samples.remove(&item.id);
            let resumable = matches!(item.status.as_str(), "paused" | "interrupted" | "failed")
                && has_resume_checkpoint(&item.destination);
            if item.resumable != resumable {
                item.resumable = resumable;
                changed = true;
            }
        }
        if changed {
            self.write_disk_locked(&downloads)?;
        }
        Ok(downloads.clone())
    }

    fn update<F>(&self, id: &str, update: F)
    where
        F: FnOnce(&mut DownloadItem),
    {
        if let Ok(mut downloads) = self.downloads.lock() {
            if let Some(item) = downloads.iter_mut().find(|item| item.id == id) {
                update(item);
                let snapshot = downloads.clone();
                let _ = self.persist_locked(&snapshot);
            }
        }
    }
}

#[tauri::command]
fn list_downloads(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<EngineState, String> {
    pump_queue(&app, &state)?;
    let downloads = state.refresh()?;
    Ok(EngineState {
        generated_at: now_millis().to_string(),
        downloads,
    })
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<AppState>>) -> Result<DesktopSettings, String> {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|_| "desktop settings are unavailable".to_string())
}

#[tauri::command]
fn clear_history(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut downloads = state
        .downloads
        .lock()
        .map_err(|_| "download state is unavailable".to_string())?;
    downloads.retain(keep_after_history_clear);
    let _file_lock = state.lock_state_file()?;
    state.write_disk_locked(&downloads)
}

fn keep_after_history_clear(item: &DownloadItem) -> bool {
    matches!(
        item.status.as_str(),
        "active" | "queued" | "paused" | "interrupted"
    ) || (item.status == "failed" && item.resumable)
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    settings: DesktopSettings,
) -> Result<DesktopSettings, String> {
    validate_settings(&settings)?;
    fs::create_dir_all(&settings.download_directory)
        .map_err(|error| format!("could not create download folder: {error}"))?;
    let bytes = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("could not serialize settings: {error}"))?;
    let temporary = state.settings_path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| format!("could not write settings: {error}"))?;
    fs::rename(&temporary, &state.settings_path)
        .map_err(|error| format!("could not commit settings: {error}"))?;
    *state
        .settings
        .lock()
        .map_err(|_| "desktop settings are unavailable".to_string())? = settings.clone();
    pump_queue(&app, &state)?;
    Ok(settings)
}

fn validate_settings(settings: &DesktopSettings) -> Result<(), String> {
    let directory = Path::new(&settings.download_directory);
    if !directory.is_absolute() {
        return Err("Download folder must be an absolute path.".to_string());
    }
    if !(1..=32).contains(&settings.connections) {
        return Err("Connections must be between 1 and 32.".to_string());
    }
    if !(1..=16).contains(&settings.max_concurrent_downloads) {
        return Err("Concurrent downloads must be between 1 and 16.".to_string());
    }
    if settings.throttle_bytes_per_sec > 10_000_000_000 {
        return Err("Speed limit must not exceed 10 GB/s.".to_string());
    }
    if !(1..=20).contains(&settings.max_retries) {
        return Err("Retries must be between 1 and 20.".to_string());
    }
    Ok(())
}

#[tauri::command]
fn start_download(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    url: String,
) -> Result<DownloadItem, String> {
    let parsed = Url::parse(&url).map_err(|_| "Enter a valid http(s) URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only credential-free http(s) URLs can be downloaded.".to_string());
    }

    let filename = safe_filename(
        parsed
            .path_segments()
            .and_then(|mut segments| segments.next_back())
            .filter(|segment| !segment.is_empty())
            .unwrap_or("download"),
    );
    let directory = PathBuf::from(
        state
            .settings
            .lock()
            .map_err(|_| "desktop settings are unavailable".to_string())?
            .download_directory
            .clone(),
    );
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create Downloads folder: {error}"))?;
    let destination = unused_destination(&directory, &filename)?;
    let id = format!(
        "{}-{}-{}",
        std::process::id(),
        now_millis(),
        NEXT_DOWNLOAD_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let item = DownloadItem {
        id: id.clone(),
        name: filename,
        url,
        size_bytes: None,
        downloaded_bytes: Some(0),
        speed_bytes_per_sec: None,
        status: "queued".to_string(),
        category: category_for(&destination),
        added_at: now_millis().to_string(),
        progress_percent: None,
        eta_seconds: None,
        destination: destination.to_string_lossy().into_owned(),
        error: None,
        resumable: false,
        resume_pending: false,
    };

    let mut downloads = state
        .downloads
        .lock()
        .map_err(|_| "download state is unavailable".to_string())?;
    downloads.push(item.clone());
    let snapshot = downloads.clone();
    state.persist_locked(&snapshot)?;
    drop(downloads);
    pump_queue(&app, &state)?;

    Ok(item)
}

#[tauri::command]
fn resume_download(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DownloadItem, String> {
    let item = {
        let downloads = state
            .downloads
            .lock()
            .map_err(|_| "download state is unavailable".to_string())?;
        downloads
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .ok_or_else(|| "download not found".to_string())?
    };
    if !matches!(item.status.as_str(), "paused" | "interrupted" | "failed")
        || !has_resume_checkpoint(&item.destination)
    {
        return Err("This download has no resumable checkpoint.".to_string());
    }

    {
        let mut downloads = state
            .downloads
            .lock()
            .map_err(|_| "download state is unavailable".to_string())?;
        let current = downloads
            .iter_mut()
            .find(|current| current.id == id)
            .ok_or_else(|| "download disappeared before resume".to_string())?;
        current.status = "queued".to_string();
        current.error = None;
        current.resumable = false;
        current.resume_pending = true;
        let snapshot = downloads.clone();
        state.persist_locked(&snapshot)?;
    }
    pump_queue(&app, &state)?;
    Ok(item)
}

#[tauri::command]
fn pause_download(state: State<'_, Arc<AppState>>, id: String) -> Result<String, String> {
    let item = state
        .downloads
        .lock()
        .map_err(|_| "download state is unavailable".to_string())?
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| "download not found".to_string())?;
    if item.status != "active" {
        return Err("Only an active download can be paused.".to_string());
    }
    fs::write(control_file_path(Path::new(&item.destination)), "pause\n")
        .map_err(|error| format!("could not request pause: {error}"))?;
    Ok("Pause requested; the engine will save a checkpoint after its current chunk.".to_string())
}

#[tauri::command]
fn cancel_download(state: State<'_, Arc<AppState>>, id: String) -> Result<String, String> {
    let mut downloads = state
        .downloads
        .lock()
        .map_err(|_| "download state is unavailable".to_string())?;
    let index = downloads
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| "download not found".to_string())?;
    let item = downloads[index].clone();
    let destination = Path::new(&item.destination);
    let control_file = control_file_path(destination);

    if item.status == "active" {
        fs::write(&control_file, "cancel\n")
            .map_err(|error| format!("could not request cancellation: {error}"))?;
        return Ok("Cancellation requested; the engine will remove its partial file.".to_string());
    }
    if !matches!(
        item.status.as_str(),
        "queued" | "paused" | "interrupted" | "failed"
    ) {
        return Err("Only active or incomplete downloads can be cancelled.".to_string());
    }

    remove_if_exists(&part_file_path(destination))?;
    remove_if_exists(&checkpoint_file_path(destination))?;
    remove_if_exists(&control_file)?;
    let item = &mut downloads[index];
    item.status = "cancelled".to_string();
    item.error = None;
    item.resumable = false;
    let snapshot = downloads.clone();
    state.persist_locked(&snapshot)?;
    Ok("Download cancelled; its partial file and checkpoint were removed.".to_string())
}

fn engine_command(
    app: &AppHandle,
    url: &str,
    destination: &Path,
    resume: bool,
    control_file: &Path,
    settings: &DesktopSettings,
) -> Result<std::process::Child, String> {
    let engine = resolve_engine_binary(app, if cfg!(windows) { "dm.exe" } else { "dm" })?;
    if !engine.is_file() {
        return Err("The packaged `dm` download engine is missing.".to_string());
    }
    let mut command = Command::new(engine);
    command
        .arg(url)
        .arg(destination)
        .arg("--connections")
        .arg(settings.connections.to_string())
        .arg("--max-retries")
        .arg(settings.max_retries.to_string())
        .arg("--control-file")
        .arg(control_file);
    if settings.throttle_bytes_per_sec > 0 {
        command
            .arg("--throttle")
            .arg(settings.throttle_bytes_per_sec.to_string());
    }
    if resume {
        command.arg("--resume");
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start the download engine: {error}"))
}

fn monitor_engine(
    mut child: std::process::Child,
    id: String,
    state: Arc<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "could not read engine progress".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "could not read engine result".to_string())?;
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(progress) = parse_progress(&line) {
                state.update(&id, |item| {
                    item.downloaded_bytes = Some(progress.downloaded_bytes);
                    item.speed_bytes_per_sec = progress.speed_bytes_per_sec;
                    item.eta_seconds = progress.eta_seconds;
                    if let Some(total) = progress.total_bytes {
                        item.size_bytes = Some(total);
                        item.progress_percent = Some(
                            (progress.downloaded_bytes as f64 * 100.0 / total.max(1) as f64)
                                .min(100.0),
                        );
                    }
                });
            } else if line.starts_with("error:") {
                let safe_error = line.chars().take(500).collect::<String>();
                state.update(&id, |item| item.error = Some(safe_error));
            }
        }

        let mut stdout = stdout;
        let mut output = String::new();
        let _ = stdout.read_to_string(&mut output);
        let result = child.wait();
        state.update(&id, |item| match result {
            Ok(status) if status.success() => {
                item.status = "completed".to_string();
                item.resumable = false;
                item.eta_seconds = None;
                if let Ok(metadata) = fs::metadata(&item.destination) {
                    item.size_bytes = Some(metadata.len());
                    item.downloaded_bytes = Some(metadata.len());
                    item.progress_percent = Some(100.0);
                }
                item.error = None;
            }
            Ok(status) if status.code() == Some(130) => {
                item.status = "paused".to_string();
                item.resumable = has_resume_checkpoint(&item.destination);
                item.speed_bytes_per_sec = None;
                item.eta_seconds = None;
                item.error = None;
            }
            Ok(status) if status.code() == Some(131) => {
                item.status = "cancelled".to_string();
                item.resumable = false;
                item.speed_bytes_per_sec = None;
                item.eta_seconds = None;
                item.error = None;
            }
            Ok(status) => {
                item.status = "failed".to_string();
                item.resumable = has_resume_checkpoint(&item.destination);
                item.speed_bytes_per_sec = None;
                item.eta_seconds = None;
                if item.error.is_none() {
                    item.error = Some(format!("download engine exited with {status}"));
                }
            }
            Err(error) => {
                item.status = "failed".to_string();
                item.resumable = has_resume_checkpoint(&item.destination);
                item.speed_bytes_per_sec = None;
                item.eta_seconds = None;
                item.error = Some(format!("could not observe download engine exit: {error}"));
            }
        });
        let _ = pump_queue(&app, &state);
    });
    Ok(())
}

fn pump_queue(app: &AppHandle, state: &Arc<AppState>) -> Result<(), String> {
    loop {
        let (item, settings, resume) = {
            let mut downloads = state
                .downloads
                .lock()
                .map_err(|_| "download state is unavailable".to_string())?;
            let settings = state
                .settings
                .lock()
                .map_err(|_| "desktop settings are unavailable".to_string())?
                .clone();
            let active = downloads
                .iter()
                .filter(|item| item.status == "active")
                .count();
            if active >= usize::from(settings.max_concurrent_downloads) {
                return Ok(());
            }
            let Some(index) = downloads.iter().position(|item| item.status == "queued") else {
                return Ok(());
            };
            let item = &mut downloads[index];
            item.status = "active".to_string();
            let resume = item.resume_pending;
            item.resume_pending = false;
            let item = item.clone();
            let snapshot = downloads.clone();
            state.persist_locked(&snapshot)?;
            (item, settings, resume)
        };

        let control_file = control_file_path(Path::new(&item.destination));
        let child = match engine_command(
            app,
            &item.url,
            Path::new(&item.destination),
            resume,
            &control_file,
            &settings,
        ) {
            Ok(child) => child,
            Err(error) => {
                state.update(&item.id, |current| {
                    current.status = "failed".to_string();
                    current.error = Some(error);
                    current.resumable = has_resume_checkpoint(&current.destination);
                });
                continue;
            }
        };
        monitor_engine(child, item.id, Arc::clone(state), app.clone())?;
    }
}

fn has_resume_checkpoint(destination: &str) -> bool {
    let path = Path::new(destination);
    part_file_path(path).is_file()
        && checkpoint_file_path(path).is_file()
        && !control_file_path(path).exists()
}

fn sidecar_path(destination: &Path, suffix: &str) -> PathBuf {
    let filename = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    destination.with_file_name(format!("{filename}{suffix}"))
}

fn part_file_path(destination: &Path) -> PathBuf {
    sidecar_path(destination, ".part")
}

fn checkpoint_file_path(destination: &Path) -> PathBuf {
    sidecar_path(destination, ".checkpoint.json")
}

fn control_file_path(destination: &Path) -> PathBuf {
    sidecar_path(destination, ".control")
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove {}: {error}", path.display())),
    }
}

#[tauri::command]
fn pair_chromium_extensions(app: AppHandle, extension_ids: Vec<String>) -> Result<String, String> {
    let extension_ids: Vec<String> = extension_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if extension_ids.is_empty()
        || extension_ids
            .iter()
            .any(|id| id.len() != 32 || !id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)))
    {
        return Err(
            "Enter one or more valid Chromium extension IDs (32 letters a–p), separated by commas."
                .to_string(),
        );
    }

    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("could not locate application data directory: {error}"))?;
        let manifest_dir = app_data.join("native-host");
        fs::create_dir_all(&manifest_dir)
            .map_err(|error| format!("could not create native host manifest directory: {error}"))?;
        let manifest_path = manifest_dir.join("com.downloadmanager.nextgen.json");
        let host_path = resolve_engine_binary(&app, "dm-native-host.exe")?;
        if !host_path.is_file() {
            return Err("The packaged Native Messaging host executable is missing.".to_string());
        }

        let allowed_origins: Vec<String> = extension_ids
            .iter()
            .map(|id| format!("chrome-extension://{id}/"))
            .collect();
        let manifest = serde_json::json!({
            "name": "com.downloadmanager.nextgen",
            "description": "ZEX Download Manager Native Messaging host",
            "path": host_path,
            "type": "stdio",
            "allowed_origins": allowed_origins,
        });
        let temporary = manifest_path.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&manifest).map_err(|error| {
                format!("could not serialize Native Messaging manifest: {error}")
            })?,
        )
        .map_err(|error| format!("could not write Native Messaging manifest: {error}"))?;
        fs::rename(&temporary, &manifest_path)
            .map_err(|error| format!("could not install Native Messaging manifest: {error}"))?;

        let registry = RegKey::predef(HKEY_CURRENT_USER);
        let manifest_value = manifest_path.to_string_lossy().to_string();
        for subkey in [
            "Software\\Google\\Chrome\\NativeMessagingHosts\\com.downloadmanager.nextgen",
            "Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.downloadmanager.nextgen",
            "Software\\BraveSoftware\\Brave\\NativeMessagingHosts\\com.downloadmanager.nextgen",
        ] {
            let (key, _) = registry
                .create_subkey(subkey)
                .map_err(|error| format!("could not register Native Messaging host: {error}"))?;
            key.set_value("", &manifest_value).map_err(|error| {
                format!("could not write Native Messaging registry entry: {error}")
            })?;
        }
        return Ok(format!("Registered Native Messaging for {} Chromium extension ID(s). Restart the browser to apply it.", extension_ids.len()));
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Chromium Native Messaging registration is supported on Windows only.".to_string())
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn resolve_engine_binary(app: &AppHandle, binary_name: &str) -> Result<PathBuf, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| format!("could not locate application resources: {error}"))?
        .join("binaries")
        .join(binary_name);
    if resources.is_file() {
        return Ok(resources);
    }

    let local_build = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../engine/target/release")
        .join(binary_name);
    if local_build.is_file() {
        return Ok(local_build);
    }
    Err(format!("required engine binary `{binary_name}` is missing"))
}

fn safe_filename(input: &str) -> String {
    let mut filename: String = input
        .chars()
        .take(160)
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    filename = filename.trim_matches([' ', '.']).to_string();
    if filename.is_empty() || filename == "." || filename == ".." {
        return "download".to_string();
    }
    let device_name = filename
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if matches!(device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device_name.len() == 4
            && (device_name.starts_with("COM") || device_name.starts_with("LPT"))
            && device_name.as_bytes()[3].is_ascii_digit()
            && device_name.as_bytes()[3] != b'0')
    {
        filename.insert_str(0, "download-");
    }
    filename
}

fn unused_destination(directory: &Path, filename: &str) -> Result<PathBuf, String> {
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str());
    for suffix in 0..10_000 {
        let name = if suffix == 0 {
            filename.to_string()
        } else if let Some(extension) = extension {
            format!("{stem} ({suffix}).{extension}")
        } else {
            format!("{stem} ({suffix})")
        };
        let candidate = directory.join(name);
        let name = candidate
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("download");
        if !candidate.exists()
            && !directory.join(format!("{name}.part")).exists()
            && !directory.join(format!("{name}.checkpoint.json")).exists()
            && !directory.join(format!("{name}.control")).exists()
        {
            return Ok(candidate);
        }
    }
    Err("could not choose an unused destination filename".to_string())
}

fn category_for(destination: &Path) -> String {
    match destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "m3u8" | "mpd" => "video".to_string(),
        "" => "other".to_string(),
        _ => "file".to_string(),
    }
}

fn read_checkpoint_progress(destination: &str) -> Option<(u64, Option<u64>)> {
    let bytes = fs::read(checkpoint_file_path(Path::new(destination))).ok()?;
    let checkpoint: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let segments = checkpoint.get("segments")?.as_array()?;
    let downloaded = segments.iter().try_fold(0u64, |total, segment| {
        total.checked_add(segment.get("done")?.as_u64()?)
    })?;
    let total = checkpoint
        .get("total_size")
        .and_then(serde_json::Value::as_u64);
    Some((downloaded, total))
}

fn parse_progress(line: &str) -> Option<ProgressUpdate> {
    let body = line.strip_prefix("progress:")?.trim();
    let (done, total) = if let Some((done, rest)) = body.split_once(" / ") {
        let total = rest.split_whitespace().next()?.parse().ok()?;
        (done.parse().ok()?, Some(total))
    } else {
        (body.split_whitespace().next()?.parse().ok()?, None)
    };
    let speed = body
        .split_once("KiB/s")
        .and_then(|(before, _)| before.split_whitespace().last())
        .and_then(|value| value.trim_matches(['(', ',']).parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| (value * 1024.0).round() as u64);
    let eta = body
        .split_once("ETA ")
        .and_then(|(_, value)| value.split('s').next())
        .and_then(|value| value.parse::<u64>().ok());
    Some(ProgressUpdate {
        downloaded_bytes: done,
        total_bytes: total,
        speed_bytes_per_sec: speed,
        eta_seconds: eta,
    })
}

fn load_state(path: PathBuf) -> Arc<AppState> {
    let mut downloads: Vec<DownloadItem> = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    for item in &mut downloads {
        if item.status == "active" {
            let _ = fs::write(control_file_path(Path::new(&item.destination)), "pause\n");
            item.status = "interrupted".to_string();
            item.error =
                Some("The desktop session ended before this download finished.".to_string());
        }
        item.resumable = matches!(item.status.as_str(), "paused" | "interrupted" | "failed")
            && has_resume_checkpoint(&item.destination);
    }
    Arc::new(AppState {
        settings_path: path.with_file_name("settings.json"),
        settings: Mutex::new(load_settings(path.with_file_name("settings.json"))),
        checkpoint_samples: Mutex::new(HashMap::new()),
        state_path: path,
        downloads: Mutex::new(downloads),
    })
}

fn load_settings(path: PathBuf) -> DesktopSettings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<DesktopSettings>(&bytes).ok())
        .filter(|settings| validate_settings(settings).is_ok())
        .unwrap_or_default()
}

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Ok(downloads) = window.state::<Arc<AppState>>().downloads.lock() {
                    for item in downloads.iter().filter(|item| item.status == "active") {
                        let _ =
                            fs::write(control_file_path(Path::new(&item.destination)), "pause\n");
                    }
                }
            }
        })
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            fs::create_dir_all(&directory)?;
            let state = load_state(directory.join("downloads.json"));
            if let Ok(downloads) = state.downloads.lock() {
                let _ = state.persist_locked(&downloads);
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_downloads,
            get_settings,
            save_settings,
            clear_history,
            start_download,
            resume_download,
            pause_download,
            cancel_download,
            pair_chromium_extensions
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZEX Download Manager");
}

#[cfg(test)]
mod tests {
    use super::{
        keep_after_history_clear, load_state, parse_progress, read_checkpoint_progress,
        safe_filename, validate_settings, AppState, DesktopSettings, DownloadItem, ProgressUpdate,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::sync::Mutex;

    fn item(id: &str, status: &str, destination: &str) -> DownloadItem {
        DownloadItem {
            id: id.to_string(),
            name: "fixture.bin".to_string(),
            url: "http://127.0.0.1/fixture.bin".to_string(),
            size_bytes: None,
            downloaded_bytes: Some(0),
            speed_bytes_per_sec: None,
            status: status.to_string(),
            category: "file".to_string(),
            added_at: "123456789".to_string(),
            progress_percent: None,
            eta_seconds: None,
            destination: destination.to_string(),
            error: None,
            resumable: false,
            resume_pending: false,
        }
    }

    #[test]
    fn desktop_state_imports_native_host_jobs_and_detects_completion() {
        let directory =
            std::env::temp_dir().join(format!("zex-tauri-state-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let destination = directory.join("fixture.bin");
        fs::write(&destination, b"complete").unwrap();
        let record = item("native-job", "active", &destination.to_string_lossy());
        let state_path = directory.join("downloads.json");
        fs::write(&state_path, serde_json::to_vec(&[record]).unwrap()).unwrap();

        let state = AppState {
            state_path,
            downloads: Mutex::new(Vec::new()),
            settings_path: directory.join("settings.json"),
            settings: Mutex::new(DesktopSettings::default()),
            checkpoint_samples: Mutex::new(HashMap::new()),
        };
        let downloads = state.refresh().unwrap();
        assert_eq!(downloads.len(), 1);
        assert_eq!(downloads[0].id, "native-job");
        assert_eq!(downloads[0].status, "completed");
        assert_eq!(downloads[0].size_bytes, Some(8));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn desktop_state_persistence_merges_jobs_from_other_processes() {
        let directory =
            std::env::temp_dir().join(format!("zex-tauri-merge-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let state_path = directory.join("downloads.json");
        let external = item("native-job", "active", "C:/Downloads/fixture.bin");
        fs::write(&state_path, serde_json::to_vec(&[external]).unwrap()).unwrap();
        let local = item("desktop-job", "active", "C:/Downloads/local.bin");
        let state = AppState {
            state_path: state_path.clone(),
            downloads: Mutex::new(vec![local]),
            settings_path: directory.join("settings.json"),
            settings: Mutex::new(DesktopSettings::default()),
            checkpoint_samples: Mutex::new(HashMap::new()),
        };

        let local_snapshot = state.downloads.lock().unwrap().clone();
        state.persist_locked(&local_snapshot).unwrap();
        let persisted: Vec<DownloadItem> =
            serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
        assert_eq!(persisted.len(), 2);
        assert!(persisted.iter().any(|entry| entry.id == "native-job"));
        assert!(persisted.iter().any(|entry| entry.id == "desktop-job"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn interrupted_download_is_resumable_only_with_both_checkpoint_files() {
        let directory =
            std::env::temp_dir().join(format!("zex-tauri-resume-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let destination = directory.join("fixture.bin");
        let record = item("resume-job", "active", &destination.to_string_lossy());
        let state_path = directory.join("downloads.json");
        fs::write(&state_path, serde_json::to_vec(&[record]).unwrap()).unwrap();

        let state = load_state(state_path);
        {
            let downloads = state.downloads.lock().unwrap();
            assert_eq!(downloads[0].status, "interrupted");
            assert!(!downloads[0].resumable);
        }
        assert_eq!(
            fs::read_to_string(directory.join("fixture.bin.control")).unwrap(),
            "pause\n"
        );
        fs::write(directory.join("fixture.bin.part"), b"partial").unwrap();
        fs::write(directory.join("fixture.bin.checkpoint.json"), b"{}\n").unwrap();
        fs::remove_file(directory.join("fixture.bin.control")).unwrap();
        let downloads = state.refresh().unwrap();
        assert!(downloads[0].resumable);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn desktop_settings_validate_limits_and_round_trip() {
        let mut settings = DesktopSettings::default();
        assert!(validate_settings(&settings).is_ok());
        let serialized = serde_json::to_vec(&settings).unwrap();
        assert_eq!(
            serde_json::from_slice::<DesktopSettings>(&serialized)
                .unwrap()
                .connections,
            settings.connections
        );
        settings.connections = 33;
        assert!(validate_settings(&settings).is_err());
        settings.connections = 4;
        settings.max_concurrent_downloads = 0;
        assert!(validate_settings(&settings).is_err());
        settings.max_concurrent_downloads = 3;
        settings.download_directory = "relative/downloads".to_string();
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn history_clear_keeps_active_and_resumable_jobs() {
        let statuses = [
            item("active", "active", "C:/Downloads/active.bin"),
            item("queued", "queued", "C:/Downloads/queued.bin"),
            item("paused", "paused", "C:/Downloads/paused.bin"),
            item("interrupted", "interrupted", "C:/Downloads/interrupted.bin"),
            item("failed-resumable", "failed", "C:/Downloads/retry.bin"),
            item("completed", "completed", "C:/Downloads/done.bin"),
            item("cancelled", "cancelled", "C:/Downloads/cancelled.bin"),
        ];
        let mut statuses = statuses.to_vec();
        statuses
            .iter_mut()
            .find(|download| download.id == "failed-resumable")
            .unwrap()
            .resumable = true;
        statuses.retain(keep_after_history_clear);
        let ids: Vec<&str> = statuses
            .iter()
            .map(|download| download.id.as_str())
            .collect();
        assert_eq!(
            ids,
            [
                "active",
                "queued",
                "paused",
                "interrupted",
                "failed-resumable"
            ]
        );
    }

    #[test]
    fn checkpoint_reader_sums_observed_segment_bytes() {
        let directory =
            std::env::temp_dir().join(format!("zex-tauri-progress-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let destination = directory.join("fixture.bin");
        fs::write(
            directory.join("fixture.bin.checkpoint.json"),
            br#"{"total_size":100,"segments":[{"done":25},{"done":15}]}"#,
        )
        .unwrap();
        assert_eq!(
            read_checkpoint_progress(destination.to_str().unwrap()),
            Some((40, Some(100)))
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn parses_only_observed_engine_progress() {
        assert_eq!(
            parse_progress("progress: 10 / 100 bytes (10.0%, 1/1 segments, 1.5 KiB/s, ETA 2s)"),
            Some(ProgressUpdate {
                downloaded_bytes: 10,
                total_bytes: Some(100),
                speed_bytes_per_sec: Some(1536),
                eta_seconds: Some(2),
            })
        );
        assert_eq!(
            parse_progress("progress: 10 bytes (1.5 KiB/s, unknown total)"),
            Some(ProgressUpdate {
                downloaded_bytes: 10,
                total_bytes: None,
                speed_bytes_per_sec: Some(1536),
                eta_seconds: None,
            })
        );
    }

    #[test]
    fn destination_names_are_path_safe() {
        assert_eq!(safe_filename("../../movie.mp4"), "_.._movie.mp4");
        assert_eq!(safe_filename(".."), "download");
        assert_eq!(safe_filename("CON.txt"), "download-CON.txt");
    }
}
