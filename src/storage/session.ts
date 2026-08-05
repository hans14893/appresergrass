import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthResponse } from '../types';

const SESSION_KEY = 'resergrass.session';

export function getTokenExpirationMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: AuthResponse) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function getSession(): Promise<AuthResponse | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw) as AuthResponse;
  const expiration = getTokenExpirationMs(session.token);
  if (expiration !== null && expiration <= Date.now()) {
    await clearSession();
    return null;
  }
  return session;
}

export async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}
