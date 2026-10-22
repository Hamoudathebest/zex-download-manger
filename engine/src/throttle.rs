//! Shared token-bucket bandwidth throttle.
//!
//! All segment workers draw from one bucket, so `--throttle N` caps the
//! *aggregate* download rate at N bytes/second, not N per connection
//! (a per-connection cap would silently multiply the limit by the
//! connection count). The bucket refills continuously from wall-clock
//! time and holds at most one second's worth of tokens, so bursts are
//! bounded. `rate == 0` means unlimited and `acquire` returns at once.
//!
//! Memory is bounded by design: workers stream 64 KiB chunks and only
//! ever hold one chunk each, regardless of file size.

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct Throttle {
    rate: u64, // bytes per second; 0 = unlimited
    bucket: Mutex<Bucket>,
}

impl Throttle {
    pub fn new(rate: u64) -> Arc<Self> {
        Arc::new(Throttle {
            rate,
            bucket: Mutex::new(Bucket {
                tokens: 0.0,
                last: Instant::now(),
            }),
        })
    }

    /// Wait until `n` bytes of budget are available, then consume them.
    pub async fn acquire(&self, n: usize) {
        if self.rate == 0 {
            return;
        }
        let mut need = n as f64;
        loop {
            let wait = {
                let mut b = self.bucket.lock().await;
                let now = Instant::now();
                let elapsed = now.duration_since(b.last).as_secs_f64();
                b.last = now;
                // Refill, capped at one second of burst.
                b.tokens = (b.tokens + elapsed * self.rate as f64).min(self.rate as f64);
                if b.tokens >= need {
                    b.tokens -= need;
                    return;
                }
                // Take what is available, wait for the rest.
                let shortfall = need - b.tokens;
                b.tokens = 0.0;
                need = shortfall;
                Duration::from_secs_f64(shortfall / self.rate as f64)
            };
            tokio::time::sleep(wait).await;
        }
    }
}
