import { useState, useEffect, useMemo, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

import '../../styles/Data_Anaytics_modal.css';
import './styles/Data_Analytics_pdf.css';

import { RESIDENTS_API, DOCUMENTS_API } from '../../../UI/api'; 
import { type Resident, createResidentMap, calculateSexDistribution, calculateAgeDistribution, calculateSpecialCategories } from './Resident_data';
import { type DocRecord, enrichDocuments, calculateMonthlyStats, calculateDailyStats, calculateTypeStats, calculatePurokStats, calculateTopResidents } from './Document_data';
import { fmtDay, fmtMonth } from './Data_Math';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler,
);

// ─── Component Props ──────────────────────────────────────────────────────────
interface PDFExporterProps {
  onClose: () => void;
  initialFilter?: string;
}

// ─── Perfected Chart Configuration for Print ──────────────────────────────────
const MONO = "'IBM Plex Mono', monospace";
const RULE = '#e8ecf0';

const chartOpts = (hideLegend = true) => ({
  maintainAspectRatio: false,
  animation: false as const,
  layout: { padding: { top: 15, right: 15, left: 10, bottom: 10 } }, // Prevents edge clipping
  plugins: {
    legend: {
      display: !hideLegend,
      position: 'bottom' as const,
      labels: { color: '#64748b', font: { size: 9, family: MONO }, boxWidth: 8, padding: 12 },
    },
    tooltip: { enabled: false } 
  },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 8, family: MONO } }, grid: { color: RULE }, border: { color: RULE } },
    y: { ticks: { color: '#94a3b8', font: { size: 8, family: MONO } }, grid: { color: RULE }, border: { color: RULE }, beginAtZero: true },
  },
});

const doughnutOpts = {
  maintainAspectRatio: false,
  animation: false as const,
  cutout: '64%',
  layout: { padding: { top: 10, bottom: 10, left: 0, right: 10 } },
  plugins: {
    legend: {
      display: true, position: 'right' as const,
      labels: { color: '#64748b', font: { size: 8, family: MONO }, boxWidth: 8, padding: 8 }, // Scaled down for perfect PDF fit
    },
    tooltip: { enabled: false }
  },
};

// ─── Strict UI Components ─────────────────────────────────────────────────────
const Section = ({ label }: { label: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '36px 0 16px', width: '100%' }}>
    <span style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}>{label}</span>
    <div style={{ flexGrow: 1, height: '1px', backgroundColor: '#e2e8f0' }} />
  </div>
);

