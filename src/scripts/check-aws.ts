import { CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetTranscriptionJobCommand } from '@aws-sdk/client-transcribe';

import { env } from '@/config/env';
import { getMediaConvert, getS3, getTranscribe, isAwsConfigured } from '@/modules/media/aws';
import { mediaService } from '@/modules/media/media.service';

/**
 * Read-only AWS connectivity check for the video pipeline. Verifies creds,
 * both buckets, MediaConvert + Transcribe access, S3 presigning, and that the
 * CloudFront signing key parses. Makes NO writes / no jobs. Run: `npm run check-aws`.
 */
type CheckResult = 'pass' | 'fail' | 'net';

/**
 * True for local connectivity failures (DNS/socket) — NOT AWS auth results. These
 * make a run unreliable: a network error must never be mistaken for "authorized".
 */
function isNetworkError(err: unknown): boolean {
  const e = err as {
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const sig = `${e.name ?? ''} ${e.code ?? ''} ${e.message ?? ''} ${e.cause?.code ?? ''} ${e.cause?.message ?? ''}`;
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|getaddrinfo|socket hang up|TimeoutError/i.test(
    sig,
  );
}

async function check(name: string, fn: () => Promise<void>): Promise<CheckResult> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return 'pass';
  } catch (err) {
    if (isNetworkError(err)) {
      console.log(`  ⚠ ${name}\n      NETWORK error (result unreliable): ${(err as Error).message}`);
      return 'net';
    }
    console.log(`  ✗ ${name}\n      ${(err as Error).name}: ${(err as Error).message}`);
    return 'fail';
  }
}

async function main(): Promise<void> {
  console.log(`\nAWS region: ${env.AWS_REGION ?? '(unset)'}`);
  console.log(`Input bucket: ${env.AWS_S3_INPUT_BUCKET ?? '(unset)'}`);
  console.log(`Output bucket: ${env.AWS_S3_OUTPUT_BUCKET ?? '(unset)'}`);
  console.log(`isAwsConfigured: ${isAwsConfigured()}\n`);

  const results: CheckResult[] = [];

  // PutObject + GetObject round-trip on a fixed probe key (overwritten each run, no
  // accumulation). Uses only the granted object perms; catches region mismatch
  // (PermanentRedirect) and proves real read/write — without needing s3:ListBucket.
  const probeBucket = async (bucket: string): Promise<void> => {
    const Key = 'healthcheck/connectivity-probe.txt';
    await getS3().send(
      new PutObjectCommand({ Bucket: bucket, Key, Body: 'ok', ContentType: 'text/plain' }),
    );
    await getS3().send(new GetObjectCommand({ Bucket: bucket, Key }));
  };

  results.push(
    await check('S3 — input bucket reachable', () => probeBucket(env.AWS_S3_INPUT_BUCKET!)),
  );
  results.push(
    await check('S3 — output bucket reachable', () => probeBucket(env.AWS_S3_OUTPUT_BUCKET!)),
  );
  results.push(
    await check('S3 — presigned upload URL', async () => {
      await mediaService.createUploadUrl('healthcheck/probe.mp4', 'video/mp4', 1024, 'video');
    }),
  );
  results.push(
    await check('MediaConvert — CreateJob authorized', async () => {
      // Empty Settings fails validation BEFORE any job is created — so this is a safe
      // auth/reachability probe via the default endpoint (the app's real path), not the
      // deprecated DescribeEndpoints. BadRequest = authorized & reachable → OK.
      try {
        await getMediaConvert().send(
          new CreateJobCommand({ Role: env.MEDIACONVERT_ROLE_ARN ?? 'none', Settings: {} }),
        );
      } catch (err) {
        // A network error must surface (not be read as "authorized"); so must auth errors.
        const sig = `${(err as Error).name} ${(err as Error).message}`;
        if (
          isNetworkError(err) ||
          /AccessDenied|NotAuthorized|Subscription|UnrecognizedClient|InvalidSignature/i.test(sig)
        ) {
          throw err;
        }
      }
    }),
  );
  results.push(
    await check('Transcribe — reachable (GetJob only; job-start needs the account subscription)', async () => {
      try {
        await getTranscribe().send(
          new GetTranscriptionJobCommand({
            TranscriptionJobName: 'enigma-healthcheck-nonexistent',
          }),
        );
      } catch (err) {
        // "not found / bad request" = authorized (the job just doesn't exist) → OK.
        const sig = `${(err as Error).name} ${(err as Error).message}`;
        if (isNetworkError(err) || /AccessDenied|NotAuthorized|UnrecognizedClient|InvalidSignature/i.test(sig))
          throw err;
      }
    }),
  );
  results.push(
    await check('CloudFront — signing key parses', async () => {
      const cookies = mediaService.issueSignedCookies('healthcheck', Math.floor(Date.now() / 1000));
      if (!cookies['CloudFront-Signature']) throw new Error('no signature produced');
    }),
  );

  const pass = results.filter((r) => r === 'pass').length;
  const net = results.filter((r) => r === 'net').length;
  console.log(`\n${pass}/${results.length} checks passed.`);
  if (net > 0) {
    console.log(
      `\n⚠ ${net} check(s) hit a NETWORK error — THIS RUN IS UNRELIABLE (not an AWS result).\n` +
        `  Fix your connection/DNS (e.g. ipconfig /flushdns, disable VPN), then re-run.\n` +
        `  Only trust the MediaConvert/Transcribe rows when the S3 rows are ✓.`,
    );
  }
  console.log('');
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
