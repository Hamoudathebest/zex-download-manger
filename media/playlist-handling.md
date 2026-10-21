# Playlist / Collection Handling Notes — Phase 1

How a playlist or collection is enumerated and queued, within the
hard constraints of this project.

## 1. Scope: user-authorized, publicly accessible items only

- A "playlist" here means a list of items the **user explicitly
  supplies** (pasted URLs, an uploaded/exported list, or a manifest
  the user points the tool at) **and** that are publicly accessible
  without authentication.
- The tool does **not** enumerate private playlists, account libraries,
  watch history, subscriptions, or any authenticated collection, and it
  does not use the user's credentials, cookies, or session tokens to
  gain access to anything. If an item requires sign-in, it is skipped
  with a "requires sign-in — skipped" note, not worked around.
- Items that are DRM-protected are reported and skipped for download
  (see `SPEC.md` §2 rule 7), even if they appear in an otherwise
  public playlist.

## 2. Enumeration

1. **One item per entry, in source order.** The playlist order is
   preserved; no re-sorting, de-duplication by guesswork, or
   "smart" reordering. Exact duplicate URIs are collapsed (same URI
   string = same item) and the collapse is reported in the queue log.
2. **Each entry is parsed independently.** Every item's manifest is
   run through `parser.py` on its own, producing its own normalized
   variant list. A parse failure in one item never aborts the rest of
   the playlist; the failed item is marked `error` with the parser's
   message and the queue continues.
3. **No recursive crawling.** The tool does not follow "related",
   "up next", channel, or recommendation links from an item. A
   playlist is exactly the entries the user gave. If the user wants
   more items, they add them explicitly.
4. **Per-item selection, not one global choice.** Resolution/audio/
   subtitle selection (see `SPEC.md`) is made per item, or the user
   may apply one explicit choice ("720p + English audio for all") to
   every item — but that choice is still an explicit user action, and
   items that lack the chosen rendition fall back to being listed for
   individual selection, not silently downgraded. The queue log records
   which choice applied to which item.

## 3. Queuing

- **Queue states:** `pending → selected → downloading → done` plus
  terminal `skipped` (DRM / sign-in required / parse error) and
  `failed` (download/merge error). A skipped item is never retried
  automatically.
- **Confirmation before download starts.** The queue is shown in full
  (item, chosen variant, audio, subtitle, output name) and the user
  confirms before any download begins. "Add to queue" never means
  "start downloading".
- **Sequential by default.** Items download one at a time in queue
  order. Any parallel-download option is a later, explicit user
  setting with a documented limit, and is out of scope for Phase 1.
- **Output naming:** derived from the item's own title/label when the
  user supplies one, otherwise `item-001`, `item-002`, … in queue
  order. No title is scraped from a page the user did not supply.
- **Resume / retry:** a failed item can be retried manually by the
  user; retries re-parse the manifest (renditions may have changed)
  and re-ask for selection if the previously chosen rendition is gone.
- **Logging:** the queue log records, per item: source URI (as supplied),
  parsed variant count, user choice, skip reason if skipped, and final
  state. It never records credentials, cookies, or tokens — there are
  none in this flow.

## 4. Explicitly out of scope

- Downloading an entire channel, account, or site.
- Bypassing geo-blocks, paywalls, sign-in walls, or DRM.
- Using yt-dlp (or any backend) to expand a playlist beyond what the
  user supplied — see `yt-dlp-evaluation.md` for why yt-dlp is
  optional and opt-in only, and even then only for items the user
  explicitly lists.
