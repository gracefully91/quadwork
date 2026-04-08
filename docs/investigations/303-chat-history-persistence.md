# AC Chat History Persistence — Investigation (#423 / quadwork#303)

**TL;DR:** AgentChattr **already persists chat history to
`{data_dir}/agentchattr_log.jsonl`** out of the box. No built-in
config option is needed — the store.py `MessageStore` reads the
file on startup and appends to it on every `store.add()` call. The
original ticket's premise ("chat history lost on restart") is
incorrect for the current AC code; the symptom the operator saw
must have been caused by something else (iframe session vs API
mode, stale `/api/messages` response, different AC instance).

## Evidence

### AC already writes messages to disk synchronously

`~/.quadwork/dropcast/agentchattr/app.py:247` instantiates the
store against `{data_dir}/agentchattr_log.jsonl`:

```python
log_path = Path(data_dir) / "agentchattr_log.jsonl"
legacy_log_path = Path(data_dir) / "room_log.jsonl"
if not log_path.exists() and legacy_log_path.exists():
    # Backward compatibility for existing installs.
    log_path = legacy_log_path
store = MessageStore(str(log_path))
```

`store.py:52-83` confirms every `add()` call appends the message
to disk (with `fsync` on non-bulk inserts) and the in-memory list
in a single locked transaction:

```python
self._next_id += 1
self._messages.append(msg)
if not _bulk:
    with open(self._path, "a", encoding="utf-8") as f:
        f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())
```

### AC re-loads the log on startup

`store.py:24` calls `self._load()` in `__init__`. `store.py:27-46`
reads the JSONL line-by-line, preserves the persisted `id`, and
resumes `_next_id` from `max_id + 1`. So a restart rehydrates the
full history, including stable IDs.

### Dropcast's live data directory already has 116 persisted messages

```
$ wc -l /Users/cho/.quadwork/dropcast/agentchattr/data/agentchattr_log.jsonl
     116 agentchattr_log.jsonl

$ head -1 agentchattr_log.jsonl
{"id": 0, "uid": "95e259bf-...", "sender": "user",
 "text": "@head are you online?", "type": "chat",
 "timestamp": 1775637890.35, "time": "09:44:50",
 "attachments": [], "channel": "general"}
```

### `history_limit` is "all" by default

`~/.quadwork/dropcast/agentchattr/data/settings.json`:

```json
{
  "title": "agentchattr",
  ...
  "history_limit": "all",
  ...
}
```

`app.py` (the `/ws` connect handler) reads `history_limit` to
decide how many messages to replay on connect — `"all"` replays
everything in the JSONL. No default cap.

## Files inspected

- `~/.quadwork/dropcast/agentchattr/store.py` — `MessageStore`
  class (load/add/flush/clear paths)
- `~/.quadwork/dropcast/agentchattr/app.py` — store instantiation
  + ws history replay
- `~/.quadwork/dropcast/agentchattr/data/agentchattr_log.jsonl` —
  live 116-message history
- `~/.quadwork/dropcast/agentchattr/data/settings.json` — confirms
  `history_limit = "all"`

## Conclusion

**Built-in persistence: YES.** No QuadWork code change is required
to preserve chat history across AC restarts — it's already being
preserved by AgentChattr itself at
`{data_dir}/agentchattr_log.jsonl`.

## Implications for the follow-up tickets

- **#304 auto-snapshot before restart** — arguably unnecessary
  given the above, but still useful as a point-in-time backup (the
  in-place JSONL is overwritten by `_rewrite_jsonl()` on delete/
  clear operations, and a pre-restart snapshot gives the operator
  a way to roll back a destructive `/clear`). Treat as "defense in
  depth" rather than "the only way to keep history."
- If the operator still observes chat "disappearing" after a
  restart in practice, the next investigation should focus on:
  1. Whether the dashboard is hitting a stale `/api/messages`
     response (cursor / caching issue).
  2. Whether the iframe mode is opening a fresh ws session that
     starts from the latest id rather than replaying history.
  3. Whether AC is starting from a different `data_dir` (e.g.,
     the wizard wrote `config.toml` with the wrong path, or a
     migration moved it).

None of those require a fork of AgentChattr.
