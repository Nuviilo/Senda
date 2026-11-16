import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiRequest,
  detectLocalDeviceMetadata,
  getStoredToken,
  setStoredDeviceId,
  setStoredToken,
} from '../lib/api';
import type { DeviceInfo, ThemePreference, UserProfile } from '../types/senda';

interface AuthContextValue {
  user: UserProfile | null;
  deviceId: string;
  devices: DeviceInfo[];
  loading: boolean;
  resolvedTheme: 'light' | 'dark';
  setDevices: React.Dispatch<React.SetStateAction<DeviceInfo[]>>;
  refreshSession: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => Promise<{ verificationPreview: any }>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<UserProfile>;
  setThemePreference: (pref: ThemePreference) => Promise<void>;
  toggleThemeQuick: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LOCAL_THEME_KEY = 'senda_theme';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [deviceId, setDeviceId] = useState<string>(() => detectLocalDeviceMetadata().id);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [localTheme, setLocalTheme] = useState<ThemePreference>(
    () => (localStorage.getItem(LOCAL_THEME_KEY) as ThemePreference) || 'system'
  );
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const activeThemePref = user?.themePreference || localTheme;
  const resolvedTheme: 'light' | 'dark' =
    activeThemePref === 'system' ? (systemDark ? 'dark' : 'light') : activeThemePref;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', resolvedTheme === 'dark' ? '#0B0D11' : '#F8F9FA');
    }
  }, [resolvedTheme]);

  const refreshDevices = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      const data = await apiRequest<{ devices: DeviceInfo[] }>('/api/devices');
      setDevices(data.devices);
    } catch {
      // Ignore transient errors
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiRequest<{ user: UserProfile; deviceId: string }>('/api/auth/me');
      setUser(data.user);
      setDeviceId(data.deviceId);
      setStoredDeviceId(data.deviceId);
      setLocalTheme(data.user.themePreference);
      localStorage.setItem(LOCAL_THEME_KEY, data.user.themePreference);
      await refreshDevices();
    } catch {
      setStoredToken('');
      setUser(null);
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [refreshDevices]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (identifier: string, password: string) => {
    const device = detectLocalDeviceMetadata();
    const res = await apiRequest<{ token: string; deviceId: string; user: UserProfile }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ identifier, password, device }),
      }
    );
    setStoredToken(res.token);
    setStoredDeviceId(res.deviceId);
    setDeviceId(res.deviceId);
    setUser(res.user);
    setLocalTheme(res.user.themePreference);
    localStorage.setItem(LOCAL_THEME_KEY, res.user.themePreference);
    await refreshDevices();
  };

  const register = async (data: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => {
    const device = detectLocalDeviceMetadata();
    const res = await apiRequest<{
      token: string;
      deviceId: string;
      user: UserProfile;
      verificationPreview: any;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ ...data, device }),
    });
    setStoredToken(res.token);
    setStoredDeviceId(res.deviceId);
    setDeviceId(res.deviceId);
    setUser(res.user);
    await refreshDevices();
    return { verificationPreview: res.verificationPreview };
  };

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local state regardless
    }
    setStoredToken('');
    setUser(null);
    setDevices([]);
  };

  const updateProfile = async (patch: Partial<UserProfile>): Promise<UserProfile> => {
    const res = await apiRequest<{ user: UserProfile }>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setUser(res.user);
    if (res.user.themePreference) {
      setLocalTheme(res.user.themePreference);
      localStorage.setItem(LOCAL_THEME_KEY, res.user.themePreference);
    }
    return res.user;
  };

  const setThemePreference = async (pref: ThemePreference) => {
    setLocalTheme(pref);
    localStorage.setItem(LOCAL_THEME_KEY, pref);
    if (user) {
      await updateProfile({ themePreference: pref });
    }
  };

  const toggleThemeQuick = () => {
    const next: ThemePreference = resolvedTheme === 'dark' ? 'light' : 'dark';
    void setThemePreference(next);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        deviceId,
        devices,
        loading,
        resolvedTheme,
        setDevices,
        refreshSession,
        refreshDevices,
        login,
        register,
        logout,
        updateProfile,
        setThemePreference,
        toggleThemeQuick,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
