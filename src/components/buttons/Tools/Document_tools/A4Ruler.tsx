import React from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// 📏 A4 RULER  (MS Word / MS365-style horizontal ruler)
// ───────────────────────────────────────────────────────────────────────────
// Renders a centimetre ruler that sits directly above the A4 canvas and stays
// pixel-aligned with it at any zoom level. The page is 210 mm wide with a 25 mm
// print margin on each side (see Documeent_File.css `--a4-padding`), so the
// shaded bands below mark exactly where the typeable area begins and ends —
// just like the grey margin zones on a real Word ruler.
// ═══════════════════════════════════════════════════════════════════════════

const A4_WIDTH_MM = 210;
const MARGIN_MM = 25;
const TOTAL_CM = A4_WIDTH_MM / 10;          // 21 whole centimetres across the sheet
const MARGIN_PCT = (MARGIN_MM / A4_WIDTH_MM) * 100;

interface A4RulerProps {
  /** Current canvas zoom (percentage). The ruler scales 1:1 with the sheet. */
  zoom: number;
}

export const A4Ruler: React.FC<A4RulerProps> = ({ zoom }) => {
  // Mirror the canvas transform: a 210 mm sheet scaled by (zoom/100) renders at
  // exactly (210 * zoom/100) mm of visual width, so declaring the ruler at the
  // same width keeps the two locked together without a CSS transform.
  const widthMm = (A4_WIDTH_MM * zoom) / 100;

  // One explicit tick per centimetre — hardcoded rather than generated on the
  // fly so the layout is trivially predictable.
  const ticks = Array.from({ length: TOTAL_CM + 1 }, (_, cm) => cm);

  return (
    <div className="doc-ruler-track" aria-hidden="true">
      <div className="doc-ruler" style={{ width: `${widthMm}mm` }}>
        {/* Left + right margin shading (the non-printable zones) */}
        <div className="ruler-margin" style={{ left: 0, width: `${MARGIN_PCT}%` }} />
        <div className="ruler-margin" style={{ right: 0, width: `${MARGIN_PCT}%` }} />

        {ticks.map((cm) => {
          const leftPct = (cm / TOTAL_CM) * 100;
          const isEdge = cm === 0 || cm === TOTAL_CM;
          return (
            <div key={cm} className="ruler-tick" style={{ left: `${leftPct}%` }}>
              <span className="ruler-tick-line" />
              {!isEdge && <span className="ruler-tick-num">{cm}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
