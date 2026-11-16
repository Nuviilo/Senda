import {
  Activity,
  Download,
  Home,
  Inbox,
  Laptop,
  Loader2,
  Moon,
  Send,
  Settings,
  Smartphone,
  Sun,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from './components/Avatar';
import { NativePackagingModal } from './components/NativePackagingModal';
import { ReceiveModal } from './components/ReceiveModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TransferProvider, useTransfer } from './context/TransferContext';
import { usePWAInstall } from './hooks/usePWAInstall';
import { apiRequest } from './lib/api';
import { formatBytes } from './lib/fileUtils';
import { t } from './lib/i18n';
import { ActivityView } from './pages/ActivityView';
import { AuthScreen } from './pages/AuthScreen';
import { DevicesView } from './pages/DevicesView';
import { HomeView } from './pages/HomeView';
import { SendView } from './pages/SendView';
import { SettingsView } from './pages/SettingsView';
import type { NavTab, PublicPeer, QueuedFileItem } from './types/senda';

function SendaWorkspace() {
  const { user, loading, resolvedTheme, toggleThemeQuick, refreshSession } = useAuth();
  const {
    activeTransfers,
    incomingRequests,
    toastMessage,
    showToast,
    acceptIncomingRequest,
    declineIncomingRequest,
  } = useTransfer();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [queuedFiles, setQueuedFiles] = useState<QueuedFileItem[]>([]);
  const [preselectedPeer, setPreselectedPeer] = useState<PublicPeer | null>(null);
  const [preselectedOwnDeviceIds, setPreselectedOwnDeviceIds] = useState<string[]>([]);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [packagingOpen, setPackagingOpen] = useState(false);
  const [iosGuideOpen, setIosGuideOpen] = useState(false);

  // Handle ?verifyToken=..., ?tab=send, and Android Web Share Target files
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get('verifyToken');
    const tabParam = params.get('tab') as NavTab | null;
    const isShared = params.get('shared') === '1';

    if (tabParam && ['home', 'send', 'devices', 'activity', 'settings'].includes(tabParam)) {
      setActiveTab(tabParam);
    }

    if (verifyToken) {
      apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken }),
      })
        .then(() => {
          showToast('Email verified successfully', 'success');
          void refreshSession();
        })
        .catch(() => {});
      window.history.replaceState({}, '', '/');
    }

    if (isShared && 'caches' in window) {
      (async () => {
        try {
          const cache = await caches.open('senda-share-target-v1');
          const manifestRes = await cache.match('/__shared_manifest__');
          if (!manifestRes) return;
          const keys = (await manifestRes.json()) as string[];
          const loaded: QueuedFileItem[] = [];
          for (const key of keys) {
            const fileRes = await cache.match(key);
            if (!fileRes) continue;
            const blob = await fileRes.blob();
            const rawName = fileRes.headers.get('X-Senda-Filename') || 'shared-file';
            const name = decodeURIComponent(rawName);
            const file = new File([blob], name, {
              type: fileRes.headers.get('Content-Type') || 'application/octet-stream',
            });
            loaded.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              file,
              name,
              relativePath: name,
              size: file.size,
              mimeType: file.type,
            });
            await cache.delete(key);
          }
          await cache.delete('/__shared_manifest__');
          if (loaded.length > 0) {
            setQueuedFiles((prev) => [...prev, ...loaded]);
            setActiveTab('send');
            showToast(`Loaded ${loaded.length} shared file(s) from Android`, 'success');
          }
        } catch {}
        window.history.replaceState({}, '', '/');
      })();
    }
  }, [refreshSession, showToast]);

  const clearPreselection = useCallback(() => {
    setPreselectedPeer(null);
    setPreselectedOwnDeviceIds([]);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] dark:bg-[#0B0D11]">
        <Loader2 className="w-6 h-6 animate-spin text-[#2563EB]" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const lang = user.language || 'en';
  const runningCount = activeTransfers.filter(
    (tr) => tr.status === 'active' || tr.status === 'connecting' || tr.status === 'pending' || tr.status === 'paused'
  ).length;

  const navItems: Array<{ id: NavTab; label: string; icon: typeof Home; count?: number }> = [
    { id: 'home', label: t(lang, 'nav.home'), icon: Home },
    { id: 'send', label: t(lang, 'nav.send'), icon: Send, count: runningCount > 0 ? runningCount : undefined },
    { id: 'devices', label: t(lang, 'nav.devices'), icon: Laptop },
    { id: 'activity', label: t(lang, 'nav.activity'), icon: Activity },
    { id: 'settings', label: t(lang, 'nav.settings'), icon: Settings },
  ];

  return (
    <div
      dir={lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#F8F9FA] dark:bg-[#0B0D11] text-zinc-900 dark:text-zinc-100 flex"
    >
      {/* Desktop Sidebar (Windows / macOS / Linux) */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-e border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#0F1117] z-30">
        <div className="px-5 py-5 flex items-center gap-2.5">
          <img
            src="/src/assets/images/senda_app_icon_1794834881731.jpg"
            alt="Senda"
            className="w-8 h-8 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800 shrink-0"
          />
          <span className="text-lg font-bold tracking-tight">Senda</span>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-zinc-100 dark:bg-[#191D26] text-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${active ? 'text-[#2563EB]' : ''}`} strokeWidth={1.8} />
                  {item.label}
                </span>
                {item.count !== undefined && (
                  <span className="font-mono text-xs text-[#2563EB] dark:text-blue-400 tabular-nums">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-zinc-200/80 dark:border-zinc-800/80 space-y-2">
          <button
            type="button"
            onClick={() => setReceiveOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-zinc-500" />
              Receive Queue
            </span>
            {incomingRequests.length > 0 && (
              <span className="font-mono font-semibold text-[#2563EB]">{incomingRequests.length}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left"
          >
            <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {user.displayName}
              </p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate font-mono">
                @{user.username}
              </p>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:ps-60 flex flex-col min-w-0 pb-20 md:pb-8">
        {/* Top Header */}
        <header className="sticky top-0 z-20 h-14 bg-[#F8F9FA]/85 dark:bg-[#0B0D11]/85 backdrop-blur-md border-b border-zinc-200/70 dark:border-zinc-800/70 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 md:hidden">
            <img
              src="/src/assets/images/senda_app_icon_1794834881731.jpg"
              alt="Senda"
              className="w-7 h-7 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800"
            />
            <span className="text-base font-bold tracking-tight">Senda</span>
          </div>

          <div className="hidden md:block text-xs text-zinc-500 dark:text-zinc-400 font-medium capitalize">
            {navItems.find((n) => n.id === activeTab)?.label}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isInstallable && !isInstalled && (
              <button
                type="button"
                onClick={() => void install()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-[#1D4ED8] transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Install App
              </button>
            )}
            {isIOS && !isInstalled && !isInstallable && (
              <button
                type="button"
                onClick={() => setIosGuideOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium whitespace-nowrap"
              >
                <Smartphone className="w-3.5 h-3.5" />
                Install
              </button>
            )}
            <button
              type="button"
              onClick={() => setPackagingOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13161C] text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
            >
              APK / EXE
            </button>
            <button
              type="button"
              onClick={() => setReceiveOpen(true)}
              className="md:hidden relative min-w-[40px] min-h-[40px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13161C] flex items-center justify-center"
              aria-label="Receive queue"
            >
              <Inbox className="w-4 h-4" />
              {incomingRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#2563EB] text-white text-[10px] font-mono flex items-center justify-center">
                  {incomingRequests.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={toggleThemeQuick}
              className="min-w-[40px] min-h-[40px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13161C] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center justify-center transition-colors"
              aria-label="Toggle dark mode"
            >
              {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Unverified Email Reminder Banner */}
        {!user.emailVerified && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/80 dark:border-amber-900/50 px-4 sm:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200">
            <span>
              Your email ({user.email}) is not verified yet. Verify it to protect account recovery.
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="font-semibold underline hover:no-underline"
            >
              Verify now
            </button>
          </div>
        )}

        {/* Live Incoming Transfer Request Banner */}
        {incomingRequests.length > 0 && !receiveOpen && (
          <div className="mx-4 sm:mx-8 mt-4 rounded-2xl border border-[#2563EB]/40 bg-white dark:bg-[#13161C] p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar
                name={incomingRequests[0].fromDisplayName}
                src={incomingRequests[0].fromAvatarUrl}
                size="md"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {incomingRequests[0].fromDisplayName} wants to send {incomingRequests[0].files.length}{' '}
                  {incomingRequests[0].files.length === 1 ? 'file' : 'files'}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  @{incomingRequests[0].fromUsername} · {incomingRequests[0].fromDeviceName} ·{' '}
                  <span className="font-mono tabular-nums">
                    {formatBytes(incomingRequests[0].totalBytes)}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => declineIncomingRequest(incomingRequests[0].transferId)}
                className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => void acceptIncomingRequest(incomingRequests[0].transferId)}
                className="px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1D4ED8]"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => setReceiveOpen(true)}
                className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Details
              </button>
            </div>
          </div>
        )}

        {/* Active Screen Viewport */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
          {activeTab === 'home' && (
            <HomeView
              onNavigate={setActiveTab}
              onStartSendWithFiles={(files) => {
                setQueuedFiles((prev) => [...prev, ...files]);
                setActiveTab('send');
              }}
              onSelectPeerForSend={(peer) => {
                setPreselectedPeer(peer);
                setActiveTab('send');
              }}
              onSelectOwnDeviceForSend={(devId) => {
                setPreselectedOwnDeviceIds([devId]);
                setActiveTab('send');
              }}
              onOpenReceive={() => setReceiveOpen(true)}
            />
          )}

          {activeTab === 'send' && (
            <SendView
              queuedFiles={queuedFiles}
              setQueuedFiles={setQueuedFiles}
              preselectedPeer={preselectedPeer}
              preselectedOwnDeviceIds={preselectedOwnDeviceIds}
              clearPreselection={clearPreselection}
            />
          )}

          {activeTab === 'devices' && (
            <DevicesView
              onSendToDevices={(ids) => {
                setPreselectedOwnDeviceIds(ids);
                setActiveTab('send');
              }}
            />
          )}

          {activeTab === 'activity' && <ActivityView />}

          {activeTab === 'settings' && (
            <SettingsView
              onNavigate={setActiveTab}
              onOpenPackaging={() => setPackagingOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Android) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#0F1117]/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80 pb-safe">
        <div className="grid grid-cols-5 h-16 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
                  active
                    ? 'text-[#2563EB] dark:text-blue-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={active ? 2.1 : 1.75} />
                <span className="text-[10px] font-medium tracking-tight truncate max-w-[64px]">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <NativePackagingModal open={packagingOpen} onClose={() => setPackagingOpen(false)} />

      {iosGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#13161C] border border-zinc-200 dark:border-zinc-800 p-6 space-y-3">
            <h3 className="text-base font-semibold">Install Senda on iOS</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              1. Tap the <strong>Share</strong> icon in Safari.<br />
              2. Scroll down and tap <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => setIosGuideOpen(false)}
              className="w-full py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-50 max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#191D26] px-4 py-3 shadow-lg text-xs font-medium text-zinc-900 dark:text-zinc-100">
          {toastMessage.text}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TransferProvider>
        <SendaWorkspace />
      </TransferProvider>
    </AuthProvider>
  );
}
