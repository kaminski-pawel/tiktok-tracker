---
name: tiktok-tracker
description: "Use when building or modifying the TikTok manual-browse capture tool: Chrome/CDP response capture, raw JSON archival, configurable CSV flattening, TypeScript quality gates, and operator packaging. Keywords: tiktok tracker, recommend item_list, raw json archive, csv schema config, lint typecheck pre-commit, UTC+1, daily CSV rotation."
---

# TikTok Tracker Agent Instructions

You are a focused implementation agent for this repository.

## Mission

Build and maintain a Node.js + TypeScript tool that passively captures TikTok API responses while a human manually browses TikTok, then writes:

1. Original matched responses as raw JSON files.
2. Flattened analytics rows to CSV.

## Core Scope

1. Required endpoint: `/api/recommend/item_list`.
2. Optional endpoints (disabled by default): `/api/prefetch/explore/item_list`, `/api/preload/item_list`.
3. No browser auto-interaction, no anti-bot bypass logic, no captcha/session bypass tactics.

## Non-Negotiable Data Rules

1. Never store raw response JSON inside CSV fields.
2. Always archive original matched responses as standalone JSON files.
3. CSV contains flattened columns only, plus operational metadata columns.
4. Upsert by video id in CSV state: first seen creates row, repeated sightings update mutable counters and `last_seen_at_utc_plus_1`.
5. Include `capture_run_id` in every CSV row.
6. Rotate CSV files daily using `tiktok_YYYY-MM-DD.csv`.

## Timestamp Policy

1. Export timestamps in UTC+1.
2. Document timezone behavior in README, including DST strategy and caveats.
3. Keep timestamp handling centralized in a dedicated utility module.

## CSV Schema Policy

1. CSV columns must be configurable via a mapping file, not hard-coded throughout the codebase.
2. Default seeded field mappings must include:
   - `itemList[].id`, `itemList[].desc`, `itemList[].isAd`.
   - `itemList[].author.nickname`, `itemList[].author.uniqueId`.
   - `itemList[].authorStats.diggCount`, `itemList[].authorStats.followerCount`, `itemList[].authorStats.followingCount`, `itemList[].authorStats.heartCount`, `itemList[].authorStats.videoCount`.
   - `itemList[].contents[].desc`.
   - `itemList[].music.authorName`.
   - `itemList[].stats.collectCount`, `itemList[].stats.commentCount`, `itemList[].stats.diggCount`, `itemList[].stats.playCount`, `itemList[].stats.shareCount`.
3. Metadata columns include: `capture_run_id`, `source_endpoint`, `request_url`, `fetched_at_utc+1`.

## Quality Gates (Always Enforced)

1. TypeScript strict mode enabled.
2. Lint and typecheck commands must be runnable from terminal scripts.
3. Pre-commit hook must run lint and typecheck before every commit.
4. Keep CI parity: local scripts are suitable for CI usage.
5. Add tests for extractor/mapping behavior when changing parsing or schema logic.

## Code Quality and Maintainability

1. Use JSDoc comments for all functions and complex logic.
2. Keep functions focused and modular for testability.
3. Write tests for crucial business logic.

## Preferred Workflow

1. Implement in small, reviewable changes.
2. Document crucial implementation details with JSDoc.
3. Run `lint`, `typecheck`, and relevant tests after edits.
4. Report what changed, why, and verification results.
5. If blocked by environment limitations, provide exact next command for operator.

## File Targets

1. `package.json` for scripts and tooling.
2. `tsconfig.json` for strict TypeScript settings.
3. `eslint.config.*` for linting.
4. `.husky/pre-commit` for commit gate.
5. `src/config.ts` for runtime settings and endpoint toggles.
6. `src/chrome/*` for CDP attach/listening.
7. `src/store/raw-json-archive.ts` for JSON archival.
8. `src/schema/csv-schema.ts` for configurable CSV mappings.
9. `src/store/upsert-index.ts` and `src/store/csv-rotating-writer.ts` for CSV state and rotation.
10. `README.md` for operator instructions and UTC+1 explanation.

## Operator Experience Priorities

1. Optimize for non-technical operators.
2. Managed-launch mode is default; attach mode is advanced fallback.
3. Keep config simple and editable.
4. Favor clear logs and troubleshooting messages.

## Completion Checklist

1. Lint passes.
2. Typecheck passes.
3. Pre-commit hook configured and executable.
4. Required endpoint capture path implemented.
5. Raw JSON archival path implemented.
6. Configurable CSV flattening implemented.
7. Daily rotation and `capture_run_id` implemented.
8. UTC+1 behavior documented.
