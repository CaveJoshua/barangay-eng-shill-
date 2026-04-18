import { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// Re-using your data processing tools so the math matches exactly
import { RESIDENTS_API, DOCUMENTS_API } from '../../../UI/api'; 
import { type Resident, createResidentMap, calculateSexDistribution, calculateAgeDistribution } from './Resident_data';
import { type DocRecord, enrichDocuments, calculateTypeStats, calculatePurokStats, calculateTopResidents } from './Document_data';

// Component Props
interface PDFExporterProps {
  onClose: () => void;
  initialFilter?: string;
}

export default function Data_Analytics_pdf({ onClose, initialFilter = 'All' }: PDFExporterProps) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [allDocs, setAllDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // The filter specific to the PDF exporter
  const [pdfDocType, setPdfDocType] = useState<string>(initialFilter);
  
  const printRef = useRef<HTMLDivElement>(null);

  // ─── Fetch Data (Zero Trust Handshake) ──────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const fetchOptions = {
        method: 'GET',
        credentials: 'include' as RequestCredentials
    };

    Promise.all([
      fetch(RESIDENTS_API, fetchOptions).then(r => r.ok ? r.json() : []),
      fetch(DOCUMENTS_API, fetchOptions).then(r => r.ok ? r.json() : []),
    ])
      .then(([res, doc]) => {
        setResidents(Array.isArray(res) ? res : []);
        setAllDocs(Array.isArray(doc) ? doc : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ─── Process Data for PDF ───────────────────────────────────────────────
  const ReportData = useMemo(() => {
    const resMap = createResidentMap(residents);
    const enrichedDocs = enrichDocuments(allDocs, resMap);

    const baseTypeStats = calculateTypeStats(enrichedDocs);
    const availableDocTypes = Object.keys(baseTypeStats.typeCounts || {});

    // Apply the dropdown filter
    const filteredDocs = pdfDocType === 'All' 
        ? enrichedDocs 
        : enrichedDocs.filter((doc: any) => 
            doc.type === pdfDocType || doc.document_type === pdfDocType || doc.doc_type === pdfDocType
        );

    const typeStats = calculateTypeStats(filteredDocs);
    const purokStats = calculatePurokStats(filteredDocs);
    const topResidents = calculateTopResidents(filteredDocs);
    const sexDist = calculateSexDistribution(residents);
    const ageDist = calculateAgeDistribution(residents);

    return {
      availableDocTypes,
      typeStats,
      purokStats,
      sexDist,
      ageDist,
      topResidents: topResidents.slice(0, 10), // Limit to top 10 for print
      totalFiltered: filteredDocs.length,
      totalResidents: residents.length,
    };
  }, [residents, allDocs, pdfDocType]);

  // ─── PDF Generation Engine ──────────────────────────────────────────────
  const generatePDF = async () => {
    const el = printRef.current;
    if (!el) return;

    setIsGenerating(true);
    try {
      // Create a high-quality canvas from the DOM element
      const canvas = await html2canvas(el, { 
        scale: 2, 
        backgroundColor: '#ffffff', 
        useCORS: true,
        logging: false 
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const a4Width = 210;
      const a4Height = 297;
      const imgHeight = (canvas.height * a4Width) / canvas.width;
      const imgData = canvas.toDataURL('image/jpeg', 1.0);

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'JPEG', 0, position, a4Width, imgHeight);
      heightLeft -= a4Height;

      // Handle multi-page if the report gets too long
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, a4Width, imgHeight);
        heightLeft -= a4Height;
      }

      const dateStr = new Date().toISOString().split('T')[0];
      const filterName = pdfDocType.replace(/\s+/g, '_');
      pdf.save(`Barangay_Report_${filterName}_${dateStr}.pdf`);
    } catch (error) {
      console.error("PDF Generation Failed:", error);
      alert("Failed to generate PDF. Please check console.");
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        
        {/* Modal Header & Controls */}
        <div style={headerStyle}>
          <div>
            <h3 style={{ margin: 0, color: '#0f172a', fontFamily: "'IBM Plex Mono', monospace" }}>
              PDF Export Configuration
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Select the data you want to include in the printed report.
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select 
              value={pdfDocType} 
              onChange={(e) => setPdfDocType(e.target.value)}
              style={selectStyle}
              disabled={loading || isGenerating}
            >
              <option value="All">All Documents</option>
              {ReportData.availableDocTypes?.map((type: string) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <button 
              onClick={generatePDF} 
              style={btnStyle(isGenerating || loading)}
              disabled={loading || isGenerating}
            >
              {isGenerating ? 'Rendering...' : 'Download PDF'}
            </button>
            <button onClick={onClose} style={closeBtnStyle}>×</button>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                Fetching fresh data for export...
            </div>
        )}

        {/* Hidden/Print Area - This is what actually gets exported */}
        {!loading && (
          <div style={printWrapperStyle}>
            <div ref={printRef} style={a4DocumentStyle}>
              {/* Document Header */}
              <div style={{ borderBottom: '2px solid #1e293b', paddingBottom: '20px', marginBottom: '30px' }}>
                <h1 style={{ margin: 0, fontSize: '24px', color: '#0f172a' }}>Barangay Document Analytics</h1>
                <p style={{ margin: '5px 0 0 0', color: '#475569', fontSize: '14px' }}>
                  <strong>Report Filter:</strong> {pdfDocType} <br/>
                  <strong>Date Generated:</strong> {new Date().toLocaleDateString('en-PH')} <br/>
                  <strong>Records Included:</strong> {ReportData.totalFiltered} documents from {ReportData.totalResidents} residents
                </p>
              </div>

              {/* Data Section: Purok Demand */}
              <div style={sectionStyle}>
                <h2 style={sectionTitleStyle}>1. Purok Demand Distribution</h2>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Purok</th>
                      <th style={thStyle}>Document Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(ReportData.purokStats.purokCounts || {}).map(([purok, count]) => (
                      <tr key={purok}>
                        <td style={tdStyle}>{purok}</td>
                        <td style={tdStyle}>{count as number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Data Section: Top Residents */}
              <div style={sectionStyle}>
                <h2 style={sectionTitleStyle}>2. Highest Volume Residents</h2>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Rank</th>
                      <th style={thStyle}>Resident ID</th>
                      <th style={thStyle}>Purok</th>
                      <th style={thStyle}>Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ReportData.topResidents.map((r: any, i: number) => (
                      <tr key={r.id}>
                        <td style={tdStyle}>{i + 1}</td>
                        <td style={tdStyle}>{r.id}</td>
                        <td style={tdStyle}>{r.purok}</td>
                        <td style={tdStyle}>{r.count}</td>
                      </tr>
                    ))}
                    {ReportData.topResidents.length === 0 && (
                      <tr><td colSpan={4} style={{...tdStyle, textAlign: 'center'}}>No records found for this filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Footer */}
              <div style={{ marginTop: '50px', fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>
                Generated by Analytics Engine v4.3 • Internal Use Only
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Inline Styles for the Modal & PDF ────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999, backdropFilter: 'blur(4px)'
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#f8fafc',
  width: '900px', height: '85vh',
  borderRadius: '12px', overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
};

const headerStyle: React.CSSProperties = {
  padding: '20px 24px', backgroundColor: '#ffffff',
  borderBottom: '1px solid #e2e8f0',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
};

const selectStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1',
  backgroundColor: '#f8fafc', color: '#0f172a',
  fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.85rem', cursor: 'pointer'
};

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: '6px', border: 'none',
  backgroundColor: disabled ? '#94a3b8' : '#2563eb', color: '#ffffff',
  fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', transition: '0.2s'
});

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: '24px', color: '#64748b', cursor: 'pointer'
};

// Styles specifically for the A4 Print area
const printWrapperStyle: React.CSSProperties = {
  flexGrow: 1, overflowY: 'auto', padding: '30px',
  backgroundColor: '#cbd5e1', display: 'flex', justifyContent: 'center'
};

const a4DocumentStyle: React.CSSProperties = {
  width: '210mm', minHeight: '297mm', // Standard A4 Dimensions
  backgroundColor: '#ffffff', padding: '20mm',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  fontFamily: "Arial, sans-serif"
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '30px'
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '16px', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '12px'
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '12px'
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px', backgroundColor: '#f1f5f9', color: '#334155', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1'
};

const tdStyle: React.CSSProperties = {
  padding: '10px', borderBottom: '1px solid #e2e8f0', color: '#475569'
};