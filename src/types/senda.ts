export type ThemePreference = 'system' | 'light' | 'dark';
export type NavTab = 'home' | 'send' | 'devices' | 'activity' | 'settings';
export type TransportMode = 'webrtc-lan' | 'webrtc-p2p' | 'ws-relay';
export type TransferStatus =
  | 'pending'
  | 'connecting'
  | 'active'
  | 'paused'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'failed';

export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string;
  displayName: string;
  avatarUrl: string;
  autoAcceptTrusted: boolean;
  defaultDownloadFolder: string;
  notificationsEnabled: boolean;
  themePreference: ThemePreference;
  language: string;
  createdAt: number;
}

export interface DeviceInfo {
  id: string;
  userId: string;
  deviceName: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'web';
  isTrusted: boolean;
  isOnline: boolean;
  lastSeen: number;
  sameNetwork?: boolean;
  isCurrentDevice?: boolean;
  createdAt?: number;
}

export interface PublicPeer {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  devices: Array<{
    id: string;
    deviceName: string;
    os: string;
    deviceType: 'desktop' | 'mobile' | 'tablet' | 'web';
    isOnline: boolean;
    lastSeen: number;
  }>;
}

export interface QueuedFileItem {
  id: string;
  file: File;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
}

export interface FileMeta {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  sha256?: string;
}

export interface ActiveTransfer {
  id: string;
  direction: 'send' | 'receive';
  peerUserId: string;
  peerUsername: string;
  peerDisplayName: string;
  peerAvatarUrl?: string;
  peerDeviceId: string;
  peerDeviceName: string;
  files: FileMeta[];
  totalBytes: number;
  transferredBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  progress: number; // 0..100
  status: TransferStatus;
  transport: TransportMode;
  sameNetwork: boolean;
  integrityVerified: boolean;
  errorMessage?: string;
  currentFileIndex: number;
  currentFileName: string;
  createdAt: number;
  completedAt?: number;
  // Locally available received blobs in current session for instant reopen/save
  receivedFiles?: Array<{
    name: string;
    relativePath: string;
    size: number;
    mimeType: string;
    blob?: Blob;
    savedToDisk?: boolean;
    sha256?: string;
  }>;
}

export interface IncomingTransferRequest {
  transferId: string;
  fromUserId: string;
  fromUsername: string;
  fromDisplayName: string;
  fromAvatarUrl: string;
  fromDeviceId: string;
  fromDeviceName: string;
  fromDeviceOs: string;
  files: FileMeta[];
  totalBytes: number;
  sameNetwork: boolean;
  autoAccept: boolean;
  receivedAt: number;
}

export interface TransferHistoryRecord {
  id: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  senderDeviceId: string;
  senderDeviceName: string;
  recipientId: string;
  recipientUsername: string;
  recipientDisplayName: string;
  recipientDeviceId: string;
  recipientDeviceName: string;
  files: FileMeta[];
  totalBytes: number;
  fileCount: number;
  transport: TransportMode;
  status: TransferStatus;
  errorMessage?: string | null;
  createdAt: number;
  completedAt?: number | null;
}
