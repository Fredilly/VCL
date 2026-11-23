/**
 * Archive a captured HAR into the private replay bucket, pinned by sha256.
 *
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET=scoop-private-replay \
 *   node tools/har-archive.mjs <file.har> [--content-ref n9u8ynhBdSo] [--date 2026-11-21]
 *
 * A HAR carries the partner's listings, titles and destinations: this repository is
 * public, so the file must never be committed. The bucket is the same private store
 * the replay workflow already uses. The object name and checksum are printed so the
 * workflow can pin them as secrets.
 *
 * Uses the S3-compatible R2 API via SigV4, with no SDK dependency.
 */
import { createHash, createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const file = args[0];
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
if (!file) {
  console.error('Usage: node tools/har-archive.mjs <file.har> [--content-ref ID] [--date YYYY-MM-DD] [--bucket NAME]');
  process.exit(2);
}

const account = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = option('bucket', process.env.R2_BUCKET || 'scoop-private-replay');
if (!account || !accessKeyId || !secretAccessKey) {
  console.error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required.');
  process.exit(2);
}

const body = await readFile(file);
const sha256 = createHash('sha256').update(body).digest('hex');
const date = option('date', new Date().toISOString().slice(0, 10));
const contentRef = option('content-ref', 'unknown');
const key = `private-replay/${date}-${contentRef}-${sha256.slice(0, 12)}.har`;
const size = (await stat(file)).size;

const host = `${account}.r2.cloudflarestorage.com`;
const endpoint = `https://${host}/${bucket}/${key}`;
const now = new Date();
const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
const shortDate = amzDate.slice(0, 8);
const payloadHash = sha256;

const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
const canonicalRequest = ['PUT', `/${bucket}/${key}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
const scope = `${shortDate}/auto/s3/aws4_request`;
const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
const hmac = (keyBytes, value) => createHmac('sha256', keyBytes).update(value).digest();
const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, shortDate), 'auto'), 's3'), 'aws4_request');
const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

const response = await fetch(endpoint, {
  method: 'PUT',
  headers: {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'content-type': 'application/json',
  },
  body,
});
if (!response.ok) {
  console.error(`upload failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  process.exit(1);
}
console.log(JSON.stringify({
  archived: basename(file), bytes: size, object_key: key, sha256,
  pin_as: { SCOOP_REPLAY_HAR_OBJECT_KEY: key, SCOOP_REPLAY_HAR_SHA256: sha256 },
}, null, 1));
