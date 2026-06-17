import React, { useEffect, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// 🎀 DOCUMENT TOOLBAR  —  MS365-grade formatting ribbon
// ───────────────────────────────────────────────────────────────────────────
// Every tool below is HARDCODED and EXPLICITLY TYPED. There is no generic
// config layer: each button, dropdown and swatch is declared by hand so the
// behaviour is 100% predictable and there are no "mystery" commands.
//
// The ribbon drives the browser's native rich-text engine (execCommand) on
// whichever contentEditable surface inside the document preview currently holds
// the selection — exactly how a Word/Google-Docs toolbar works. The critical
// trick is `onMouseDown + preventDefault` on every control: it stops the button
// from stealing focus, so the user's text selection survives the click and the
// command lands on the right range.
// ═══════════════════════════════════════════════════════════════════════════

// ── Explicit command vocabulary (the only execCommand verbs we ever issue) ──
type ExecCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'subscript'
  | 'superscript'
  | 'justifyLeft'
  | 'justifyCenter'
  | 'justifyRight'
  | 'justifyFull'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'indent'
  | 'outdent'
  | 'undo'
  | 'redo'
  | 'removeFormat';

// A simple click-to-run button. `isToggle` controls whether it lights up to
// reflect the current selection (Bold on, Center on, …).
interface ToolButtonDef {
  command: ExecCommand;
  label: string;     // visible glyph
  title: string;     // tooltip (with shortcut hint)
  isToggle: boolean; // reflect active state via queryCommandState
}

// ── Low-level execution helpers ──────────────────────────────────────────
// styleWithCSS(true) makes the engine emit <span style="…"> instead of legacy
// <font> tags, which round-trips cleanly through the preview's innerHTML save.
const run = (command: string, value?: string): void => {
  try {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
  } catch {
    /* execCommand is best-effort; ignore engine hiccups */
  }
};

// Real point-size support. Native `fontSize` only accepts the legacy buckets
// 1-7, so we apply bucket 7 then rewrite the freshly-created <font> tags to a
// precise px size — the canonical, reliable way to get arbitrary sizes.
const applyFontSize = (px: number): void => {
  document.execCommand('styleWithCSS', false, 'false');
  document.execCommand('fontSize', false, '7');
  const fonts = document.getElementsByTagName('font');
  for (let i = fonts.length - 1; i >= 0; i--) {
    const f = fonts[i] as HTMLElement;
    if (f.getAttribute('size') === '7') {
      f.removeAttribute('size');
      f.style.fontSize = `${px}px`;
    }
  }
};

const applyFontFamily = (family: string): void => run('fontName', family);
const applyForeColor = (color: string): void => run('foreColor', color);
const applyHighlight = (color: string): void => run('hiliteColor', color);

// ── HARDCODED TOOL GROUPS ────────────────────────────────────────────────
const FONT_FAMILIES: readonly string[] = [
  'Times New Roman',
  'Calibri',
  'Arial',
  'Georgia',
  'Cambria',
  'Verdana',
  'Tahoma',
  'Courier New',
];

const FONT_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

const STYLE_TOOLS: readonly ToolButtonDef[] = [
  { command: 'bold', label: 'B', title: 'Bold (Ctrl+B)', isToggle: true },
  { command: 'italic', label: 'I', title: 'Italic (Ctrl+I)', isToggle: true },
  { command: 'underline', label: 'U', title: 'Underline (Ctrl+U)', isToggle: true },
  { command: 'strikeThrough', label: 'S', title: 'Strikethrough', isToggle: true },
  { command: 'subscript', label: 'x₂', title: 'Subscript', isToggle: true },
  { command: 'superscript', label: 'x²', title: 'Superscript', isToggle: true },
];

const ALIGN_TOOLS: readonly ToolButtonDef[] = [
  { command: 'justifyLeft', label: '⬅', title: 'Align left', isToggle: true },
  { command: 'justifyCenter', label: '⬌', title: 'Align center', isToggle: true },
  { command: 'justifyRight', label: '➡', title: 'Align right', isToggle: true },
  { command: 'justifyFull', label: '☰', title: 'Justify', isToggle: true },
];

const LIST_TOOLS: readonly ToolButtonDef[] = [
  { command: 'insertUnorderedList', label: '•', title: 'Bulleted list', isToggle: true },
  { command: 'insertOrderedList', label: '1.', title: 'Numbered list', isToggle: true },
  { command: 'outdent', label: '⇤', title: 'Decrease indent', isToggle: false },
  { command: 'indent', label: '⇥', title: 'Increase indent', isToggle: false },
];

const HISTORY_TOOLS: readonly ToolButtonDef[] = [
  { command: 'undo', label: '↶', title: 'Undo (Ctrl+Z)', isToggle: false },
  { command: 'redo', label: '↷', title: 'Redo (Ctrl+Y)', isToggle: false },
];

// Office-style swatch grid, hardcoded.
const COLOR_SWATCHES: readonly string[] = [
  '#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff',
  '#b91c1c', '#ea580c', '#ca8a04', '#15803d', '#0e7490', '#1d4ed8',
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
  '#7c3aed', '#c026d3', '#db2777', '#4a5d23', '#92400e', '#1e3a8a',
];

const HIGHLIGHT_SWATCHES: readonly string[] = [
  '#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#e9d5ff', 'transparent',
];

// ── Active-state tracking: keep toggles in sync with the live selection ─────
const useActiveFormats = (): Record<string, boolean> => {
  const [active, setActive] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const refresh = () => {
      const next: Record<string, boolean> = {};
      const probe = (cmd: ExecCommand) => {
        try {
          next[cmd] = document.queryCommandState(cmd);
        } catch {
          next[cmd] = false;
        }
      };
      [...STYLE_TOOLS, ...ALIGN_TOOLS, ...LIST_TOOLS]
        .filter((t) => t.isToggle)
        .forEach((t) => probe(t.command));
      setActive(next);
    };

    document.addEventListener('selectionchange', refresh);
    return () => document.removeEventListener('selectionchange', refresh);
  }, []);

  return active;
};

