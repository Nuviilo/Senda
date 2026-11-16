import { Globe, Laptop, Monitor, Smartphone, Tablet } from 'lucide-react';

interface DeviceIconProps {
  os: string;
  deviceType: string;
  className?: string;
}

export function DeviceIcon({ os, deviceType, className = 'w-5 h-5' }: DeviceIconProps) {
  const lowerOs = os.toLowerCase();
  if (deviceType === 'mobile' || lowerOs.includes('android') || lowerOs.includes('ios')) {
    return <Smartphone className={className} strokeWidth={1.75} />;
  }
  if (deviceType === 'tablet' || lowerOs.includes('ipad')) {
    return <Tablet className={className} strokeWidth={1.75} />;
  }
  if (lowerOs.includes('mac') || lowerOs.includes('linux')) {
    return <Laptop className={className} strokeWidth={1.75} />;
  }
  if (deviceType === 'web') {
    return <Globe className={className} strokeWidth={1.75} />;
  }
  return <Monitor className={className} strokeWidth={1.75} />;
}
