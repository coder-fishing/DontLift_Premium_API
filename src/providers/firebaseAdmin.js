import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export function createFirebase(config) {
  let account = null;
  const rawAccount = config.serviceAccountPath
    ? readFileSync(config.serviceAccountPath, 'utf8')
    : config.serviceAccount;
  try { account = rawAccount ? JSON.parse(rawAccount) : null; }
  catch { throw new Error('Invalid Firebase service account JSON file or FIREBASE_SERVICE_ACCOUNT_JSON'); }
  if (account && account.project_id !== config.projectId) throw new Error('Firebase credential project mismatch');
  const app = initializeApp({ projectId: config.projectId, credential: account ? cert(account) : applicationDefault() });
  return { db: getFirestore(app), verifyToken: token => getAuth(app).verifyIdToken(token, true) };
}
