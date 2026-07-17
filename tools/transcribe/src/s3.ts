import { createReadStream } from 'node:fs';
import {
  type BucketLocationConstraint,
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export interface S3Location {
  bucket: string;
  key: string;
}

/**
 * Parses an S3 object reference into its bucket and key. Accepts both the
 * `s3://bucket/key` form and the HTTPS forms AWS Transcribe returns
 * (path-style `https://s3.<region>.amazonaws.com/bucket/key` and virtual-hosted
 * `https://bucket.s3.<region>.amazonaws.com/key`).
 */
export function parseS3Uri(uri: string): S3Location {
  if (uri.startsWith('s3://')) {
    const rest = uri.slice('s3://'.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      throw new Error(`S3 URI has no object key: ${uri}`);
    }
    return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }

  const url = new URL(uri);
  const host = url.hostname;
  const path = decodeURIComponent(url.pathname.replace(/^\//, ''));

  // Path-style: host is s3.<region>.amazonaws.com or s3-<region>.amazonaws.com,
  // and the first path segment is the bucket.
  if (host === 's3.amazonaws.com' || /^s3[.-]/.test(host)) {
    const slash = path.indexOf('/');
    if (slash === -1) {
      throw new Error(`S3 URL has no object key: ${uri}`);
    }
    return { bucket: path.slice(0, slash), key: path.slice(slash + 1) };
  }

  // Virtual-hosted: bucket is the label before ".s3".
  const marker = host.indexOf('.s3');
  if (marker > 0) {
    return { bucket: host.slice(0, marker), key: path };
  }

  throw new Error(`unrecognized S3 URL: ${uri}`);
}

/** Ensures a bucket exists in `region`, creating it if it does not. */
export async function ensureBucket(
  s3: S3Client,
  bucket: string,
  region: string,
): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  await s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      // us-east-1 is the API default and rejects an explicit LocationConstraint.
      ...(region === 'us-east-1'
        ? {}
        : {
            CreateBucketConfiguration: {
              LocationConstraint: region as BucketLocationConstraint,
            },
          }),
    }),
  );
}

/** Uploads a local file to S3, streaming it (multipart for large files). */
export async function uploadFile(
  s3: S3Client,
  file: string,
  location: S3Location,
): Promise<void> {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: location.bucket,
      Key: location.key,
      Body: createReadStream(file),
    },
  });
  await upload.done();
}

/** Reads an S3 object as a UTF-8 string. */
export async function getObjectText(
  s3: S3Client,
  location: S3Location,
): Promise<string> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: location.bucket, Key: location.key }),
  );
  if (!response.Body) {
    throw new Error(`empty S3 object: s3://${location.bucket}/${location.key}`);
  }
  return response.Body.transformToString('utf8');
}

/** Deletes every object under a key prefix. No-op if the prefix is empty. */
export async function deletePrefix(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects },
        }),
      );
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

function isNotFound(error: unknown): boolean {
  const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  const name = (error as { name?: string }).name;
  return (
    meta?.httpStatusCode === 404 ||
    name === 'NotFound' ||
    name === 'NoSuchBucket'
  );
}
