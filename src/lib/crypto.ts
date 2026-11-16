// End-to-end encryption helpers (ECDH P-256 + AES-256-GCM) for WebSocket relay fallback.
// WebRTC DataChannels already enforce mandatory DTLS encryption natively.

export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', publicKey);
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

export async function deriveAesGcmKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptChunk(aesKey: CryptoKey, plainBytes: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainCopy = new Uint8Array(plainBytes);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plainCopy.buffer
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(12 + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, 12);
  return combined;
}

export async function decryptChunk(aesKey: CryptoKey, combined: Uint8Array): Promise<Uint8Array> {
  const iv = new Uint8Array(combined.subarray(0, 12));
  const cipherBytes = new Uint8Array(combined.subarray(12));
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    cipherBytes.buffer
  );
  return new Uint8Array(plainBuffer);
}
