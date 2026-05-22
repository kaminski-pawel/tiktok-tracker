# TikTok Tracker

Phase 1 scaffold is in place with strict TypeScript and quality gates.

## Available Scripts

- `npm run build`: Compile TypeScript into `dist/`.
- `npm run lint`: Run ESLint for TypeScript source files.
- `npm run lint:fix`: Auto-fix supported lint issues.
- `npm run typecheck`: Run TypeScript checks without emitting files.
- `npm test`: Run Node test runner.

## Quality Gate

The pre-commit hook at `.husky/pre-commit` runs:

- `npm run lint`
- `npm run typecheck`

## Runtime Modes

The tracker now supports two browser connection modes:

- `managed-launch` (default): the tracker launches Chrome with remote debugging enabled.
- `attach-to-existing` (advanced): the tracker connects to a Chrome instance you started manually.

Use environment variables to configure behavior:

- `TRACKER_RUNTIME_MODE`: `managed-launch` (default) or `attach-to-existing`.
- `TRACKER_DEBUG_HOST`: DevTools host (default `127.0.0.1`).
- `TRACKER_DEBUG_PORT`: DevTools port (default `9222`).
- `TRACKER_LAUNCH_TIMEOUT_MS`: startup/attach timeout in milliseconds (default `15000`).
- `TRACKER_LAUNCH_URL`: initial URL when using managed launch (default `https://www.tiktok.com/`).
- `TRACKER_RAW_JSON_ARCHIVE_ROOT_DIR`: root directory for archived matched API payloads (default `<project>/data/raw-json-archive`).
- `TRACKER_CSV_COLUMN_MAPPING_CONFIG_PATH`: JSON file path for configurable CSV field mappings (default `<project>/config/csv-column-mapping.json`).
- `TRACKER_CHROME_PATH`: optional explicit Chrome/Chromium executable path.
- `TRACKER_CHROME_USER_DATA_DIR`: optional user data directory for managed launch.
- `TRACKER_ENDPOINT_RECOMMEND_ITEM_LIST_ENABLED`: enable capture for `/api/recommend/item_list` (default `true`).
- `TRACKER_ENDPOINT_PREFETCH_EXPLORE_ITEM_LIST_ENABLED`: enable capture for `/api/prefetch/explore/item_list` (default `false`).
- `TRACKER_ENDPOINT_PRELOAD_ITEM_LIST_ENABLED`: enable capture for `/api/preload/item_list` (default `false`).

By default, only `/api/recommend/item_list` is captured.

## Raw JSON Archival

Each matched endpoint response is persisted as a standalone JSON file. Payloads are not embedded in CSV fields.

Output structure:

- `<archive-root>/<YYYY-MM-DD>/<endpoint-path>/<timestamp>_<requestId>.json`

Example:

- `data/raw-json-archive/2026-05-22/api/recommend/item_list/2026-05-22T10-16-34-921Z_7526.55.json`

WSL2 development note:

- This project targets Windows and macOS operators.
- When running from WSL2, managed launch can use Windows Chrome (for example `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`).
- If `TRACKER_CHROME_PATH` uses a Windows-style path (for example `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`), the runtime normalizes it for WSL.
- Managed launch in WSL uses a Windows-accessible profile directory and WSL-reachable DevTools host handling automatically.

Examples:

```bash
# Default managed launch
npm run build && node dist/index.js

# Advanced attach mode (Chrome must already expose --remote-debugging-port=9222)
TRACKER_RUNTIME_MODE=attach-to-existing npm run build && node dist/index.js

# Optional endpoint toggles
TRACKER_ENDPOINT_PREFETCH_EXPLORE_ITEM_LIST_ENABLED=true \
TRACKER_ENDPOINT_PRELOAD_ITEM_LIST_ENABLED=true \
npm run build && node dist/index.js
```
