//! `dm` — Phase 1 download engine CLI.
//!
//! Usage:
//! ```text
//! dm <URL> <DEST> [--connections N] [--throttle BYTES_PER_SEC]
//!    [--resume] [--restart] [--sha256 HEX] [--checkpoint PATH]
//!    [--max-retries N]
//! ```
//!
//! Behaviour summary (full design in SPEC.md):
//! * Probes the server with HEAD + a `Range: bytes=0-0` request to learn
//!   the size, ETag and whether Range is honoured.
//! * Splits a Range-capable file into N contiguous segments downloaded
//!   concurrently; otherwise falls back to a single connection.
//! * Downloads into `<DEST>.part`, streaming 64 KiB chunks (bounded
//!   memory: one chunk per connection in flight, never the whole file).
//! * Persists progress to `<DEST>.checkpoint.json` (atomic temp+rename)
//!   at most every 500 ms and always on pause/completion. Ctrl-C pauses:
//!   the checkpoint is flushed and the process exits 130, leaving the
//!   `.part` file in place; `--resume` continues from the checkpoint.
//! * On resume, a changed content-length or ETag aborts with an error
//!   instead of silently resuming a different file.
//! * Retries each segment with exponential backoff (0.5s, 1s, 2s, 4s,
//!   8s, …). A shared token bucket caps aggregate bandwidth.
//! * On success the SHA-256 of the `.part` file is computed and, if
//!   `--sha256` was given, compared before the atomic rename to DEST.
//!   A hash mismatch keeps the `.part` file and exits non-zero; the
//!   destination is never created from unverified bytes.
//!
//! Exit codes: 0 success, 1 error / hash mismatch, 2 usage error,
//! 130 paused via Ctrl-C (checkpoint saved, resumable).

mod checkpoint;
mod throttle;

use checkpoint::{default_checkpoint_path, default_part_path, Checkpoint, CheckpointOptions};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use throttle::Throttle;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

const CHUNK: usize = 64 * 1024;
const SAVE_INTERVAL: Duration = Duration::from_millis(500);

struct Args {
    url: String,
    dest: PathBuf,
    connections: usize,
    throttle: u64,
    resume: bool,
    restart: bool,
    sha256: Option<String>,
    checkpoint_path: Option<PathBuf>,
    max_retries: u32,
}

fn usage() -> String {
    "Usage: dm <URL> <DEST> [options]\n\
     \nOptions:\n\
     \x20 --connections N, -c N   Parallel connections (1-32, default 4)\n\
     \x20 --throttle RATE, -t     Aggregate cap in bytes/sec (suffixes k/m/g allowed, 0 = unlimited, default 0)\n\
     \x20 --resume, -r            Resume from an existing .part + checkpoint\n\
     \x20 --restart               Discard any .part/checkpoint and start fresh\n\
     \x20 --sha256 HEX            Expected SHA-256 (checked before rename)\n\
     \x20 --checkpoint PATH       Checkpoint path (default <DEST>.checkpoint.json)\n\
     \x20 --max-retries N         Retries per segment (default 5)\n\
     \x20 --help, -h              Show this help\n\
     \nPause: press Ctrl-C. Progress is saved to the checkpoint and the\n\
     download can be continued later with --resume."
        .to_string()
}

fn parse_rate(s: &str) -> Result<u64, String> {
    let (num, mult) = match s.chars().last() {
        Some(c) if c.is_ascii_alphabetic() => {
            let m = match c.to_ascii_lowercase() {
                'k' => 1024u64,
                'm' => 1024u64 * 1024,
                'g' => 1024u64 * 1024 * 1024,
                _ => return Err(format!("bad throttle suffix in '{}'", s)),
            };
            (&s[..s.len() - 1], m)
        }
        _ => (s, 1u64),
    };
    num.parse::<u64>()
        .map(|v| v.saturating_mul(mult))
        .map_err(|_| format!("bad throttle value '{}'", s))
}

