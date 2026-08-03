import { CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { CopyObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  GetTranscriptionJobCommand,
  type LanguageCode,
  StartTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { getSignedCookies, getSignedUrl as getCfSignedUrl } from '@aws-sdk/cloudfront-signer';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/config/env';
import { getMediaConvert, getS3, getTranscribe } from '@/modules/media/aws';
import { buildHlsJob } from '@/modules/media/mediaconvert-job';
import { ApiError } from '@/utils/ApiError';

const UPLOAD_URL_TTL_SEC = 900; // 15 min
const SIGNED_COOKIE_TTL_SEC = 6 * 60 * 60; // 6 hours (must exceed longest video)

export interface SignedCookies {
  'CloudFront-Policy': string;
  'CloudFront-Signature': string;
  'CloudFront-Key-Pair-Id': string;
}

export const mediaService = {
  /** Presigned S3 PUT URL so the admin browser uploads directly to the input bucket. */
  async createUploadUrl(key: string, contentType: string): Promise<{ url: string; key: string }> {
    if (!env.AWS_S3_INPUT_BUCKET) throw ApiError.internal('AWS_S3_INPUT_BUCKET not configured');
    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_INPUT_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(getS3(), command, { expiresIn: UPLOAD_URL_TTL_SEC });
    return { url, key };
  },

  /**
   * CloudFront signed URL for a single object (signature in the query string).
   * Unlike signed cookies, this works cross-domain (e.g. localhost → cloudfront.net)
   * because the browser doesn't need to send any cookie — ideal for a single MP4,
   * captions, or transcript file. Caller must verify the member's tier first.
   */
  signObjectUrl(key: string, nowEpochSec: number): string {
    if (!env.CLOUDFRONT_DOMAIN || !env.CLOUDFRONT_KEY_PAIR_ID || !env.CLOUDFRONT_PRIVATE_KEY) {
      throw ApiError.internal('CloudFront signing is not configured');
    }
    return getCfSignedUrl({
      url: `https://${env.CLOUDFRONT_DOMAIN}/${key}`,
      keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
      privateKey: env.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      dateLessThan: new Date((nowEpochSec + SIGNED_COOKIE_TTL_SEC) * 1000).toISOString(),
    });
  },

  /**
   * CloudFront signed cookies granting access to an entire HLS video folder
   * (one cookie set covers the manifest + all segments). Caller must verify the
   * member's tier BEFORE issuing these. NOTE: cookies only reach CloudFront when
   * the app and CDN share a parent domain — used for HLS segment fan-out in prod.
   */
  issueSignedCookies(pathPrefix: string, nowEpochSec: number): SignedCookies {
    if (!env.CLOUDFRONT_DOMAIN || !env.CLOUDFRONT_KEY_PAIR_ID || !env.CLOUDFRONT_PRIVATE_KEY) {
      throw ApiError.internal('CloudFront signing is not configured');
    }
    const resource = `https://${env.CLOUDFRONT_DOMAIN}/${pathPrefix}/*`;
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: resource,
          Condition: { DateLessThan: { 'AWS:EpochTime': nowEpochSec + SIGNED_COOKIE_TTL_SEC } },
        },
      ],
    });
    return getSignedCookies({
      keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
      privateKey: env.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      policy,
    }) as SignedCookies;
  },

  /** Submit a MediaConvert HLS ABR transcode job (input → output bucket). */
  async submitTranscode(inputKey: string, outputPrefix: string): Promise<string | undefined> {
    if (!env.AWS_S3_INPUT_BUCKET || !env.AWS_S3_OUTPUT_BUCKET || !env.MEDIACONVERT_ROLE_ARN) {
      throw ApiError.internal('MediaConvert is not configured');
    }
    const job = buildHlsJob(
      `s3://${env.AWS_S3_INPUT_BUCKET}/${inputKey}`,
      `s3://${env.AWS_S3_OUTPUT_BUCKET}/${outputPrefix}/`,
    );
    const res = await getMediaConvert().send(new CreateJobCommand(job));
    return res.Job?.Id;
  },

  /**
   * Server-side copy of an uploaded source from the input bucket into the output
   * (CDN) bucket — used for MP4-first playback before HLS transcoding exists.
   */
  async copyInputToOutput(inputKey: string, outputKey: string): Promise<void> {
    if (!env.AWS_S3_INPUT_BUCKET || !env.AWS_S3_OUTPUT_BUCKET) {
      throw ApiError.internal('S3 buckets not configured');
    }
    await getS3().send(
      new CopyObjectCommand({
        Bucket: env.AWS_S3_OUTPUT_BUCKET,
        Key: outputKey,
        CopySource: encodeURI(`${env.AWS_S3_INPUT_BUCKET}/${inputKey}`),
      }),
    );
  },

  /** Upload a generated object (e.g. a certificate PDF) to the output bucket. */
  async uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!env.AWS_S3_OUTPUT_BUCKET) throw ApiError.internal('AWS_S3_OUTPUT_BUCKET not configured');
    await getS3().send(
      new PutObjectCommand({
        Bucket: env.AWS_S3_OUTPUT_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  },

  /** Presigned GET URL for a stored object (e.g. certificate download). */
  getDownloadUrl(key: string): Promise<string> {
    if (!env.AWS_S3_OUTPUT_BUCKET) throw ApiError.internal('AWS_S3_OUTPUT_BUCKET not configured');
    return getSignedUrl(
      getS3(),
      new GetObjectCommand({ Bucket: env.AWS_S3_OUTPUT_BUCKET, Key: key }),
      { expiresIn: UPLOAD_URL_TTL_SEC },
    );
  },

  /** Start an Amazon Transcribe job; output JSON carries word-level timestamps. */
  async submitTranscription(inputKey: string, jobName: string, outputKey: string): Promise<void> {
    if (!env.AWS_S3_INPUT_BUCKET || !env.AWS_S3_OUTPUT_BUCKET) {
      throw ApiError.internal('Transcribe is not configured');
    }
    await getTranscribe().send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        Media: { MediaFileUri: `s3://${env.AWS_S3_INPUT_BUCKET}/${inputKey}` },
        OutputBucketName: env.AWS_S3_OUTPUT_BUCKET,
        OutputKey: outputKey,
        LanguageCode: env.TRANSCRIBE_LANGUAGE as LanguageCode,
      }),
    );
  },

  /** Poll a Transcribe job's status (QUEUED | IN_PROGRESS | COMPLETED | FAILED). */
  async getTranscriptionStatus(jobName: string): Promise<string> {
    const res = await getTranscribe().send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    );
    return res.TranscriptionJob?.TranscriptionJobStatus ?? 'UNKNOWN';
  },

  /** Fetch + parse a JSON object stored in the output bucket. */
  async getOutputJson(key: string): Promise<unknown> {
    if (!env.AWS_S3_OUTPUT_BUCKET) throw ApiError.internal('AWS_S3_OUTPUT_BUCKET not configured');
    const res = await getS3().send(
      new GetObjectCommand({ Bucket: env.AWS_S3_OUTPUT_BUCKET, Key: key }),
    );
    const text = (await res.Body?.transformToString()) ?? '{}';
    return JSON.parse(text);
  },
};
