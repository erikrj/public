import { extname } from 'node:path';

/** Media container formats AWS Transcribe accepts for a batch job. */
export type MediaFormat =
  | 'amr'
  | 'flac'
  | 'm4a'
  | 'mp3'
  | 'mp4'
  | 'ogg'
  | 'wav'
  | 'webm';

const EXTENSION_TO_FORMAT: Record<string, MediaFormat> = {
  '.amr': 'amr',
  '.flac': 'flac',
  '.m4a': 'm4a',
  '.mp3': 'mp3',
  '.mp4': 'mp4',
  '.m4v': 'mp4',
  '.mov': 'mp4',
  '.ogg': 'ogg',
  '.oga': 'ogg',
  '.wav': 'wav',
  '.webm': 'webm',
};

/**
 * Maps a file's extension to the AWS Transcribe media format. Returns
 * `undefined` for an unrecognized extension, in which case the caller should
 * let Transcribe auto-detect the format.
 */
export function detectMediaFormat(path: string): MediaFormat | undefined {
  return EXTENSION_TO_FORMAT[extname(path).toLowerCase()];
}
