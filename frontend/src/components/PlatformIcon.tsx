/** Platform icons — kept as custom inline SVGs for consistent visual weight.
 *  (Lucide's Windows/macOS equivalents are either generic or trademark-avoided.)
 */

import type { Platform } from '@/types/api';

interface SvgProps {
  size?: number;
  className?: string;
}

function BaseIcon({
  size = 14,
  className,
  children,
}: SvgProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const WindowsIcon = (p: SvgProps) => (
  <BaseIcon {...p}>
    <path d="M3 5.5 11 4v7H3V5.5z" />
    <path d="M3 13h8v7l-8-1.5V13z" />
    <path d="M12 3.8 21 2.5V11h-9V3.8z" />
    <path d="M12 13h9v8.5l-9-1.3V13z" />
  </BaseIcon>
);

export const AppleIcon = (p: SvgProps) => (
  <BaseIcon {...p}>
    <path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" />
    <path d="M10 2c1 .5 2 2 2 5" />
  </BaseIcon>
);

export const TerminalIcon = (p: SvgProps) => (
  <BaseIcon {...p}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </BaseIcon>
);

export const SmartphoneIcon = (p: SvgProps) => (
  <BaseIcon {...p}>
    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
    <path d="M12 18h.01" />
  </BaseIcon>
);

interface PlatformIconProps {
  platform: Platform;
  size?: number;
}

export function PlatformIcon({ platform, size = 14 }: PlatformIconProps) {
  const Ic =
    platform === 'Windows'
      ? WindowsIcon
      : platform === 'macOS'
        ? AppleIcon
        : platform === 'Linux'
          ? TerminalIcon
          : SmartphoneIcon;
  return (
    <span className="rd-platform" title={platform}>
      <Ic size={size} />
      <span>{platform}</span>
    </span>
  );
}