fn parse_args(argv: &[String]) -> Result<Args, String> {
    let mut url: Option<String> = None;
    let mut dest: Option<PathBuf> = None;
    let mut connections = 4usize;
    let mut throttle = 0u64;
    let mut resume = false;
    let mut restart = false;
    let mut sha256 = None;
    let mut checkpoint_path = None;
    let mut max_retries = 5u32;
    let mut i = 0;
    while i < argv.len() {
        let a = &argv[i];
        let take = |i: &mut usize| -> Result<String, String> {
            *i += 1;
            argv.get(*i)
                .cloned()
                .ok_or_else(|| format!("option {} needs a value", a))
        };
        match a.as_str() {
            "--help" | "-h" => return Err("__help__".to_string()),
            "--resume" | "-r" => resume = true,
            "--restart" => restart = true,
            "--connections" | "-c" => {
                let v = take(&mut i)?;
                connections = v
                    .parse::<usize>()
                    .map_err(|_| format!("bad --connections '{}'", v))?
                    .clamp(1, 32);
            }
            "--throttle" | "-t" => throttle = parse_rate(&take(&mut i)?)?,
            "--sha256" => sha256 = Some(take(&mut i)?),
            "--checkpoint" => checkpoint_path = Some(PathBuf::from(take(&mut i)?)),
            "--max-retries" => {
                max_retries = take(&mut i)?
                    .parse::<u32>()
                    .map_err(|_| "bad --max-retries".to_string())?;
            }
            s if s.starts_with("--connections=") => {
                connections = s["--connections=".len()..]
                    .parse::<usize>()
                    .map_err(|_| "bad --connections".to_string())?
                    .clamp(1, 32);
            }
            s if s.starts_with("--throttle=") => {
                throttle = parse_rate(&s["--throttle=".len()..])?;
            }
            s if s.starts_with("--sha256=") => sha256 = Some(s["--sha256=".len()..].to_string()),
            s if s.starts_with("--checkpoint=") => {
                checkpoint_path = Some(PathBuf::from(&s["--checkpoint=".len()..]));
            }
            s if s.starts_with('-') => return Err(format!("unknown option '{}'", s)),
            s => {
                if url.is_none() {
                    url = Some(s.to_string());
                } else if dest.is_none() {
                    dest = Some(PathBuf::from(s));
                } else {
                    return Err(format!("unexpected argument '{}'", s));
                }
            }
        }
        i += 1;
    }
    Ok(Args {
        url: url.ok_or("missing URL")?,
        dest: dest.ok_or("missing destination")?,
        connections,
        throttle,
        resume,
        restart,
        sha256,
        checkpoint_path,
        max_retries,
    })
}

struct Probe {
    total_size: Option<u64>,
    etag: Option<String>,
    last_modified: Option<String>,
    accept_ranges: bool,
}

fn parse_content_range_total(v: &str) -> Option<u64> {
    // "bytes 0-0/12345" or "bytes */12345"
    v.split('/').nth(1)?.trim().parse::<u64>().ok()
}

