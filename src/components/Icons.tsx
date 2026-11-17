import type { ReactNode } from "react";

function Svg({ size = 16, children, filled = false }: { size?: number; children: ReactNode; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="icon"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const PlayIcon = ({ size }: P) => (
  <Svg size={size} filled>
    <path d="M4.5 2.9v10.2c0 .5.5.8 1 .5l8-5.1c.4-.3.4-.8 0-1.1l-8-5.1c-.5-.2-1 .1-1 .6Z" />
  </Svg>
);

export const PauseIcon = ({ size }: P) => (
  <Svg size={size} filled>
    <rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8" />
    <rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8" />
  </Svg>
);

export const BackIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M7.5 4 3.5 8l4 4M12.5 4l-4 4 4 4" />
  </Svg>
);

export const ForwardIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="m8.5 4 4 4-4 4M3.5 4l4 4-4 4" />
  </Svg>
);

export const PrevLineIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3.5 3v10M12.5 3.5 6.5 8l6 4.5Z" />
  </Svg>
);

export const NextLineIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M12.5 3v10M3.5 3.5 9.5 8l-6 4.5Z" />
  </Svg>
);

export const LoopLineIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M2.5 4.5h9.5a1.5 1.5 0 0 1 1.5 1.5v1M13.5 11.5H4a1.5 1.5 0 0 1-1.5-1.5V9" />
    <path d="M6 7 7.8 8.5 6 10" />
  </Svg>
);

export const CloseIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);

export const PlusIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const MinusIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 8h10" />
  </Svg>
);

export const SearchIcon = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3.3 3.3" />
  </Svg>
);

export const FolderIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M2 4.5c0-.6.4-1 1-1h3l1.4 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1Z" />
  </Svg>
);

export const SaveIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 2.5v7M5 6.8 8 9.8l3-3" />
    <path d="M2.8 10.5v1.7c0 .7.6 1.3 1.3 1.3h7.8c.7 0 1.3-.6 1.3-1.3v-1.7" />
  </Svg>
);

export const ExportIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 10V2.5M5 5.3 8 2.3l3 3" />
    <path d="M4.5 7.5H4c-.7 0-1.2.5-1.2 1.2v3.6c0 .7.5 1.2 1.2 1.2h8c.7 0 1.2-.5 1.2-1.2V8.7c0-.7-.5-1.2-1.2-1.2h-.5" />
  </Svg>
);

export const MemoryIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 3.2c0-.4.3-.7.7-.7h7.6c.4 0 .7.3.7.7v10.1l-4.5-2.4-4.5 2.4Z" />
    <path d="M5.8 5.5h3.4M5.8 7.8h2.2" />
  </Svg>
);

export const FilmIcon = ({ size }: P) => (
  <Svg size={size}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 3v10M11 3v10M2 6h3M2 10h3M11 6h3M11 10h3" />
  </Svg>
);

export const CopyIcon = ({ size }: P) => (
  <Svg size={size}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7" />
  </Svg>
);

export const CheckIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);

export const ArrowDownIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Svg>
);

export const TrashIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.3c0 .4.4.7.8.7h4.2c.4 0 .8-.3.8-.7l.6-8.3" />
  </Svg>
);

export const WarningIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 2.5 14 13H2Z" />
    <path d="M8 6.5v3M8 11.3v.1" />
  </Svg>
);

export const SunIcon = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="8" cy="8" r="2.9" />
    <path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" />
  </Svg>
);

export const MoonIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M13.2 9.9A5.6 5.6 0 0 1 6.1 2.8a5.6 5.6 0 1 0 7.1 7.1Z" />
  </Svg>
);

export const AutoThemeIcon = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 2.4v11.2a5.6 5.6 0 0 0 0-11.2Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const UndoIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" />
  </Svg>
);

export const RedoIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="m10.5 3.5 3 3-3 3" />
    <path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9" />
  </Svg>
);