// A tiny popover that closes on any outside mousedown.
const useDismissable = (): [
  boolean,
  React.Dispatch<React.SetStateAction<boolean>>,
  React.RefObject<HTMLDivElement | null>,
] => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return [open, setOpen, ref];
};

// `hold` = run on mousedown WITHOUT losing the editor selection.
const hold = (fn: () => void) => (e: React.MouseEvent) => {
  e.preventDefault();
  fn();
};

export const DocumentToolbar: React.FC = () => {
  const active = useActiveFormats();

  const [fontOpen, setFontOpen, fontRef] = useDismissable();
  const [sizeOpen, setSizeOpen, sizeRef] = useDismissable();
  const [colorOpen, setColorOpen, colorRef] = useDismissable();
  const [hiliteOpen, setHiliteOpen, hiliteRef] = useDismissable();

  const [fontLabel, setFontLabel] = useState<string>('Times New Roman');
  const [sizeLabel, setSizeLabel] = useState<string>('12');
  const [colorLabel, setColorLabel] = useState<string>('#000000');

  const renderButton = (t: ToolButtonDef) => (
    <button
      key={t.command}
      type="button"
      className={`ribbon-btn ${t.isToggle && active[t.command] ? 'active' : ''}`}
      title={t.title}
      onMouseDown={hold(() => run(t.command))}
    >
      {t.label}
    </button>
  );

  return (
    <div className="doc-ribbon">
      {/* FONT FAMILY */}
      <div className="ribbon-group" ref={fontRef}>
        <button
          type="button"
          className="ribbon-select wide"
          title="Font"
          onMouseDown={hold(() => setFontOpen(!fontOpen))}
        >
          <span className="ribbon-select-label">{fontLabel}</span>
          <span className="ribbon-caret">▾</span>
        </button>
        {fontOpen && (
          <div className="ribbon-dropdown">
            {FONT_FAMILIES.map((f) => (
              <button
                key={f}
                type="button"
                className="ribbon-dropdown-item"
                style={{ fontFamily: f }}
                onMouseDown={hold(() => {
                  applyFontFamily(f);
                  setFontLabel(f);
                  setFontOpen(false);
                })}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* FONT SIZE */}
      <div className="ribbon-group" ref={sizeRef}>
        <button
          type="button"
          className="ribbon-select"
          title="Font size"
          onMouseDown={hold(() => setSizeOpen(!sizeOpen))}
        >
          <span className="ribbon-select-label">{sizeLabel}</span>
          <span className="ribbon-caret">▾</span>
        </button>
        {sizeOpen && (
          <div className="ribbon-dropdown narrow">
            {FONT_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className="ribbon-dropdown-item center"
                onMouseDown={hold(() => {
                  applyFontSize(s);
                  setSizeLabel(String(s));
                  setSizeOpen(false);
                })}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="ribbon-divider" />

      {/* TEXT STYLES */}
      <div className="ribbon-group flat">{STYLE_TOOLS.map(renderButton)}</div>

      {/* TEXT COLOR */}
      <div className="ribbon-group" ref={colorRef}>
        <button
          type="button"
          className="ribbon-btn color-btn"
          title="Font color"
          onMouseDown={hold(() => setColorOpen(!colorOpen))}
        >
          <span className="color-glyph">A</span>
          <span className="color-bar" style={{ background: colorLabel }} />
        </button>
        {colorOpen && (
          <div className="ribbon-color-popover">
            <div className="color-grid">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="color-swatch"
                  style={{ background: c }}
                  title={c}
                  onMouseDown={hold(() => {
                    applyForeColor(c);
                    setColorLabel(c);
                    setColorOpen(false);
                  })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* HIGHLIGHT */}
      <div className="ribbon-group" ref={hiliteRef}>
        <button
          type="button"
          className="ribbon-btn color-btn"
          title="Highlight color"
          onMouseDown={hold(() => setHiliteOpen(!hiliteOpen))}
        >
          <span className="color-glyph hilite">✎</span>
        </button>
        {hiliteOpen && (
          <div className="ribbon-color-popover">
            <div className="color-grid hilite-grid">
              {HIGHLIGHT_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="color-swatch"
                  style={{
                    background: c === 'transparent' ? '#ffffff' : c,
                    backgroundImage:
                      c === 'transparent'
                        ? 'linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%)'
                        : 'none',
                  }}
                  title={c === 'transparent' ? 'No color' : c}
                  onMouseDown={hold(() => {
                    applyHighlight(c === 'transparent' ? '#ffffff' : c);
                    setHiliteOpen(false);
                  })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="ribbon-divider" />

      {/* ALIGNMENT */}
      <div className="ribbon-group flat">{ALIGN_TOOLS.map(renderButton)}</div>

      <span className="ribbon-divider" />

      {/* LISTS + INDENT */}
      <div className="ribbon-group flat">{LIST_TOOLS.map(renderButton)}</div>

      <span className="ribbon-divider" />

      {/* CLEAR FORMATTING */}
      <div className="ribbon-group flat">
        <button
          type="button"
          className="ribbon-btn"
          title="Clear all formatting"
          onMouseDown={hold(() => run('removeFormat'))}
        >
          ⌫A
        </button>
      </div>

      <span className="ribbon-divider" />

      {/* HISTORY */}
      <div className="ribbon-group flat">{HISTORY_TOOLS.map(renderButton)}</div>
    </div>
  );
};
