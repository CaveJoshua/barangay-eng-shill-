import React from 'react';
import jsPDF from 'jspdf';
import { DraggableBlock, type BlockOffset } from './DraggableBlock';

// Row add / remove icons (user-supplied assets in ./icons)
import plusIcon from './icons/Plus_icon.png';
import minusIcon from './icons/Minus_icon.png';

// Per-block drag displacement map, keyed by the block's render key (mm offsets).
export type LayoutOverrides = Record<string, BlockOffset>;

// --- CONSTANTS & CALIBRATION ---
const A4_WIDTH = 210;
// 🎯 DEFAULT page height — schemas can override via `pageHeight` (e.g. JobseekerSchema
// uses an extended 330mm so the Oath of Undertaking fits without spilling onto a 3rd page).
const DEFAULT_PAGE_HEIGHT = 297;
const MARGIN = { top: 25, right: 25, bottom: 25, left: 25 };
const SAFE_WIDTH = A4_WIDTH - MARGIN.left - MARGIN.right;

// --- INTERFACES ---
export interface WitnessRecord {
  name: string;
  address: string;
  contactNo: string;
}

export interface DocumentPayload {
  residentName: string;
  address: string;
  type: string;
  purpose: string;
  dateIssued: string;
  ctcNo: string;
  orNo: string;
  feesPaid: string;
  certificateNo: string;
  captainName: string;
  kagawadName?: string;
  // ✍️ e-signature on file for each signer, if any — Cloudinary URL. Left
  // undefined when the official hasn't uploaded one, which schemas treat as
  // "leave the reserved space blank" (no visual regression either way).
  captainSignatureUrl?: string;
  kagawadSignatureUrl?: string;
  officials?: any[];
  witnesses?: WitnessRecord[];
  [key: string]: any;
}

// Formats a YYYY-MM-DD payment date as "Month/DD/YYYY" (e.g. "June/09/2026")
// for the Documentary Stamp Tax box. Parses the parts manually to avoid the
// timezone shift you get from `new Date('2026-06-09')`.
export const formatPaymentDate = (iso?: string): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = months[parseInt(m[2], 10) - 1];
  return monthName ? `${monthName}/${m[3]}/${m[1]}` : null;
};

export interface RenderInstruction {
  type:
    | 'text' | 'title' | 'line' | 'spacer' | 'page_break'
    | 'image_banner' | 'columns' | 'stamp_box' | 'watermark'
    | 'logo_text_header' | 'table' | 'dynamic_witnesses';
    
  color?: string; 
  content?: string;
  fontSize?: number;
  isBold?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  heightInMm?: number;
  alignOffset?: number; 
  editableKey?: string; 

  columns?: Array<{
    align: 'left' | 'center' | 'right';
    lines: Array<{
      color?: string;
      content: string;
      isBold?: boolean;
      fontSize?: number;
      alignOffset?: number;
      align?: 'left' | 'center' | 'right';
      editableKey?: string;
      // ✍️ When set, this line renders as a signature image instead of text —
      // `content` is ignored. Lets multiple signers stack in one column (e.g. a
      // Punong Barangay signature above a Kagawad signature). Falls back to
      // ordinary blank/text lines wherever no signature is on file.
      image?: string;
      imageHeightMm?: number;
    }>;
  }>;

  orNo?: string;
  date?: string;
  leftLogo?: string;
  rightLogo?: string;
  imageSrc?: string;
  logoSrc?: string;
  logoSize?: number; 
  headerLines?: Array<{
    content: string;
    fontSize?: number;
    isBold?: boolean;
    isItalic?: boolean;
  }>;
  tableHeaders?: string[];
  tableRows?: string[][];
  columnWidths?: number[]; 
}

// ── 🧩 SELF-DESCRIBING SCHEMA METADATA ───────────────────────────────────────
// Each document declares its OWN inputs (which sidebar sections it needs), its
// OWN behaviour (surface editing on/off), and its OWN identity (label/fee). The
// engine stays generic and stable; nothing about one document is hardcoded into
// shared code, so a change to one format can never leak into another.
export type SidebarSection = 'certificate' | 'payment' | 'guardian' | 'witnesses' | 'table';

export interface SchemaMeta {
  /** Canonical type id — must match the value stored on the request / used to route. */
  id: string;
  /** Human label shown in the document picker. */
  label: string;
  /** Default fee for this document (single source of truth — no global fee map). */
  fee: string;
  /** Which optional sidebar sections this document exposes (input isolation). */
  fields: SidebarSection[];
  /** Whether the body text of this document can be edited directly on the page. */
  surfaceEdit?: boolean;
}

export interface DocumentSchema {
  /** Self-describing identity + input/behaviour contract for THIS document only. */
  meta?: SchemaMeta;
  compile: (payload: DocumentPayload) => RenderInstruction[];
  // 🎯 Optional per-schema page-size overrides. When omitted, the default A4
  // (210 × 297 mm) is used. The Jobseeker schema sets a slightly extended
  // height so the Oath of Undertaking page fits on a single sheet.
  pageHeight?: number;
  pageWidth?: number;
}

// Safely converts surface edits (HTML) into clean PDF text
const stripHTML = (html: string) => {
  if (!html) return '';
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')              
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')    
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')        
    .replace(/<[^>]*>?/gm, '')                  
    .replace(/&nbsp;/g, ' ')                    
    .replace(/&amp;/g, '&');                    
  
  return text.replace(/\n{3,}/g, '\n\n').trim();
};

// 🖊️ One canonical key for a surface-editable block, used IDENTICALLY by the
// preview renderer and the PDF compiler so an edit shows up in both. Respects a
// schema-provided editableKey; otherwise derives a stable key from the document
// type + the instruction's position (namespaced by type to avoid cross-type bleed).
export const surfaceKeyFor = (
  inst: RenderInstruction,
  index: number,
  docType?: string
): string => inst.editableKey || `surface::${docType || 'doc'}::${index}`;

