import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractText, outputPath, writeOutputs } from './output.js';

const sampleDocument = {
  jobName: 'demo',
  results: {
    transcripts: [{ transcript: 'hello world' }],
    items: [{ start_time: '0.0' }],
  },
};

describe('extractText', () => {
  it('joins all transcript segments', () => {
    expect(
      extractText({
        results: { transcripts: [{ transcript: 'a' }, { transcript: 'b' }] },
      }),
    ).toBe('a\nb');
  });

  it('skips empty segments', () => {
    expect(
      extractText({
        results: { transcripts: [{ transcript: '' }, { transcript: 'only' }] },
      }),
    ).toBe('only');
  });
});

describe('outputPath', () => {
  it('replaces the extension with the format', () => {
    expect(outputPath('/x/talk.mp4', 'txt')).toBe('/x/talk.txt');
    expect(outputPath('/x/talk.mp4', 'json')).toBe('/x/talk.json');
  });

  it('preserves spaces and the directory', () => {
    expect(outputPath('/a b/My Recording.mp4', 'txt')).toBe(
      '/a b/My Recording.txt',
    );
  });
});

describe('writeOutputs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'transcribe-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the requested formats next to the input', async () => {
    const input = join(dir, 'clip.mp4');
    const written = await writeOutputs(input, ['txt', 'json'], sampleDocument);

    expect(written).toEqual([join(dir, 'clip.txt'), join(dir, 'clip.json')]);
    expect(await readFile(written[0], 'utf8')).toBe('hello world\n');
    // The JSON output preserves the full document, not just the parsed subset.
    expect(JSON.parse(await readFile(written[1], 'utf8'))).toEqual(
      sampleDocument,
    );
  });

  it('rejects a document missing the transcripts shape', async () => {
    const input = join(dir, 'clip.mp4');
    await expect(
      writeOutputs(input, ['txt'], { results: {} }),
    ).rejects.toThrow();
  });
});
