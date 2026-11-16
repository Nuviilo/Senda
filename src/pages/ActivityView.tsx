import { ArrowDownLeft, ArrowUpRight, Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FileTypeIcon } from '../components/FileTypeIcon';
import { useAuth } from '../context/AuthContext';
import { useTransfer } from '../context/TransferContext';
import { formatBytes, triggerBlobDownload } from '../lib/fileUtils';

type ActivityFilter = 'all' | 'sent' | 'received' | 'completed' | 'failed' | 'cancelled';

export function ActivityView() {
  const { user } = useAuth();
  const { history, activeTransfers } = useTransfer();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [search, setSearch] = useState('');

  // Map locally cached received blobs from activeTransfers by transfer ID
  const sessionBlobsById = useMemo(() => {
    const map = new Map<string, NonNullable<(typeof activeTransfers)[number]['receivedFiles']>>();
    for (const tr of activeTransfers) {
      if (tr.receivedFiles && tr.receivedFiles.length > 0) {
        map.set(tr.id, tr.receivedFiles);
      }
    }
    return map;
  }, [activeTransfers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((item) => {
      const isSent = item.senderId === user?.id;
      if (filter === 'sent' && !isSent) return false;
      if (filter === 'received' && isSent) return false;
      if (filter === 'completed' && item.status !== 'completed') return false;
      if (filter === 'failed' && item.status !== 'failed' && item.status !== 'declined') return false;
      if (filter === 'cancelled' && item.status !== 'cancelled') return false;

      if (!q) return true;
      const matchesUser =
        item.senderUsername.toLowerCase().includes(q) ||
        item.recipientUsername.toLowerCase().includes(q) ||
        item.senderDisplayName.toLowerCase().includes(q) ||
        item.recipientDisplayName.toLowerCase().includes(q);
      const matchesFile = item.files.some(
        (f) => f.name.toLowerCase().includes(q) || f.relativePath.toLowerCase().includes(q)
      );
      return matchesUser || matchesFile;
    });
  }, [history, filter, search, user?.id]);

  const tabs: Array<{ id: ActivityFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'sent', label: 'Sent' },
    { id: 'received', label: 'Received' },
    { id: 'completed', label: 'Completed' },
    { id: 'failed', label: 'Failed' },
    { id: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Activity
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Complete history of sent, received, completed, failed, and cancelled transfers.
        </p>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#1C2029] text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by file or @username..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13161C] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* History Table / List */}
      <div className="bg-white dark:bg-[#13161C] border border-zinc-200/90 dark:border-zinc-800 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No matching transfers found.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {filtered.map((item) => {
              const isSent = item.senderId === user?.id;
              const firstFile = item.files[0];
              const localFiles = sessionBlobsById.get(item.id);
              const dateStr = new Date(item.createdAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={item.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                      <FileTypeIcon
                        fileName={firstFile?.name || 'file'}
                        mimeType={firstFile?.mimeType}
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isSent ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        ) : (
                          <ArrowDownLeft className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                        )}
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {item.fileCount === 1
                            ? firstFile?.name || 'File'
                            : `${firstFile?.name || 'Files'} (+${item.fileCount - 1} more)`}
                        </p>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                        {isSent
                          ? `Sent to ${item.recipientDisplayName} (@${item.recipientUsername}) · ${item.recipientDeviceName}`
                          : `From ${item.senderDisplayName} (@${item.senderUsername}) · ${item.senderDeviceName}`}
                        {' · '}
                        <span>{dateStr}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-mono tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
                        {formatBytes(item.totalBytes)}
                      </p>
                      <p
                        className={`text-xs font-medium capitalize ${
                          item.status === 'completed'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : item.status === 'failed' || item.status === 'declined'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {item.status}
                      </p>
                    </div>

                    {localFiles && localFiles.some((f) => f.blob) && (
                      <button
                        type="button"
                        onClick={() => {
                          localFiles.forEach((f) => {
                            if (f.blob) triggerBlobDownload(f.blob, f.name);
                          });
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Save
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
