import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base(paths: React.ReactNode) {
  return function Icon({ size = 18, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconSettings = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
export const IconHelp = base(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.8" /><path d="M12 17h.01" /></>);
export const IconClose = base(<path d="M6 6l12 12M18 6 6 18" />);
export const IconCheck = base(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconArrowLeft = base(<path d="M19 12H5m6-6-6 6 6 6" />);
export const IconArrowRight = base(<path d="M5 12h14m-6-6 6 6-6 6" />);
export const IconShield = base(<><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>);
export const IconLock = base(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconInfo = base(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconWifi = base(<><path d="M2 8.8a15 15 0 0 1 20 0" /><path d="M5 12.4a10 10 0 0 1 14 0" /><path d="M8.5 15.9a5 5 0 0 1 7 0" /><path d="M12 19.5h.01" /></>);
export const IconHotspot = base(<><circle cx="12" cy="12" r="2" /><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>);
export const IconPhone = base(<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>);
export const IconSlides = base(<><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v3M8.5 20.5h7" /><path d="m10 8.5 4 2-4 2z" /></>);
export const IconTimer = base(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 2.5h5" /></>);
export const IconLaser = base(<><circle cx="12" cy="12" r="3.5" fill="currentColor" /><circle cx="12" cy="12" r="8.5" opacity=".45" /></>);
export const IconCopy = base(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>);
export const IconRefresh = base(<><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v3.5h3.5" /><path d="M4 13a8 8 0 0 0 14.9 3.5M20 20v-3.5h-3.5" /></>);
export const IconTrash = base(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>);
export const IconKeyboard = base(<><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>);
export const IconMonitor = base(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>);
export const IconPlay = base(<path d="M7 5v14l11-7z" />);
export const IconPause = base(<><path d="M8 5v14M16 5v14" /></>);
export const IconAlert = base(<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>);
export const IconNet = base(<><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-2h12v2" /></>);
export const IconGrid = base(<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>);
export const IconList = base(<><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>);
export const IconBolt = base(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />);
export const IconEdit = base(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>);
export const IconPlus = base(<path d="M12 5v14M5 12h14" />);
export const IconPalette = base(<><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.9 17 3 12 3z" /><circle cx="7.5" cy="11" r="1" fill="currentColor" /><circle cx="10" cy="7" r="1" fill="currentColor" /><circle cx="14.5" cy="7" r="1" fill="currentColor" /></>);
export const IconSearch = base(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconStop = base(<><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>);
export const IconFolder = base(<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />);
export const IconDownload = base(<><path d="M12 4v11m-5-5 5 5 5-5" /><path d="M4.5 19.5h15" /></>);
export const IconUpload = base(<><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4.5 19.5h15" /></>);
export const IconPip = base(<><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><rect x="12" y="6.8" width="7" height="4.6" rx="1" fill="currentColor" /></>);
export const IconBroom = base(<><path d="M14 4 10.5 11" /><path d="M7 12h7l2 8H5z" /><path d="M9 16v3M12 16v3" /></>);
export const IconChevron = base(<path d="m9 6 6 6-6 6" />);
export const IconUp = base(<path d="m6 15 6-6 6 6" />);
export const IconDown = base(<path d="m6 9 6 6 6-6" />);
export const IconImage = base(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></>);
export const IconBell = base(<><path d="M6 10a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 16 6 10z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IconGamepad = base(<><path d="M7 8h10a4.5 4.5 0 0 1 4.3 5.8l-1 3.3a2.4 2.4 0 0 1-4 1l-2-2.1h-4.6l-2 2.1a2.4 2.4 0 0 1-4-1l-1-3.3A4.5 4.5 0 0 1 7 8z" /><path d="M7.5 11v3M6 12.5h3" /><path d="M15.5 12h.01M17.5 13.5h.01" /></>);
export const IconExpand = base(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
