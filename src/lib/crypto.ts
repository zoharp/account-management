/**
 * AES-256-GCM secret encryption — a wire-compatible port of
 * `encrypt_key` / `decrypt_key` in the QMS backend's `backend/account_keys.py`.
 *
 * Format: base64( 12-byte random nonce || ciphertext || 16-byte GCM tag ).
 * No AAD. Python's `AESGCM.encrypt` appends the tag to the ciphertext, which is
 * why `decrypt` below splits the last 16 bytes off as the auth tag — Node's
 * `createDecipheriv` wants them supplied separately.
 *
 * Because the format matches, ciphertext written by the QMS backend decrypts
 * here and vice versa, PROVIDED both apps share the same ENCRYPTION_KEY.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { encryptionKey } from './env';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function keyBytes(): Buffer {
  const key = Buffer.from(encryptionKey(), 'base64');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return key;
}

/** Encrypt a secret for storage in a `*_encrypted` column. */
export function encryptSecret(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}

/** Decrypt a value written by this app or by the QMS backend. */
export function decryptSecret(encrypted: string): string {
  const data = Buffer.from(encrypted, 'base64');
  if (data.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('Ciphertext too short to be a valid AES-256-GCM payload');
  }
  const nonce = data.subarray(0, NONCE_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const ciphertext = data.subarray(NONCE_BYTES, data.length - TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Alphanumeric password for a freshly provisioned Postgres role. */
export function generateDbPassword(length = 32): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
