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
