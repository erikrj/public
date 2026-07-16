import {
  GetTranscriptionJobCommand,
  type LanguageCode,
  StartTranscriptionJobCommand,
  type TranscribeClient,
  type TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe';
import type { MediaFormat } from './media.js';

export interface StartJobInput {
  jobName: string;
  mediaFileUri: string;
  mediaFormat?: MediaFormat;
  /** BCP-47 language code; when omitted, Transcribe auto-detects the language. */
  languageCode?: string;
  outputBucket: string;
  outputKeyPrefix: string;
}

/** Starts an AWS Transcribe batch job. */
export async function startJob(
  client: TranscribeClient,
  input: StartJobInput,
): Promise<void> {
  await client.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: input.jobName,
      Media: { MediaFileUri: input.mediaFileUri },
      ...(input.mediaFormat ? { MediaFormat: input.mediaFormat } : {}),
      ...(input.languageCode
        ? { LanguageCode: input.languageCode as LanguageCode }
        : { IdentifyLanguage: true }),
      OutputBucketName: input.outputBucket,
      OutputKey: input.outputKeyPrefix,
    }),
  );
}

export interface CompletedJob {
  transcriptFileUri: string;
  languageCode?: string;
}

export interface WaitOptions {
  pollIntervalMs: number;
  onPoll?: (status: TranscriptionJobStatus, elapsedSeconds: number) => void;
  /** Injectable delay, primarily for testing. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls a transcription job until it completes or fails. Resolves with the
 * transcript location on success; throws with the failure reason on failure.
 */
export async function waitForJob(
  client: TranscribeClient,
  jobName: string,
  options: WaitOptions,
): Promise<CompletedJob> {
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  for (;;) {
    const response = await client.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    );
    const job = response.TranscriptionJob;
    const status = job?.TranscriptionJobStatus;
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

    if (status) {
      options.onPoll?.(status, elapsedSeconds);
    }

    if (status === 'COMPLETED') {
      const uri = job?.Transcript?.TranscriptFileUri;
      if (!uri) {
        throw new Error(
          'transcription completed but returned no transcript URI',
        );
      }
      return { transcriptFileUri: uri, languageCode: job?.LanguageCode };
    }

    if (status === 'FAILED') {
      throw new Error(
        `transcription failed: ${job?.FailureReason ?? 'unknown reason'}`,
      );
    }

    await sleep(options.pollIntervalMs);
  }
}
