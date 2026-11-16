import {
  ArrowUpRight,
  Download,
  FolderUp,
  Search,
  Send,
  Upload,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { DeviceIcon } from '../components/DeviceIcon';
import { FileTypeIcon } from '../components/FileTypeIcon';
import { TransferCard } from '../components/TransferCard';
import { useAuth } from '../context/AuthContext';
import { useTransfer } from '../context/TransferContext';
import { apiRequest } from '../lib/api';
import {
  extractDroppedItems,
  filesToQueuedItems,
  formatBytes,
  formatRelativeTime,
} from '../lib/fileUtils';
import { t } from '../lib/i18n';
import type { NavTab, PublicPeer, QueuedFileItem } from '../types/senda';

interface HomeViewProps {
  onNavigate: (tab: NavTab) => void;
  onStartSendWithFiles: (files: QueuedFileItem[]) => void;
  onSelectPeerForSend: (peer: PublicPeer) => void;
  onSelectOwnDeviceForSend: (deviceId: string) => void;
  onOpenReceive: () => void;
}

export function HomeView({
  onNavigate,
  onStartSendWithFiles,
  onSelectPeerForSend,
  onSelectOwnDeviceForSend,
  onOpenReceive,
}: HomeViewProps) {
  const { user, devices } = useAuth();
  const { activeTransfers, history, incomingRequests } = useTransfer();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicPeer[]>([]);
  const [recentPeers, setRecentPeers] = useState<PublicPeer[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const lang = user?.language || 'en';

  // Fetch recent peers on mount
  useEffect(() => {
    let cancelled = false;
    apiRequest<{ users: PublicPeer[] }>('/api/users/search')
      .then((res) => {
        if (!cancelled) setRecentPeers(res.users);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced @username search
  useEffect(() => {
    const clean = searchQuery.trim();
    if (!clean) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{ users: PublicPeer[] }>(
          `/api/users/search?q=${encodeURIComponent(clean)}`
        );
        setSearchResults(res.users);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const queued = await extractDroppedItems(e.dataTransfer);
    if (queued.length > 0) {
      onStartSendWithFiles(queued);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onStartSendWithFiles(filesToQueuedItems(e.target.files));
      e.target.value = '';
    }
  };

  // Sort My Devices: online first, current device excluded or clearly labeled
  const sortedDevices = [...devices].sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return b.lastSeen - a.lastSeen;
  });

  const runningTransfers = activeTransfers.filter(
    (tr) => tr.status === 'active' || tr.status === 'connecting' || tr.status === 'pending' || tr.status === 'paused'
  );

  return (
    <div className="space-y-8">
      {/* Top User Search Bar */}
      <div className="relative max-w-xl">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(lang, 'search.placeholder')}
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13161C] text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 focus:border-[#2563EB]"
          />
        </div>

        {searchQuery.trim().length > 0 && (
          <div className="absolute left-0 right-0 top-13 z-30 bg-white dark:bg-[#13161C] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden">
            {searching ? (
              <div className="px-4 py-3 text-xs text-zinc-500">Searching accounts...</div>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-500">
                No user found matching &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-72 overflow-y-auto">
                {searchResults.map((peer) => {
                  const onlineCount = peer.devices.filter((d) => d.isOnline).length;
                  return (
                    <div
                      key={peer.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={peer.displayName} src={peer.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {peer.displayName}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            @{peer.username}
                            {onlineCount > 0 ? ` · ${onlineCount} online` : ' · Offline'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          onSelectPeerForSend(peer);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-[#1D4ED8] shrink-0 transition-colors whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send Files
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Prominent Upload Hero */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`rounded-2xl border transition-colors p-6 sm:p-10 bg-white dark:bg-[#13161C] ${
          dragOver
            ? 'border-[#2563EB] bg-blue-50/40 dark:bg-blue-950/20'
            : 'border-zinc-200/90 dark:border-zinc-800'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported in Chromium/Firefox/Safari
          webkitdirectory=""
          directory=""
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-balance">
            {t(lang, 'hero.title')}
          </h1>
          <p className="text-sm sm:text-base text-zinc-500 dark:text-zinc-400 mt-2.5 leading-relaxed">
            {t(lang, 'hero.subtitle')}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('send')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              {t(lang, 'action.sendFiles')}
            </button>
            <button
              type="button"
              onClick={onOpenReceive}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              {t(lang, 'action.receiveFiles')}
              {incomingRequests.length > 0 && (
                <span className="ml-1 font-mono text-xs text-[#2563EB] dark:text-blue-400">
                  ({incomingRequests.length})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors whitespace-nowrap"
            >
              <FolderUp className="w-4 h-4" />
              Drop or Pick Folder
            </button>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-4">
            Drag and drop any files or entire folders here to start sending immediately.
          </p>
        </div>
      </section>

      {/* Active Transfers Live Feed */}
      {runningTransfers.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Active Transfers
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('send')}
              className="text-xs text-[#2563EB] hover:underline font-medium"
            >
              View all
            </button>
          </div>
          <div className="space-y-3">
            {runningTransfers.map((tr) => (
              <TransferCard key={tr.id} transfer={tr} />
            ))}
          </div>
        </section>
      )}

      {/* My Devices + Recent Transfers 2-Column Balanced Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* My Devices */}
        <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t(lang, 'section.myDevices')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('devices')}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-medium"
            >
              Manage
            </button>
          </div>

          {sortedDevices.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">No devices registered yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {sortedDevices.slice(0, 5).map((dev) => (
                <div
                  key={dev.id}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                      <DeviceIcon os={dev.os} deviceType={dev.deviceType} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {dev.deviceName}
                        {dev.isCurrentDevice ? ' (This device)' : ''}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {dev.os}
                        {' · '}
                        <span
                          className={
                            dev.isOnline
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : ''
                          }
                        >
                          {dev.isOnline ? 'Online' : `Seen ${formatRelativeTime(dev.lastSeen)}`}
                        </span>
                        {dev.sameNetwork && dev.isOnline && !dev.isCurrentDevice ? ' · Same Wi-Fi' : ''}
                      </p>
                    </div>
                  </div>
                  {!dev.isCurrentDevice && (
                    <button
                      type="button"
                      onClick={() => onSelectOwnDeviceForSend(dev.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0 transition-colors"
                    >
                      Send
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Transfers */}
        <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t(lang, 'section.recentTransfers')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('activity')}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 font-medium"
            >
              History
            </button>
          </div>

          {history.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Your completed and active transfers will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {history.slice(0, 5).map((item) => {
                const isSent = item.senderId === user?.id;
                const firstFile = item.files[0];
                return (
                  <div
                    key={item.id}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                        <FileTypeIcon
                          fileName={firstFile?.name || 'file'}
                          mimeType={firstFile?.mimeType}
                          className="w-4 h-4"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {item.fileCount === 1
                            ? firstFile?.name || 'File'
                            : `${firstFile?.name || 'Files'} + ${item.fileCount - 1}`}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          {isSent
                            ? `Sent to @${item.recipientUsername}`
                            : `From @${item.senderUsername}`}
                          {' · '}
                          <span className="font-mono tabular-nums">{formatBytes(item.totalBytes)}</span>
                          {' · '}
                          {formatRelativeTime(item.createdAt)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium capitalize shrink-0 ${
                        item.status === 'completed'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : item.status === 'failed' || item.status === 'declined'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* People & Peers */}
      {recentPeers.length > 0 && (
        <section className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {t(lang, 'section.onlineFriends')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {recentPeers.map((peer) => {
              const online = peer.devices.some((d) => d.isOnline);
              return (
                <div
                  key={peer.id}
                  className="p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={peer.displayName} src={peer.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {peer.displayName}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        @{peer.username} · {online ? 'Online' : 'Offline'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectPeerForSend(peer)}
                    className="px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-[#2563EB] hover:text-white text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors shrink-0"
                  >
                    Send
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
