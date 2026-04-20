import React from 'react';
import jsPDF from 'jspdf';

// --- CONSTANTS & CALIBRATION ---
const A4_WIDTH = 210;
const A4_HEIGHT = 297;
const MARGIN = { top: 25, right: 25, bottom: 25, left: 25 };
const SAFE_WIDTH = A4_WIDTH - MARGIN.left - MARGIN.right;
const PAGE_BREAK_THRESHOLD = A4_HEIGHT - MARGIN.bottom;

// --- INTERFACES ---
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
  [key: string]: any; 
}

export interface RenderInstruction {
  type:
    | 'text' | 'title' | 'line' | 'spacer' | 'page_break'
    | 'image_banner' | 'columns' | 'stamp_box' | 'watermark'
    | 'logo_text_header' | 'table';
    
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
  onEdit?: (key: string, value: string) => void
) => {
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
        currentPageElements.push(
          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minHeight: `${lSize}mm`, marginBottom: '2mm' }}>
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
        currentY += inst.heightInMm || lSize;
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

      case 'text':
        currentPageElements.push(
          <div 
            key={index} 
            style={{ 
              fontSize: `${inst.fontSize}pt`, color: inst.color || '#000000', textAlign: inst.align as any, 
              textIndent: inst.align === 'justify' ? '10mm' : '0', margin: 0, lineHeight: 1.5, 
              fontFamily: '"Times New Roman", Times, serif', display: 'block', outline: 'none',
              cursor: inst.editableKey ? 'text' : 'default',
              padding: inst.editableKey ? '2px 4px' : '0',
              borderRadius: '3px',
              backgroundColor: inst.editableKey ? 'rgba(0, 120, 255, 0.05)' : 'transparent',
              transition: 'background-color 0.2s'
            }} 
            dangerouslySetInnerHTML={{ __html: inst.content || '' }} 
            contentEditable={!!inst.editableKey}
            suppressContentEditableWarning={true}
            onBlur={(e) => onEdit && onEdit(inst.editableKey!, e.currentTarget.innerHTML)}
          />
        );
        currentY += estimatedHeight;
        break;

      case 'columns':
        currentPageElements.push(
          <div key={index} style={{ display: 'flex', width: '100%', height: `${inst.heightInMm}mm` }}>
            {inst.columns?.map((col, cIdx) => (
              <div key={cIdx} style={{ flex: 1, textAlign: col.align as any, minWidth: 0 }}>
                {col.lines.map((l, lIdx) => (
                  <div key={lIdx} style={{ 
                    color: l.color || inst.color || '#000000', fontWeight: l.isBold ? 'bold' : 'normal', 
                    fontSize: `${l.fontSize || 10}pt`, textAlign: (l.align as any) || 'inherit',
                    fontFamily: '"Times New Roman", Times, serif', position: 'relative', left: `${l.alignOffset || 0}mm`,
                    whiteSpace: 'nowrap', lineHeight: 1.5, display: 'block', outline: 'none',
                    cursor: l.editableKey ? 'text' : 'default',
                    padding: l.editableKey ? '0 4px' : '0',
                    borderRadius: '2px',
                    backgroundColor: l.editableKey ? 'rgba(0, 120, 255, 0.05)' : 'transparent'
                  }} 
                  dangerouslySetInnerHTML={{ __html: l.content || '&nbsp;' }} 
                  contentEditable={!!l.editableKey}
                  suppressContentEditableWarning={true}
                  onBlur={(e) => onEdit && onEdit(l.editableKey!, e.currentTarget.innerHTML)}
                  />
                ))}
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
    }
  });

  if (currentPageElements.length > 0) {
    pages.push(
      <div key="page-final" className="virtual-page-content" style={{ position: 'relative', fontFamily: '"Times New Roman", Times, serif' }}>
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

        const lineCount = inst.headerLines?.length || 1;
        const avgLineH = (inst.headerLines?.[0]?.fontSize || 10) * 0.3527 * 1.25; 
        const blockH = lineCount * avgLineH;
        let lineY = currentY + (lSizePDF - blockH) / 2 + (avgLineH / 2);

        inst.headerLines?.forEach((hl) => {
          const fontStyle = hl.isBold ? (hl.isItalic ? 'bolditalic' : 'bold') : (hl.isItalic ? 'italic' : 'normal');
          pdf.setFont('times', fontStyle);
          pdf.setFontSize(hl.fontSize || 10);
          pdf.text(hl.content, textCenterX, lineY, { align: 'center' });
          lineY += (hl.fontSize || 10) * 0.3527 * 1.25;
        });

        currentY += inst.heightInMm || lSizePDF;
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
    }
    
    pdf.setTextColor('#000000'); 
  });

  return pdf;
};