#!/usr/bin/env node
import { HelpRequested, parseCliArgs } from './args.js';
import { transcribeFile } from './index.js';

async function main(): Promise<void> {
  let args: ReturnType<typeof parseCliArgs>;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(error.text);
      return;
    }
    throw error;
  }

  const result = await transcribeFile(args);

  const language = result.languageCode ? ` (${result.languageCode})` : '';
  process.stderr.write(`Done${language}. Wrote:\n`);
  for (const path of result.outputs) {
    process.stdout.write(`${path}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`transcribe: ${message}\n`);
  process.exitCode = 1;
});
