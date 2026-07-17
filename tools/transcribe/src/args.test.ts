import { describe, expect, it } from 'vitest';
import { type CliArgs, HelpRequested, parseCliArgs } from './args.js';

function parse(argv: string[]): CliArgs {
  return parseCliArgs(argv);
}

describe('parseCliArgs', () => {
  it('defaults region, formats, and flags', () => {
    const args = parse(['clip.mp4']);
    expect(args.input).toBe('clip.mp4');
    expect(args.formats).toEqual(['txt', 'json']);
    expect(args.pollIntervalSeconds).toBe(10);
    expect(args.keepRemote).toBe(false);
    expect(args.keepJob).toBe(false);
    expect(args.bucket).toBeUndefined();
    expect(args.language).toBeUndefined();
  });

  it('parses region, bucket, language, and a single format', () => {
    const args = parse([
      'clip.mp4',
      '-r',
      'us-east-2',
      '--bucket',
      'my-bucket',
      '--language',
      'en-US',
      '--format',
      'json',
    ]);
    expect(args.region).toBe('us-east-2');
    expect(args.bucket).toBe('my-bucket');
    expect(args.language).toBe('en-US');
    expect(args.formats).toEqual(['json']);
  });

  it('parses boolean keep flags', () => {
    const args = parse(['clip.mp4', '--keep-remote', '--keep-job']);
    expect(args.keepRemote).toBe(true);
    expect(args.keepJob).toBe(true);
  });

  it('requires an input file', () => {
    expect(() => parse([])).toThrow(/input file is required/);
  });

  it('rejects more than one positional', () => {
    expect(() => parse(['a.mp4', 'b.mp4'])).toThrow(/only one input file/);
  });

  it('rejects an unknown format', () => {
    expect(() => parse(['clip.mp4', '--format', 'srt'])).toThrow();
  });

  it('rejects a non-numeric poll interval', () => {
    expect(() => parse(['clip.mp4', '--poll-interval', 'soon'])).toThrow();
  });

  it('signals help', () => {
    expect(() => parse(['--help'])).toThrow(HelpRequested);
  });
});
