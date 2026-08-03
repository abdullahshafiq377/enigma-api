import { randomUUID } from 'node:crypto';

import { env } from '@/config/env';
import { mediaService } from '@/modules/media/media.service';

/**
 * Diagnose why "Generate transcript" 500s. Reproduces the exact StartTranscriptionJob
 * call against an already-uploaded input file and prints the real AWS error.
 *
 * Get the <inputKey> from the browser DevTools → Network → the failed POST
 * /admin/transcribe → Payload (looks like `inputs/<uuid>/<filename>`).
 *
 * Usage: npx tsx src/scripts/check-transcribe.ts inputs/<uuid>/<filename>
 */
const inputKey = process.argv[2];

async function run(): Promise<void> {
  if (!inputKey) {
    console.error('Usage: npx tsx src/scripts/check-transcribe.ts <inputKey>');
    process.exit(1);
  }
  console.log(`Region:        ${env.AWS_REGION}`);
  console.log(`Input bucket:  ${env.AWS_S3_INPUT_BUCKET}`);
  console.log(`Output bucket: ${env.AWS_S3_OUTPUT_BUCKET}`);
  console.log(`Language:      ${env.TRANSCRIBE_LANGUAGE}`);
  console.log(`MediaFileUri:  s3://${env.AWS_S3_INPUT_BUCKET}/${inputKey}\n`);

  const jobName = `diag-${randomUUID()}`;
  try {
    await mediaService.submitTranscription(inputKey, jobName, `transcripts/${jobName}.json`);
    console.log(`✓ StartTranscriptionJob ACCEPTED (job=${jobName}).`);
    console.log('  Transcribe can read the input + is allowed to write the output.');
    console.log('  So the 500 is elsewhere — re-check the app logs.');
  } catch (err) {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    console.error('✗ StartTranscriptionJob FAILED — this is the real cause of the 500:\n');
    console.error(`   name:    ${e.name}`);
    console.error(`   status:  ${e.$metadata?.httpStatusCode}`);
    console.error(`   message: ${e.message}`);
  }
  process.exit(0);
}

void run();
