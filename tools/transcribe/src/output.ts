import { writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import * as v from 'valibot';
import type { OutputFormat } from './args.js';

/**
 * The subset of the AWS Transcribe result document we rely on. The document
 * carries far more (per-item timings, alternatives, speaker labels); we validate
 * only the full-transcript text and leave the rest untouched for the JSON output.
 */
export const TranscriptDocumentSchema = v.object({
  results: v.object({
    transcripts: v.array(
      v.object({
        transcript: v.optional(v.string(), ''),
      }),
    ),
  }),
});
export type TranscriptDocument = v.InferOutput<typeof TranscriptDocumentSchema>;

/** Extracts the plain-text transcript from a Transcribe result document. */
export function extractText(document: TranscriptDocument): string {
  return document.results.transcripts
    .map((entry) => entry.transcript)
    .filter((text) => text.length > 0)
    .join('\n');
}

/**
 * Derives the output path for a given format: the input path with its extension
 * replaced (e.g. `/x/talk.mp4` + `txt` -> `/x/talk.txt`).
 */
export function outputPath(inputPath: string, format: OutputFormat): string {
  const dir = dirname(inputPath);
  const base = basename(inputPath, extname(inputPath));
  return join(dir, `${base}.${format}`);
}

/**
 * Writes the requested output formats next to the input file. Returns the paths
 * written, in the order the formats were requested.
 */
export async function writeOutputs(
  inputPath: string,
  formats: OutputFormat[],
  rawDocument: unknown,
): Promise<string[]> {
  const document = v.parse(TranscriptDocumentSchema, rawDocument);
  const written: string[] = [];

  for (const format of formats) {
    const path = outputPath(inputPath, format);
    if (format === 'txt') {
      await writeFile(path, `${extractText(document)}\n`, 'utf8');
    } else {
      await writeFile(
        path,
        `${JSON.stringify(rawDocument, null, 2)}\n`,
        'utf8',
      );
    }
    written.push(path);
  }

  return written;
}
