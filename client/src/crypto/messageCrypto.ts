import type { Conversation } from '../api/conversations.api';

export const MESSAGE_ENCRYPTION_VERSION = 'mvp-v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptedMessagePayload {
  ciphertext: string;
  nonce: string;
  encryptionVersion: typeof MESSAGE_ENCRYPTION_VERSION;
}

export async function encryptMessage(
  plaintext: string,
  conversation: Conversation,
): Promise<EncryptedMessagePayload> {
  const key = await deriveConversationKey(conversation);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce),
    encryptionVersion: MESSAGE_ENCRYPTION_VERSION,
  };
}

export async function decryptMessage(
  ciphertext: string,
  nonce: string,
  conversation: Conversation,
): Promise<string> {
  const key = await deriveConversationKey(conversation);
  const nonceBytes = base64ToBytes(nonce);
  const ciphertextBytes = base64ToBytes(ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonceBytes) },
    key,
    toArrayBuffer(ciphertextBytes),
  );

  return decoder.decode(decrypted);
}

async function deriveConversationKey(conversation: Conversation): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(conversationKeyMaterial(conversation)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`langram:${MESSAGE_ENCRYPTION_VERSION}:${conversation.id}`),
      iterations: 120000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function conversationKeyMaterial(conversation: Conversation): string {
  const memberIds = conversation.members.map((member) => member.id).sort().join(':');

  // MVP message content encryption, not full E2EE.
  // This derives a per-conversation AES-GCM key from shared conversation metadata so the
  // server never receives plaintext, but it is not a Secret Chat design and has no forward secrecy.
  return `langram-mvp-message-key:${conversation.id}:${memberIds}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
