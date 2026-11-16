import { useState } from 'react';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'S';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Avatar({ name, src, size = 'md', className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${SIZE_CLASSES[size]} rounded-full object-cover border border-zinc-200 dark:border-zinc-700/80 shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      aria-label={name}
      className={`${SIZE_CLASSES[size]} rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold flex items-center justify-center shrink-0 select-none ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}
