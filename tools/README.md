# tools

Local CLI tools for this monorepo. Each tool is its own pnpm workspace package
under `tools/<name>`, builds to `dist/`, and exposes a `bin` so it can be
installed and run locally.

## Conventions

Tools follow the repository's TypeScript conventions (see
[`.github/copilot-instructions.md`](../.github/copilot-instructions.md)):

- **ESM + NodeNext.** `"type": "module"`, `tsc` builds `src/**/*.ts` to `dist/`.
- **Biome** for formatting and linting (`prebuild` runs `biome check`).
- **valibot** for input validation.
- **vitest** for tests.
- Dependencies are referenced from the workspace `catalog:` in
  `pnpm-workspace.yaml`, never pinned per-package.

## Installing a tool locally

Build the tool, then link its `bin` onto your `PATH`:

```sh
pnpm --filter <name> build
pnpm --filter <name> exec npm link   # or: cd tools/<name> && pnpm link --global
```

## Tools

| Tool | What it does |
|------|--------------|
| [`transcribe`](./transcribe) | Transcribe an audio/video file with AWS Transcribe, writing the transcript next to the input file. |