const ChartBlock = ({
  title, sub, strictHeight, meaning, dropdown, children, width
}: {
  title: string; sub?: string; strictHeight?: string; meaning?: string; dropdown?: React.ReactNode; children: React.ReactNode; width?: string;
}) => (
  <div style={{ 
    backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px',
    display: 'flex', flexDirection: 'column', boxSizing: 'border-box', height: '100%', breakInside: 'avoid',
    width: width || '100%' 
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
      <div style={{ flex: 1, paddingRight: '12px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '4px', whiteSpace: 'normal', wordWrap: 'break-word' }}>{title}</div>
        {sub && <div style={{ fontSize: '13px', color: '#94a3b8', margin: 0, whiteSpace: 'normal', wordWrap: 'break-word' }}>{sub}</div>}
      </div>
      {dropdown && <div>{dropdown}</div>}
    </div>
    
    <div style={{ position: 'relative', width: '100%', height: strictHeight || '220px', minHeight: strictHeight || '220px' }}>
      {children}
    </div>

    {meaning && (
      <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px dashed #cbd5e1', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
        <strong style={{ color: '#1e293b' }}>Meaning:</strong> {meaning}
      </div>
    )}
  </div>
);

// ─── Main PDF Component ───────────────────────────────────────────────────────
export default function Data_Analytics_pdf({ onClose, initialFilter = 'All' }: PDFExporterProps) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [allDocs, setAllDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    const fetchOptions = { method: 'GET', credentials: 'include' as RequestCredentials };
    Promise.all([
      fetch(RESIDENTS_API, fetchOptions).then(r => r.ok ? r.json() : []),
      fetch(DOCUMENTS_API, fetchOptions).then(r => r.ok ? r.json() : []),
    ]).then(([res, doc]) => {
        setResidents(Array.isArray(res) ? res : []);
        setAllDocs(Array.isArray(doc) ? doc : []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const E = useMemo(() => {
    const resMap = createResidentMap(residents);
    const enrichedDocs = enrichDocuments(allDocs, resMap);

    const baseTypeStats = calculateTypeStats(enrichedDocs);
    const availableDocTypes = Object.keys(baseTypeStats.typeCounts || {});

    const filteredDocs = initialFilter === 'All' 
        ? enrichedDocs 
        : enrichedDocs.filter((doc: any) => doc.type === initialFilter || doc.document_type === initialFilter || doc.doc_type === initialFilter);

    const monthlyStats = calculateMonthlyStats(filteredDocs);
    const dailyStats = calculateDailyStats(filteredDocs);
    const typeStats = calculateTypeStats(filteredDocs);
    const purokStats = calculatePurokStats(filteredDocs);
    const topResidents = calculateTopResidents(filteredDocs);
    
    const sexDist = calculateSexDistribution(residents);
    const ageDist = calculateAgeDistribution(residents);
    const specialCats = calculateSpecialCategories(residents);

    const suggestions = [];
    if (monthlyStats.mTrend > 0.5) {
        suggestions.push({ title: "Capacity Warning", text: "Document demand is expanding quickly. Consider preparing additional supplies (ink/paper) or adjusting staff schedules for next month." });
    }
    if (purokStats.topPurok) {
        suggestions.push({ title: "Localized Outreach", text: `Purok ${purokStats.topPurok} currently shows the highest request volume. This may be an ideal location for the next barangay assembly or satellite desk.` });
    }
    if (specialCats["Senior Citizen"] && specialCats["Senior Citizen"] > residents.length * 0.15) {
        suggestions.push({ title: "Demographic Shift", text: "A significant portion of your recorded population are Seniors. Consider fast-tracking health or pension-related clearance workflows." });
    }

    return {
      ...monthlyStats, ...dailyStats, ...typeStats, ...purokStats, ...sexDist,
      ages: ageDist, specials: specialCats, topResidents, suggestions, availableDocTypes,
      totalResidents: residents.length, totalDocs: enrichedDocs.length, filteredDocsCount: filteredDocs.length,
    };
  }, [residents, allDocs, initialFilter]);

  const generatePDF = async () => {
    if (!page1Ref.current || !page2Ref.current) return;

    setIsGenerating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));

      const pdf = new jsPDF('p', 'mm', 'a4');
      const a4Width = 210;
     
      const captureOpts = { 
        scale: 2, 
        backgroundColor: '#f8fafc',
        useCORS: true,
        logging: false,
      };

      const canvas1 = await html2canvas(page1Ref.current, captureOpts);
      const imgData1 = canvas1.toDataURL('image/jpeg', 1.0);
      const imgHeight1 = (canvas1.height * a4Width) / canvas1.width;
      pdf.addImage(imgData1, 'JPEG', 0, 0, a4Width, imgHeight1);

      pdf.addPage();
      
      const canvas2 = await html2canvas(page2Ref.current, captureOpts);
      const imgData2 = canvas2.toDataURL('image/jpeg', 1.0);
      const imgHeight2 = (canvas2.height * a4Width) / canvas2.width;
      pdf.addImage(imgData2, 'JPEG', 0, 0, a4Width, imgHeight2);

      const dateStr = new Date().toISOString().split('T')[0];
      const filterName = initialFilter.replace(/\s+/g, '_');
      pdf.save(`Analytics_Report_${filterName}_${dateStr}.pdf`);
    } catch (error) {
      console.error("PDF Generation Failed:", error);
      alert("Failed to generate PDF. Check console.");
    } finally {
      setIsGenerating(false);
    }
  };

  const mUp = E.mTrend >= 0;
  const dUp = E.dTrend >= 0;

  const BLUES = ['#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#60a5fa', '#93c5fd'];
  const TYPE_PAL = ['#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];
  const typeKeys = Object.keys(E.typeCounts || {});

  const purokLabels = Object.keys(E.purokCounts || {});
  const purokData = Object.values(E.purokCounts || {});
  
  const docLabels = typeKeys;
  const docData = typeKeys.map(k => (E.typeCounts as Record<string, number>)[k]);
  
  const sexLabels = ['Male', 'Female'];
  const sexData = [E.male || 0, E.female || 0];

  return (
    <div className="pdf-overlay" onClick={onClose}>
      <div className="pdf-modal" onClick={e => e.stopPropagation()}>
        
        <div className="pdf-header">
          <div>
            <h3 className="pdf-header-title">PDF Export Ready</h3>
            <p className="pdf-header-subtitle">Filter Applied: <strong>{initialFilter}</strong></p>
          </div>
          <div className="pdf-header-controls">
            <button onClick={generatePDF} className="pdf-btn" disabled={loading || isGenerating}>
              {isGenerating ? 'Rendering Multi-Page PDF...' : '↓ Download Exact Dashboard'}
            </button>
            <button onClick={onClose} className="pdf-close-btn">×</button>
          </div>
        </div>

        {loading ? (
            <div className="pdf-loading">Loading visual dashboard components for capture...</div>
        ) : (
          <div className="pdf-preview-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            
            {/* ═════════ PAGE 1 ═════════ */}
            <div ref={page1Ref} className="pdf-print-container" style={{ width: '1050px', height: '1485px', backgroundColor: '#f8fafc', padding: '50px', boxSizing: 'border-box', marginBottom: '20px', overflow: 'hidden' }}>
              
              <div style={{ borderBottom: '3px solid #1e293b', paddingBottom: '20px', marginBottom: '30px' }}>
                <h1 style={{ margin: 0, fontSize: '32px', color: '#0f172a', fontWeight: 800 }}>Barangay Statistical Prediction Report</h1>
                <p style={{ margin: '10px 0 0 0', color: '#475569', fontSize: '14px', lineHeight: 1.6 }}>
                  <strong>Report Filter:</strong> {initialFilter} <br/>
                  <strong>Date Generated:</strong> {new Date().toLocaleDateString('en-PH')} <br/>
                  <strong>Records Included:</strong> {E.filteredDocsCount} documents from {E.totalResidents} residents
                </p>
              </div>

              <Section label="Predictive Forecast" />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', width: '100%' }}>
                <div style={{ width: 'calc(25% - 12px)', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderTop: '4px solid #3b82f6', borderRadius: '12px', padding: '20px', boxSizing: 'border-box' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>Tomorrow's Requests</div>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: '#3b82f6', lineHeight: 1.2 }}>~{E.tomorrowP || 0}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>Daily trend: <span style={{ fontWeight: 600, color: dUp ? '#16a34a' : '#ef4444' }}>{dUp ? '↑' : '↓'} {Math.abs(E.dTrend || 0).toFixed(2)} /day</span></div>
                  <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '16px 0' }} />
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Holt's DES · α=0.45 · 14d series</div>
                </div>

                <div style={{ width: 'calc(25% - 12px)', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderTop: '4px solid #14b8a6', borderRadius: '12px', padding: '20px', boxSizing: 'border-box' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>Most Likely Next Type</div>
                  {/* Fixed text wrapping for long names here */}
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f766e', lineHeight: 1.3, marginBottom: '6px', whiteSpace: 'normal', wordWrap: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {E.predType || 'N/A'}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>Probability: <span style={{ fontWeight: 600, color: '#14b8a6' }}>{E.predTypePct || 0}%</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                    {(E.sortedTypes || []).slice(0, 3).map(([t, w]: any) => {
                      const p = Math.round(w / (E.totalW || 1) * 100);
                      return (
                        <div key={t}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{t}</span>
                            <span style={{ fontWeight: 500 }}>{p}%</span>
                          </div>
                          <div style={{ height: '5px', backgroundColor: '#e2e8f0', borderRadius: '99px' }}><div style={{ height: '100%', backgroundColor: '#14b8a6', borderRadius: '99px', width: `${p}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ width: 'calc(25% - 12px)', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderTop: '4px solid #22c55e', borderRadius: '12px', padding: '20px', boxSizing: 'border-box' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>Next Month Projection</div>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: '#22c55e', lineHeight: 1.2 }}>~{E.mF1 || 0}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>Month +2: <span style={{ fontWeight: 600 }}>~{E.mF2 || 0}</span></div>
                  <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '16px 0' }} />
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Holt's DES · α=0.35 · {(E.mKeys || []).length}-month series</div>
                </div>

                <div style={{ width: 'calc(25% - 12px)', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxSizing: 'border-box' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>Today</div>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: '#1e293b', lineHeight: 1.2 }}>{E.todayCount || 0}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>requests processed</div>
                  <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '16px 0' }} />
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                </div>
              </div>

              <Section label="Strategic Insights & Meaning" />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', width: '100%' }}>
                  <div style={{ width: 'calc(50% - 8px)', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxSizing: 'border-box' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>Recommended Actions</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>Data-Driven recommendations based on live system patterns</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {E.suggestions && E.suggestions.length > 0 ? (
                              E.suggestions.map((s: any, i: number) => (
                                  <div key={i} style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                                      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '13px', marginBottom: '4px' }}>{s.title}</div>
                                      <p style={{ margin: 0, fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>{s.text}</p>
                                  </div>
                              ))
                          ) : (
                              <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '12px', color: '#475569' }}>System status is stable. No immediate strategic changes required.</p>
                              </div>
                          )}
                      </div>
                  </div>

                  <div style={{ width: 'calc(50% - 8px)', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxSizing: 'border-box' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>Understanding the Report</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>How these predictions are calculated</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div>
                              <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block', marginBottom: '4px' }}>Holt's DES (Double Exponential Smoothing):</strong>
                              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>A mathematical model that looks at past data to find a "speed" or trend. It gives more weight to recent data to accurately predict the immediate future.</p>
                          </div>
                          <div>
                              <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block', marginBottom: '4px' }}>Probability % (Exponential Decay):</strong>
                              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>Calculates what document type is most likely to be requested next. It looks at the last 28 days, prioritizing what was requested yesterday over what was requested 3 weeks ago.</p>
                          </div>
                      </div>
                  </div>
              </div>

              <Section label="Trend Analysis" />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', width: '100%' }}>
                <ChartBlock width="calc(60% - 8px)" title="Monthly Volume + Forecast" sub={`Holt's DES · trend=${mUp ? '+' : ''}${Number(E.mTrend || 0).toFixed(2)} Δ/mo · ${(E.mKeys || []).length} months data`} strictHeight="260px" meaning="Tracks the total number of document requests month over month. The dashed green line projects the expected volume for the next two months based on historical momentum.">
                  <Line data={{
                    labels: [...(E.mKeys || []).map(fmtMonth), 'Mo+1', 'Mo+2'],
                    datasets: [
                      { label: 'Volume', data: E.mVals || [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#3b82f6', pointBorderColor: '#fff' },
                      { label: 'Forecast', data: [...Array(Math.max(0, (E.mKeys || []).length - 1)).fill(null), (E.mVals || []).length > 0 ? E.mVals[E.mVals.length - 1] : 0, E.mF1 || 0, E.mF2 || 0], borderColor: '#22c55e', borderDash: [5, 4], borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#22c55e', pointBorderColor: '#fff' },
                    ],
                  }} options={chartOpts(false)} />
                </ChartBlock>

                <ChartBlock width="calc(40% - 8px)" title="Daily Requests (14d) + Tomorrow" sub={`Holt's DES · predicted_tomorrow=~${E.tomorrowP || 0}`} strictHeight="260px" meaning="Shows the daily volume of requests over the last two weeks. The final dashed point represents the statistically expected number of requests for tomorrow.">
                  <Line data={{
                    labels: [...(E.dKeys || []).map(fmtDay), 'Tomorrow'],
                    datasets: [
                      { label: 'Daily', data: E.dVals || [], borderColor: '#14b8a6', backgroundColor: 'rgba(20, 184, 166, 0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#14b8a6', pointBorderColor: '#fff' },
                      { label: 'Predicted', data: [...Array(Math.max(0, (E.dKeys || []).length - 1)).fill(null), (E.dVals || []).length > 0 ? E.dVals[E.dVals.length - 1] : 0, E.tomorrowP || 0], borderColor: '#22c55e', borderDash: [5, 4], borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#22c55e', pointBorderColor: '#fff' },
                    ],
                  }} options={chartOpts(false)} />
                </ChartBlock>
              </div>
            </div>

            {/* ═════════ PAGE 2 ═════════ */}
            <div ref={page2Ref} className="pdf-print-container" style={{ width: '1050px', height: '1485px', backgroundColor: '#f8fafc', padding: '50px', boxSizing: 'border-box', marginBottom: '20px', overflow: 'hidden' }}>
              
              <div style={{ paddingTop: '10px' }}>
                <Section label="Distribution Filtered Reports" />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', width: '100%' }}>
                  <ChartBlock width="calc(33.333% - 11px)" title="Purok Demand" sub="doc → resident_id → purok" strictHeight="200px" meaning="Compares the total volume of requests originating from each Purok. Useful for identifying which local areas require the most administrative attention.">
                    <Bar data={{
                      labels: purokLabels,
                      datasets: [{ label: 'Requests', data: purokData, maxBarThickness: 45, backgroundColor: purokLabels.map((_, i) => BLUES[i % BLUES.length]), borderRadius: 4, borderSkipped: false }],
                    }} options={chartOpts()} />
                  </ChartBlock>

                  <ChartBlock width="calc(33.333% - 11px)" title="Document Types" sub={initialFilter === 'All' ? 'All records mapped' : `Filtered: ${initialFilter}`} strictHeight="200px" meaning="Displays the proportion of each document type requested. Helps identify the most frequently processed clearances or certificates.">
                    <Doughnut data={{
                      labels: docLabels,
                      datasets: [{ data: docData, backgroundColor: TYPE_PAL.slice(0, docLabels.length), borderColor: '#ffffff', borderWidth: 2 }],
                    }} options={doughnutOpts} />
                  </ChartBlock>

                  <ChartBlock width="calc(33.333% - 11px)" title="Sex Distribution" sub="residents_records.sex" strictHeight="200px" meaning="Shows the demographic breakdown of residents by sex, based on the total registered population in the system.">
                    <Doughnut data={{
                      labels: sexLabels,
                      datasets: [{ data: sexData, backgroundColor: ['#3b82f6', '#ec4899'].slice(0, sexLabels.length), borderColor: '#ffffff', borderWidth: 2 }],
                    }} options={doughnutOpts} />
                  </ChartBlock>
                </div>

                <Section label="Demographics" />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', width: '100%' }}>
                  <ChartBlock width="calc(50% - 8px)" title="Age Group Spread" sub="residents_records.dob → computed_age" strictHeight="220px" meaning="Categorizes the registered population into specific age brackets to help visualize the demographic makeup of the barangay.">
                    <Bar data={{
                      labels: Object.keys(E.ages || {}),
                      datasets: [{ label: 'Residents', data: Object.values(E.ages || {}), maxBarThickness: 45, backgroundColor: BLUES.slice(0, 4), borderRadius: 4, borderSkipped: false }],
                    }} options={chartOpts()} />
                  </ChartBlock>

                  <div style={{ width: 'calc(50% - 8px)', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b' }}>Special Categories</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>residents_records → boolean flags</div>
                    </div>
                    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {Object.entries(E.specials || {}).map(([label, count]) => {
                        const c = count as number;
                        const pct = E.totalResidents > 0 ? Math.round((c / E.totalResidents) * 100) : 0;
                        return (
                          <div key={label}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b' }}>{label}</span>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>{c}<span style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8', marginLeft: '6px' }}>{pct}%</span></span>
                            </div>
                            <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '99px' }}>
                              <div style={{ height: '100%', background: '#3b82f6', borderRadius: '99px', width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed #cbd5e1', fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
                      <strong style={{ color: '#1e293b' }}>Meaning:</strong> Highlights vulnerable or specialized groups (e.g., Senior Citizens, PWDs) within the population to guide targeted community programs.
                    </div>
                  </div>
                </div>

                <Section label="Resident ID Activity" />
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', padding: '14px 20px', gap: '16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', alignItems: 'center' }}>
                    <span style={{ width: '40px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>#</span>
                    <span style={{ flex: 1, fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Resident ID</span>
                    <span style={{ width: '140px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Purok</span>
                    <span style={{ width: '160px', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Document Count</span>
                  </div>

                  {(!E.topResidents || E.topResidents.length === 0) ? (
                    <div style={{ padding: '32px 20px', fontSize: '14px', color: '#94a3b8', textAlign: 'center' }}>No linked document records found.</div>
                  ) : E.topResidents.map((r: any, i: number) => (
                    <div key={r.id} style={{ display: 'flex', padding: '14px 20px', gap: '16px', borderBottom: '1px solid #e2e8f0', alignItems: 'center' }}>
                      <span style={{ width: '40px', fontSize: '13px', fontWeight: 500, color: '#94a3b8' }}>{i + 1}</span>
                      <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.id}</span>
                      <span style={{ width: '140px', fontSize: '13px', color: '#64748b' }}>{r.purok}</span>
                      <div style={{ width: '160px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: '#3b82f6', borderRadius: '99px', width: `${Math.round((r.count / (E.topResidents[0]?.count || 1)) * 100)}%` }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', minWidth: '24px', textAlign: 'right' }}>{r.count}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '32px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '20px' }}>
                  <p style={{ margin: 0, fontSize: '14px', color: '#1e3a8a', lineHeight: 1.6, whiteSpace: 'normal', wordWrap: 'break-word' }}>
                    <strong>SUMMARY — </strong>
                    n_doc={E.filteredDocsCount} ({initialFilter === 'All' ? '100%' : 'Filtered'} sourced from Live DB) ·
                    n_res={E.totalResidents} ·
                    monthly_trend=
                    <span style={{ fontWeight: 600, color: mUp ? '#16a34a' : '#ef4444' }}>
                      {mUp ? 'EXPANDING' : 'CONTRACTING'} ({mUp ? '+' : ''}{Number(E.mTrend || 0).toFixed(2)} Δ/mo)
                    </span>
                    {' '}· top_purok={E.topPurok || 'N/A'} ·
                    predicted_tomorrow=~{E.tomorrowP || 0} ·
                    predicted_type=[<strong>{E.predType || 'N/A'}</strong> · {E.predTypePct || 0}%] ·
                    model=Holt_DES
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}