//! Browser Native Messaging adapter for the `dm` download CLI.
//!
//! Reads Chrome/Edge Native Messaging frames from stdin and writes exactly
//! one framed JSON response per request to stdout. Diagnostics never go to
//! stdout because that would corrupt the framing protocol.

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_URL_BYTES: usize = 64 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeDownloadRecord {
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
    destination: String,
    error: Option<String>,
}

fn app_data_directory() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let base = env::var_os("APPDATA").map(PathBuf::from);

    #[cfg(not(windows))]
    let base = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));

    base.map(|path| path.join("com.zex.downloadmanager"))
        .ok_or_else(|| "cannot determine the application data directory".to_string())
}

fn persist_download_record(record: NativeDownloadRecord) -> Result<(), String> {
    let directory = app_data_directory()?;
    persist_record_in(&directory, record)
}

fn persist_record_in(directory: &Path, record: NativeDownloadRecord) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("cannot create application data directory: {error}"))?;
    let state_path = directory.join("downloads.json");
    let lock_path = directory.join("downloads.lock");
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|error| format!("cannot open download state lock: {error}"))?;
    lock.lock_exclusive()
        .map_err(|error| format!("cannot lock download state: {error}"))?;

    let mut records: Vec<NativeDownloadRecord> = if state_path.exists() {
        let bytes = fs::read(&state_path)
            .map_err(|error| format!("cannot read download state: {error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("download state is invalid JSON: {error}"))?
    } else {
        Vec::new()
    };
    records.push(record);
    let bytes = serde_json::to_vec_pretty(&records)
        .map_err(|error| format!("cannot serialize download state: {error}"))?;
    let temporary = directory.join(format!("downloads-{}.tmp", std::process::id()));
    fs::write(&temporary, bytes)
        .map_err(|error| format!("cannot write download state: {error}"))?;
    fs::rename(&temporary, &state_path)
        .map_err(|error| format!("cannot commit download state: {error}"))?;
    let _ = FileExt::unlock(&lock);
    Ok(())
}

fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut prefix = [0u8; 4];
    let mut read = 0;
    while read < prefix.len() {
        match reader.read(&mut prefix[read..])? {
            0 if read == 0 => return Ok(None),
            0 => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "truncated frame length",
                ))
            }
            n => read += n,
        }
    }

    let length = u32::from_le_bytes(prefix) as usize;
    if length == 0 || length > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }

    let mut payload = vec![0; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame<W: Write>(writer: &mut W, message: &Value) -> io::Result<()> {
    let payload = serde_json::to_vec(message)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if payload.len() > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "response too large",
        ));
    }
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()
}

fn safe_filename(input: Option<&str>) -> String {
    let source = input
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("download");
    let mut result: String = source
        .chars()
        .take(180)
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
    result = result.trim_matches([' ', '.']).to_string();
    if result.is_empty() || result == "." || result == ".." {
        result = "download".to_string();
    }

    let basename = result.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(basename.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (basename.len() == 4
            && (basename.starts_with("COM") || basename.starts_with("LPT"))
            && basename.as_bytes()[3].is_ascii_digit()
            && basename.as_bytes()[3] != b'0')
    {
        result.insert_str(0, "download-");
    }
    result
}

fn downloads_directory() -> Result<PathBuf, String> {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .ok_or_else(|| "cannot determine the user's home directory".to_string())?;
    let directory = PathBuf::from(home).join("Downloads");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("cannot create download directory: {error}"))?;
    Ok(directory)
}

fn available_destination(directory: &Path, filename: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(filename);
    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = candidate.extension().and_then(|value| value.to_str());
    for suffix in 0..10_000 {
        let name = if suffix == 0 {
            filename.to_string()
        } else if let Some(extension) = extension {
            format!("{stem} ({suffix}).{extension}")
        } else {
            format!("{stem} ({suffix})")
        };
        let destination = directory.join(name);
        let filename = destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("download");
        let part_file = directory.join(format!("{filename}.part"));
        let checkpoint_file = directory.join(format!("{filename}.checkpoint.json"));
        if !destination.exists() && !part_file.exists() && !checkpoint_file.exists() {
            return Ok(destination);
        }
    }
    Err("could not select an unused destination filename".to_string())
}

