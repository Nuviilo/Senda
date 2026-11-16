import {
  Check,
  FolderPlus,
  Laptop,
  Plus,
  Search,
  Send,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { DeviceIcon } from '../components/DeviceIcon';
import { FileTypeIcon } from '../components/FileTypeIcon';
import { TransferCard } from '../components/TransferCard';
import { useAuth } from '../context/AuthContext';
import { type TransferTarget, useTransfer } from '../context/TransferContext';
import { apiRequest } from '../lib/api';
import {
  extractDroppedItems,
  filesToQueuedItems,
  formatBytes,
  formatRelativeTime,
} from '../lib/fileUtils';
import type { PublicPeer, QueuedFileItem } from '../types/senda';

interface SendViewProps {
  queuedFiles: QueuedFileItem[];
  setQueuedFiles: React.Dispatch<React.SetStateAction<QueuedFileItem[]>>;
  preselectedPeer: PublicPeer | null;
  preselectedOwnDeviceIds: string[];
  clearPreselection: () => void;
}

export function SendView({
  queuedFiles,
  setQueuedFiles,
  preselectedPeer,
  preselectedOwnDeviceIds,
  clearPreselection,
}: SendViewProps) {
  const { user, devices } = useAuth();
  const { activeTransfers, sendFilesToTargets, showToast } = useTransfer();

  const [recipientTab, setRecipientTab] = useState<'people' | 'devices'>(
    preselectedOwnDeviceIds.length > 0 ? 'devices' : 'people'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicPeer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PublicPeer | null>(preselectedPeer);
  const [selectedTargetDeviceIds, setSelectedTargetDeviceIds] = useState<string[]>(
    preselectedOwnDeviceIds
  );
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preselectedPeer) {
      setRecipientTab('people');
      setSelectedPeer(preselectedPeer);
      const onlineIds = preselectedPeer.devices.filter((d) => d.isOnline).map((d) => d.id);
      setSelectedTargetDeviceIds(
        onlineIds.length > 0 ? [onlineIds[0]] : preselectedPeer.devices.slice(0, 1).map((d) => d.id)
      );
      clearPreselection();
    } else if (preselectedOwnDeviceIds.length > 0) {
      setRecipientTab('devices');
      setSelectedPeer(null);
      setSelectedTargetDeviceIds(preselectedOwnDeviceIds);
      clearPreselection();
    }
  }, [preselectedPeer, preselectedOwnDeviceIds, clearPreselection]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{ users: PublicPeer[] }>(
          `/api/users/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        if (active) setSearchResults(res.users);
      } catch {
        if (active) setSearchResults([]);
      }
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const toggleDeviceSelection = (id: string) => {
    setSelectedTargetDeviceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectPeer = (peer: PublicPeer) => {
    setSelectedPeer(peer);
    const online = peer.devices.filter((d) => d.isOnline).map((d) => d.id);
    setSelectedTargetDeviceIds(
      online.length > 0 ? [online[0]] : peer.devices.slice(0, 1).map((d) => d.id)
    );
  };

  const appendFiles = (incoming: QueuedFileItem[]) => {
    if (incoming.length === 0) return;
    setQueuedFiles((prev) => [...prev, ...incoming]);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = await extractDroppedItems(e.dataTransfer);
    appendFiles(items);
  };

  const ownOtherDevices = [...devices]
    .filter((d) => !d.isCurrentDevice)
    .sort((a, b) => (a.isOnline === b.isOnline ? b.lastSeen - a.lastSeen : a.isOnline ? -1 : 1));

  const totalQueuedBytes = queuedFiles.reduce((acc, f) => acc + f.size, 0);

  const handleStartTransfer = async () => {
    if (queuedFiles.length === 0) {
      showToast('Select at least one file or folder to send.', 'error');
      return;
    }
    if (selectedTargetDeviceIds.length === 0) {
      showToast('Choose at least one recipient device.', 'error');
      return;
    }

    const targets: TransferTarget[] = [];

    if (recipientTab === 'devices' && user) {
      for (const devId of selectedTargetDeviceIds) {
        const dev = devices.find((d) => d.id === devId);
        if (dev) {
          targets.push({
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            deviceId: dev.id,
            deviceName: dev.deviceName,
          });
        }
      }
    } else if (selectedPeer) {
      for (const devId of selectedTargetDeviceIds) {
        const dev = selectedPeer.devices.find((d) => d.id === devId);
        if (dev) {
          targets.push({
            userId: selectedPeer.id,
            username: selectedPeer.username,
            displayName: selectedPeer.displayName,
            avatarUrl: selectedPeer.avatarUrl,
            deviceId: dev.id,
            deviceName: dev.deviceName,
          });
        }
      }
    }

    if (targets.length === 0) {
      showToast('Selected device is no longer available.', 'error');
      return;
    }

    setSending(true);
    try {
      await sendFilesToTargets(queuedFiles, targets);
      setQueuedFiles([]);
      showToast(`Started transfer to ${targets.length} device(s)`, 'success');
    } finally {
      setSending(false);
    }
  };

  const outgoingTransfers = activeTransfers.filter((t) => t.direction === 'send');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Send Files
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Select a recipient or one of your devices, add files or folders, and send directly.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Step 1: Recipient & Devices */}
        <div className="lg:col-span-5 bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              1. Choose Recipient
            </h2>
            <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setRecipientTab('people');
                  setSelectedTargetDeviceIds([]);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  recipientTab === 'people'
                    ? 'bg-white dark:bg-[#1C2029] text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                People
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecipientTab('devices');
                  setSelectedPeer(null);
                  const onlineOwn = ownOtherDevices.filter((d) => d.isOnline).map((d) => d.id);
                  setSelectedTargetDeviceIds(onlineOwn.slice(0, 1));
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  recipientTab === 'devices'
                    ? 'bg-white dark:bg-[#1C2029] text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                My Devices
              </button>
            </div>
          </div>

          {recipientTab === 'people' ? (
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search @username..."
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#0B0D11] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 focus:border-[#2563EB]"
                />
              </div>

              {selectedPeer ? (
                <div className="rounded-xl border border-[#2563EB]/40 bg-blue-50/30 dark:bg-blue-950/15 p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={selectedPeer.displayName} src={selectedPeer.avatarUrl} size="md" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {selectedPeer.displayName}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          @{selectedPeer.username}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPeer(null);
                        setSelectedTargetDeviceIds([]);
                      }}
                      className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      Change
                    </button>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-zinc-200/70 dark:border-zinc-800">
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Select recipient device(s)
                    </p>
                    {selectedPeer.devices.length === 0 ? (
                      <p className="text-xs text-zinc-500">No devices registered on this account.</p>
                    ) : (
                      selectedPeer.devices.map((dev) => {
                        const checked = selectedTargetDeviceIds.includes(dev.id);
                        return (
                          <button
                            key={dev.id}
                            type="button"
                            onClick={() => toggleDeviceSelection(dev.id)}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                              checked
                                ? 'border-[#2563EB] bg-white dark:bg-[#13161C]'
                                : 'border-zinc-200 dark:border-zinc-800 hover:bg-white/60 dark:hover:bg-zinc-900/50'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <DeviceIcon os={dev.os} deviceType={dev.deviceType} className="w-4 h-4 text-zinc-600 dark:text-zinc-300 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                  {dev.deviceName}
                                </p>
                                <p className="text-[11px] text-zinc-500 truncate">
                                  {dev.os} · {dev.isOnline ? 'Online' : `Seen ${formatRelativeTime(dev.lastSeen)}`}
                                </p>
                              </div>
                            </div>
                            <div
                              className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                                checked
                                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                                  : 'border-zinc-300 dark:border-zinc-700'
                              }`}
                            >
                              {checked && <Check className="w-3.5 h-3.5" />}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-72 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-6 text-center">
                      {searchQuery.trim()
                        ? `No users found matching "${searchQuery}"`
                        : 'Type a @username above to find someone on Senda.'}
                    </p>
                  ) : (
                    searchResults.map((peer) => {
                      const onlineCount = peer.devices.filter((d) => d.isOnline).length;
                      return (
                        <button
                          key={peer.id}
                          type="button"
                          onClick={() => handleSelectPeer(peer)}
                          className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 px-2 rounded-lg transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={peer.displayName} src={peer.avatarUrl} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                {peer.displayName}
                              </p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                @{peer.username} · {onlineCount > 0 ? `${onlineCount} online` : 'Offline'}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-medium text-[#2563EB] shrink-0">Select</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {ownOtherDevices.length === 0 ? (
                <p className="text-xs text-zinc-500 py-6 text-center">
                  Sign in with this account on another phone or PC to send files directly between your devices.
                </p>
              ) : (
                ownOtherDevices.map((dev) => {
                  const checked = selectedTargetDeviceIds.includes(dev.id);
                  return (
                    <button
                      key={dev.id}
                      type="button"
                      onClick={() => toggleDeviceSelection(dev.id)}
                      className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border text-left transition-colors ${
                        checked
                          ? 'border-[#2563EB] bg-blue-50/30 dark:bg-blue-950/15'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <DeviceIcon os={dev.os} deviceType={dev.deviceType} className="w-4 h-4 text-zinc-600 dark:text-zinc-300 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {dev.deviceName}
                          </p>
                          <p className="text-xs text-zinc-500 truncate">
                            {dev.os} · {dev.isOnline ? 'Online' : `Seen ${formatRelativeTime(dev.lastSeen)}`}
                            {dev.sameNetwork && dev.isOnline ? ' · Same Wi-Fi' : ''}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                          checked
                            ? 'bg-[#2563EB] border-[#2563EB] text-white'
                            : 'border-zinc-300 dark:border-zinc-700'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Step 2: Select & Review Files */}
        <div className="lg:col-span-7 bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              2. Select Files or Folders
            </h2>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => {
                  if (e.target.files) appendFiles(filesToQueuedItems(e.target.files));
                  e.target.value = '';
                }}
                className="hidden"
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory supported across Chromium/Safari/Firefox
                webkitdirectory=""
                directory=""
                onChange={(e) => {
                  if (e.target.files) appendFiles(filesToQueuedItems(e.target.files));
                  e.target.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Files
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                Add Folder
              </button>
            </div>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragOver
                ? 'border-[#2563EB] bg-blue-50/40 dark:bg-blue-950/20'
                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
            }`}
          >
            <UploadCloud className="w-7 h-7 text-zinc-400 mx-auto" strokeWidth={1.6} />
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 mt-2">
              Drop files or folders here, or click to browse
            </p>
            <p className="text-xs text-zinc-400 mt-1">
              All file types supported · Streamed in 64 KB chunks with SHA-256 verification
            </p>
          </div>

          {/* Queued File Review */}
          {queuedFiles.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  {queuedFiles.length} {queuedFiles.length === 1 ? 'item' : 'items'} selected ·{' '}
                  <span className="font-mono tabular-nums font-medium text-zinc-800 dark:text-zinc-200">
                    {formatBytes(totalQueuedBytes)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setQueuedFiles([])}
                  className="text-red-600 dark:text-red-400 hover:underline"
                >
                  Clear all
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-200/80 dark:border-zinc-800 px-3">
                {queuedFiles.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileTypeIcon
                        fileName={item.name}
                        mimeType={item.mimeType}
                        className="w-4 h-4 text-zinc-500 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {item.relativePath}
                        </p>
                        <p className="text-[11px] text-zinc-400 font-mono tabular-nums">
                          {formatBytes(item.size)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setQueuedFiles((prev) => prev.filter((f) => f.id !== item.id))
                      }
                      className="p-1.5 text-zinc-400 hover:text-red-600 rounded-md transition-colors"
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end">
            <button
              type="button"
              disabled={sending || queuedFiles.length === 0 || selectedTargetDeviceIds.length === 0}
              onClick={() => void handleStartTransfer()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              <Send className="w-4 h-4" />
              {sending
                ? 'Starting Transfer...'
                : `Start Transfer${
                    selectedTargetDeviceIds.length > 1
                      ? ` (${selectedTargetDeviceIds.length} devices)`
                      : ''
                  }`}
            </button>
          </div>
        </div>
      </div>

      {/* Live Outgoing Transfers */}
      {outgoingTransfers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Transfer Queue
          </h2>
          <div className="space-y-3">
            {outgoingTransfers.map((tr) => (
              <TransferCard key={tr.id} transfer={tr} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
