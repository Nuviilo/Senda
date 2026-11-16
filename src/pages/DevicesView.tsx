import { Check, Edit3, Send, Shield, ShieldCheck, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { DeviceIcon } from '../components/DeviceIcon';
import { useAuth } from '../context/AuthContext';
import { useTransfer } from '../context/TransferContext';
import { apiRequest } from '../lib/api';
import { formatRelativeTime } from '../lib/fileUtils';

interface DevicesViewProps {
  onSendToDevices: (deviceIds: string[]) => void;
}

export function DevicesView({ onSendToDevices }: DevicesViewProps) {
  const { devices, refreshDevices } = useAuth();
  const { showToast } = useTransfer();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const sorted = [...devices].sort((a, b) => {
    if (a.isCurrentDevice !== b.isCurrentDevice) return a.isCurrentDevice ? -1 : 1;
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return b.lastSeen - a.lastSeen;
  });

  const handleRename = async (deviceId: string) => {
    if (!draftName.trim()) return;
    try {
      await apiRequest(`/api/devices/${deviceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ deviceName: draftName.trim() }),
      });
      setEditingId(null);
      await refreshDevices();
      showToast('Device renamed', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rename failed', 'error');
    }
  };

  const handleToggleTrust = async (deviceId: string, currentTrusted: boolean) => {
    try {
      await apiRequest(`/api/devices/${deviceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isTrusted: !currentTrusted }),
      });
      await refreshDevices();
      showToast(
        !currentTrusted ? 'Device marked as trusted' : 'Removed trusted status',
        'info'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleRemove = async (deviceId: string, isCurrent?: boolean) => {
    if (isCurrent) {
      showToast('Sign out from Settings to remove your current device session.', 'info');
      return;
    }
    try {
      await apiRequest(`/api/devices/${deviceId}`, { method: 'DELETE' });
      setSelectedIds((prev) => prev.filter((id) => id !== deviceId));
      await refreshDevices();
      showToast('Device removed and session signed out', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Remove failed', 'error');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Devices
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Manage your signed-in Windows PCs, Android devices, and browsers. Select multiple devices to send files simultaneously.
          </p>
        </div>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => onSendToDevices(selectedIds)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors"
          >
            <Send className="w-4 h-4" />
            Send to {selectedIds.length} {selectedIds.length === 1 ? 'Device' : 'Devices'}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800/80">
        {sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No devices registered on your account yet.
          </div>
        ) : (
          sorted.map((dev) => {
            const isEditing = editingId === dev.id;
            const isSelected = selectedIds.includes(dev.id);

            return (
              <div
                key={dev.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  {!dev.isCurrentDevice && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(dev.id)}
                      aria-label={`Select ${dev.deviceName}`}
                      className={`mt-1 sm:mt-0 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-[#2563EB] border-[#2563EB] text-white'
                          : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-400'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </button>
                  )}

                  <div className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                    <DeviceIcon os={dev.os} deviceType={dev.deviceType} className="w-5 h-5" />
                  </div>

                  <div className="min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRename(dev.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          className="h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-[#0B0D11] text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRename(dev.id)}
                          className="p-1.5 rounded-lg bg-[#2563EB] text-white"
                          aria-label="Save name"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          aria-label="Cancel rename"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {dev.deviceName}
                        </p>
                        {dev.isCurrentDevice && (
                          <span className="text-xs font-medium text-[#2563EB] dark:text-blue-400">
                            This device
                          </span>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {dev.os}
                      {' · '}
                      <span
                        className={
                          dev.isOnline
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : ''
                        }
                      >
                        {dev.isOnline ? 'Online' : 'Offline'}
                      </span>
                      {' · '}
                      <span>Last seen {formatRelativeTime(dev.lastSeen)}</span>
                      {dev.sameNetwork && dev.isOnline && !dev.isCurrentDevice ? ' · Same Wi-Fi' : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {!dev.isCurrentDevice && (
                    <button
                      type="button"
                      onClick={() => onSendToDevices([dev.id])}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-[#2563EB] hover:text-white text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleToggleTrust(dev.id, dev.isTrusted)}
                    title={dev.isTrusted ? 'Trusted for auto-accept' : 'Mark device as trusted'}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      dev.isTrusted
                        ? 'border-emerald-300 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {dev.isTrusted ? <ShieldCheck className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                    {dev.isTrusted ? 'Trusted' : 'Trust'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(dev.id);
                      setDraftName(dev.deviceName);
                    }}
                    title="Rename device"
                    className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  {!dev.isCurrentDevice && (
                    <button
                      type="button"
                      onClick={() => void handleRemove(dev.id, dev.isCurrentDevice)}
                      title="Remove device"
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