/// HEAD + a `Range: bytes=0-0` probe. Never reads a response body:
/// the probe response is dropped without consuming it.
async fn probe(client: &reqwest::Client, url: &str) -> Result<Probe, String> {
    let mut total_size = None;
    let mut etag = None;
    let mut last_modified = None;

    // HEAD first (cheap metadata). Some servers reject HEAD; that is
    // not fatal — the Range probe below is authoritative for ranges.
    if let Ok(resp) = client.head(url).send().await {
        let h = resp.headers();
        total_size = h
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        etag = h
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_string());
        last_modified = h
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_string());
    }

    // Range probe: a 206 proves the server honours Range; a 200 proves
    // it does not (for this resource). Body is dropped unread.
    let accept_ranges = match client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                if let Some(cr) = resp
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                {
                    if let Some(t) = parse_content_range_total(cr) {
                        total_size = Some(t);
                    }
                }
                if etag.is_none() {
                    etag = resp
                        .headers()
                        .get(reqwest::header::ETAG)
                        .and_then(|v| v.to_str().ok())
                        .map(|v| v.to_string());
                }
                true
            } else if resp.status().is_success() {
                // Server ignored Range: single-connection fallback.
                if total_size.is_none() {
                    total_size = resp
                        .headers()
                        .get(reqwest::header::CONTENT_LENGTH)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok());
                }
                false
            } else {
                return Err(format!("probe failed: HTTP {} for {}", resp.status(), url));
            }
        }
        Err(e) => return Err(format!("probe failed: {}", e)),
    };
    Ok(Probe {
        total_size,
        etag,
        last_modified,
        accept_ranges,
    })
}

struct Shared {
    ckpt: Mutex<Checkpoint>,
    ckpt_path: PathBuf,
    last_save: Mutex<Instant>,
    throttle: Arc<Throttle>,
    paused: AtomicBool,
    aborted: AtomicBool,
}

impl Shared {
    async fn save(&self, force: bool) {
        let mut last = self.last_save.lock().await;
        if !force && last.elapsed() < SAVE_INTERVAL {
            return;
        }
        let ck = self.ckpt.lock().await.clone();
        if let Err(e) = ck.save(&self.ckpt_path) {
            eprintln!("warning: checkpoint save failed: {}", e);
        } else {
            *last = Instant::now();
        }
    }
}

/// Download one segment. Returns Ok(true) when complete, Ok(false)
/// when paused, Err(msg) on failure (after retries by the caller).
async fn download_segment_once(
    client: &reqwest::Client,
    shared: &Shared,
    part_path: &Path,
    seg_index: usize,
) -> Result<bool, String> {
    let (start, end, done) = {
        let ck = shared.ckpt.lock().await;
        let s = &ck.segments[seg_index];
        (s.start, s.end, s.done)
    };
    // Range header for this attempt.
    let mut req = client.get(shared.ckpt.lock().await.url.clone());
    let single_whole_file = {
        let ck = shared.ckpt.lock().await;
        ck.segments.len() == 1 && ck.total_size.is_none()
    };
    // A segment that IS the whole file can be served as a plain 200
    // full body (this is exactly the no-Range fallback: the server
    // ignored Range and sent everything from byte 0). Accepting a 200
    // is only safe in this case — for a partial segment it would mean
    // writing a full body at a non-zero offset, i.e. corruption.
    let is_full_file_segment = {
        let ck = shared.ckpt.lock().await;
        match (end, ck.total_size) {
            (Some(e), Some(t)) => start == 0 && e + 1 == t,
            _ => false,
        }
    };
    let is_ranged;
    if single_whole_file && done == 0 {
        is_ranged = false; // unknown length, first attempt: plain GET
    } else if single_whole_file {
        // Resuming an unknown-length stream: only possible with Range.
        req = req.header(reqwest::header::RANGE, format!("bytes={}-", done));
        is_ranged = true;
    } else {
        let end = end.expect("known-size segment must have an end");
        req = req.header(
            reqwest::header::RANGE,
            format!("bytes={}-{}", start + done, end),
        );
        is_ranged = true;
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if is_ranged {
        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            // Already complete (or file shrank — caller validates size).
            return Ok(true);
        }
        if status != reqwest::StatusCode::PARTIAL_CONTENT {
            // A 200 here for a partial segment means the server ignored
            // Range mid-download: accepting it would corrupt the file.
            if status == reqwest::StatusCode::OK && (single_whole_file || is_full_file_segment) {
                // Full-body fallback: only valid when nothing has been
                // written yet (a resumed partial + a 200 body would be
                // written at a non-zero offset — guarded at startup too).
                if done != 0 {
                    return Err(format!(
                        "segment {}: server ignored Range on resume",
                        seg_index
                    ));
                }
            } else {
                return Err(format!(
                    "segment {}: unexpected HTTP {} for Range request",
                    seg_index, status
                ));
            }
        }
    } else if !status.is_success() {
        return Err(format!("segment {}: HTTP {}", seg_index, status));
    }

    let mut file = File::options()
        .read(true)
        .write(true)
        .open(part_path)
        .await
        .map_err(|e| format!("cannot open {}: {}", part_path.display(), e))?;
    file.seek(SeekFrom::Start(start + done))
        .await
        .map_err(|e| e.to_string())?;

    let mut written_here: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(item) = stream.next().await {
        if shared.paused.load(Ordering::SeqCst) || shared.aborted.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let chunk = item.map_err(|e| format!("segment {}: read error: {}", seg_index, e))?;
        if chunk.is_empty() {
            continue;
        }
        shared.throttle.acquire(chunk.len()).await;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("segment {}: write error: {}", seg_index, e))?;
        written_here += chunk.len() as u64;
        {
            let mut ck = shared.ckpt.lock().await;
            ck.segments[seg_index].done += chunk.len() as u64;
        }
        shared.save(false).await;
    }
    file.flush().await.map_err(|e| e.to_string())?;

    // A ranged segment whose stream ended early is incomplete: the
    // caller retries from the new offset. Detect it here.
    if let Some(end) = end {
        let ck = shared.ckpt.lock().await;
        let s = &ck.segments[seg_index];
        if !s.is_complete() {
            let _ = end;
            return Err(format!(
                "segment {}: stream ended early ({} of {} bytes)",
                seg_index,
                s.done,
                s.len().unwrap_or(0)
            ));
        }
    }
    let _ = written_here;
    Ok(true)
}

