import React, { useEffect, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// 🧲 DRAGGABLE BLOCK  —  free x/y repositioning inside the A4 page
// ───────────────────────────────────────────────────────────────────────────
// The document engine lays blocks out in a fixed top-to-bottom flow. This
// wrapper lets a single block be nudged anywhere on the sheet WITHOUT disturbing
// that flow: the displacement is applied as a CSS `transform: translate()`, so
// the block keeps reserving its original space (nothing collapses) while it
// visually moves — exactly the behaviour we mirror in the PDF compiler by adding
// the same millimetre offset to the block's draw coordinates.
//
// Offsets are stored in MILLIMETRES so the same number works in the on-screen
// preview (CSS mm) and in the jsPDF coordinate system (mm). Pointer movement is
// in screen pixels, so we convert: screen px → unscaled css px (÷ zoom) → mm.
// ═══════════════════════════════════════════════════════════════════════════

const PX_PER_MM = 96 / 25.4; // CSS reference pixels per millimetre
const round = (n: number) => Math.round(n * 100) / 100;

export interface BlockOffset {
  dx: number; // millimetres, horizontal
  dy: number; // millimetres, vertical
}

interface DraggableBlockProps {
  blockKey: string;
  offset?: BlockOffset;
  /** Canvas zoom percentage — the whole sheet is scaled by zoom/100. */
  zoom: number;
  /** When false the wrapper is inert (normal text editing); drag only in move mode. */
  moveMode: boolean;
  onCommit?: (key: string, dx: number, dy: number) => void;
  children: React.ReactNode;
}

export const DraggableBlock: React.FC<DraggableBlockProps> = ({
  blockKey,
  offset,
  zoom,
  moveMode,
  onCommit,
  children,
}) => {
  const committedDx = offset?.dx ?? 0;
  const committedDy = offset?.dy ?? 0;

  const [live, setLive] = useState<BlockOffset>({ dx: committedDx, dy: committedDy });
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  // Keep the rendered offset in sync with committed state (e.g. after a Reset)
  // — but never yank the block out from under an in-progress drag.
  useEffect(() => {
    if (!draggingRef.current) setLive({ dx: committedDx, dy: committedDy });
  }, [committedDx, committedDy]);

  const startDrag = (e: React.PointerEvent) => {
    if (!moveMode) return;
    e.preventDefault();
    e.stopPropagation();

    const scale = zoom / 100 || 1;
    const base = { ...live };
    const startX = e.clientX;
    const startY = e.clientY;

    // Defined here so add/removeEventListener share one stable instance.
    const move = (ev: PointerEvent) => {
      const dx = base.dx + (ev.clientX - startX) / scale / PX_PER_MM;
      const dy = base.dy + (ev.clientY - startY) / scale / PX_PER_MM;
      setLive({ dx, dy });
    };
    const up = () => {
      draggingRef.current = false;
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLive((cur) => {
        onCommit?.(blockKey, round(cur.dx), round(cur.dy));
        return cur;
      });
    };

    draggingRef.current = true;
    setDragging(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const moved = live.dx !== 0 || live.dy !== 0;

  return (
    <div
      data-block-key={blockKey}
      className={`drag-block ${moveMode ? 'movable' : ''} ${dragging ? 'dragging' : ''}`}
      onPointerDown={moveMode ? startDrag : undefined}
      style={{
        position: 'relative',
        transform: moved ? `translate(${live.dx}mm, ${live.dy}mm)` : undefined,
        cursor: moveMode ? (dragging ? 'grabbing' : 'grab') : undefined,
        zIndex: dragging ? 50 : undefined,
        userSelect: moveMode ? 'none' : undefined,
        transition: dragging ? 'none' : 'outline-color 0.15s',
      }}
    >
      {/* 📐 Word-style move grip — appears only in move mode, drags the block. */}
      {moveMode && (
        <span
          className="drag-grip"
          title="Move this block"
          contentEditable={false}
          onPointerDown={startDrag}
        >
          ✥
        </span>
      )}
      {children}
    </div>
  );
};
