import { describe, expect, it } from 'vitest';
import { parseS3Uri } from './s3.js';

describe('parseS3Uri', () => {
  it('parses the s3:// form', () => {
    expect(parseS3Uri('s3://my-bucket/path/to/file.json')).toEqual({
      bucket: 'my-bucket',
      key: 'path/to/file.json',
    });
  });

  it('parses the path-style HTTPS form Transcribe returns', () => {
    expect(
      parseS3Uri('https://s3.us-west-2.amazonaws.com/my-bucket/out/job.json'),
    ).toEqual({ bucket: 'my-bucket', key: 'out/job.json' });
  });

  it('parses the virtual-hosted HTTPS form', () => {
    expect(
      parseS3Uri('https://my-bucket.s3.us-east-2.amazonaws.com/out/job.json'),
    ).toEqual({ bucket: 'my-bucket', key: 'out/job.json' });
  });

  it('decodes percent-encoded keys', () => {
    expect(
      parseS3Uri('https://s3.amazonaws.com/my-bucket/a%20b/c.json'),
    ).toEqual({ bucket: 'my-bucket', key: 'a b/c.json' });
  });

  it('throws on a URI without a key', () => {
    expect(() => parseS3Uri('s3://only-bucket')).toThrow();
  });
});
