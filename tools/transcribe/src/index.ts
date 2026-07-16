import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import {
  DeleteTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import type { CliArgs } from './args.js';
import { getAccountId } from './aws.js';
import { detectMediaFormat } from './media.js';
import { writeOutputs } from './output.js';
import {
  deletePrefix,
  ensureBucket,
  getObjectText,
  parseS3Uri,
  uploadFile,
} from './s3.js';
import { startJob, waitForJob } from './transcribe.js';

/** Sink for human-readable progress messages (defaults to stderr). */
export type Logger = (message: string) => void;

export interface TranscribeResult {
  /** Paths of the transcript files written next to the input. */
  outputs: string[];
  /** The language Transcribe used (detected or supplied). */
  languageCode?: string;
  /** The S3 bucket that staged the media and output. */
  bucket: string;
}

const defaultLog: Logger = (message) => process.stderr.write(`${message}\n`);

/**
 * Transcribes `args.input` with AWS Transcribe and writes the transcript
 * file(s) next to the input. Stages the media in S3 (creating a per-account
 * bucket if none is given), runs a batch job, downloads the result, and cleans
 * up the staged objects and job unless asked to keep them.
 */
export async function transcribeFile(
  args: CliArgs,
  log: Logger = defaultLog,
): Promise<TranscribeResult> {
  const inputPath = resolve(args.input);
  const info = await stat(inputPath).catch(() => undefined);
  if (!info?.isFile()) {
    throw new Error(`not a file: ${inputPath}`);
  }

  const region = args.region;
  const accountId = await getAccountId(region);
  const bucket = args.bucket ?? `transcribe-cli-${accountId}-${region}`;

  const s3 = new S3Client({ region });
  const transcribe = new TranscribeClient({ region });

  log(`Region: ${region}`);
  log(`Staging bucket: ${bucket}`);
  await ensureBucket(s3, bucket, region);

  const jobName = `transcribe-cli-${randomUUID()}`;
  const prefix = `transcribe-cli/${jobName}/`;
  const inputKey = `${prefix}input${extname(inputPath)}`;
  const outputKeyPrefix = `${prefix}output/`;

  log(`Uploading ${basename(inputPath)} ...`);
  await uploadFile(s3, inputPath, { bucket, key: inputKey });

  const mediaFormat = detectMediaFormat(inputPath);
  if (!mediaFormat) {
    log('Unknown media extension; letting Transcribe auto-detect the format.');
  }

  log(`Starting transcription job ${jobName} ...`);
  await startJob(transcribe, {
    jobName,
    mediaFileUri: `s3://${bucket}/${inputKey}`,
    mediaFormat,
    languageCode: args.language,
    outputBucket: bucket,
    outputKeyPrefix,
  });

  let lastStatus = '';
  const completed = await waitForJob(transcribe, jobName, {
    pollIntervalMs: args.pollIntervalSeconds * 1000,
    onPoll: (status, elapsed) => {
      if (status !== lastStatus) {
        lastStatus = status;
        log(`  ${status} (${elapsed}s elapsed)`);
      }
    },
  });

  log('Downloading transcript ...');
  const raw = await getObjectText(s3, parseS3Uri(completed.transcriptFileUri));
  const document = JSON.parse(raw) as unknown;
  const outputs = await writeOutputs(inputPath, args.formats, document);

  if (!args.keepRemote) {
    await deletePrefix(s3, bucket, prefix);
  }
  if (!args.keepJob) {
    await transcribe.send(
      new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    );
  }

  return { outputs, languageCode: completed.languageCode, bucket };
}
