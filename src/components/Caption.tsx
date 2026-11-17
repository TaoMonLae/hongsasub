import type { CSSProperties } from "react";
import { renderText, type RunStyle } from "../lib/render";
import type { StyleFields } from "../lib/styles";

function runCss(s: RunStyle, scale: number, box: boolean): CSSProperties {
  const border = s.border * scale;
  const depth = s.depth * scale;
  const shadows: string[] = [];
  if (depth > 0) shadows.push(`${depth}px ${depth}px 0 ${s.shadow}`);
  return {
    fontFamily: `"${s.font}", var(--font-mon)`,
    fontSize: `${Math.max(1, s.size * scale)}px`,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textDecoration: [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || "none",
    color: s.primary,
    WebkitTextStroke: !box && border > 0 ? `${border * 2}px ${s.outline}` : undefined,
    paintOrder: "stroke fill",
    textShadow: shadows.join(", ") || undefined,
  };
}

const JUSTIFY: Record<number, CSSProperties> = {
  1: { alignItems: "flex-start", justifyContent: "flex-end", textAlign: "left" },
  2: { alignItems: "center", justifyContent: "flex-end", textAlign: "center" },
  3: { alignItems: "flex-end", justifyContent: "flex-end", textAlign: "right" },
  4: { alignItems: "flex-start", justifyContent: "center", textAlign: "left" },
  5: { alignItems: "center", justifyContent: "center", textAlign: "center" },
  6: { alignItems: "flex-end", justifyContent: "center", textAlign: "right" },
  7: { alignItems: "flex-start", justifyContent: "flex-start", textAlign: "left" },
  8: { alignItems: "center", justifyContent: "flex-start", textAlign: "center" },
  9: { alignItems: "flex-end", justifyContent: "flex-start", textAlign: "right" },
};

interface Props {
  texts: { text: string; fields: StyleFields; dim?: boolean }[];
  scale: number;
}

export function Caption({ texts, scale }: Props) {
  const groups = new Map<number, { text: string; fields: StyleFields; dim?: boolean; align: number; key: number }[]>();
  texts.forEach((t, key) => {
    const align = renderText(t.text, t.fields).align;
    const list = groups.get(align) ?? [];
    list.push({ ...t, align, key });
    groups.set(align, list);
  });
  return (
    <>
      {[...groups.entries()].map(([align, items]) => {
        const f = items[0].fields;
        const pad: CSSProperties = {
          paddingLeft: `${(Number(f.MarginL) || 0) * scale}px`,
          paddingRight: `${(Number(f.MarginR) || 0) * scale}px`,
          paddingTop: `${(Number(f.MarginV) || 0) * scale}px`,
          paddingBottom: `${(Number(f.MarginV) || 0) * scale}px`,
        };
        return (
          <div key={align} className="caption" style={{ ...JUSTIFY[align] ?? JUSTIFY[2], ...pad }}>
            {items.map((item) => {
              const rendered = renderText(item.text, item.fields);
              const box = item.fields.BorderStyle === "3";
              const sx = (Number(item.fields.ScaleX) || 100) / 100;
              const sy = (Number(item.fields.ScaleY) || 100) / 100;
              return (
                <p
                  key={item.key}
                  className={`caption__block${item.dim ? " is-dim" : ""}`}
                  style={{
                    letterSpacing: `${(Number(item.fields.Spacing) || 0) * scale}px`,
                    transform: sx !== 1 || sy !== 1 ? `scale(${sx}, ${sy})` : undefined,
                  }}
                >
                  {rendered.lines.map((line, i) => (
                    <span key={i} className="caption__line" style={box ? { background: rendered.lines[i][0]?.style.outline } : undefined}>
                      {line.length === 0 ? " " : line.map((run, j) => (
                        <span key={j} style={runCss(run.style, scale, box)}>
                          {run.text}
                        </span>
                      ))}
                    </span>
                  ))}
                </p>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
