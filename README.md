# TikTok Tracker

A tool that passively captures TikTok API responses while a human manually browses TikTok.
Raw responses are written to JSON files in `raw-json-archive` directory. Most important data is saved in a table to CSV (`csv` dir).

## Commands

- `npm run build`: Compile TypeScript into `dist/`.
- `node dist/index.js`: Run compiled code.
- `npm run lint`: Run ESLint for TypeScript source files.
- `npm run lint:fix`: Auto-fix supported lint issues.
- `npm run typecheck`: Run TypeScript checks without emitting files.
- `npm test`: Run Node test runner.

There are 2 modes in which you can use this script:
* launch mode (default)
* attach mode
Note that for the attach mode Chrome must already expose the debugging port: `--remote-debugging-port=9222`

```bash
# Launch launch
npm run build && node dist/index.js

# Attach mode
TRACKER_RUNTIME_MODE=attach-to-existing npm run build && node dist/index.js
```

## Development

To change the data to be written to csv, change `csv-schema.ts` and `csv-column-mapping.json`, as well as accompanying tests.

## Disclaimer

This is just a prototype app. More work and debugging is needed. Tested on Windows 11.
