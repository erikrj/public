import { parseArgs } from 'node:util';
import * as v from 'valibot';

export const OutputFormatSchema = v.picklist(
  ['txt', 'json'],
  "--format entries must be 'txt' or 'json'",
);
export type OutputFormat = v.InferOutput<typeof OutputFormatSchema>;

const FormatListSchema = v.pipe(
  v.string(),
  v.transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  ),
  v.array(OutputFormatSchema),
  v.minLength(1, '--format must list at least one format'),
);

const PollIntervalSchema = v.pipe(
  v.string(),
  v.transform((value) => Number(value)),
  v.number('--poll-interval must be a number of seconds'),
  v.minValue(1, '--poll-interval must be at least 1 second'),
);

export interface CliArgs {
  /** Path to the audio/video file to transcribe. */
  input: string;
  /** Region to run AWS Transcribe in. */
  region: string;
  /** S3 bucket used to stage the media and receive the transcript. */
  bucket?: string;
  /** Explicit BCP-47 language code (e.g. `en-US`); omitted means auto-detect. */
  language?: string;
  /** Output files to write next to the input. */
  formats: OutputFormat[];
  /** Seconds between transcription-job status checks. */
  pollIntervalSeconds: number;
  /** Keep the objects staged in S3 instead of deleting them when done. */
  keepRemote: boolean;
  /** Keep the AWS Transcribe job instead of deleting it when done. */
  keepJob: boolean;
}

const HELP = `transcribe — transcribe an audio/video file with AWS Transcribe

Usage:
  transcribe <file> [options]

The transcript is written next to <file> using the same base name
(e.g. talk.mp4 -> talk.txt and/or talk.json).

Options:
  -r, --region <region>       AWS region (default: $AWS_REGION or us-west-2)
  -b, --bucket <name>         S3 bucket to stage media/output
                              (default: a per-account transcribe-cli bucket, created if absent)
  -p, --profile <name>        AWS profile to use (sets AWS_PROFILE)
  -l, --language <code>       BCP-47 language code, e.g. en-US (default: auto-detect)
  -f, --format <list>         Comma-separated: txt,json (default: txt,json)
      --poll-interval <secs>  Seconds between status checks (default: 10)
      --keep-remote           Do not delete the staged S3 objects when done
      --keep-job              Do not delete the AWS Transcribe job when done
  -h, --help                  Show this help
`;

export class HelpRequested extends Error {
  readonly text = HELP;
}

/** Parses argv into validated options, throwing on invalid input. */
export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      region: { type: 'string', short: 'r' },
      bucket: { type: 'string', short: 'b' },
      profile: { type: 'string', short: 'p' },
      language: { type: 'string', short: 'l' },
      format: { type: 'string', short: 'f', default: 'txt,json' },
      'poll-interval': { type: 'string', default: '10' },
      'keep-remote': { type: 'boolean', default: false },
      'keep-job': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    throw new HelpRequested();
  }

  const input = positionals[0];
  if (!input) {
    throw new Error('an input file is required (see --help)');
  }
  if (positionals.length > 1) {
    throw new Error('only one input file may be given');
  }

  // Setting AWS_PROFILE before any SDK client is constructed lets the default
  // credential provider chain pick it up.
  if (values.profile) {
    process.env.AWS_PROFILE = values.profile;
  }

  return {
    input,
    region: values.region ?? process.env.AWS_REGION ?? 'us-west-2',
    bucket: values.bucket,
    language: values.language,
    formats: v.parse(FormatListSchema, values.format),
    pollIntervalSeconds: v.parse(PollIntervalSchema, values['poll-interval']),
    keepRemote: values['keep-remote'],
    keepJob: values['keep-job'],
  };
}
