import { MediaConvertClient } from '@aws-sdk/client-mediaconvert';
import { S3Client } from '@aws-sdk/client-s3';
import { TranscribeClient } from '@aws-sdk/client-transcribe';

import { env } from '@/config/env';
import { ApiError } from '@/utils/ApiError';

/**
 * Lazy AWS client singletons. Credentials resolve via the default provider
 * chain (env AWS_ACCESS_KEY_ID/SECRET locally, or IAM role on AWS). Clients are
 * only constructed on first use, so the app boots/tests without AWS config.
 */
let s3: S3Client | undefined;
let mediaConvert: MediaConvertClient | undefined;
let transcribe: TranscribeClient | undefined;

function requireRegion(): string {
  if (!env.AWS_REGION) throw ApiError.internal('AWS is not configured (AWS_REGION missing)');
  return env.AWS_REGION;
}

export function getS3(): S3Client {
  s3 ??= new S3Client({ region: requireRegion() });
  return s3;
}

export function getMediaConvert(): MediaConvertClient {
  // SDK v3 resolves the account's regional MediaConvert endpoint automatically.
  mediaConvert ??= new MediaConvertClient({ region: requireRegion() });
  return mediaConvert;
}

export function getTranscribe(): TranscribeClient {
  transcribe ??= new TranscribeClient({ region: requireRegion() });
  return transcribe;
}

/** True when the minimum AWS video config is present. */
export function isAwsConfigured(): boolean {
  return Boolean(env.AWS_REGION && env.AWS_S3_INPUT_BUCKET && env.AWS_S3_OUTPUT_BUCKET);
}
