import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { GitRepository } from './types/git';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Mandatory Firestore boot connectivity test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
if (typeof window !== 'undefined') {
  testConnection();
}

/**
 * Sanitizes any identifier to strictly match `^[a-zA-Z0-9_-]+$` and <= 128 chars
 */
export function sanitizeFirestoreId(raw: string, fallback = 'id'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    if (result.user) {
      await syncUserProfile(result.user);
    }
    return result.user;
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this host';
      throw new Error(
        `Domain "${host}" is not authorized for Google sign-in in Firebase Console (Authentication -> Settings -> Authorized domains). Add "${host}" there to enable Cloud Sync, or continue using GitReplay locally with IndexedDB.`
      );
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Sign-in popup was blocked by your browser. Allow popups for this site and try again.');
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in popup was closed before completing.');
    }
    throw err;
  }
}

export async function signOutUser() {
  await signOut(auth);
}

/**
 * Syncs non-PII profile to /users/{uid} and isolated PII (email) to /users/{uid}/private/account
 */
export async function syncUserProfile(user: User) {
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/account`;
  const safeDisplayName = (user.displayName || 'GitReplay Developer').slice(0, 120);
  const safePhotoUrl = user.photoURL ? user.photoURL.slice(0, 1024) : '';

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      const createPayload: Record<string, unknown> = {
        uid: user.uid,
        displayName: safeDisplayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (safePhotoUrl) {
        createPayload.photoURL = safePhotoUrl;
      }
      await setDoc(userRef, createPayload);
    } else {
      const updatePayload: Record<string, unknown> = {
        displayName: safeDisplayName,
        updatedAt: serverTimestamp(),
      };
      if (safePhotoUrl) {
        updatePayload.photoURL = safePhotoUrl;
      }
      await updateDoc(userRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (user.email) {
    try {
      const privateRef = doc(db, 'users', user.uid, 'private', 'account');
      const privSnap = await getDoc(privateRef);
      const safeEmail = user.email.slice(0, 320);
      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid: user.uid,
          email: safeEmail,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email: safeEmail,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }
}

/**
 * Persists a commit annotation in /users/{uid}/annotations/{annotationId}
 */
export async function saveCommitAnnotation(
  uid: string,
  repoId: string,
  commitSha: string,
  note: string
) {
  const safeRepoId = sanitizeFirestoreId(repoId, 'repo');
  const safeSha = sanitizeFirestoreId(commitSha.slice(0, 64), 'commit');
  const annotationId = sanitizeFirestoreId(`${safeRepoId}_${safeSha}`, 'note');
  const path = `users/${uid}/annotations/${annotationId}`;
  const clampedNote = note.slice(0, 4000);

  try {
    const ref = doc(db, 'users', uid, 'annotations', annotationId);
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        uid,
        repoId: safeRepoId,
        commitSha: safeSha,
        note: clampedNote,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        note: clampedNote,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeAnnotations(
  uid: string,
  onData: (map: Record<string, string>) => void,
  onError?: (err: Error) => void
) {
  const path = `users/${uid}/annotations`;
  const q = query(collection(db, 'users', uid, 'annotations'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const next: Record<string, string> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.commitSha && typeof data.note === 'string') {
          next[data.commitSha] = data.note;
        }
      });
      onData(next);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

/**
 * Persists an imported repository in /users/{uid}/savedRepos/{repoId}
 */
export async function saveUserRepository(uid: string, repo: GitRepository) {
  const safeRepoId = sanitizeFirestoreId(repo.id, `repo_${Date.now()}`);
  const path = `users/${uid}/savedRepos/${safeRepoId}`;

  const stripUndefined = <T>(val: T): T => JSON.parse(JSON.stringify(val));
  const isLargeRepo = repo.commits.length > 15;
  const boundedCommits = stripUndefined(
    repo.commits.slice(0, 200).map(({ diffLoading: _dl, diffError: _de, ...c }) => ({
      ...c,
      title: (c.title || 'Commit').slice(0, 240),
      message: (c.message || '').slice(0, isLargeRepo ? 500 : 2000),
      files: isLargeRepo
        ? []
        : (c.files || []).slice(0, 5).map((f) => ({
            ...f,
            content: (f.content || '').slice(0, 12000),
            previousContent: (f.previousContent || '').slice(0, 12000),
          })),
    }))
  );

  try {
    const ref = doc(db, 'users', uid, 'savedRepos', safeRepoId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        repoId: safeRepoId,
        owner: repo.owner.slice(0, 100) || 'github',
        name: repo.name.slice(0, 120) || 'repository',
        description: (repo.description || '').slice(0, 500),
        defaultBranch: (repo.defaultBranch || 'main').slice(0, 64),
        primaryLanguage: (repo.primaryLanguage || 'TypeScript').slice(0, 64),
        commits: boundedCommits,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        description: (repo.description || '').slice(0, 500),
        commits: boundedCommits,
        updatedAt: serverTimestamp(),
      });
    }
    return safeRepoId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteUserRepository(uid: string, repoId: string) {
  const safeRepoId = sanitizeFirestoreId(repoId, 'repo');
  const path = `users/${uid}/savedRepos/${safeRepoId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'savedRepos', safeRepoId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserRepositories(
  uid: string,
  onData: (repos: GitRepository[]) => void,
  onError?: (err: Error) => void
) {
  const path = `users/${uid}/savedRepos`;
  const q = query(collection(db, 'users', uid, 'savedRepos'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const repos: GitRepository[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const repoId = d.repoId || docSnap.id;
        const rawCommits = Array.isArray(d.commits) ? d.commits : [];
        repos.push({
          id: repoId,
          owner: d.owner,
          name: d.name,
          description: d.description || '',
          defaultBranch: d.defaultBranch || 'main',
          primaryLanguage: d.primaryLanguage || 'TypeScript',
          commits: rawCommits.map((c: any) => ({
            ...c,
            files: Array.isArray(c.files) ? c.files : [],
            diffLoaded:
              Array.isArray(c.files) && c.files.length > 0 ? c.diffLoaded !== false : false,
          })),
          githubMeta: repoId.startsWith('gh-')
            ? {
                owner: d.owner,
                repo: d.name,
                nextPage: Math.max(2, Math.ceil(rawCommits.length / 100) + 1),
                hasMore: rawCommits.length < 200,
              }
            : undefined,
        });
      });
      onData(repos);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export type ChatPersona = 'general' | 'architect' | 'mentor' | 'fast';

export interface PersistedChatMessage {
  id: string;
  repoId: string;
  role: 'user' | 'model';
  persona: ChatPersona;
  modelUsed: string;
  commitSha?: string;
  text: string;
  createdAtMs: number;
}

export async function saveChatMessage(
  uid: string,
  msg: Omit<PersistedChatMessage, 'createdAtMs'>
) {
  const safeMsgId = sanitizeFirestoreId(msg.id, `msg_${Date.now()}`);
  const safeRepoId = sanitizeFirestoreId(msg.repoId, 'repo');
  const path = `users/${uid}/chatMessages/${safeMsgId}`;

  const payload: Record<string, unknown> = {
    uid,
    repoId: safeRepoId,
    role: msg.role,
    persona: msg.persona,
    modelUsed: msg.modelUsed.slice(0, 64),
    text: msg.text.slice(0, 16000),
    createdAt: serverTimestamp(),
  };

  if (msg.commitSha) {
    payload.commitSha = msg.commitSha.slice(0, 64);
  }

  try {
    await setDoc(doc(db, 'users', uid, 'chatMessages', safeMsgId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeChatMessages(
  uid: string,
  repoId: string,
  commitSha: string,
  onData: (messages: PersistedChatMessage[]) => void,
  onError?: (err: Error) => void
) {
  const safeRepoId = sanitizeFirestoreId(repoId, 'repo');
  const safeSha = commitSha.slice(0, 64);
  const shortSha = commitSha.slice(0, 7);
  const path = `users/${uid}/chatMessages`;
  const q = query(
    collection(db, 'users', uid, 'chatMessages'),
    where('uid', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: PersistedChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.repoId !== safeRepoId) return;
        if (d.commitSha && d.commitSha !== safeSha && d.commitSha !== shortSha) return;
        if (!d.commitSha) return;
        const ts = d.createdAt as Timestamp | null;
        list.push({
          id: docSnap.id,
          repoId: d.repoId,
          role: d.role,
          persona: d.persona,
          modelUsed: d.modelUsed,
          commitSha: d.commitSha,
          text: d.text,
          createdAtMs: ts ? ts.toMillis() : Date.now(),
        });
      });
      list.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function clearChatHistoryForCommit(
  uid: string,
  repoId: string,
  commitSha: string
) {
  const safeRepoId = sanitizeFirestoreId(repoId, 'repo');
  const safeSha = commitSha.slice(0, 64);
  const shortSha = commitSha.slice(0, 7);
  const path = `users/${uid}/chatMessages`;
  try {
    const q = query(
      collection(db, 'users', uid, 'chatMessages'),
      where('uid', '==', uid)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(db);
    let deleteCount = 0;
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (
        d.repoId === safeRepoId &&
        (d.commitSha === safeSha || d.commitSha === shortSha)
      ) {
        batch.delete(docSnap.ref);
        deleteCount += 1;
      }
    });
    if (deleteCount > 0) {
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface CloudAICacheInput {
  cacheId: string;
  repoId: string;
  commitSha: string;
  mode: 'analysis' | 'ask';
  model: string;
  promptVersion: string;
  normalizedQuestion: string;
  responseText?: string;
  analysisData?: Record<string, unknown>;
}

export async function getCloudAICacheEntry(
  uid: string,
  cacheId: string
): Promise<CloudAICacheInput | null> {
  const safeCacheId = sanitizeFirestoreId(cacheId, 'cache');
  const path = `users/${uid}/aiCache/${safeCacheId}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'aiCache', safeCacheId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      cacheId: d.cacheId || safeCacheId,
      repoId: d.repoId,
      commitSha: d.commitSha,
      mode: d.mode,
      model: d.model,
      promptVersion: d.promptVersion,
      normalizedQuestion: d.normalizedQuestion || '',
      responseText: typeof d.responseText === 'string' ? d.responseText : undefined,
      analysisData:
        d.analysisData && typeof d.analysisData === 'object' ? d.analysisData : undefined,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveCloudAICacheEntry(uid: string, entry: CloudAICacheInput) {
  const safeCacheId = sanitizeFirestoreId(entry.cacheId, `cache_${Date.now()}`);
  const safeRepoId = sanitizeFirestoreId(entry.repoId, 'repo');
  const safeSha = sanitizeFirestoreId(entry.commitSha.slice(0, 64), 'commit');
  const path = `users/${uid}/aiCache/${safeCacheId}`;
  const stripUndefined = <T>(val: T): T => JSON.parse(JSON.stringify(val));

  const payloadBase: Record<string, unknown> = {
    uid,
    cacheId: safeCacheId,
    repoId: safeRepoId,
    commitSha: safeSha,
    mode: entry.mode,
    model: entry.model.slice(0, 64),
    promptVersion: entry.promptVersion.slice(0, 32),
    normalizedQuestion: (entry.normalizedQuestion || '').slice(0, 1000),
    updatedAt: serverTimestamp(),
  };

  if (typeof entry.responseText === 'string') {
    payloadBase.responseText = entry.responseText.slice(0, 32000);
  }
  if (entry.analysisData && typeof entry.analysisData === 'object') {
    payloadBase.analysisData = stripUndefined(entry.analysisData);
  }

  try {
    const ref = doc(db, 'users', uid, 'aiCache', safeCacheId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payloadBase,
        createdAt: serverTimestamp(),
      });
    } else {
      const updatePayload: Record<string, unknown> = {
        model: payloadBase.model,
        promptVersion: payloadBase.promptVersion,
        normalizedQuestion: payloadBase.normalizedQuestion,
        updatedAt: serverTimestamp(),
      };
      if (payloadBase.responseText !== undefined) {
        updatePayload.responseText = payloadBase.responseText;
      }
      if (payloadBase.analysisData !== undefined) {
        updatePayload.analysisData = payloadBase.analysisData;
      }
      await updateDoc(ref, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function clearCloudAICache(uid: string) {
  const path = `users/${uid}/aiCache`;
  try {
    const q = query(collection(db, 'users', uid, 'aiCache'), where('uid', '==', uid));
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