async fn download_segment(
    client: reqwest::Client,
    shared: Arc<Shared>,
    part_path: PathBuf,
    seg_index: usize,
    max_retries: u32,
) -> Result<bool, String> {
    let mut attempt: u32 = 0;
    loop {
        if shared.paused.load(Ordering::SeqCst) {
            return Ok(false);
        }
        match download_segment_once(&client, &shared, &part_path, seg_index).await {
            Ok(done) => return Ok(done),
            Err(e) => {
                if attempt >= max_retries || shared.paused.load(Ordering::SeqCst) {
                    return Err(e);
                }
                let backoff = Duration::from_secs_f64((0.5 * 2f64.powi(attempt as i32)).min(8.0));
                eprintln!(
                    "{} — retry {}/{} in {:.1}s",
                    e,
                    attempt + 1,
                    max_retries,
                    backoff.as_secs_f64()
                );
                tokio::time::sleep(backoff).await;
                attempt += 1;
            }
        }
    }
}

async fn sha256_of(path: &Path) -> Result<String, String> {
    let mut f = File::open(path)
        .await
        .map_err(|e| format!("cannot open {} for hashing: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = f
            .read(&mut buf)
            .await
            .map_err(|e| format!("hash read error: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn run(args: Args) -> Result<i32, String> {
    let dest = args.dest.clone();
    let part_path = default_part_path(&dest);
    let ckpt_path = args
        .checkpoint_path
        .clone()
        .unwrap_or_else(|| default_checkpoint_path(&dest));

    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("cannot create {}: {}", parent.display(), e))?;
        }
    }

    if args.restart {
        let _ = tokio::fs::remove_file(&part_path).await;
        let _ = tokio::fs::remove_file(&ckpt_path).await;
        println!("restart: discarded existing .part/checkpoint");
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("download-manager/0.1 (Phase 1 engine)")
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("cannot build HTTP client: {}", e))?;

    let probe = probe(&client, &args.url).await?;
    eprintln!(
        "probe: size={:?} accept_ranges={} etag={:?}",
        probe.total_size, probe.accept_ranges, probe.etag
    );

    // --- Resolve checkpoint / fresh start -------------------------
    let mut ckpt: Checkpoint;
    if args.resume && ckpt_path.exists() && part_path.exists() {
        let old = Checkpoint::load(&ckpt_path)?;
        if old.url != args.url {
            return Err(format!(
                "checkpoint URL mismatch: checkpoint is for {}, requested {}. Use --restart to start fresh.",
                old.url, args.url
            ));
        }
        if old.part_path != part_path.to_string_lossy() {
            return Err(
                "checkpoint belongs to a different destination. Use --restart to start fresh."
                    .to_string(),
            );
        }
        if let (Some(a), Some(b)) = (old.total_size, probe.total_size) {
            if a != b {
                return Err(format!(
                    "file changed on server: checkpoint size {} != current size {}. Refusing to resume a different file; use --restart.",
                    a, b
                ));
            }
        }
        if let (Some(a), Some(b)) = (&old.etag, &probe.etag) {
            if a != b {
                return Err(format!(
                    "file changed on server: ETag changed ({} -> {}). Refusing to resume; use --restart.",
                    a, b
                ));
            }
        }
        // Without Range, a partially downloaded file cannot be resumed:
        // a 200 full body written at a non-zero offset would corrupt it.
        // (This covers both unknown-length streams and known-size files
        // from no-Range servers. A complete checkpoint is exempt — it
        // needs no further bytes, only verification and rename.)
        if !probe.accept_ranges && old.total_done() > 0 && !old.is_complete() {
            return Err(
                "cannot resume: server does not support Range and the download is incomplete. Use --restart to download from scratch."
                    .to_string(),
            );
        }
        eprintln!(
            "resuming: {}/{} bytes already downloaded",
            old.total_done(),
            old.total_size
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".to_string())
        );
        ckpt = old;
        // Adopt the fresh probe's metadata (ETag may legitimately be
        // absent on one probe and present on the next).
        ckpt.etag = probe.etag.clone().or(ckpt.etag.clone());
        ckpt.total_size = probe.total_size.or(ckpt.total_size);
    } else {
        if args.resume {
            eprintln!("resume requested but no usable checkpoint/.part found; starting fresh");
        } else if part_path.exists() || ckpt_path.exists() {
            eprintln!("starting fresh (existing .part/checkpoint will be overwritten)");
            let _ = tokio::fs::remove_file(&part_path).await;
            let _ = tokio::fs::remove_file(&ckpt_path).await;
        }
        let mut connections = args.connections;
        if !probe.accept_ranges {
            if connections != 1 {
                eprintln!("server does not support Range: falling back to 1 connection");
            }
            connections = 1;
        }
        if probe.total_size.is_none() {
            connections = 1;
        }
        ckpt = Checkpoint::new(CheckpointOptions {
            url: &args.url,
            destination: &dest,
            part_path: &part_path,
            total_size: probe.total_size,
            etag: probe.etag.clone(),
            last_modified: probe.last_modified.clone(),
            accept_ranges: probe.accept_ranges,
            connections,
        });
        // Pre-create the .part file (sparse) at the final size so
        // segment workers can seek freely.
        let f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .map_err(|e| format!("cannot create {}: {}", part_path.display(), e))?;
        if let Some(total) = probe.total_size {
            f.set_len(total)
                .map_err(|e| format!("cannot size .part file: {}", e))?;
        }
        drop(f);
    }

    // Zero-byte file: nothing to download.
    if ckpt.total_size == Some(0) {
        tokio::fs::rename(&part_path, &dest)
            .await
            .map_err(|e| format!("rename failed: {}", e))?;
        let _ = tokio::fs::remove_file(&ckpt_path).await;
        println!("done: {} (0 bytes, empty file)", dest.display());
        return Ok(0);
    }

    if ckpt.is_complete() {
        eprintln!("checkpoint already complete; verifying and finalising");
    }

    let paused = Arc::new(AtomicBool::new(false));
    {
        let p = paused.clone();
        let _ = ctrlc::set_handler(move || {
            p.store(true, Ordering::SeqCst);
            eprintln!(
                "\npause requested (Ctrl-C); finishing current chunks and saving checkpoint…"
            );
        });
    }

    let shared = Arc::new(Shared {
        ckpt: Mutex::new(ckpt),
        ckpt_path: ckpt_path.clone(),
        last_save: Mutex::new(Instant::now()),
        throttle: Throttle::new(args.throttle),
        paused: AtomicBool::new(false),
        aborted: AtomicBool::new(false),
    });
    // Wire the ctrlc flag into Shared: poll it via a tiny task.
    let shared_paused_flag = paused.clone();
    let shared_for_flag = shared.clone();
    tokio::spawn(async move {
        loop {
            if shared_paused_flag.load(Ordering::SeqCst) {
                shared_for_flag.paused.store(true, Ordering::SeqCst);
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    });

    // Initial checkpoint so an immediate Ctrl-C still has state.
    shared.save(true).await;

    let started = Instant::now();
    let total = shared.ckpt.lock().await.total_size;

    // Progress reporter (stderr, so stdout stays a clean summary).
    let progress_shared = shared.clone();
    let progress_done = Arc::new(AtomicBool::new(false));
    let progress_done2 = progress_done.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            if progress_done2.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            let (done, segs_done, segs_total) = {
                let ck = progress_shared.ckpt.lock().await;
                (
                    ck.total_done(),
                    ck.segments.iter().filter(|s| s.is_complete()).count(),
                    ck.segments.len(),
                )
            };
            let elapsed = started.elapsed().as_secs_f64().max(0.001);
            let speed = done as f64 / elapsed;
            match total {
                Some(t) if t > 0 => {
                    let pct = done as f64 / t as f64 * 100.0;
                    let eta = if speed > 0.0 {
                        (t - done) as f64 / speed
                    } else {
                        0.0
                    };
                    eprintln!(
                        "progress: {} / {} bytes ({:.1}%, {}/{} segments, {:.1} KiB/s, ETA {:.0}s)",
                        done,
                        t,
                        pct,
                        segs_done,
                        segs_total,
                        speed / 1024.0,
                        eta
                    );
                }
                _ => {
                    eprintln!(
                        "progress: {} bytes ({:.1} KiB/s, unknown total)",
                        done,
                        speed / 1024.0
                    );
                }
            }
        }
    });

    // Spawn one task per incomplete segment.
    let seg_count = shared.ckpt.lock().await.segments.len();
    let mut handles = Vec::new();
    for i in 0..seg_count {
        let complete = shared.ckpt.lock().await.segments[i].is_complete();
        if complete {
            continue;
        }
        let c = client.clone();
        let s = shared.clone();
        let p = part_path.clone();
        handles.push(tokio::spawn(download_segment(c, s, p, i, args.max_retries)));
    }

    let mut first_error: Option<String> = None;
    let mut any_paused = false;
    for h in handles {
        match h.await {
            Ok(Ok(true)) => {}
            Ok(Ok(false)) => any_paused = true,
            Ok(Err(e)) => {
                shared.aborted.store(true, Ordering::SeqCst);
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
            Err(e) => {
                shared.aborted.store(true, Ordering::SeqCst);
                if first_error.is_none() {
                    first_error = Some(format!("segment task failed: {}", e));
                }
            }
        }
    }
    progress_done.store(true, Ordering::SeqCst);
    // Abort rather than await: the reporter sleeps 500 ms per cycle and
    // awaiting it would add up to 500 ms of fake latency (and fake
    // elapsed time) to every completed download.
    progress_task.abort();
    let _ = progress_task.await;

    if shared.paused.load(Ordering::SeqCst) || any_paused {
        shared.save(true).await;
        let done = shared.ckpt.lock().await.total_done();
        eprintln!(
            "PAUSED: {} bytes saved to {} (checkpoint {})",
            done,
            part_path.display(),
            ckpt_path.display()
        );
        eprintln!("resume with: dm {} {} --resume", args.url, dest.display());
        return Ok(130);
    }
    if let Some(e) = first_error {
        shared.save(true).await;
        return Err(format!("download failed: {} (checkpoint preserved)", e));
    }

    // Unknown-length stream: mark the single segment complete at EOF.
    {
        let mut ck = shared.ckpt.lock().await;
        if ck.total_size.is_none() && ck.segments.len() == 1 {
            let done = ck.segments[0].done;
            ck.total_size = Some(done);
            ck.segments[0].end = Some(done.saturating_sub(1));
        }
    }
    shared.save(true).await;

    let elapsed = started.elapsed();
    let final_size = shared.ckpt.lock().await.total_done();
    // Truncate the sparse .part to the real size (unknown-length case
    // and any server that delivered fewer bytes than advertised are
    // caught by the size check below, not silently padded).
    if let Some(total) = shared.ckpt.lock().await.total_size {
        if final_size != total {
            return Err(format!(
                "size mismatch after download: got {} bytes, expected {}",
                final_size, total
            ));
        }
        let f = std::fs::OpenOptions::new()
            .write(true)
            .open(&part_path)
            .map_err(|e| e.to_string())?;
        f.set_len(total).map_err(|e| e.to_string())?;
    }

    // SHA-256 is always computed and printed; --sha256 additionally
    // gates the rename.
    let actual = sha256_of(&part_path).await?;
    if let Some(expected) = &args.sha256 {
        if actual.to_lowercase() != expected.to_lowercase() {
            return Err(format!(
                "SHA-256 MISMATCH: expected {}, got {}. Destination NOT created; .part kept at {}",
                expected,
                actual,
                part_path.display()
            ));
        }
    }

    tokio::fs::rename(&part_path, &dest)
        .await
        .map_err(|e| format!("atomic rename failed: {}", e))?;
    let _ = tokio::fs::remove_file(&ckpt_path).await;
    println!(
        "done: {} ({} bytes in {:.2}s, avg {:.1} KiB/s, sha256 {})",
        dest.display(),
        final_size,
        elapsed.as_secs_f64(),
        final_size as f64 / elapsed.as_secs_f64().max(0.001) / 1024.0,
        actual
    );
    Ok(0)
}

#[tokio::main]
async fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = match parse_args(&argv) {
        Ok(a) => a,
        Err(e) if e == "__help__" => {
            println!("{}", usage());
            return ExitCode::SUCCESS;
        }
        Err(e) => {
            eprintln!("error: {}\n\n{}", e, usage());
            return ExitCode::from(2);
        }
    };
    match run(args).await {
        Ok(code) => ExitCode::from(code as u8),
        Err(e) => {
            eprintln!("error: {}", e);
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_rate;
    use crate::checkpoint::split_segments;

    #[test]
    fn segments_cover_exactly() {
        for (total, n) in [(10u64, 4usize), (100, 3), (1, 4), (1024, 8)] {
            let segs = split_segments(total, n);
            let mut covered = 0u64;
            let mut prev_end: Option<u64> = None;
            for s in &segs {
                assert_eq!(s.start, prev_end.map(|e| e + 1).unwrap_or(0));
                covered += s.len().unwrap();
                prev_end = s.end;
            }
            assert_eq!(covered, total);
        }
    }

    #[test]
    fn rate_suffixes() {
        assert_eq!(parse_rate("1024").unwrap(), 1024);
        assert_eq!(parse_rate("1k").unwrap(), 1024);
        assert_eq!(parse_rate("2m").unwrap(), 2 * 1024 * 1024);
        assert!(parse_rate("1x").is_err());
    }
}
