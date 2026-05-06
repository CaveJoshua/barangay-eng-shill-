import React from 'react';
import jsPDF from 'jspdf';

// --- CONSTANTS & CALIBRATION ---
const A4_WIDTH = 210;
const A4_HEIGHT = 297;
const MARGIN = { top: 25, right: 25, bottom: 25, left: 25 };
const SAFE_WIDTH = A4_WIDTH - MARGIN.left - MARGIN.right;
const PAGE_BREAK_THRESHOLD = A4_HEIGHT - MARGIN.bottom;

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
  officials?: any[];
  witnesses?: WitnessRecord[];
  [key: string]: any; 
}

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

export interface DocumentSchema {
  compile: (payload: DocumentPayload) => RenderInstruction[];
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. VIRTUAL PAGINATION (Browser Preview)
// ─────────────────────────────────────────────────────────────────────────────
export const calculatePagination = (
  schema: DocumentSchema,
  payload: DocumentPayload,
  onEdit?: (key: string, value: string) => void,
  options?: { protectedEditableKeys?: string[] }
) => {
  // 🎯 Keys in this set keep their TEXT but are forbidden from being edited in the
  // document preview. Used to lock down the Punong Barangay / Kagawad signatures
  // so admins can't accidentally rename them via inline editing.
  const protectedKeys = new Set(options?.protectedEditableKeys || []);
  const isEditable = (key?: string) => !!key && !protectedKeys.has(key);

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
          style={{ position: 'relative', fontFamily: '"Times New Roman", Times, serif' }}
        >
          {/* 🎯 SURGICAL FIX: scoped CSS so underlined placeholders disappear the moment the
              user focuses or types into any editable field (affidavit blanks etc.) */}
          <style>{`
            .virtual-page-content [data-editable="true"] u {
              text-decoration: none;
              border-bottom: 1.2px dashed #aaa;
              padding-bottom: 1px;
              display: inline-block;
              min-width: 30px;
            }
            .virtual-page-content [data-editable="true"]:focus u,
            .virtual-page-content [data-editable="true"]:focus-within u,
            .virtual-page-content [data-editable="true"] u:not(:empty) {
              border-bottom: none !important;
              text-decoration: none !important;
              padding-bottom: 0 !important;
            }
            .virtual-page-content [data-editable="true"]:focus,
            .virtual-page-content [data-editable="true"]:hover {
              outline: 1px dotted #4a90e2;
              outline-offset: 2px;
            }
          `}</style>
          {activeWatermark && (
            <img
              src={activeWatermark}
              alt="watermark"
              style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '60%', opacity: 0.08, zIndex: 0, pointerEvents: 'none' }}
            />
          )}
          <div style={{ position: 'relative', zIndex: 1 }}>{currentPageElements}</div>
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
                <tr key={rIdx}>
                  {row.map((cell: string, cIdx: number) => (
                    <td 
                      key={cIdx} 
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      onBlur={(e) => onEdit && onEdit(`table-${index}-${rIdx}-${cIdx}`, e.currentTarget.innerHTML)}
                      style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'center', height: '8mm', outline: 'none', cursor: 'text' }}
                      dangerouslySetInnerHTML={{ __html: cell || '' }}
                    />
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
        // 🎯 honor the protected-keys denylist: locked keys keep their content but lose
        // contentEditable, the blue highlight, the hover outline, and the text cursor.
        const editable = isEditable(inst.editableKey);
        currentPageElements.push(
          <div 
            key={index} 
            data-editable={editable ? 'true' : undefined}
            style={{ 
              fontSize: `${inst.fontSize}pt`, color: inst.color || '#000000', textAlign: inst.align as any, 
              textIndent: inst.align === 'justify' ? '10mm' : '0', margin: 0, lineHeight: 1.5, 
              fontFamily: '"Times New Roman", Times, serif', display: 'block', outline: 'none',
              cursor: editable ? 'text' : 'default',
              padding: editable ? '2px 4px' : '0',
              borderRadius: '3px',
              backgroundColor: editable ? 'rgba(0, 120, 255, 0.05)' : 'transparent',
              transition: 'background-color 0.2s'
            }} 
            dangerouslySetInnerHTML={{ __html: inst.content || '' }} 
            contentEditable={editable}
            suppressContentEditableWarning={true}
            onBlur={editable ? (e) => {
              if (!onEdit || !inst.editableKey) return;
              let value = e.currentTarget.innerHTML;
              const plainText = stripHTML(value).trim();
              if (plainText.length > 0) {
                value = value.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1');
              }
              onEdit(inst.editableKey, value);
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
      <div key="page-final" className="virtual-page-content" style={{ position: 'relative', fontFamily: '"Times New Roman", Times, serif' }}>
        <style>{`
          .virtual-page-content [data-editable="true"] u {
            text-decoration: none;
            border-bottom: 1.2px dashed #aaa;
            padding-bottom: 1px;
            display: inline-block;
            min-width: 30px;
          }
          .virtual-page-content [data-editable="true"]:focus u,
          .virtual-page-content [data-editable="true"]:focus-within u,
          .virtual-page-content [data-editable="true"] u:not(:empty) {
            border-bottom: none !important;
            text-decoration: none !important;
            padding-bottom: 0 !important;
          }
          .virtual-page-content [data-editable="true"]:focus,
          .virtual-page-content [data-editable="true"]:hover {
            outline: 1px dotted #4a90e2;
            outline-offset: 2px;
          }
        `}</style>
        {activeWatermark && <img src={activeWatermark} alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '60%', opacity: 0.08, zIndex: 0, pointerEvents: 'none' }} />}
        <div style={{ position: 'relative', zIndex: 1 }}>{currentPageElements}</div>
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
  const pdf = new jsPDF('p', 'mm', 'a4');
  const instructions = schema.compile(payload);

  let currentY = MARGIN.top;
  let activeWatermark: string | null = null;

  const applyWatermark = () => {
    if (activeWatermark) {
      pdf.setGState(new (pdf as any).GState({ opacity: 0.08 }));
      pdf.addImage(activeWatermark, 'PNG', 55, 95, 100, 100);
      pdf.setGState(new (pdf as any).GState({ opacity: 1.0 }));
    }
  };

  instructions.forEach((inst) => {
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

    switch (inst.type) {
      case 'image_banner': {
        const bannerHeight = inst.heightInMm || 22;
        try {
          if (inst.leftLogo) pdf.addImage(inst.leftLogo, 'PNG', MARGIN.left, currentY, bannerHeight, bannerHeight);
          if (inst.rightLogo) pdf.addImage(inst.rightLogo, 'PNG', A4_WIDTH - MARGIN.right - bannerHeight, currentY, bannerHeight, bannerHeight);
        } catch (e) {
          console.warn('Could not load logos into PDF.');
        }

        pdf.setFillColor(74, 93, 35);
        const bannerWidth = SAFE_WIDTH - bannerHeight * 2 - 10;
        const bannerX = MARGIN.left + bannerHeight + 5;
        pdf.rect(bannerX, currentY, bannerWidth, bannerHeight, 'F');

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(9);
        pdf.setFont('times', 'normal');
        pdf.text('REPUBLIC OF THE PHILIPPINES', A4_WIDTH / 2, currentY + 6, { align: 'center' });
        pdf.text('CITY OF BAGUIO', A4_WIDTH / 2, currentY + 11, { align: 'center' });
        pdf.setFontSize(13);
        pdf.setFont('times', 'bolditalic');
        pdf.text("ENGINEER'S HILL BARANGAY", A4_WIDTH / 2, currentY + 18, { align: 'center' });
        
        pdf.setTextColor('#000000'); 
        currentY += bannerHeight;
        break;
      }

      case 'logo_text_header': {
        const lSizePDF = inst.logoSize || 22;
        try {
          if (inst.logoSrc) pdf.addImage(inst.logoSrc, 'PNG', MARGIN.left, currentY, lSizePDF, lSizePDF);
        } catch (e) {
          console.warn('Could not load logo for header.');
        }

        const textAreaLeft = MARGIN.left + lSizePDF + 5;
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
          const colX = MARGIN.left + tColFracs.slice(0, hIdx).reduce((sum, f) => sum + f * SAFE_WIDTH, 0);
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
            const colX = MARGIN.left + tColFracs.slice(0, cIdx).reduce((sum, f) => sum + f * SAFE_WIDTH, 0);
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
        const cleanText = stripHTML(inst.content || '');
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

            pdf.text(textToPrint, MARGIN.left, currentY, { align: 'justify', maxWidth: SAFE_WIDTH });
            const pLines = pdf.splitTextToSize(textToPrint, SAFE_WIDTH);
            currentY += pLines.length * (inst.fontSize || 10) * 0.3527 * 1.5;
          } else {
            const textX = inst.align === 'center' ? A4_WIDTH / 2 : inst.align === 'right' ? A4_WIDTH - MARGIN.right : MARGIN.left;
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
          const startX = MARGIN.left + colWidth * cIdx;

          col.lines.forEach(line => {
            const lineAlign = line.align || col.align || 'left';
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
        const boxX = A4_WIDTH - MARGIN.right - boxWidth;
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
        pdf.line(MARGIN.left, currentY, A4_WIDTH - MARGIN.right, currentY);
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
    
    pdf.setTextColor('#000000'); 
  });

  return pdf;
};