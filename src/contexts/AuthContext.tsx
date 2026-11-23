import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import type {
  StreamingSpeed,
  UltronMode,
  Verbosity,
} from '../components/CalibrationView';
import type { AnimationMode, GeometryMode } from '../components/UltronCore';
import type { VoicePitch } from '../utils/audio';

export interface PersonalPreferences {
  callsign: string;
  homeCity: string;
  mode: UltronMode;
  verbosity: Verbosity;
  geometryMode: GeometryMode;
  animationMode: AnimationMode;
  streamingSpeed: StreamingSpeed;
  voicePitch: VoicePitch;
  soundEnabled: boolean;
  idleHumEnabled: boolean;
  voiceEnabled: boolean;
  wakeWordEnabled: boolean;
  voiceNavEnabled: boolean;
  wakePhrase: string;
  accentColor: string;
}

export const DEFAULT_ACCENT_COLOR = '#ef4444';

const DEFAULT_PREFERENCES: PersonalPreferences = {
  callsign: 'Architect',
  homeCity: '',
  mode: 'architect',
  verbosity: 'balanced',
  geometryMode: 'unified',
  animationMode: 'standard',
  streamingSpeed: 'cinematic',
  voicePitch: 'deep',
  soundEnabled: true,
  idleHumEnabled: true,
  voiceEnabled: false,
  wakeWordEnabled: false,
  voiceNavEnabled: false,
  wakePhrase: 'Hey Ultron',
  accentColor: DEFAULT_ACCENT_COLOR,
};

interface AuthContextValue {
  user: User | null;
  idToken: string | null;
  loading: boolean;
  authError: string | null;
  preferences: PersonalPreferences;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  updatePreferences: (patch: Partial<PersonalPreferences>) => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sanitizeWakePhrase(raw: unknown): string {
  if (typeof raw !== 'string') return 'Hey Ultron';
  const trimmed = raw.trim().slice(0, 48);
  return trimmed.length >= 2 ? trimmed : 'Hey Ultron';
}

export function sanitizeHexColor(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_ACCENT_COLOR;
  const trimmed = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed)
    ? trimmed.toLowerCase()
    : DEFAULT_ACCENT_COLOR;
}

