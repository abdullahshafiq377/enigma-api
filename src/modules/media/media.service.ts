import { CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
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

/** What the presign endpoints will sign. Each carries its own ceiling. */
export const UPLOAD_KINDS = ['video', 'thumbnail', 'pdf'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/**
 * The largest object this API will presign, per kind. Mirrored by `MAX_BYTES`,
 * `MAX_THUMB_BYTES` and `MAX_PDF_BYTES` in the admin Add-video drawer; change
 * both sides together.
 *
 * These were browser-side only until the request grew a `kind`. One endpoint
 * serves all three, so without it the server could only ever enforce the
 * loosest of them — a 200MB "thumbnail" was accepted because a 250MB video is.
 */
export const MAX_UPLOAD_BYTES: Record<UploadKind, number> = {
  video: 250 * 1024 * 1024, // 250MB
  thumbnail: 5 * 1024 * 1024, // 5MB
  pdf: 100 * 1024 * 1024, // 100MB
};

/**
 * Multipart part size. S3 requires every part except the last to be at least
 * 5MB, so this cannot go below that; 8MB keeps a 250MB source to 32 parts,
 * comfortably under S3's 10,000-part ceiling and small enough that one failed
 * part is a cheap retry rather than a restart.
 */
export const UPLOAD_PART_SIZE = 8 * 1024 * 1024; // 8MB

/**
 * Below this, a single PUT is fewer round-trips and there is nothing to gain.
 * It has to be at least one part: a two-part upload whose FIRST part is under
 * S3's 5MB floor is rejected at complete time, and only the last part is exempt.
 */
export const MULTIPART_THRESHOLD_BYTES = UPLOAD_PART_SIZE;

/**
 * Part URLs are signed once, up front, for the whole upload — so the window has
 * to cover the slowest plausible transfer rather than one request. 250MB on a
 * weak connection is tens of minutes; the 15 min a single PUT gets would expire
 * mid-upload and strand the parts already sent.
 */
const MULTIPART_TTL_SEC = 6 * 60 * 60; // 6 hours

/** Admin preview of an uploaded source — must outlast watching the video once. */
const SOURCE_URL_TTL_SEC = 60 * 60; // 1 hour

/**
 * Split a size into S3 parts: `count` parts of UPLOAD_PART_SIZE, the last one
 * short. Pure and exported so the arithmetic can be checked without an S3 call —
 * an off-by-one here corrupts the object rather than failing loudly, because
 * every part still uploads cleanly and only the reassembled file is wrong.
 *
 * The largest cap over UPLOAD_PART_SIZE is 32 parts, so S3's 10,000-part
 * ceiling is unreachable by construction; it only comes into play if a cap ever
 * grows past 78GB.
 */
export function planUploadParts(sizeBytes: number): { partNumber: number; size: number }[] {
  const count = Math.ceil(sizeBytes / UPLOAD_PART_SIZE);
  return Array.from({ length: count }, (_, i) => ({
    partNumber: i + 1,
    size: Math.min(UPLOAD_PART_SIZE, sizeBytes - i * UPLOAD_PART_SIZE),
  }));
}

/**
 * The cap, restated where the URL is actually signed.
 *
 * The request schema already rejects an oversized `sizeBytes`, so this is
 * belt-and-braces — but it belongs here rather than only there: these two
 * methods are what hand out a signed ContentLength, and a future caller that
 * skips the HTTP layer would otherwise skip the limit with it.
 */
function assertWithinLimit(sizeBytes: number, kind: UploadKind): void {
  const limit = MAX_UPLOAD_BYTES[kind];
  if (sizeBytes > limit) {
    throw ApiError.badRequest(`That ${kind} is over the ${limit / (1024 * 1024)}MB limit.`);
  }
}

export interface SignedCookies {
  'CloudFront-Policy': string;
  'CloudFront-Signature': string;
  'CloudFront-Key-Pair-Id': string;
}

export const mediaService = {
  /**
   * Presigned S3 PUT URL so the admin browser uploads directly to the input bucket.
   *
   * `sizeBytes` is signed into the URL as `ContentLength`, which is what makes
   * the size limit real rather than advisory: the presigner puts `content-length`
   * in `X-Amz-SignedHeaders`, so a PUT whose body is a different length fails
   * S3's signature check. Without it the browser could hand back any number of
   * bytes it liked once it held the URL — the caller's declared size would only
   * ever have gated whether we *issued* one.
   */
  async createUploadUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    kind: UploadKind,
  ): Promise<{ url: string; key: string }> {
    if (!env.AWS_S3_INPUT_BUCKET) throw ApiError.internal('AWS_S3_INPUT_BUCKET not configured');
    assertWithinLimit(sizeBytes, kind);
    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_INPUT_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(getS3(), command, { expiresIn: UPLOAD_URL_TTL_SEC });
    return { url, key };
  },

  /**
   * Open a multipart upload and presign EVERY part in one go.
   *
   * Signing the parts up front rather than exposing a "sign part N" endpoint is
   * what keeps the size cap airtight: the only part URLs that exist are the ones
   * computed here from a size already checked against the kind's cap, each
   * pinned to its own byte count. A per-part signing endpoint would have to
   * re-derive the part count from a number the client supplies again, and any
   * disagreement between the two calls is a hole.
   *
   * Each part carries its exact `ContentLength` for the same reason the single
   * PUT does — `content-length` lands in `X-Amz-SignedHeaders`, so a part of a
   * different size fails S3's signature check.
   */
  async createMultipartUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    kind: UploadKind,
  ): Promise<{
    key: string;
    uploadId: string;
    partSize: number;
    parts: { partNumber: number; size: number; url: string }[];
  }> {
    if (!env.AWS_S3_INPUT_BUCKET) throw ApiError.internal('AWS_S3_INPUT_BUCKET not configured');
    assertWithinLimit(sizeBytes, kind);

    const s3 = getS3();
    const created = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: env.AWS_S3_INPUT_BUCKET,
        Key: key,
        ContentType: contentType,
      }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw ApiError.internal('S3 did not return an UploadId');

    const parts = await Promise.all(
      planUploadParts(sizeBytes).map(async ({ partNumber, size }) => {
        const url = await getSignedUrl(
          s3,
          new UploadPartCommand({
            Bucket: env.AWS_S3_INPUT_BUCKET,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            ContentLength: size,
          }),
          { expiresIn: MULTIPART_TTL_SEC },
        );
        return { partNumber, size, url };
      }),
    );

    return { key, uploadId, partSize: UPLOAD_PART_SIZE, parts };
  },

  /**
   * Seal a multipart upload. S3 verifies each ETag against the part it stored,
   * so a client cannot claim parts it never sent; the parts list must be ordered
   * by part number or S3 rejects it (InvalidPartOrder).
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<{ key: string }> {
    if (!env.AWS_S3_INPUT_BUCKET) throw ApiError.internal('AWS_S3_INPUT_BUCKET not configured');
    await getS3().send(
      new CompleteMultipartUploadCommand({
        Bucket: env.AWS_S3_INPUT_BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
    return { key };
  },

  /**
   * Presigned GET for a source still sitting in the INPUT bucket, so the admin
   * can play back what they just uploaded before it has been transcoded.
   *
   * Distinct from `getDownloadUrl`, which reads the OUTPUT bucket, and from the
   * CloudFront signing members use: nothing about a raw source is public, there
   * is no CDN in front of the input bucket, and this is admin-only.
   *
   * Long enough to watch the video through — a 15-minute window would expire
   * mid-playback on a long source and leave the player stalled at a seek.
   */
  getSourceUrl(key: string): Promise<string> {
    if (!env.AWS_S3_INPUT_BUCKET) throw ApiError.internal('AWS_S3_INPUT_BUCKET not configured');
    return getSignedUrl(
      getS3(),
      new GetObjectCommand({ Bucket: env.AWS_S3_INPUT_BUCKET, Key: key }),
      {
        expiresIn: SOURCE_URL_TTL_SEC,
      },
    );
  },

  /**
   * Discard an abandoned upload. Parts that are neither completed nor aborted
   * stay in the bucket and stay billable while remaining invisible to a normal
   * object listing, so the browser calls this whenever an upload fails or is
   * cancelled. It is best-effort by nature — a browser that is closed mid-upload
   * never calls it, which is what the bucket's lifecycle rule is for.
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    if (!env.AWS_S3_INPUT_BUCKET) throw ApiError.internal('AWS_S3_INPUT_BUCKET not configured');
    await getS3().send(
      new AbortMultipartUploadCommand({
        Bucket: env.AWS_S3_INPUT_BUCKET,
        Key: key,
        UploadId: uploadId,
      }),
    );
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
