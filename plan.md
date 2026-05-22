## Plan: TikTok Recommend Item Capture for Operators

Build a Node.js + TypeScript tracker packaged for non-technical operators that passively captures TikTok network responses, saves the original response payloads as raw JSON files, and writes configurable flattened item fields to daily-rotated CSV files with session grouping and upsert behavior.

**Steps**
1. Phase 1 - Project scaffold and quality gates
2. Initialize a TypeScript Node.js project in /home/ubuntu/Playground/tiktok-tracker with strict tsconfig and dependencies for Chrome CDP, CSV writing, and timezone-safe date formatting.
3. Add developer quality commands and enforce them locally: lint, format-check, typecheck, tests. Add pre-commit hook so lint and typecheck run before every commit.
4. Add CI-ready script parity so the same lint/typecheck commands are runnable from terminal and automation.
5. Phase 2 - Browser connection and endpoint filtering (depends on Phase 1)
6. Implement two runtime modes: managed-launch (default for operators) and attach-to-existing Chrome (advanced).
7. Capture responses with primary focus on /api/recommend/item_list. Add optional endpoints as disabled-by-default config entries: /api/prefetch/explore/item_list and /api/preload/item_list.
8. Add robust ingestion pipeline for matched responses: validate content type, safe JSON parse, and error-resilient handling.
9. Phase 3 - Raw JSON archival and normalized extraction (depends on Phase 2)
10. Persist each matched original API response as raw JSON (not embedded in CSV) in a dedicated output folder structure organized by date and endpoint.
11. Define flattening pipeline from response itemList arrays into row candidates, including support for missing/variant fields.
12. Implement schema configurability using a dedicated column mapping config so CSV columns can be changed without code edits.
13. Seed default CSV schema with user-specified fields:
    - id, desc, isAd.
    - author.nickname, author.privateAccount, author.uniqueId.
    - authorStats.diggCount, authorStats.followerCount, authorStats.followingCount, authorStats.friendCount, authorStats.heart, authorStats.heartCount, authorStats.videoCount.
    - contents[].desc.
    - music.authorName.
    - stats.collectCount, stats.commentCount, stats.diggCount, stats.playCount, stats.shareCount.
14. Add metadata columns capture_run_id, source_endpoint, request_url, first_seen_at_utc_plus_1, last_seen_at_utc_plus_1.
15. Implement upsert-by-video-id behavior in CSV state: first seen creates row, repeated sightings update mutable stats and last_seen timestamp.
16. Phase 4 - CSV lifecycle and time standardization (depends on Phase 3)
17. Implement daily CSV rotation using tiktok_YYYY-MM-DD.csv naming.
18. Standardize exported timestamps in UTC+1 and document timezone behavior clearly in README, including DST handling strategy and caveats.
19. Ensure capture_run_id is generated once per process start and attached to every exported row for session grouping.
20. Phase 5 - Operator packaging and usability (depends on core tracker working)
21. Package distributables for Windows and macOS so operators do not install Node.js manually.
22. Add one-click launcher scripts and minimal editable config file (output path, mode, endpoint toggles, schema config path).
23. Add operator-focused documentation with startup checklist and troubleshooting for Chrome debug mode and output verification.

**Relevant files**
- /home/ubuntu/Playground/tiktok-tracker/package.json - runtime scripts, lint/typecheck/test hooks, pre-commit setup.
- /home/ubuntu/Playground/tiktok-tracker/tsconfig.json - strict typing rules.
- /home/ubuntu/Playground/tiktok-tracker/eslint.config.* - lint rules.
- /home/ubuntu/Playground/tiktok-tracker/.husky/pre-commit - pre-commit execution of lint and typecheck.
- /home/ubuntu/Playground/tiktok-tracker/src/config.ts - runtime config parsing and endpoint toggles.
- /home/ubuntu/Playground/tiktok-tracker/src/chrome/attach.ts - managed launch and attach logic.
- /home/ubuntu/Playground/tiktok-tracker/src/chrome/network-listener.ts - response matching and body retrieval.
- /home/ubuntu/Playground/tiktok-tracker/src/store/raw-json-archive.ts - storage of original response payloads.
- /home/ubuntu/Playground/tiktok-tracker/src/normalize/extractor.ts - flattening extraction from itemList.
- /home/ubuntu/Playground/tiktok-tracker/src/schema/csv-schema.ts - editable column definition and JSON-path mapping.
- /home/ubuntu/Playground/tiktok-tracker/src/store/upsert-index.ts - row identity and update logic by video id.
- /home/ubuntu/Playground/tiktok-tracker/src/store/csv-rotating-writer.ts - daily file rotation and flush behavior.
- /home/ubuntu/Playground/tiktok-tracker/src/cli.ts - orchestration and capture_run_id lifecycle.
- /home/ubuntu/Playground/tiktok-tracker/README.md - operator runbook and UTC+1 explanation.

**Verification**
1. Run lint and typecheck from terminal and confirm success.
2. Make a temporary intentional lint/type error and verify pre-commit hook blocks commit.
3. Start tracker in managed mode and manually browse TikTok feed; confirm /api/recommend/item_list captures appear.
4. Toggle optional endpoints on and off in config to confirm optional behavior.
5. Confirm raw JSON files are created for each matched response in archive folder.
6. Confirm flattened rows are written to CSV with configured columns.
7. Re-encounter an existing video id and verify upsert updates last_seen_at_utc_plus_1 and mutable counters.
8. Run capture across date boundary or mocked date to verify daily CSV rotation file naming.
9. Confirm capture_run_id is constant during one run and changes between runs.
10. Confirm README explains UTC+1 output behavior and operator interpretation.

**Decisions**
- Runtime: Node.js + TypeScript for CDP reliability and maintainability, distributed as packaged binaries for operators.
- Data outputs: raw original responses saved as JSON files; flattened analytics data saved to CSV.
- Endpoint priority: /api/recommend/item_list is required; additional endpoints are optional and disabled by default.
- Timestamp policy: export timestamps normalized to UTC+1 and explicitly documented.
- Data quality: include capture_run_id in every row.
- CSV operations: rotate files daily using date-based naming.
- Scope includes passive local capture while user manually browses.
- Scope excludes browser auto-interaction and anti-bot bypass techniques.