fn engine_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("DM_ENGINE_PATH") {
        return Ok(PathBuf::from(path));
    }
    let executable =
        env::current_exe().map_err(|error| format!("cannot locate native host: {error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "native host has no parent directory".to_string())?;
    let engine_name = if cfg!(windows) { "dm.exe" } else { "dm" };
    Ok(directory.join(engine_name))
}

fn handle_request(message: &Value) -> Value {
    match message.get("type").and_then(Value::as_str) {
        Some("ping") => json!({ "type": "pong", "hostVersion": HOST_VERSION }),
        Some("download_request") => match start_download(message) {
            Ok((url, filename)) => json!({
                "type": "download_ack",
                "url": url,
                "filename": filename,
                "queued": true
            }),
            Err(error) => json!({ "type": "download_error", "error": error }),
        },
        _ => json!({ "type": "download_error", "error": "unsupported message type" }),
    }
}

fn start_download(message: &Value) -> Result<(String, String), String> {
    let url = message
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "download request is missing a URL".to_string())?;
    if url.len() > MAX_URL_BYTES {
        return Err("URL exceeds the maximum allowed length".to_string());
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| "download URL is invalid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("only credential-free http(s) URLs are supported".to_string());
    }

    let filename = safe_filename(message.get("filename").and_then(Value::as_str));
    let directory = downloads_directory()?;
    let destination = available_destination(&directory, &filename)?;
    let engine = engine_path()?;
    if !engine.is_file() {
        return Err("download engine is missing next to the native host".to_string());
    }

    let mut child = Command::new(engine)
        .arg(url)
        .arg(&destination)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not start the download engine: {error}"))?;

    let added_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let category = if matches!(
        extension.as_str(),
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "m3u8" | "mpd"
    ) {
        "video"
    } else if extension.is_empty() {
        "other"
    } else {
        "file"
    };
    let record = NativeDownloadRecord {
        id: format!("native-{}-{added_at}", std::process::id()),
        name: filename.clone(),
        url: url.to_string(),
        size_bytes: None,
        downloaded_bytes: Some(0),
        speed_bytes_per_sec: None,
        status: "active".to_string(),
        category: category.to_string(),
        added_at,
        progress_percent: None,
        destination: destination.to_string_lossy().into_owned(),
        error: None,
    };
    if let Err(error) = persist_download_record(record) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    Ok((url.to_string(), filename))
}

fn run() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    while let Some(payload) = read_frame(&mut input)? {
        let response = match serde_json::from_slice::<Value>(&payload) {
            Ok(message) if message.is_object() => handle_request(&message),
            _ => json!({ "type": "download_error", "error": "message must be a JSON object" }),
        };
        write_frame(&mut output, &response)?;
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        // Native Messaging reserves stdout for frames. stderr is captured by
        // browser diagnostics and is intentionally free of URLs or payloads.
        eprintln!("native host protocol error: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        handle_request, persist_record_in, read_frame, safe_filename, NativeDownloadRecord,
    };
    use serde_json::json;
    use std::io::Cursor;

    #[test]
    fn ping_returns_protocol_version() {
        let result = handle_request(&json!({ "type": "ping" }));
        assert_eq!(result["type"], "pong");
        assert!(result["hostVersion"].is_string());
    }

    #[test]
    fn download_rejects_non_http_and_credentials() {
        for url in ["file:///etc/passwd", "https://user:pass@example.test/file"] {
            let result = handle_request(&json!({ "type": "download_request", "url": url }));
            assert_eq!(result["type"], "download_error");
        }
    }

    #[test]
    fn filenames_cannot_escape_download_directory() {
        assert_eq!(safe_filename(Some("../../CON.txt")), "_.._CON.txt");
        assert_eq!(safe_filename(Some("CON.txt")), "download-CON.txt");
        assert_eq!(safe_filename(Some("..")), "download");
        assert_eq!(safe_filename(None), "download");
        assert!(!safe_filename(Some("C:\\Users\\user\\file.exe")).contains('\\'));
    }

    #[test]
    fn native_frame_uses_little_endian_length_prefix() {
        let payload = br#"{"type":"ping"}"#;
        let mut bytes = (payload.len() as u32).to_le_bytes().to_vec();
        bytes.extend_from_slice(payload);
        assert_eq!(
            read_frame(&mut Cursor::new(bytes)).unwrap(),
            Some(payload.to_vec())
        );
        assert_eq!(
            read_frame(&mut Cursor::new(Vec::<u8>::new())).unwrap(),
            None
        );
    }

    #[test]
    fn native_host_persists_the_shared_desktop_download_record() {
        let directory =
            std::env::temp_dir().join(format!("zex-native-host-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let record = NativeDownloadRecord {
            id: "native-test".to_string(),
            name: "fixture.bin".to_string(),
            url: "http://127.0.0.1/fixture.bin".to_string(),
            size_bytes: None,
            downloaded_bytes: Some(0),
            speed_bytes_per_sec: None,
            status: "active".to_string(),
            category: "file".to_string(),
            added_at: "123456789".to_string(),
            progress_percent: None,
            destination: directory.join("fixture.bin").to_string_lossy().into_owned(),
            error: None,
        };
        persist_record_in(&directory, record).unwrap();
        let state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(directory.join("downloads.json")).unwrap())
                .unwrap();
        assert_eq!(state[0]["id"], "native-test");
        assert_eq!(state[0]["status"], "active");
        assert_eq!(state[0]["downloadedBytes"], 0);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
