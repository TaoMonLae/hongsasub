import { useId } from "react";

const HA = "M337 -10Q248 -10 182.5 25.5Q117 61 81.0 125.0Q45 189 45 273Q45 342 63.5 396.5Q82 451 114.5 491.5Q147 532 188 556L262 436Q241 415 226.5 391.0Q212 367 204.5 338.0Q197 309 197 273Q197 225 214.5 188.5Q232 152 263.5 131.0Q295 110 336 110Q378 110 409.5 130.0Q441 150 459.0 187.0Q477 224 477 273Q477 309 470.0 337.0Q463 365 449.0 389.0Q435 413 412 436L487 556Q535 529 567 484Q569 480 571 476Q587 496 612 512Q642 532 683.5 544.0Q725 556 772 556Q859 556 925.0 520.0Q991 484 1027.5 420.0Q1064 356 1064 273Q1064 212 1044.5 160.0Q1025 108 990.0 70.0Q955 32 908.0 11.0Q861 -10 805 -10Q775 -10 750.0 -7.0Q725 -4 704.5 3.5Q684 11 664 22L715 133Q735 126 750.0 121.5Q765 117 789 117Q848 117 880.0 160.5Q912 204 912 273Q912 323 894.0 359.5Q876 396 843.0 416.0Q810 436 765 436Q727 436 698.0 421.5Q669 407 649 383Q634 364 623 342Q629 308 629 273Q629 189 593.5 125.0Q558 61 492.5 25.5Q427 -10 337 -10Z";

function Tile({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3c3c41" />
          <stop offset="1" stopColor="#1e1e21" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="185" fill={`url(#${id})`} />
      <rect x="104" y="104" width="816" height="816" rx="181" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="6" />
    </>
  );
}

export function HongsaMark({ size = 22 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden className="mark">
      <Tile id={id} />
      <path d={HA} fill="#f2f2f4" transform="translate(512 560) scale(0.52 -0.52) translate(-555 -273)" />
      <rect x="330" y="726" width="364" height="56" rx="28" fill="#0a84ff" />
    </svg>
  );
}

export function HongsaIcon({ size = 72 }: { size?: number }) {
  const id = useId();
  const line = { stroke: "#f2f2f4", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden className="mark">
      <Tile id={id} />
      <path
        fill="#f2f2f4"
        d="M300 596 C 300 540, 384 504, 480 504 L 596 504 C 676 504, 724 548, 724 596 C 724 622, 706 640, 680 640 L 344 640 C 318 640, 300 622, 300 596 Z"
      />
      <path {...line} strokeWidth="60" d="M640 540 C 704 488, 664 432, 644 394 C 626 360, 642 326, 676 324" />
      <circle cx="680" cy="330" r="42" fill="#f2f2f4" />
      <path fill="#f2f2f4" d="M704 312 L 800 342 L 708 356 Z" />
      <circle cx="684" cy="322" r="9" fill="#232326" />
      <path {...line} strokeWidth="40" d="M336 560 C 280 548, 248 492, 266 444 C 280 404, 326 402, 334 436" />
      <path {...line} strokeWidth="22" d="M652 300 C 628 272, 600 266, 576 276" />
      <rect x="352" y="720" width="300" height="56" rx="28" fill="#0a84ff" />
    </svg>
  );
}
