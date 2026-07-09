import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthResponse } from '../types';

const SESSION_KEY = 'resergrass.session';

export async function saveSession(session: AuthResponse) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function getSession(): Promise<AuthResponse | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) as AuthResponse : null;
}

export async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}
