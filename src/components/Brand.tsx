function Hongsa({ size }: { size: number }) {
  return <img src="/hongsa.svg" width={size} height={size} alt="" aria-hidden className="mark" draggable={false} />;
}

export function HongsaMark({ size = 22 }: { size?: number }) {
  return <Hongsa size={size} />;
}

export function HongsaIcon({ size = 72 }: { size?: number }) {
  return <Hongsa size={size} />;
}
