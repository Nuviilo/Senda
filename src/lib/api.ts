const TOKEN_KEY = 'senda_auth_token';
const DEVICE_ID_KEY = 'senda_device_id';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getOrCreateLocalDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function setStoredDeviceId(id: string): void {
  localStorage.setItem(DEVICE_ID_KEY, id);
}

export function detectLocalDeviceMetadata(): {
  id: string;
  deviceName: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'web';
} {
  const ua = navigator.userAgent || '';
  const id = getOrCreateLocalDeviceId();

  let os = 'Web Browser';
  let deviceType: 'desktop' | 'mobile' | 'tablet' | 'web' = 'desktop';
  let deviceName = 'Desktop Browser';

  if (/Android/i.test(ua)) {
    os = 'Android';
    if (/Tablet|SM-T|Pad/i.test(ua) || (!/Mobile/i.test(ua))) {
      deviceType = 'tablet';
      deviceName = 'Android Tablet';
    } else {
      deviceType = 'mobile';
      deviceName = 'Android Phone';
    }
  } else if (/iPhone/i.test(ua)) {
    os = 'iOS';
    deviceType = 'mobile';
    deviceName = 'iPhone';
  } else if (/iPad/i.test(ua)) {
    os = 'iPadOS';
    deviceType = 'tablet';
    deviceName = 'iPad';
  } else if (/Windows/i.test(ua)) {
    os = 'Windows';
    deviceType = 'desktop';
    deviceName = 'Windows PC';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS';
    deviceType = 'desktop';
    deviceName = 'Mac';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
    deviceType = 'desktop';
    deviceName = 'Linux PC';
  }

  return { id, deviceName, os, deviceType };
}

export async function apiRequest<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}
