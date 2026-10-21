//! Checkpoint format (shared with the Python reference implementation).
//!
//! File: `<destination>.checkpoint.json` (or the path given with
//! `--checkpoint`). Written atomically: serialise to a temporary file in
//! the same directory, then rename over the checkpoint path, so a crash
//! can never leave a half-written checkpoint behind.
//!
//! ```json
//! {
//!   "version": 1,
//!   "url": "https://example.com/file.bin",
//!   "destination": "/tmp/file.bin",
//!   "part_path": "/tmp/file.bin.part",
//!   "total_size": 10485760,
//!   "etag": "\"abc123\"",
//!   "last_modified": "Wed, 01 Jan 2025 00:00:00 GMT",
//!   "accept_ranges": true,
//!   "connections": 4,
//!   "segments": [
//!     {"index": 0, "start": 0, "end": 2621439, "done": 2621440}
//!   ]
//! }
//! ```
//!
//! Segment `end` is **inclusive**. `done` counts bytes already written
//! for that segment, so the next byte to fetch is `start + done` and a
//! segment is complete when `done == end - start + 1`. A segment with
//! unknown total size is represented by `total_size: null` and a single
//! segment `{start: 0, end: null, done: N}` (see `Segment::end` as
//! `Option<u64>`); in that case `done` is simply the byte count so far
//! and resume uses `Range: bytes=<done>-` if the server accepts it.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub index: usize,
    pub start: u64,
    /// Inclusive end byte, or None when the total size is unknown.
    pub end: Option<u64>,
    /// Bytes already written for this segment.
    pub done: u64,
}

impl Segment {
    /// Total length of this segment, if known.
    pub fn len(&self) -> Option<u64> {
        self.end.map(|e| e - self.start + 1)
    }

    pub fn is_complete(&self) -> bool {
        match self.len() {
            Some(l) => self.done >= l,
            None => false, // unknown-length streams are complete only at EOF
        }
    }

    /// Next byte offset to request, or None when complete.
    pub fn next_offset(&self) -> Option<u64> {
        if self.is_complete() {
            None
        } else {
            Some(self.start + self.done)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub version: u32,
    pub url: String,
    pub destination: String,
    pub part_path: String,
    pub total_size: Option<u64>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub accept_ranges: bool,
    pub connections: usize,
    pub segments: Vec<Segment>,
}

impl Checkpoint {
    pub fn new(
        url: &str,
        destination: &Path,
        part_path: &Path,
        total_size: Option<u64>,
        etag: Option<String>,
        last_modified: Option<String>,
        accept_ranges: bool,
        connections: usize,
    ) -> Self {
        let segments = match total_size {
            Some(total) if total > 0 => split_segments(total, connections),
            _ => vec![Segment {
                index: 0,
                start: 0,
                end: None,
                done: 0,
            }],
        };
        Checkpoint {
            version: 1,
            url: url.to_string(),
            destination: destination.to_string_lossy().into_owned(),
            part_path: part_path.to_string_lossy().into_owned(),
            total_size,
            etag,
            last_modified,
            accept_ranges,
            connections,
            segments,
        }
    }

    pub fn total_done(&self) -> u64 {
        self.segments.iter().map(|s| s.done).sum()
    }

    pub fn is_complete(&self) -> bool {
        match self.total_size {
            Some(0) => true,
            Some(_) => self.segments.iter().all(|s| s.is_complete()),
            None => false,
        }
    }

    /// Save atomically (temp file + rename in the same directory).
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, json.as_bytes())?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn load(path: &Path) -> Result<Checkpoint, String> {
        let data = fs::read_to_string(path)
            .map_err(|e| format!("cannot read checkpoint {}: {}", path.display(), e))?;
        serde_json::from_str(&data)
            .map_err(|e| format!("checkpoint {} is not valid JSON: {}", path.display(), e))
    }
}

/// Split `total` bytes into `n` contiguous, non-overlapping segments.
/// The last segment absorbs the remainder. With n == 1 this is the
/// single-connection fallback shape.
pub fn split_segments(total: u64, n: usize) -> Vec<Segment> {
    let n = n.max(1);
    let base = total / n as u64;
    let rem = total % n as u64;
    let mut segments = Vec::with_capacity(n);
    let mut start = 0u64;
    for i in 0..n {
        // Distribute the remainder one byte at a time over the first
        // `rem` segments so segments differ by at most 1 byte.
        let mut len = base;
        if (i as u64) < rem {
            len += 1;
        }
        if len == 0 {
            // More connections than bytes: skip empty segments. A
            // zero-byte file is handled by the caller (no segments
            // needed, but keep at least one empty segment for clarity).
            continue;
        }
        let end = start + len - 1;
        segments.push(Segment {
            index: i,
            start,
            end: Some(end),
            done: 0,
        });
        start = end + 1;
    }
    if segments.is_empty() {
        segments.push(Segment {
            index: 0,
            start: 0,
            end: Some(0),
            done: 0,
        });
    }
    segments
}

/// Default checkpoint path for a destination: `<dest>.checkpoint.json`.
pub fn default_checkpoint_path(destination: &Path) -> PathBuf {
    let mut s = destination.as_os_str().to_owned();
    s.push(".checkpoint.json");
    PathBuf::from(s)
}

/// Default in-progress path for a destination: `<dest>.part`.
pub fn default_part_path(destination: &Path) -> PathBuf {
    let mut s = destination.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}
