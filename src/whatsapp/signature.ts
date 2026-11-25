import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body
 * using constant-time comparison.
 */
export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const providedHex = signatureHeader.slice('sha256='.length);
  const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (providedBuf.length === 0 || providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Constant-time string comparison for webhook verify tokens.
 */
export function verifyTokenConstantTime(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  if (providedBuf.length === 0 || providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}
