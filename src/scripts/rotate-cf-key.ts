import { generateKeyPairSync } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Generate a fresh CloudFront signing key pair and safely write the PRIVATE key
 * into .env (backing up the old file first). Prints ONLY the PUBLIC key — that is
 * the part you upload to CloudFront. The private key is never printed.
 *
 * After running: create a CloudFront public key with the printed block, add it to
 * the key group on the distribution behavior, then set CLOUDFRONT_KEY_PAIR_ID in
 * .env to the new key's ID and restart. Run: `npm run rotate-cf-key`.
 */

const ENV_PATH = resolve(process.cwd(), '.env');

/** Remove an existing KEY=... entry, handling quoted (possibly multi-line) values. */
function stripEnvVar(text: string, key: string): string {
  const re = new RegExp(`^${key}=(?:"[\\s\\S]*?"|'[\\s\\S]*?'|[^\\n]*)\\r?\\n?`, 'm');
  return text.replace(re, '');
}

function main(): void {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Single-line .env-safe form; the app does .replace(/\\n/g,'\n') at read time.
  const oneLine = privateKey.trim().replace(/\n/g, '\\n');

  let env = '';
  try {
    env = readFileSync(ENV_PATH, 'utf8');
    copyFileSync(ENV_PATH, `${ENV_PATH}.bak`);
    console.log(`Backed up existing .env → .env.bak`);
  } catch {
    console.log('No existing .env found — creating a new one.');
  }

  env = stripEnvVar(env, 'CLOUDFRONT_PRIVATE_KEY').trimEnd();
  env += `\nCLOUDFRONT_PRIVATE_KEY="${oneLine}"\n`;
  writeFileSync(ENV_PATH, env, 'utf8');

  console.log('\n✓ Wrote new CLOUDFRONT_PRIVATE_KEY into .env (private key NOT shown).\n');
  console.log('Upload THIS public key in CloudFront → Key management → Create public key:\n');
  console.log(publicKey.trim());
  console.log('\nThen (see DOCS/AWS-SETUP.md for the full walkthrough):');
  console.log('  1. Create a CloudFront public key with the block above; add it to the key');
  console.log("     group that's set as the distribution's Trusted key group.");
  console.log('  2. Set CLOUDFRONT_KEY_PAIR_ID in .env to the NEW public key ID it gives you.');
  console.log('  3. Restart the backend, then run: npm run check-protection  (expect 3/3).\n');
}

main();
