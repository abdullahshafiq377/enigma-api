import { createPublicKey } from 'node:crypto';

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { env } from '@/config/env';
import { getS3 } from '@/modules/media/aws';
import { mediaService } from '@/modules/media/media.service';

/**
 * ACTIVE protection check for the video CDN. Unlike `check-aws` (connectivity),
 * this proves UNAUTHORIZED access is REFUSED end-to-end:
 *
 *   1. CloudFront, NO signature  → must be 403  (proves "Restrict viewer access")
 *   2. CloudFront, valid signature → must be 200 (proves signing actually works)
 *   3. Direct S3 object URL, no auth → must be 403 (proves Block Public Access + OAC)
 *
 * Uploads one tiny probe object to the output bucket and best-effort deletes it.
 * Run: `npm run check-protection`.
 */

const PASS = (m: string) => console.log(`  ✓ ${m}`);
const FAIL = (m: string) => console.log(`  ✗ ${m}`);

/**
 * When a valid signature is rejected, the cause is almost always one of:
 *   (a) CLOUDFRONT_KEY_PAIR_ID ≠ the Public key ID registered in CloudFront, or
 *   (b) the public key in CloudFront isn't the pair of CLOUDFRONT_PRIVATE_KEY.
 * Derive the public key from our configured private key so it can be compared,
 * byte-for-byte, against CloudFront → Key management → Public keys.
 */
function printSigningDiagnostic(): void {
  console.log('\n  --- signing diagnostic ---');
  console.log(
    `  CLOUDFRONT_KEY_PAIR_ID currently used: ${env.CLOUDFRONT_KEY_PAIR_ID ?? '(unset)'}`,
  );
  try {
    const pem = (env.CLOUDFRONT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
    const pub = createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString().trim();
    console.log(
      '  Public key derived from CLOUDFRONT_PRIVATE_KEY (must equal the one in CloudFront):\n',
    );
    console.log(pub.replace(/^/gm, '    '));
  } catch (err) {
    console.log(
      `  ! CLOUDFRONT_PRIVATE_KEY did not parse as a private key: ${(err as Error).message}`,
    );
    console.log('    → the key in .env is malformed (check PEM headers / newline escaping).');
  }
  console.log('  ---------------------------\n');
}

async function main(): Promise<void> {
  const bucket = env.AWS_S3_OUTPUT_BUCKET;
  const domain = env.CLOUDFRONT_DOMAIN;
  const region = env.AWS_REGION;

  if (!bucket || !region) {
    console.log('AWS_S3_OUTPUT_BUCKET / AWS_REGION not set — cannot probe. Aborting.');
    process.exit(1);
  }

  // Unique prefix per run so no previously-cached object interferes.
  const stamp = Date.now();
  const prefix = `healthcheck/protected-${stamp}`;
  const key = `${prefix}/probe.txt`;
  const body = `protected-${stamp}`;

  console.log(`\nOutput bucket: ${bucket}`);
  console.log(`CloudFront:    ${domain ?? '(unset)'}`);
  console.log(`Probe key:     ${key}\n`);

  await getS3().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }),
  );

  const results: boolean[] = [];

  // 3 — Direct S3 object URL must be denied (Block Public Access + OAC).
  const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  try {
    const res = await fetch(s3Url);
    if (res.status === 200) {
      FAIL(
        `S3 object is PUBLICLY readable (${res.status}) — turn ON Block Public Access + use OAC`,
      );
      results.push(false);
    } else {
      PASS(`Direct S3 URL denied (${res.status}) — bucket is private`);
      results.push(true);
    }
  } catch (err) {
    PASS(`Direct S3 URL not reachable (${(err as Error).message}) — treated as private`);
    results.push(true);
  }

  if (!domain) {
    console.log('\n  ! CLOUDFRONT_DOMAIN unset — skipping CloudFront signed/unsigned probes.');
  } else {
    const cdnUrl = `https://${domain}/${key}`;

    // 1 — Unsigned CloudFront request must be refused.
    try {
      const res = await fetch(cdnUrl);
      if (res.status === 200) {
        FAIL(
          `CloudFront serves WITHOUT a signature (${res.status}) — enable "Restrict viewer access" (trusted key group)`,
        );
        results.push(false);
      } else {
        PASS(`Unsigned CloudFront request refused (${res.status}) — viewer access is restricted`);
        results.push(true);
      }
    } catch (err) {
      FAIL(`Unsigned CloudFront probe error: ${(err as Error).message}`);
      results.push(false);
    }

    // 2 — Properly signed CloudFront request must succeed (proves signing is wired correctly).
    try {
      const cookies = mediaService.issueSignedCookies(prefix, Math.floor(stamp / 1000));
      const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      const res = await fetch(cdnUrl, { headers: { Cookie: cookieHeader } });
      const text = res.status === 200 ? await res.text() : '';
      if (res.status === 200 && text === body) {
        PASS('Signed CloudFront request succeeds — signing is correctly configured');
        results.push(true);
      } else {
        FAIL(
          `Signed CloudFront request failed (${res.status}) — signing key does not match the trusted key group`,
        );
        results.push(false);
        printSigningDiagnostic();
      }
    } catch (err) {
      FAIL(`Signed CloudFront probe error: ${(err as Error).message}`);
      results.push(false);
    }
  }

  // Best-effort cleanup (delete perms may not be granted under least privilege).
  try {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    console.log(
      `\n  ! Could not delete probe object ${key} (no s3:DeleteObject) — remove it manually.`,
    );
  }

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} protection checks passed.`);
  if (ok !== results.length) {
    console.log(
      'FAILED checks above mean media is reachable without authorization. Fix before go-live.\n',
    );
  } else {
    console.log('Media is protected: unauthorized access is refused, authorized access works.\n');
  }
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
