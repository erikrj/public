import { describe, expect, it } from 'vitest';
import { detectMediaFormat } from './media.js';

describe('detectMediaFormat', () => {
  it('maps known audio and video extensions', () => {
    expect(detectMediaFormat('talk.mp3')).toBe('mp3');
    expect(detectMediaFormat('talk.mp4')).toBe('mp4');
    expect(detectMediaFormat('talk.wav')).toBe('wav');
    expect(detectMediaFormat('talk.flac')).toBe('flac');
    expect(detectMediaFormat('talk.webm')).toBe('webm');
  });

  it('maps container aliases to their Transcribe format', () => {
    expect(detectMediaFormat('clip.mov')).toBe('mp4');
    expect(detectMediaFormat('clip.m4v')).toBe('mp4');
    expect(detectMediaFormat('voice.oga')).toBe('ogg');
  });

  it('is case-insensitive and path-aware', () => {
    expect(detectMediaFormat('/a/b/Recording.MP4')).toBe('mp4');
    expect(detectMediaFormat('./My Talk.WAV')).toBe('wav');
  });

  it('returns undefined for an unknown extension', () => {
    expect(detectMediaFormat('notes.txt')).toBeUndefined();
    expect(detectMediaFormat('archive')).toBeUndefined();
  });
});
