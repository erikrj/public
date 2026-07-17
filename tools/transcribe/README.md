# transcribe

A CLI that transcribes an audio or video file with **AWS Transcribe** and writes
the transcript next to the input file, using the same base name
(e.g. `talk.mp4` → `talk.txt` and `talk.json`).

## How it works

AWS Transcribe reads its media from S3, so the tool:

1. Ensures a staging S3 bucket exists (a per-account
   `transcribe-cli-<account>-<region>` bucket, created on first use, unless you
   pass `--bucket`).
2. Uploads the input file (streamed / multipart for large files).
3. Starts a batch transcription job and polls until it finishes.
4. Downloads the transcript and writes the requested output formats next to the
   input file.
5. Deletes the staged S3 objects and the job (pass `--keep-remote` / `--keep-job`
   to retain them).

The media stays in your own account; nothing is written outside the staging
bucket and the output files.

## Usage

```sh
transcribe <file> [options]
```

| Option | Description |
|--------|-------------|
| `-r, --region <region>` | AWS region (default: `$AWS_REGION` or `us-west-2`). |
| `-b, --bucket <name>` | S3 bucket to stage media/output (default: a per-account bucket, created if absent). |
| `-p, --profile <name>` | AWS profile to use (sets `AWS_PROFILE`). |
| `-l, --language <code>` | BCP-47 language code, e.g. `en-US` (default: auto-detect). |
| `-f, --format <list>` | Comma-separated outputs: `txt`, `json` (default: `txt,json`). |
| `--poll-interval <secs>` | Seconds between status checks (default: `10`). |
| `--keep-remote` | Do not delete the staged S3 objects. |
| `--keep-job` | Do not delete the AWS Transcribe job. |
| `-h, --help` | Show help. |

### Supported input formats

`amr`, `flac`, `m4a`, `mp3`, `mp4` (`m4v`, `mov`), `ogg` (`oga`), `wav`, `webm`.
For a video file, Transcribe uses the audio track. An unrecognized extension is
still attempted — Transcribe auto-detects the format.

## Credentials

Standard AWS credential resolution applies. Provide a profile with `--profile`
or `AWS_PROFILE`, and a region with `--region` or `AWS_REGION`. The profile needs
permission for S3 (create/list/put/get/delete on the staging bucket) and AWS
Transcribe (`StartTranscriptionJob`, `GetTranscriptionJob`,
`DeleteTranscriptionJob`), plus `sts:GetCallerIdentity`.

## Examples

```sh
# Auto-detect language, write talk.txt and talk.json next to talk.mp4
AWS_PROFILE=my-profile transcribe ./talk.mp4 --region us-west-2

# English, JSON only, keep the staged S3 objects for inspection
transcribe ./interview.m4a -l en-US -f json --keep-remote
```

## Build

```sh
pnpm --filter transcribe build
pnpm --filter transcribe test
```
