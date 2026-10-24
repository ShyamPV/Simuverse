import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconMenu = (p: IconProps) => <Icon {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Icon>;
export const IconClose = (p: IconProps) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const IconUniverse = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="3.2" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)" /></Icon>
);
export const IconSky = (p: IconProps) => (
  <Icon {...p}><path d="M3 20h18" /><path d="M6 20a6 6 0 0 1 12 0" /><path d="M17 4l.6 1.4L19 6l-1.4.6L17 8l-.6-1.4L15 6l1.4-.6z" /><path d="M8 5h.01M12 3h.01" /></Icon>
);
export const IconExplore = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></Icon>
);
export const IconSettings = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>
);
export const IconPlay = (p: IconProps) => <Icon {...p}><path d="M7 5l12 7-12 7z" fill="currentColor" /></Icon>;
export const IconPause = (p: IconProps) => <Icon {...p}><path d="M8 5v14M16 5v14" strokeWidth={3} /></Icon>;
export const IconSlower = (p: IconProps) => <Icon {...p}><path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" fill="currentColor" /></Icon>;
export const IconFaster = (p: IconProps) => <Icon {...p}><path d="M13 6l7 6-7 6zM4 6l7 6-7 6z" fill="currentColor" /></Icon>;
export const IconNow = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
export const IconHelp = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></Icon>
);
export const IconCamera = (p: IconProps) => (
  <Icon {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Icon>
);
export const IconChevronRight = (p: IconProps) => <Icon {...p}><path d="M9 6l6 6-6 6" /></Icon>;
export const IconPanel = (p: IconProps) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Icon>;
