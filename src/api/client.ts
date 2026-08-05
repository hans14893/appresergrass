import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
export const API_URL = extra?.apiUrl ?? 'http://localhost:8080/api';

let authToken: string | null = null;
let unauthorizedHandler: (() => void | Promise<void>) | null = null;
let handlingUnauthorized: Promise<void> | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

async function handleUnauthorized() {
  if (!unauthorizedHandler) return;
  if (!handlingUnauthorized) {
    handlingUnauthorized = Promise.resolve(unauthorizedHandler()).finally(() => {
      handlingUnauthorized = null;
    });
  }
  await handlingUnauthorized;
}

const REQUEST_TIMEOUT_MS = 15_000;

type ApiOptions = {
  method?: string;
  body?: unknown;
};

export function resolveApiUrl(value: string) {
  if (!value || /^https?:\/\//i.test(value)) return value;
  const apiOrigin = API_URL.replace(/\/api\/?$/, '');
  return `${apiOrigin}${value.startsWith('/') ? value : `/${value}`}`;
}

export async function uploadFile<T>(path: string, file: { uri: string; name: string; type: string }): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const formData = new FormData();
  formData.append('file', file as unknown as Blob);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      body: formData,
      signal: controller.signal
    });
    if (!response.ok) {
      if (response.status === 401 && authToken) await handleUnauthorized();
      const error = await response.json().catch(() => null);
      throw new Error(error?.message ?? `Error HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('La imagen está tardando demasiado en subir. Inténtalo nuevamente.');
    }
    if (error instanceof Error && !error.message.includes('Network request failed')) throw error;
    throw new Error('No se pudo subir la imagen. Verifica la conexión con el servidor.');
  } finally {
    clearTimeout(timeout);
  }
}
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('El servicio está tardando demasiado. Verifica tu conexión e inténtalo nuevamente.');
    }
    throw new Error('No se pudo conectar con el servicio. Verifica que el servidor y tu conexión Wi-Fi estén disponibles.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const hadAuthenticatedSession = Boolean(authToken);
    if (response.status === 401 && hadAuthenticatedSession) {
      await handleUnauthorized();
    }
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? `Error HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
