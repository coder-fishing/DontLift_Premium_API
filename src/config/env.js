export function readConfig(env) {
  const required = ['PUBLIC_BASE_URL', 'FIREBASE_PROJECT_ID', 'PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'];
  for (const key of required) if (!env[key]?.trim()) throw new Error(`Missing backend setting: ${key}`);
  const url = new URL(env.PUBLIC_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL must be an HTTPS origin');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { publicBaseUrl: url.origin, port, projectId: env.FIREBASE_PROJECT_ID,
    webOrigin: env.WEB_ORIGIN || '', clientId: env.PAYOS_CLIENT_ID, apiKey: env.PAYOS_API_KEY,
    checksumKey: env.PAYOS_CHECKSUM_KEY, serviceAccount: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    serviceAccountPath: env.FIREBASE_SERVICE_ACCOUNT_PATH };
}
