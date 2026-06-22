const SECRET_KEYS = [
  "apiKey",
  "api_key",
  "apiKeyHash",
  "apiKeyId",
  "apiKeyPrefix",
  "apiKeySecret",
  "API_KEY_HASH_SECRET",
  "APP_SECRET",
  "auth",
  "authorization",
  "authTag",
  "cookie",
  "cookies",
  "ciphertext",
  "encryptedSession",
  "encryptedSessionBlob",
  "hash",
  "idToken",
  "INTERNAL_API_KEY",
  "iv",
  "keyHash",
  "localStorage",
  "passphrase",
  "password",
  "rawKey",
  "refresh_token",
  "refreshToken",
  "session",
  "SESSION_MASTER_KEY",
  "sessionStorage",
  "storageState",
  "accessToken",
  "token"
];

export function pinoRedactPaths() {
  return [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers.set-cookie",
    "req.headers.x-api-key",
    "req.headers['x-api-key']",
    "res.headers.set-cookie",
    "res.headers['set-cookie']",
    "req.body",
    ...SECRET_KEYS.flatMap((key) => [
      `req.body.${key}`,
      `res.body.${key}`,
      `*.${key}`,
      `**.${key}`
    ])
  ];
}
