import * as bcrypt from 'bcryptjs';

const AUTH_HASH_ROUNDS = 12;

export function hashAuthSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, AUTH_HASH_ROUNDS);
}

export function compareAuthSecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}
