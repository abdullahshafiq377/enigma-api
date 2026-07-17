import type { CreateJobCommandInput } from '@aws-sdk/client-mediaconvert';

import { env } from '@/config/env';

/**
 * Builds a MediaConvert HLS adaptive-bitrate (CMAF) job using Automated ABR +
 * QVBR. Input/output are S3 URIs. The ladder is auto-generated per source.
 *
 * Note: MediaConvert job specs are detailed and account-specific; validate the
 * exact settings against the target account before production use.
 */
export function buildHlsJob(inputS3Uri: string, outputS3Uri: string): CreateJobCommandInput {
  return {
    Role: env.MEDIACONVERT_ROLE_ARN,
    ...(env.MEDIACONVERT_QUEUE_ARN ? { Queue: env.MEDIACONVERT_QUEUE_ARN } : {}),
    Settings: {
      Inputs: [
        {
          FileInput: inputS3Uri,
          AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
          VideoSelector: {},
          TimecodeSource: 'ZEROBASED',
        },
      ],
      OutputGroups: [
        {
          Name: 'HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              Destination: outputS3Uri,
              SegmentLength: 6,
              MinSegmentLength: 0,
              SegmentControl: 'SEGMENTED_FILES',
            },
          },
          // Automated ABR builds the rendition ladder; one output describes the codecs.
          AutomatedEncodingSettings: { AbrSettings: { MaxRenditions: 5 } },
          Outputs: [
            {
              ContainerSettings: { Container: 'M3U8' },
              VideoDescription: {
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: { RateControlMode: 'QVBR', QvbrSettings: { QvbrQualityLevel: 8 } },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      Bitrate: 96000,
                      CodingMode: 'CODING_MODE_2_0',
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
