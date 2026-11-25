import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTokenConstantTime, verifyWhatsAppSignature } from '../src/whatsapp/signature.js';

describe('verifyWhatsAppSignature', () => {
  const secret = 'super-secret-app-key';
  const payload = Buffer.from(JSON.stringify({ entry: [{ id: '123' }] }), 'utf-8');

  it('returns true for a valid sha256 signature', () => {
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyWhatsAppSignature(payload, `sha256=${hmac}`, secret)).toBe(true);
  });

  it('returns false when payload is tampered', () => {
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ entry: [{ id: '456' }] }), 'utf-8');
    expect(verifyWhatsAppSignature(tampered, `sha256=${hmac}`, secret)).toBe(false);
  });

  it('returns false when header is missing or malformed', () => {
    expect(verifyWhatsAppSignature(payload, undefined, secret)).toBe(false);
    expect(verifyWhatsAppSignature(payload, 'md5=abcdef', secret)).toBe(false);
    expect(verifyWhatsAppSignature(payload, 'sha256=not-hex', secret)).toBe(false);
  });
});

describe('verifyTokenConstantTime', () => {
  it('returns true for exact matching tokens', () => {
    expect(verifyTokenConstantTime('gracitas_verify_2026', 'gracitas_verify_2026')).toBe(true);
  });

  it('returns false for mismatched or empty tokens', () => {
    expect(verifyTokenConstantTime('wrong_token', 'gracitas_verify_2026')).toBe(false);
    expect(verifyTokenConstantTime('', 'gracitas_verify_2026')).toBe(false);
    expect(verifyTokenConstantTime('gracitas_verify_202', 'gracitas_verify_2026')).toBe(false);
  });
});
