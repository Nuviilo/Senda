import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
} from 'lucide-react';

interface FileTypeIconProps {
  fileName: string;
  mimeType?: string;
  isFolder?: boolean;
  className?: string;
}

export function FileTypeIcon({
  fileName,
  mimeType = '',
  isFolder = false,
  className = 'w-5 h-5',
}: FileTypeIconProps) {
  if (isFolder) {
    return <Folder className={className} strokeWidth={1.75} />;
  }

  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mime = mimeType.toLowerCase();

  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'heic', 'avif'].includes(ext)) {
    return <FileImage className={className} strokeWidth={1.75} />;
  }
  if (mime.startsWith('video/') || ['mp4', 'mkv', 'mov', 'avi', 'webm'].includes(ext)) {
    return <FileVideo className={className} strokeWidth={1.75} />;
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return <FileAudio className={className} strokeWidth={1.75} />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) {
    return <FileArchive className={className} strokeWidth={1.75} />;
  }
  if (['csv', 'xlsx', 'xls', 'ods', 'numbers'].includes(ext)) {
    return <FileSpreadsheet className={className} strokeWidth={1.75} />;
  }
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'dart', 'rs', 'go', 'java', 'kt', 'cpp', 'json', 'html', 'css', 'md'].includes(ext)) {
    return <FileCode2 className={className} strokeWidth={1.75} />;
  }
  if (['pdf', 'doc', 'docx', 'txt', 'rtf'].includes(ext)) {
    return <FileText className={className} strokeWidth={1.75} />;
  }
  return <File className={className} strokeWidth={1.75} />;
}