// 🎯 ONE canonical copy of the per-page scoped CSS, shared by every rendered page.
// Previously this was duplicated inline in two <style> blocks that silently drifted
// apart — the final-page copy lost the `tr:hover .table-row-controls` rule, so on
// single-page documents the +/- row icons never revealed. Defining it once fixes
// that and prevents the two from diverging again.
const PAGE_SCOPED_CSS = `
  /* An EMPTY <u> in an editable block reads as a fill-in-the-blank (dashed line). */
  .virtual-page-content [data-editable="true"] u {
    text-decoration: none;
    border-bottom: 1.2px dashed #aaa;
    padding-bottom: 1px;
    display: inline-block;
    min-width: 30px;
  }
  /* Once it has content, drop the dashed placeholder but KEEP the real underline
     (so underlined names/addresses/dates stay underlined when blocks are editable). */
  .virtual-page-content [data-editable="true"] u:not(:empty) {
    border-bottom: none !important;
    text-decoration: underline !important;
    padding-bottom: 0 !important;
    min-width: 0 !important;
    /* Flow inline (not inline-block) so a filled underline sits in the sentence
       like normal text — no atomic gaps stretched open by justified alignment. */
    display: inline !important;
  }
  /* While actively editing, hide the dashed line on still-empty blanks. */
  .virtual-page-content [data-editable="true"]:focus u:empty,
  .virtual-page-content [data-editable="true"]:focus-within u:empty {
    border-bottom: none !important;
  }
  .virtual-page-content [data-editable="true"]:hover {
    outline: 1px dotted #4a90e2;
    outline-offset: 2px;
  }
  .virtual-page-content [data-editable="true"]:focus {
    outline: 1px solid #4a90e2;
    outline-offset: 2px;
    background-color: rgba(74, 144, 226, 0.06);
  }
  /* +/- row controls: revealed on row hover. */
  .virtual-page-content tr:hover .table-row-controls {
    opacity: 1 !important;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. VIRTUAL PAGINATION (Browser Preview)
// ─────────────────────────────────────────────────────────────────────────────
export const calculatePagination = (
  schema: DocumentSchema,
  payload: DocumentPayload,
  onEdit?: (key: string, value: string) => void,
  options?: {
    protectedEditableKeys?: string[];
    // 🧲 Free-drag layer: when moveMode is on, every top-level block is wrapped in
    // a DraggableBlock so it can be repositioned anywhere on the sheet. The mm
    // displacements live in `layout` (keyed by render key) and `onMove` commits them.
    moveMode?: boolean;
    zoom?: number;
    layout?: LayoutOverrides;
    onMove?: (key: string, dx: number, dy: number) => void;
    // 🖊️ Per-document switch: only documents that opt in get editable body text.
    surfaceEdit?: boolean;
  }
) => {
  // 🎯 Keys in this set keep their TEXT but are forbidden from being edited in the
  // document preview. Used to lock down the Punong Barangay / Kagawad signatures
  // so admins can't accidentally rename them via inline editing.
  const protectedKeys = new Set(options?.protectedEditableKeys || []);
  const isEditable = (key?: string) => !!key && !protectedKeys.has(key);

  // 🧲 Drag layer config + the wrapper that makes each block free-movable.
  const layout: LayoutOverrides = options?.layout || {};
  const moveMode = !!options?.moveMode;
  const zoom = options?.zoom || 100;
  const onMove = options?.onMove;

  const wrapBlocks = (els: React.ReactNode[]): React.ReactNode[] =>
    els.map((el, i) => {
      const child = el as React.ReactElement;
      const k = child && child.key != null ? String(child.key) : `blk-${i}`;
      return (
        <DraggableBlock
          key={k}
          blockKey={k}
          offset={layout[k]}
          zoom={zoom}
          moveMode={moveMode}
          onCommit={onMove}
        >
          {el}
        </DraggableBlock>
      );
    });

  // 🎯 Per-schema page sizing: each schema can declare its own pageHeight/pageWidth
  // to fit content that overflows standard A4. Defaults preserve A4 if unset.
  const PAGE_HEIGHT = schema.pageHeight || DEFAULT_PAGE_HEIGHT;
  const PAGE_WIDTH = schema.pageWidth || A4_WIDTH;
  const PAGE_BREAK_THRESHOLD = PAGE_HEIGHT - MARGIN.bottom;

  const instructions = schema.compile(payload);
  let totalWords = 0;

  const pages: React.ReactNode[] = [];
  let currentPageElements: React.ReactNode[] = [];
  let currentY = MARGIN.top;
  let activeWatermark: string | null = null;

  instructions.forEach((inst, index) => {
    if (inst.content)
      totalWords += stripHTML(inst.content).split(/\s+/).filter(Boolean).length;

    const estimatedHeight =
      inst.heightInMm || (inst.fontSize ? inst.fontSize * 0.3527 * 1.5 : 5);

    if (currentY + estimatedHeight > PAGE_BREAK_THRESHOLD || inst.type === 'page_break') {
      pages.push(
        <div
          key={`page-${pages.length}`}
          className="virtual-page-content"
          style={{
            position: 'relative',
            fontFamily: '"Times New Roman", Times, serif',
            // 🎯 mirror the schema's page sizing on screen so the preview matches the PDF.
            // 📌 FIXED A4: exact height + clipped overflow so the sheet never grows past
            // the page. The centered watermark stays put, and typing can't stretch the
            // page — content that overflows simply paginates onto the next sheet.
            width: `${PAGE_WIDTH}mm`,
            height: `${PAGE_HEIGHT}mm`,
            overflow: 'hidden',
          }}
        >
          {/* 🎯 SURGICAL FIX: scoped CSS so underlined placeholders disappear the moment the
              user focuses or types into any editable field (affidavit blanks etc.) */}
          <style>{PAGE_SCOPED_CSS}</style>
          {activeWatermark && (
            <img
              src={activeWatermark}
              alt="watermark"
              style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '60%', opacity: 0.08, zIndex: 0, pointerEvents: 'none' }}
            />
          )}
          <div style={{ position: 'relative', zIndex: 1 }}>{wrapBlocks(currentPageElements)}</div>
        </div>
      );
      currentPageElements = [];
      currentY = MARGIN.top;
      if (inst.type === 'page_break') return;
    }

    switch (inst.type) {
      case 'watermark':
        activeWatermark = inst.imageSrc || null;
        break;

      case 'image_banner':
        currentPageElements.push(
          <div key={index} style={{ height: `${inst.heightInMm}mm`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4mm', width: '100%' }}>
            <div style={{ width: `${inst.heightInMm}mm`, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {inst.leftLogo && <img src={inst.leftLogo} style={{ height: '100%', objectFit: 'contain' }} alt="" />}
            </div>
            <div style={{ backgroundColor: '#4a5d23', flex: 1, margin: '0 8px', height: '100%', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', borderRadius: '2px' }}>
              <div style={{ fontSize: '8.5pt', fontFamily: '"Times New Roman", Times, serif', letterSpacing: '0.3px' }}>REPUBLIC OF THE PHILIPPINES</div>
              <div style={{ fontSize: '8.5pt', fontFamily: '"Times New Roman", Times, serif', letterSpacing: '0.3px' }}>CITY OF BAGUIO</div>
              <div style={{ fontSize: '13pt', fontWeight: 'bold', fontStyle: 'italic', fontFamily: '"Times New Roman", Times, serif', marginTop: '1px' }}>ENGINEER'S HILL BARANGAY</div>
            </div>
            <div style={{ width: `${inst.heightInMm}mm`, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {inst.rightLogo && <img src={inst.rightLogo} style={{ height: '100%', objectFit: 'contain' }} alt="" />}
            </div>
          </div>
        );
        currentY += estimatedHeight;
        break;

      case 'logo_text_header': {
        const lSize = inst.logoSize || 22;
        // 🎯 SURGICAL FIX: compute the actual rendered text-block height so we
        // can advance currentY correctly and never overlap with the next block.
        const previewLineHs = (inst.headerLines || []).map(
          hl => (hl.fontSize || 10) * 0.3527 * 1.25
        );
        const previewBlockH = previewLineHs.reduce((sum, h) => sum + h, 0);
        const containerH = Math.max(lSize, previewBlockH);

        currentPageElements.push(
          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minHeight: `${containerH}mm`, marginBottom: '2mm' }}>
            <div style={{ flexShrink: 0, width: `${lSize}mm`, height: `${lSize}mm`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {inst.logoSrc && <img src={inst.logoSrc} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />}
            </div>
            <div style={{ flex: 1, textAlign: 'center', position: 'relative', left: `${inst.alignOffset || 0}mm` }}>
              {inst.headerLines?.map((hl, hlIdx) => (
                <div key={hlIdx} style={{ fontSize: `${hl.fontSize || 10}pt`, fontWeight: hl.isBold ? 'bold' : 'normal', fontStyle: hl.isItalic ? 'italic' : 'normal', fontFamily: '"Times New Roman", Times, serif', lineHeight: 1.1 }}>
                  {hl.content}
                </div>
              ))}
            </div>
          </div>
        );
        // 🎯 Advance by the MAX of all relevant heights (prevents overlap with next instruction)
        // Plus 2mm of bottom breathing room so the body doesn't kiss the header.
        currentY += Math.max(lSize, previewBlockH, inst.heightInMm || 0) + 2;
        break;
      }

      case 'table': {
        const headers = inst.tableHeaders || [];
        const baseRows = inst.tableRows || [];
        const dynamicRows = payload.tableRows || [];
        
        // 👇 THE FIX: Mathematically merge user rows with schema rows so it NEVER shrinks.
        const maxRows = Math.max(baseRows.length, dynamicRows.length);
        const numCols = headers.length || 1;
        const rows: string[][] = [];
        
        for (let r = 0; r < maxRows; r++) {
          const newRow: string[] = [];
          for (let c = 0; c < numCols; c++) {
            const bCell = (baseRows[r] && baseRows[r][c]) ? baseRows[r][c] : '';
            const dCell = (dynamicRows[r] && dynamicRows[r][c] !== undefined && dynamicRows[r][c] !== '') 
              ? dynamicRows[r][c] 
              : bCell;
            newRow.push(dCell);
          }
          rows.push(newRow);
        }

        const colFracs = inst.columnWidths || headers.map(() => 1 / numCols);

        currentPageElements.push(
          <table key={index} style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"Times New Roman", Times, serif', fontSize: '10pt', marginBottom: '2mm' }}>
            <thead>
              <tr>
                {headers.map((h: string, hIdx: number) => (
                  <th key={hIdx} style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'center', fontWeight: 'bold', width: `${colFracs[hIdx] * 100}%` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Explicit TypeScript mappings to fix the TS(7006) errors */}
              {rows.map((row: string[], rIdx: number) => (
                <tr key={rIdx} style={{ position: 'relative' }} className="pdf-table-row">
                  {row.map((cell: string, cIdx: number) => (
                    <td 
                      key={cIdx} 
                      style={{ border: '1px solid #000', padding: '0', textAlign: 'center', height: '8mm', position: 'relative' }}
                    >
                      {cIdx === 0 && onEdit && (
                        <div className="table-row-controls" contentEditable={false} style={{
                          position: 'absolute', right: '100%', bottom: '-10px', marginRight: '3px',
                          display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', gap: '4px',
                          opacity: 0, transition: 'opacity 0.2s', zIndex: 10
                        }}>
                          <button onClick={() => onEdit(`table_action-add-${rIdx}`, '')} title="Add row below" style={{ width: '20px', height: '20px', padding: 0, background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={plusIcon} alt="Add row" style={{ width: '20px', height: '20px', objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }} />
                          </button>
                          {rows.length > 1 && (
                            <button onClick={() => onEdit(`table_action-remove-${rIdx}`, '')} title="Remove row" style={{ width: '20px', height: '20px', padding: 0, background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <img src={minusIcon} alt="Remove row" style={{ width: '20px', height: '20px', objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }} />
                            </button>
                          )}
                        </div>
                      )}
                      <div
                        contentEditable={true}
                        suppressContentEditableWarning={true}
                        onBlur={(e) => onEdit && onEdit(`table-${index}-${rIdx}-${cIdx}`, e.currentTarget.innerHTML)}
                        style={{ width: '100%', height: '100%', minHeight: '8mm', outline: 'none', cursor: 'text', padding: '4px 8px', boxSizing: 'border-box' }}
                        dangerouslySetInnerHTML={{ __html: cell || '' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
        currentY += inst.heightInMm || (headers.length + rows.length) * 8;
        break;
      }

      case 'title':
        currentPageElements.push(
          <h1 key={index} style={{ fontSize: `${inst.fontSize}pt`, color: inst.color || '#000000', textAlign: inst.align as any, fontWeight: inst.isBold ? 900 : 'normal', margin: 0, fontFamily: '"Times New Roman", Times, serif' }}>
            {inst.content}
          </h1>
        );
        currentY += estimatedHeight + 5;
        break;

      case 'text': {
        // 🖊️ SURFACE EDITING: every body paragraph is editable AND persistent. If the
        // schema didn't name an editableKey, mint a STABLE one from the doc type +
        // position (`surfaceKeyFor`) so the user's edit survives re-renders and feeds
        // the PDF. Protected keys (signatures) stay locked via isEditable().
        const sKey = surfaceKeyFor(inst, index, payload.type);
        // Editable only when the document opts into surface editing (per-schema).
        const editable = !!options?.surfaceEdit && isEditable(sKey);
        // Show the saved edit if one exists; otherwise the schema's generated text.
        const override = payload[sKey];
        const html = typeof override === 'string' ? override : inst.content || '';
        currentPageElements.push(
          <div
            key={index}
            data-editable={editable ? 'true' : undefined}
            data-surface-key={sKey}
            style={{
              fontSize: `${inst.fontSize}pt`, color: inst.color || '#000000', textAlign: inst.align as any,
              textIndent: inst.align === 'justify' ? '10mm' : '0', margin: 0, lineHeight: 1.5,
              fontFamily: '"Times New Roman", Times, serif', display: 'block', outline: 'none',
              cursor: editable ? 'text' : 'default',
              // No padding/border on editable blocks → identical layout to non-editable,
              // so turning on surface editing never shifts the document. The hover/focus
              // affordance is an `outline` (drawn outside the box, no layout impact).
              padding: '0',
              backgroundColor: 'transparent',
            }}
            dangerouslySetInnerHTML={{ __html: html }}
            contentEditable={editable}
            suppressContentEditableWarning={true}
            onBlur={editable ? (e) => {
              if (!onEdit) return;
              // Save raw innerHTML so toolbar formatting (bold/italic/underline)
              // and the exact wording are preserved verbatim — "the edit stays as is".
              onEdit(sKey, e.currentTarget.innerHTML);
            } : undefined}
          />
        );
        currentY += estimatedHeight;
        break;
      }

      case 'columns':
        currentPageElements.push(
          <div key={index} style={{ display: 'flex', width: '100%', height: `${inst.heightInMm}mm` }}>
            {inst.columns?.map((col, cIdx) => (
              <div key={cIdx} style={{ flex: 1, textAlign: col.align as any, minWidth: 0 }}>
                {col.lines.map((l, lIdx) => {
                  // ✍️ A signature line renders as an image, not editable text.
                  // Same alignOffset nudge as the text lines, so it lines up over
                  // a name that's been shifted sideways (e.g. the +18mm nudge below).
                  if (l.image) {
                    return (
                      <img
                        key={lIdx}
                        src={l.image}
                        alt="signature"
                        style={{
                          height: `${l.imageHeightMm || 16}mm`, width: 'auto',
                          display: 'inline-block', position: 'relative', left: `${l.alignOffset || 0}mm`,
                        }}
                      />
                    );
                  }
                  // 🎯 same denylist filter for column-level editable lines
                  const lineEditable = isEditable(l.editableKey);
                  return (
                  <div key={lIdx}
                    data-editable={lineEditable ? 'true' : undefined}
                    style={{
                    color: l.color || inst.color || '#000000', fontWeight: l.isBold ? 'bold' : 'normal',
                    fontSize: `${l.fontSize || 10}pt`, textAlign: (l.align as any) || 'inherit',
                    fontFamily: '"Times New Roman", Times, serif', position: 'relative', left: `${l.alignOffset || 0}mm`,
                    whiteSpace: 'nowrap', lineHeight: 1.5, display: 'block', outline: 'none',
                    cursor: lineEditable ? 'text' : 'default',
                    padding: lineEditable ? '0 4px' : '0',
                    borderRadius: '2px',
                    backgroundColor: lineEditable ? 'rgba(0, 120, 255, 0.05)' : 'transparent'
                  }}
                  dangerouslySetInnerHTML={{ __html: l.content || '&nbsp;' }}
                  contentEditable={lineEditable}
                  suppressContentEditableWarning={true}
                  onBlur={lineEditable ? (e) => {
                    if (!onEdit || !l.editableKey) return;
                    let value = e.currentTarget.innerHTML;
                    const plainText = stripHTML(value).trim();
                    if (plainText.length > 0) {
                      value = value.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1');
                    }
                    onEdit(l.editableKey, value);
                  } : undefined}
                  />
                  );
                })}
              </div>
            ))}
          </div>
        );
        currentY += estimatedHeight;
        break;

      case 'stamp_box':
        currentPageElements.push(
          <div key={index} style={{ width: '60%', marginLeft: 'auto', border: '1.5px solid #000', padding: '8px 12px', textAlign: 'center', height: `${inst.heightInMm}mm`, boxSizing: 'border-box', fontFamily: '"Times New Roman", Times, serif' }}>
            <div style={{ fontWeight: 'bold', fontSize: '10pt', marginBottom: '8px' }}>{inst.content}</div>
            <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '10pt' }}>
              <div style={{ borderBottom: '1px solid #000', width: '40%', paddingBottom: '2px' }}>{inst.orNo}</div>
              <div style={{ borderBottom: '1px solid #000', width: '40%', paddingBottom: '2px' }}>{inst.date}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '8pt', marginTop: '3px' }}>
              <div style={{ width: '40%', fontWeight: 'bold' }}>GOR Serial Number</div>
              <div style={{ width: '40%', fontWeight: 'bold' }}>Date of Payment</div>
            </div>
          </div>
        );
        currentY += estimatedHeight;
        break;

      case 'line':
        currentPageElements.push(<hr key={index} style={{ border: 'none', borderTop: '1px solid #000', margin: `${inst.heightInMm || 2}mm 0`, width: '100%' }} />);
        currentY += inst.heightInMm || 5;
        break;

      case 'spacer':
        currentPageElements.push(<div key={index} style={{ height: `${inst.heightInMm}mm` }} />);
        currentY += inst.heightInMm || 5;
        break;

      // 🎯 NEW: dynamic witness block driven entirely by payload.witnesses (sidebar input table).
      // Schema usage is one line: `{ type: 'dynamic_witnesses' }` — the engine handles the rest.
      case 'dynamic_witnesses': {
        const wList = payload.witnesses || [];

        // Header line
        currentPageElements.push(
          <div key={`${index}-h`} style={{
            fontWeight: 'normal', fontSize: '11pt', margin: '4mm 0 2mm 0',
            fontFamily: '"Times New Roman", Times, serif',
          }}>
            Witnesses:
          </div>
        );
        currentY += 6;

        // Per-witness rows
        wList.forEach((w: WitnessRecord, wi: number) => {
          const editStyle = {
            display: 'inline-block',
            minWidth: '180px',
            backgroundColor: 'rgba(0, 120, 255, 0.05)',
            padding: '0 4px',
            borderRadius: '2px',
            outline: 'none',
            cursor: 'text',
            border: '1px dotted transparent',
          } as React.CSSProperties;

          currentPageElements.push(
            <div key={`${index}-w${wi}`} style={{
              marginBottom: '3mm',
              fontFamily: '"Times New Roman", Times, serif',
              fontSize: '11pt',
              lineHeight: 1.6,
            }}>
              <div>
                <strong style={{ display: 'inline-block', minWidth: '85px' }}>Name:</strong>
                <span data-editable="true"
                  contentEditable
                  suppressContentEditableWarning
                  style={editStyle}
                  onBlur={(e) => onEdit && onEdit(`witness-${wi}-name`, e.currentTarget.textContent || '')}
                >{w.name || ''}</span>
              </div>
              <div>
                <strong style={{ display: 'inline-block', minWidth: '85px' }}>Address:</strong>
                <span data-editable="true"
                  contentEditable
                  suppressContentEditableWarning
                  style={editStyle}
                  onBlur={(e) => onEdit && onEdit(`witness-${wi}-address`, e.currentTarget.textContent || '')}
                >{w.address || ''}</span>
              </div>
              <div>
                <strong style={{ display: 'inline-block', minWidth: '85px' }}>Contact No:</strong>
                <span data-editable="true"
                  contentEditable
                  suppressContentEditableWarning
                  style={editStyle}
                  onBlur={(e) => onEdit && onEdit(`witness-${wi}-contactNo`, e.currentTarget.textContent || '')}
                >{w.contactNo || ''}</span>
              </div>
            </div>
          );
          currentY += 18; // ~3 lines × ~6mm each + spacing
        });
        break;
      }
    }
  });

  if (currentPageElements.length > 0) {
    pages.push(
      <div key="page-final" className="virtual-page-content" style={{
        position: 'relative',
        fontFamily: '"Times New Roman", Times, serif',
        width: `${PAGE_WIDTH}mm`,
        height: `${PAGE_HEIGHT}mm`,
        overflow: 'hidden',
      }}>
        <style>{PAGE_SCOPED_CSS}</style>
        {activeWatermark && <img src={activeWatermark} alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '60%', opacity: 0.08, zIndex: 0, pointerEvents: 'none' }} />}
        <div style={{ position: 'relative', zIndex: 1 }}>{wrapBlocks(currentPageElements)}</div>
      </div>
    );
  }

  return { pages, totalWords };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. VECTOR PDF COMPILER (Flawless PDF Output)
// ─────────────────────────────────────────────────────────────────────────────
export const generateVectorPDF = async (
  schema: DocumentSchema,
  payload: DocumentPayload
): Promise<jsPDF> => {
  // 🎯 Resolve per-schema page sizing. JobseekerSchema overrides this to ~330mm
  // so the Oath of Undertaking on page 2 doesn't spill onto a 3rd page.
  const PAGE_WIDTH = schema.pageWidth || A4_WIDTH;
  const PAGE_HEIGHT = schema.pageHeight || DEFAULT_PAGE_HEIGHT;
  const PAGE_BREAK_THRESHOLD = PAGE_HEIGHT - MARGIN.bottom;

  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: [PAGE_WIDTH, PAGE_HEIGHT],
  });
  const instructions = schema.compile(payload);

  let currentY = MARGIN.top;
  let activeWatermark: string | null = null;

  // 🧲 Same drag displacements used by the preview, keyed by block index.
  const layout: LayoutOverrides = (payload.layout as LayoutOverrides) || {};

  // ✍️ Preload every signature image referenced by any 'columns' instruction —
  // jsPDF's addImage needs an already-loaded element (not a bare URL), and doing
  // this once upfront keeps the main render loop below fully synchronous. A
  // failed/unreachable image is simply skipped (falls back to blank space),
  // never blocks the rest of the document from generating.
  const signatureImages: Record<string, HTMLImageElement> = {};
  const referencedImageUrls = Array.from(new Set(
    instructions
      .flatMap(inst => inst.columns?.flatMap(col => col.lines.map(l => l.image)) || [])
      .filter((url): url is string => !!url)
  ));
  await Promise.all(referencedImageUrls.map(url => new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { signatureImages[url] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = url;
  })));

  const applyWatermark = () => {
    if (activeWatermark) {
      pdf.setGState(new (pdf as any).GState({ opacity: 0.08 }));
      pdf.addImage(activeWatermark, 'PNG', 55, 95, 100, 100);
      pdf.setGState(new (pdf as any).GState({ opacity: 1.0 }));
    }
  };

  instructions.forEach((inst, index) => {
    if (inst.type === 'watermark') {
      activeWatermark = inst.imageSrc || null;
      applyWatermark();
      return;
    }

    if (inst.type === 'page_break') {
      pdf.addPage();
      currentY = MARGIN.top;
      applyWatermark();
      return;
    }

    pdf.setFont('times', inst.isBold ? 'bold' : 'normal');
    if (inst.fontSize) pdf.setFontSize(inst.fontSize);

    if (inst.color) {
      pdf.setTextColor(inst.color);
    } else {
      pdf.setTextColor('#000000');
    }

    // 🧲 Apply this block's drag displacement. The vertical part shifts the whole
    // block down/up; we undo it after the switch so following blocks keep their
    // natural flow position (mirrors the preview's transform, which reserves space).
    // `dx` is added to each case's x-anchors below for horizontal movement.
    const off = layout[String(index)] || { dx: 0, dy: 0 };
    const dx = off.dx;
    currentY += off.dy;

    switch (inst.type) {
      case 'image_banner': {
        const bannerHeight = inst.heightInMm || 22;
        try {
          if (inst.leftLogo) pdf.addImage(inst.leftLogo, 'PNG', MARGIN.left + dx, currentY, bannerHeight, bannerHeight);
          if (inst.rightLogo) pdf.addImage(inst.rightLogo, 'PNG', A4_WIDTH - MARGIN.right - bannerHeight + dx, currentY, bannerHeight, bannerHeight);
        } catch (e) {
          console.warn('Could not load logos into PDF.');
        }

        pdf.setFillColor(74, 93, 35);
        const bannerWidth = SAFE_WIDTH - bannerHeight * 2 - 10;
        const bannerX = MARGIN.left + bannerHeight + 5 + dx;
        pdf.rect(bannerX, currentY, bannerWidth, bannerHeight, 'F');

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(9);
        pdf.setFont('times', 'normal');
        pdf.text('REPUBLIC OF THE PHILIPPINES', A4_WIDTH / 2 + dx, currentY + 6, { align: 'center' });
        pdf.text('CITY OF BAGUIO', A4_WIDTH / 2 + dx, currentY + 11, { align: 'center' });
        pdf.setFontSize(13);
        pdf.setFont('times', 'bolditalic');
        pdf.text("ENGINEER'S HILL BARANGAY", A4_WIDTH / 2 + dx, currentY + 18, { align: 'center' });
        
        pdf.setTextColor('#000000'); 
        currentY += bannerHeight;
        break;
      }

      case 'logo_text_header': {
        const lSizePDF = inst.logoSize || 22;
        try {
          if (inst.logoSrc) pdf.addImage(inst.logoSrc, 'PNG', MARGIN.left + dx, currentY, lSizePDF, lSizePDF);
        } catch (e) {
          console.warn('Could not load logo for header.');
        }

        const textAreaLeft = MARGIN.left + lSizePDF + 5 + dx;
        const textAreaWidth = SAFE_WIDTH - lSizePDF - 5;
        const textCenterX = (textAreaLeft + textAreaWidth / 2) + (inst.alignOffset || 0);

        // 🎯 SURGICAL FIX: use each line's OWN font size for height (was using only the first line's
        // size × line count, which is wildly wrong when fonts vary). This is what caused the
        // "Email Address ... (FIRST TIME JOBSEEKERS ASSISTANCE ACT)" overlap in the downloaded PDF.
        const headerLines = inst.headerLines || [];
        const lineHeights = headerLines.map(hl => (hl.fontSize || 10) * 0.3527 * 1.25);
        const blockH = lineHeights.reduce((sum, h) => sum + h, 0);

        // If the text block is taller than the logo, anchor at top (don't push first line UP into
        // the previous block via a negative offset). Otherwise vertically center it.
        const verticalPadding = blockH < lSizePDF ? (lSizePDF - blockH) / 2 : 0;
        // First baseline ≈ half a line-height down from the top of the first line
        let lineY = currentY + verticalPadding + (lineHeights[0] || 5) * 0.5;

        headerLines.forEach((hl, idx) => {
          const fontStyle = hl.isBold ? (hl.isItalic ? 'bolditalic' : 'bold') : (hl.isItalic ? 'italic' : 'normal');
          pdf.setFont('times', fontStyle);
          pdf.setFontSize(hl.fontSize || 10);
          pdf.text(hl.content, textCenterX, lineY, { align: 'center' });
          // 🎯 advance using THIS line's height — was using avgLineH which broke variable-size text
          lineY += lineHeights[idx];
        });

        // 🎯 CRITICAL: advance currentY by MAX(logo, textBlock, configuredHeight)
        // to guarantee the next instruction never lands inside the rendered header.
        // Plus 2mm bottom breathing room.
        currentY += Math.max(lSizePDF, blockH, inst.heightInMm || 0) + 2;
        break;
      }

      case 'table': {
        const tHeaders = inst.tableHeaders || [];
        const baseRows = inst.tableRows || [];
        const dynamicRows = payload.tableRows || [];
        
        // Exact same strict merge logic for the printer
        const maxRows = Math.max(baseRows.length, dynamicRows.length);
        const numCols = tHeaders.length || 1;
        const tRows: string[][] = [];
        
        for (let r = 0; r < maxRows; r++) {
          const newRow: string[] = [];
          for (let c = 0; c < numCols; c++) {
            const bCell = (baseRows[r] && baseRows[r][c]) ? baseRows[r][c] : '';
            const dCell = (dynamicRows[r] && dynamicRows[r][c] !== undefined && dynamicRows[r][c] !== '') 
              ? dynamicRows[r][c] 
              : bCell;
            newRow.push(dCell);
          }
          tRows.push(newRow);
        }

        const tColFracs = inst.columnWidths || tHeaders.map(() => 1 / Math.max(tHeaders.length, 1));
        
        pdf.setLineWidth(0.3);
        pdf.setFont('times', 'bold');
        pdf.setFontSize(10);
        tHeaders.forEach((header: string, hIdx: number) => {
          const colX = MARGIN.left + dx + tColFracs.slice(0, hIdx).reduce((sum, f) => sum + f * SAFE_WIDTH, 0);
          const colW = tColFracs[hIdx] * SAFE_WIDTH;
          pdf.rect(colX, currentY, colW, 8);
          pdf.text(header, colX + colW / 2, currentY + 5.5, { align: 'center' });
        });
        currentY += 8;

        pdf.setFont('times', 'normal');
        tRows.forEach((row: string[]) => {
          let maxLines = 1;
          const parsedRow = row.map((cell: string, cIdx: number) => {
            const colW = tColFracs[cIdx] * SAFE_WIDTH;
            const lines = pdf.splitTextToSize(stripHTML(cell || ''), colW - 4);
            if (lines.length > maxLines) maxLines = lines.length;
            return lines;
          });
          
          const rowH = Math.max(8, maxLines * 5); 

          if (currentY + rowH > PAGE_BREAK_THRESHOLD) {
             pdf.addPage();
             currentY = MARGIN.top;
             applyWatermark();
          }

          parsedRow.forEach((lines: string[], cIdx: number) => {
            const colX = MARGIN.left + dx + tColFracs.slice(0, cIdx).reduce((sum, f) => sum + f * SAFE_WIDTH, 0);
            const colW = tColFracs[cIdx] * SAFE_WIDTH;
            pdf.rect(colX, currentY, colW, rowH);
            if (lines.length > 0) {
              pdf.text(lines, colX + colW / 2, currentY + 5, { align: 'center' });
            }
          });
          currentY += rowH;
        });
        break;
      }

      case 'text': {
        // 🖊️ Use the surface edit if the user typed one; else the schema's text.
        const sKey = surfaceKeyFor(inst, index, payload.type);
        const override = payload[sKey];
        const sourceContent = typeof override === 'string' ? override : inst.content || '';
        const cleanText = stripHTML(sourceContent);
        const paragraphs = cleanText.split('\n');

        paragraphs.forEach(paragraph => {
          if (!paragraph.trim()) {
            currentY += (inst.fontSize || 10) * 0.3527 * 1.5;
            return;
          }

          if (inst.align === 'justify') {
            const textToPrint = "      " + paragraph.trim(); 
            
            if (currentY > PAGE_BREAK_THRESHOLD - 10) {
              pdf.addPage();
              currentY = MARGIN.top;
              applyWatermark();
            }

            pdf.text(textToPrint, MARGIN.left + dx, currentY, { align: 'justify', maxWidth: SAFE_WIDTH });
            const pLines = pdf.splitTextToSize(textToPrint, SAFE_WIDTH);
            currentY += pLines.length * (inst.fontSize || 10) * 0.3527 * 1.5;
          } else {
            const textX = (inst.align === 'center' ? A4_WIDTH / 2 : inst.align === 'right' ? A4_WIDTH - MARGIN.right : MARGIN.left) + dx;
            const lines = pdf.splitTextToSize(paragraph, SAFE_WIDTH);
            
            lines.forEach((line: string) => {
              if (currentY > PAGE_BREAK_THRESHOLD) {
                pdf.addPage();
                currentY = MARGIN.top;
                applyWatermark();
              }
              pdf.text(line, textX, currentY, { align: (inst.align as any) || 'left' });
              currentY += (inst.fontSize || 10) * 0.3527 * 1.5;
            });
          }
        });
        break;
      }

      case 'columns': {
        if (!inst.columns) break;
        const colWidth = SAFE_WIDTH / inst.columns.length;
        inst.columns.forEach((col, cIdx) => {
          let colY = currentY;
          const startX = MARGIN.left + dx + colWidth * cIdx;

          col.lines.forEach(line => {
            const lineAlign = line.align || col.align || 'left';

            // ✍️ A signature line draws an image (if it loaded) instead of text,
            // top-left-anchored, aligned the same way the column's text is —
            // including alignOffset, so it lines up over a name that's been
            // nudged sideways (several schemas shift the printed name +18mm).
            if (line.image) {
              const sigImg = signatureImages[line.image];
              const imgH = line.imageHeightMm || 16;
              if (sigImg) {
                const imgW = imgH * (sigImg.naturalWidth / sigImg.naturalHeight);
                let imgX = startX;
                if (lineAlign === 'center') imgX = startX + (colWidth - imgW) / 2;
                if (lineAlign === 'right') imgX = startX + colWidth - imgW;
                imgX += (line.alignOffset || 0);
                try {
                  pdf.addImage(sigImg, 'PNG', imgX, colY, imgW, imgH);
                } catch { /* best-effort — a failed embed just leaves the space blank */ }
              }
              colY += imgH + 2;
              return;
            }

            let alignX = startX;
            if (lineAlign === 'center') alignX = startX + colWidth / 2;
            if (lineAlign === 'right') alignX = startX + colWidth;
            alignX += (line.alignOffset || 0);

            pdf.setFontSize(line.fontSize || 10);
            pdf.setFont('times', line.isBold ? 'bold' : 'normal');

            if (line.content) {
              const cleanText = stripHTML(line.content);
              const textLines = cleanText.split('\n');
              pdf.text(textLines, alignX, colY, { align: lineAlign as any });
              colY += textLines.length * (line.fontSize || 10) * 0.3527 * 1.5;
            } else {
              colY += (line.fontSize || 10) * 0.3527 * 1.5;
            }
          });
        });
        currentY += inst.heightInMm || 20;
        break;
      }

      case 'stamp_box': {
        const boxWidth = 90;
        const boxX = A4_WIDTH - MARGIN.right - boxWidth + dx;
        pdf.setTextColor('#000000');
        pdf.setLineWidth(0.5);
        pdf.rect(boxX, currentY, boxWidth, inst.heightInMm || 25);
        pdf.setFont('times', 'bold');
        pdf.setFontSize(10);
        pdf.text(stripHTML(inst.content || ''), boxX + boxWidth / 2, currentY + 6, { align: 'center' });
        pdf.setFont('times', 'normal');
        pdf.setFontSize(10);
        pdf.text(inst.orNo || '', boxX + 22, currentY + 16, { align: 'center' });
        pdf.line(boxX + 5, currentY + 17, boxX + 40, currentY + 17);
        pdf.setFontSize(8);
        pdf.setFont('times', 'bold');
        pdf.text('GOR Serial Number', boxX + 22, currentY + 21, { align: 'center' });
        pdf.setFont('times', 'normal');
        pdf.setFontSize(10);
        pdf.text(inst.date || '', boxX + 68, currentY + 16, { align: 'center' });
        pdf.line(boxX + 50, currentY + 17, boxX + 85, currentY + 17);
        pdf.setFontSize(8);
        pdf.setFont('times', 'bold');
        pdf.text('Date of Payment', boxX + 68, currentY + 21, { align: 'center' });
        currentY += inst.heightInMm || 25;
        break;
      }

      case 'line':
        pdf.setLineWidth(0.5);
        pdf.setTextColor('#000000');
        pdf.line(MARGIN.left + dx, currentY, A4_WIDTH - MARGIN.right + dx, currentY);
        currentY += inst.heightInMm || 5;
        break;

      case 'spacer':
        currentY += inst.heightInMm || 5;
        break;

      // 🎯 NEW: PDF rendering of the dynamic witness block from payload.witnesses.
      case 'dynamic_witnesses': {
        const wList = payload.witnesses || [];

        // Header
        pdf.setFont('times', 'normal');
        pdf.setFontSize(11);
        pdf.text('Witnesses:', MARGIN.left, currentY + 4);
        currentY += 8;

        const labelW = 28; // mm reserved for "Address:" label column

        wList.forEach((w: WitnessRecord) => {
          // Page-break check before each witness block (~18mm tall)
          if (currentY + 20 > PAGE_BREAK_THRESHOLD) {
            pdf.addPage();
            currentY = MARGIN.top;
            applyWatermark();
          }

          // Name
          pdf.setFont('times', 'bold');
          pdf.text('Name:', MARGIN.left, currentY + 4);
          pdf.setFont('times', 'normal');
          if (w.name) pdf.text(w.name, MARGIN.left + labelW, currentY + 4);
          currentY += 5.5;

          // Address
          pdf.setFont('times', 'bold');
          pdf.text('Address:', MARGIN.left, currentY + 4);
          pdf.setFont('times', 'normal');
          if (w.address) pdf.text(w.address, MARGIN.left + labelW, currentY + 4);
          currentY += 5.5;

          // Contact No
          pdf.setFont('times', 'bold');
          pdf.text('Contact No:', MARGIN.left, currentY + 4);
          pdf.setFont('times', 'normal');
          if (w.contactNo) pdf.text(w.contactNo, MARGIN.left + labelW, currentY + 4);
          currentY += 7; // a touch of breathing room between witnesses
        });
        break;
      }
    }

    // 🧲 Undo the vertical drag shift so the next block resumes at its natural
    // flow position (the moved block kept its reserved space, matching preview).
    currentY -= off.dy;
    pdf.setTextColor('#000000');
  });

  return pdf;
};