function hexToRgbTuple(hex: string): string {
  const clean = sanitizeHexColor(hex).slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function formatFirestoreUserMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim();
      }
    } catch {
      // Ignore JSON parse fallback
    }
  }
  return raw || fallback;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [preferences, setPreferences] =
    useState<PersonalPreferences>(DEFAULT_PREFERENCES);
  const preferencesRef = useRef<PersonalPreferences>(DEFAULT_PREFERENCES);
  preferencesRef.current = preferences;

  // Sync CSS custom properties globally whenever accentColor updates
  useEffect(() => {
    const color = sanitizeHexColor(preferences.accentColor);
    document.documentElement.style.setProperty('--ultron-accent', color);
    document.documentElement.style.setProperty(
      '--ultron-accent-rgb',
      hexToRgbTuple(color),
    );
  }, [preferences.accentColor]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIdToken(null);
        setPreferences(DEFAULT_PREFERENCES);
        setLoading(false);
        return;
      }

      try {
        const token = await nextUser.getIdToken();
        setIdToken(token);

        const privatePath = `users/${nextUser.uid}/private/info`;
        const privateRef = doc(db, 'users', nextUser.uid, 'private', 'info');
        try {
          const snap = await getDoc(privateRef);
          const email = nextUser.email || 'unknown@local';
          const displayName =
            nextUser.displayName || email.split('@')[0] || 'Architect';
          if (!snap.exists()) {
            await setDoc(privateRef, {
              uid: nextUser.uid,
              email,
              displayName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(
              privateRef,
              {
                uid: nextUser.uid,
                email,
                displayName,
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, privatePath);
        }

        const prefPath = `users/${nextUser.uid}/preferences/config`;
        const prefRef = doc(db, 'users', nextUser.uid, 'preferences', 'config');
        try {
          const prefSnap = await getDoc(prefRef);
          const firstName =
            nextUser.displayName?.split(/\s+/)[0] ||
            nextUser.email?.split('@')[0] ||
            'Architect';
          if (!prefSnap.exists()) {
            await setDoc(prefRef, {
              uid: nextUser.uid,
              callsign: firstName.slice(0, 48),
              homeCity: '',
              mode: 'architect',
              verbosity: 'balanced',
              geometryMode: 'unified',
              animationMode: 'standard',
              streamingSpeed: 'cinematic',
              voicePitch: 'deep',
              soundEnabled: true,
              idleHumEnabled: true,
              voiceEnabled: false,
              wakeWordEnabled: false,
              voiceNavEnabled: false,
              wakePhrase: 'Hey Ultron',
              accentColor: DEFAULT_ACCENT_COLOR,
              updatedAt: serverTimestamp(),
            });
          } else {
            const existing = prefSnap.data();
            if (
              typeof existing.wakeWordEnabled !== 'boolean' ||
              typeof existing.voiceNavEnabled !== 'boolean' ||
              typeof existing.wakePhrase !== 'string' ||
              typeof existing.accentColor !== 'string' ||
              typeof existing.animationMode !== 'string' ||
              typeof existing.streamingSpeed !== 'string' ||
              typeof existing.voicePitch !== 'string' ||
              typeof existing.idleHumEnabled !== 'boolean'
            ) {
              await setDoc(
                prefRef,
                {
                  wakeWordEnabled:
                    typeof existing.wakeWordEnabled === 'boolean'
                      ? existing.wakeWordEnabled
                      : false,
                  voiceNavEnabled:
                    typeof existing.voiceNavEnabled === 'boolean'
                      ? existing.voiceNavEnabled
                      : false,
                  idleHumEnabled:
                    typeof existing.idleHumEnabled === 'boolean'
                      ? existing.idleHumEnabled
                      : true,
                  wakePhrase: sanitizeWakePhrase(existing.wakePhrase),
                  accentColor: sanitizeHexColor(existing.accentColor),
                  animationMode:
                    existing.animationMode === 'atrial-fibrillation'
                      ? 'atrial-fibrillation'
                      : 'standard',
                  streamingSpeed:
                    existing.streamingSpeed === 'instant'
                      ? 'instant'
                      : 'cinematic',
                  voicePitch:
                    existing.voicePitch === 'balanced' ||
                    existing.voicePitch === 'clear'
                      ? existing.voicePitch
                      : 'deep',
                  updatedAt: serverTimestamp(),
                },
                { merge: true },
              );
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, prefPath);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        setAuthError(
          formatFirestoreUserMessage(err, 'Unable to verify personal session.'),
        );
      } finally {
        setLoading(false);
      }
    });

    const unsubToken = onIdTokenChanged(auth, async (nextUser) => {
      if (nextUser) {
        const token = await nextUser.getIdToken().catch(() => null);
        setIdToken(token);
      } else {
        setIdToken(null);
      }
    });

    return () => {
      unsubAuth();
      unsubToken();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const prefPath = `users/${user.uid}/preferences/config`;
    const prefRef = doc(db, 'users', user.uid, 'preferences', 'config');
    const unsub = onSnapshot(
      prefRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        setPreferences({
          callsign:
            typeof data.callsign === 'string' && data.callsign.trim()
              ? data.callsign
              : 'Architect',
          homeCity: typeof data.homeCity === 'string' ? data.homeCity : '',
          mode:
            data.mode === 'tactical' || data.mode === 'deep'
              ? data.mode
              : 'architect',
          verbosity:
            data.verbosity === 'concise' || data.verbosity === 'detailed'
              ? data.verbosity
              : 'balanced',
          geometryMode:
            data.geometryMode === 'topology' || data.geometryMode === 'exploded'
              ? data.geometryMode
              : 'unified',
          animationMode:
            data.animationMode === 'atrial-fibrillation'
              ? 'atrial-fibrillation'
              : 'standard',
          streamingSpeed:
            data.streamingSpeed === 'instant' ? 'instant' : 'cinematic',
          voicePitch:
            data.voicePitch === 'balanced' || data.voicePitch === 'clear'
              ? data.voicePitch
              : 'deep',
          soundEnabled:
            typeof data.soundEnabled === 'boolean' ? data.soundEnabled : true,
          idleHumEnabled:
            typeof data.idleHumEnabled === 'boolean'
              ? data.idleHumEnabled
              : true,
          voiceEnabled:
            typeof data.voiceEnabled === 'boolean' ? data.voiceEnabled : false,
          wakeWordEnabled:
            typeof data.wakeWordEnabled === 'boolean'
              ? data.wakeWordEnabled
              : false,
          voiceNavEnabled:
            typeof data.voiceNavEnabled === 'boolean'
              ? data.voiceNavEnabled
              : false,
          wakePhrase: sanitizeWakePhrase(data.wakePhrase),
          accentColor: sanitizeHexColor(data.accentColor),
        });
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, prefPath);
        } catch (wrappedErr) {
          setAuthError(
            formatFirestoreUserMessage(
              wrappedErr,
              'Unable to synchronize personal preferences.',
            ),
          );
        }
      },
    );
    return () => unsub();
  }, [user]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google Sign-In failed.';
      if (!/popup-closed-by-user|cancelled-popup-request/i.test(msg)) {
        setAuthError(msg);
      }
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Failed to sign out cleanly.',
      );
    }
  }, []);

  const updatePreferences = useCallback(
    async (patch: Partial<PersonalPreferences>) => {
      const prev = preferencesRef.current;
      const next: PersonalPreferences = {
        ...prev,
        ...patch,
        callsign:
          (patch.callsign ?? prev.callsign).trim().slice(0, 48) ||
          'Architect',
        homeCity: (patch.homeCity ?? prev.homeCity).trim().slice(0, 120),
        wakePhrase: sanitizeWakePhrase(patch.wakePhrase ?? prev.wakePhrase),
        accentColor: sanitizeHexColor(patch.accentColor ?? prev.accentColor),
        animationMode:
          (patch.animationMode ?? prev.animationMode) === 'atrial-fibrillation'
            ? 'atrial-fibrillation'
            : 'standard',
        streamingSpeed:
          (patch.streamingSpeed ?? prev.streamingSpeed) === 'instant'
            ? 'instant'
            : 'cinematic',
        voicePitch:
          (patch.voicePitch ?? prev.voicePitch) === 'balanced' ||
          (patch.voicePitch ?? prev.voicePitch) === 'clear'
            ? (patch.voicePitch ?? prev.voicePitch)
            : 'deep',
      };
      preferencesRef.current = next;
      setPreferences(next);
      if (!user) return;
      const prefPath = `users/${user.uid}/preferences/config`;
      const prefRef = doc(db, 'users', user.uid, 'preferences', 'config');
      try {
        await setDoc(
          prefRef,
          {
            uid: user.uid,
            callsign: next.callsign,
            homeCity: next.homeCity,
            mode: next.mode,
            verbosity: next.verbosity,
            geometryMode: next.geometryMode,
            animationMode: next.animationMode,
            streamingSpeed: next.streamingSpeed,
            voicePitch: next.voicePitch,
            soundEnabled: next.soundEnabled,
            idleHumEnabled: next.idleHumEnabled,
            voiceEnabled: next.voiceEnabled,
            wakeWordEnabled: next.wakeWordEnabled,
            voiceNavEnabled: next.voiceNavEnabled,
            wakePhrase: next.wakePhrase,
            accentColor: next.accentColor,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (err) {
        preferencesRef.current = prev;
        setPreferences(prev);
        try {
          handleFirestoreError(err, OperationType.WRITE, prefPath);
        } catch (wrappedErr) {
          setAuthError(
            formatFirestoreUserMessage(
              wrappedErr,
              'Failed to save personal preferences.',
            ),
          );
        }
      }
    },
    [user],
  );

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        idToken,
        loading,
        authError,
        preferences,
        signInWithGoogle,
        signOutUser,
        updatePreferences,
        clearAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return ctx;
}
