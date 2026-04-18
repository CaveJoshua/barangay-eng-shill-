import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

import './styles/Data_Anaytics_modal.css';
import { RESIDENTS_API, DOCUMENTS_API } from '../UI/api'; 
import Data_Analytics_pdf from './Tools/Data_Analytics/Data_Analytics_pdf';

import { fmtDay, fmtMonth } from './Tools/Data_Analytics/Data_Math';
import { type Resident, createResidentMap, calculateSexDistribution, calculateAgeDistribution, calculateSpecialCategories } from './Tools/Data_Analytics/Resident_data';
import { type DocRecord, enrichDocuments, calculateMonthlyStats, calculateDailyStats, calculateTypeStats, calculatePurokStats, calculateTopResidents } from './Tools/Data_Analytics/Document_data';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler,
);

// ─── Component Props ──────────────────────────────────────────────────────────

interface AnalyticsProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Chart Configuration ──────────────────────────────────────────────────────

const MONO = "'IBM Plex Mono', monospace";
const INK = '#0f172a';
const RULE = '#e8ecf0';
const BLUE = '#1641c9';

const chartOpts = (hideLegend = true) => ({
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: !hideLegend,
      position: 'bottom' as const,
      labels: { color: '#64748b', font: { size: 9, family: MONO }, boxWidth: 8, padding: 12 },
    },
    tooltip: {
      backgroundColor: INK, borderColor: BLUE, borderWidth: 1,
      titleColor: '#94a3b8', bodyColor: '#f8fafc',
      titleFont: { family: MONO, size: 9 },
      bodyFont: { family: MONO, size: 10 },
      padding: 8, cornerRadius: 3,
    },
  },
  scales: {
    x: {
      ticks: { color: '#94a3b8', font: { size: 8, family: MONO } },
      grid: { color: RULE }, border: { color: RULE },
    },
    y: {
      ticks: { color: '#94a3b8', font: { size: 8, family: MONO } },
      grid: { color: RULE }, border: { color: RULE },
      beginAtZero: true,
    },
  },
});

const doughnutOpts = {
  maintainAspectRatio: false,
  cutout: '64%',
  plugins: {
    legend: {
      display: true, position: 'right' as const,
      labels: { color: '#64748b', font: { size: 9, family: MONO }, boxWidth: 8, padding: 10 },
    },
    tooltip: {
      backgroundColor: INK, borderColor: BLUE, borderWidth: 1,
      titleColor: '#94a3b8', bodyColor: '#f8fafc',
      titleFont: { family: MONO, size: 9 },
      bodyFont: { family: MONO, size: 10 },
      padding: 8, cornerRadius: 3,
    },
  },
};

// ─── UI Components ────────────────────────────────────────────────────────────

const Section = ({ label }: { label: string }) => (
  <div className="da-section">
    <span className="da-section__label">{label}</span>
    <div className="da-section__line" />
  </div>
);

// UPDATED: Added flex styling so charts dynamically fill vertical whitespace
const ChartBlock = ({
  title, sub, chartClass, meaning, dropdown, children,
}: {
  title: string; sub?: string; chartClass?: string; meaning?: string; dropdown?: React.ReactNode; children: React.ReactNode;
}) => (
  <div className="da-block da-flex-col" style={{ height: '100%' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
      <div>
        <div className="da-chart-title">{title}</div>
        {sub && <div className="da-chart-sub" style={{ margin: 0 }}>{sub}</div>}
      </div>
      {dropdown && <div style={{ width: '100%' }}>{dropdown}</div>}
    </div>
    
    <div 
      className={`da-chart-canvas-wrap ${chartClass || ''}`} 
      style={{ flexGrow: 1, position: 'relative', minHeight: chartClass ? undefined : '180px' }}
    >
      {children}
    </div>

    {meaning && (
      <div className="da-chart-meaning" style={{ marginTop: 'auto', paddingTop: '16px' }}>
        <strong className="da-chart-meaning-label">Meaning:</strong> {meaning}
      </div>
    )}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Data_Analytics({ isOpen, onClose }: AnalyticsProps) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [allDocs, setAllDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Local states for the three specific distribution charts
  const [localPurok, setLocalPurok] = useState<string>('All');
  const [localDocType, setLocalDocType] = useState<string>('All');
  const [localSex, setLocalSex] = useState<string>('All');

  const [showPDF, setShowPDF] = useState(false);
  
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  const E = useMemo(() => {
    const resMap = createResidentMap(residents);
    const enrichedDocs = enrichDocuments(allDocs, resMap);

    const baseTypeStats = calculateTypeStats(enrichedDocs);
    const availableDocTypes = Object.keys(baseTypeStats.typeCounts || {});

    const monthlyStats = calculateMonthlyStats(enrichedDocs);
    const dailyStats = calculateDailyStats(enrichedDocs);
    const typeStats = calculateTypeStats(enrichedDocs);
    const purokStats = calculatePurokStats(enrichedDocs);
    const topResidents = calculateTopResidents(enrichedDocs);
    
    const sexDist = calculateSexDistribution(residents);
    const ageDist = calculateAgeDistribution(residents);
    const specialCats = calculateSpecialCategories(residents);

    const suggestions = [];
    if (monthlyStats.mTrend > 0.5) {
        suggestions.push({ 
            title: "Capacity Warning", 
            text: "Document demand is expanding quickly. Consider preparing additional supplies (ink/paper) or adjusting staff schedules for next month.",
            type: "warning" 
        });
    }
    if (purokStats.topPurok) {
        suggestions.push({ 
            title: "Localized Outreach", 
            text: `Purok ${purokStats.topPurok} currently shows the highest request volume. This may be an ideal location for the next barangay assembly or satellite desk.`,
            type: "info"
        });
    }
    if (specialCats["Senior Citizen"] && specialCats["Senior Citizen"] > residents.length * 0.15) {
        suggestions.push({ 
            title: "Demographic Shift", 
            text: "A significant portion of your recorded population are Seniors. Consider fast-tracking health or pension-related clearance workflows.",
            type: "health"
        });
    }

    return {
      ...monthlyStats,
      ...dailyStats,
      ...typeStats,
      ...purokStats,
      ...sexDist,
      ages: ageDist,
      specials: specialCats,
      topResidents,
      suggestions,
      availableDocTypes,
      totalResidents: residents.length,
      totalDocs: enrichedDocs.length,
    };
  }, [residents, allDocs]);

  if (!isOpen) return null;

  const mUp = E.mTrend >= 0;
  const dUp = E.dTrend >= 0;

  const BLUES = ['#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#60a5fa', '#93c5fd'];
  const TYPE_PAL = ['#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];
  const typeKeys = Object.keys(E.typeCounts || {});

  // ─── Dynamic Data for Filtered Charts ───────────────────────────────────────
  
  // 1. Purok Chart Data
  const purokLabels = localPurok === 'All' ? Object.keys(E.purokCounts || {}) : [localPurok];
  const purokData = localPurok === 'All' 
    ? Object.values(E.purokCounts || {}) 
    : [E.purokCounts?.[localPurok] || 0];

  // 2. Doc Type Chart Data
  const docLabels = localDocType === 'All' ? typeKeys : [localDocType];
  const docData = localDocType === 'All' 
    ? typeKeys.map(k => (E.typeCounts as Record<string, number>)[k]) 
    : [(E.typeCounts as Record<string, number>)?.[localDocType] || 0];

  // 3. Sex Chart Data (UPDATED: Removed "Other")
  const sexMap: Record<string, number> = { 'Male': E.male || 0, 'Female': E.female || 0 };
  const sexLabels = localSex === 'All' ? ['Male', 'Female'] : [localSex];
  const sexData = localSex === 'All' 
    ? [E.male || 0, E.female || 0] 
    : [sexMap[localSex] || 0];

  // ─── Dropdown Components ────────────────────────────────────────────────────
  
  const DropdownPurok = (
    <select className="da-filter-select" style={{ width: '100%', padding: '6px' }} value={localPurok} onChange={(e) => setLocalPurok(e.target.value)}>
      <option value="All">All Puroks</option>
      {[1, 2, 3, 4, 5, 6, 7].map(num => (
        <option key={num} value={`Purok ${num}`}>Purok {num}</option>
      ))}
    </select>
  );

  const DropdownDoc = (
    <select className="da-filter-select" style={{ width: '100%', padding: '6px' }} value={localDocType} onChange={(e) => setLocalDocType(e.target.value)}>
      <option value="All">All Documents</option>
      {E.availableDocTypes?.map((type: string) => (
        <option key={type} value={type}>{type}</option>
      ))}
    </select>
  );

  const DropdownSex = (
    <select className="da-filter-select" style={{ width: '100%', padding: '6px' }} value={localSex} onChange={(e) => setLocalSex(e.target.value)}>
      <option value="All">All Genders</option>
      <option value="Male">Male</option>
      <option value="Female">Female</option>
    </select>
  );

  return (
    <div className="da-overlay" onClick={onClose}>
      <div className="da-sheet" onClick={e => e.stopPropagation()}>

        <div className="da-header">
          <div>
            <div className="da-header__tag">
              <div className="da-header__bar" />
              <span className="da-header__id">Analytics Engine · v4.3</span>
              <div className="da-live-badge">
                <div className="da-live-dot" />
                <span className="da-live-text">LIVE DB</span>
              </div>
            </div>
            <h2 className="da-header__title">Statistical Prediction Report</h2>
            <p className="da-header__meta">
              residents_records ⟶ document_requests · resident_id join ·
              total_records: {E.totalDocs}r · n_res: {E.totalResidents}
            </p>
          </div>
          <div className="da-header-controls">
            <button className="da-btn-pdf" onClick={() => setShowPDF(true)}>
              ↓ Export PDF
            </button>
            <button className="da-btn-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="da-body" ref={reportRef}>

          {loading ? (
            <div className="da-loading">
              <div className="da-spinner" />
              <span className="da-loading__text">FETCHING SECURE DATA...</span>
            </div>
          ) : (<>

            <Section label="Predictive Forecast" />

            <div className="da-grid-4">
              <div className="da-block da-block--blue">
                <div className="da-label">Tomorrow's Requests</div>
                <div className="da-big da-big--blue">~{E.tomorrowP || 0}</div>
                <div className="da-sub">
                  Daily trend:{' '}
                  <span className={`da-trend-text ${dUp ? 'da-trend-up' : 'da-trend-down'}`}>
                    {dUp ? '↑' : '↓'} {Math.abs(E.dTrend || 0).toFixed(2)} /day
                  </span>
                </div>
                <div className="da-rule-thin" />
                <div className="da-basis">Holt's DES · α=0.45 · 14d series</div>
              </div>

              <div className="da-block da-block--teal">
                <div className="da-label">Most Likely Next Type</div>
                <div className="da-pred-type">
                  {E.predType || 'N/A'}
                </div>
                <div className="da-sub">
                  Probability:{' '}
                  <span className="da-pred-pct">
                    {E.predTypePct || 0}%
                  </span>
                </div>
                <div className="da-prob-list">
                  {(E.sortedTypes || []).slice(0, 4).map(([t, w]: any) => {
                    const p = Math.round(w / (E.totalW || 1) * 100);
                    return (
                      <div key={t}>
                        <div className="da-prob-row">
                          <span>{t}</span>
                          <span className="da-prob-val">{p}%</span>
                        </div>
                        <div className="da-prob-track">
                          <div className="da-prob-fill" style={{ width: `${p}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="da-basis da-mt-12">
                  exp-decay · λ=0.025 · 28d half-life
                </div>
              </div>

              <div className="da-block da-block--green">
                <div className="da-label">Next Month Projection</div>
                <div className="da-big da-big--green">~{E.mF1 || 0}</div>
                <div className="da-sub">
                  Month +2: <span className="da-fw-600">~{E.mF2 || 0}</span>
                </div>
                <div className="da-rule-thin" />
                <div className="da-basis">
                  Holt's DES · α=0.35 · {(E.mKeys || []).length}-month series
                </div>
              </div>

              <div className="da-block">
                <div className="da-label">Today</div>
                <div className="da-big">{E.todayCount || 0}</div>
                <div className="da-sub">requests processed</div>
                <div className="da-rule-thin" />
                <div className="da-basis">
                  {new Date().toLocaleDateString('en-PH', {
                    weekday: 'short', month: 'short',
                    day: 'numeric', year: 'numeric',
                  })}
                </div>
              </div>
            </div>

            <Section label="Strategic Insights & Meaning" />
            <div className="da-grid-2">
                <div className="da-block da-block--insight">
                    <div className="da-chart-title">Recommended Actions</div>
                    <div className="da-chart-sub">Data-Driven recommendations based on live system patterns</div>
                    <div className="da-suggestion-list">
                        {E.suggestions && E.suggestions.length > 0 ? (
                            E.suggestions.map((s: any, i: number) => (
                                <div key={i} className="da-suggestion-card">
                                    <div className="da-sug-head">
                                        <i className="fas fa-lightbulb" />
                                        <span>{s.title}</span>
                                    </div>
                                    <p>{s.text}</p>
                                </div>
                            ))
                        ) : (
                            <div className="da-suggestion-card">
                                <p>System status is stable. No immediate strategic changes required based on current data volume.</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="da-block da-block--meaning">
                    <div className="da-chart-title">Understanding the Report</div>
                    <div className="da-chart-sub">How these predictions are calculated</div>
                    <div className="da-meaning-grid">
                        <div className="da-meaning-item">
                            <strong>Holt's DES (Double Exponential Smoothing):</strong>
                            <p>A mathematical model that looks at past data to find a "speed" or trend. It gives more weight to recent data to accurately predict the immediate future.</p>
                        </div>
                        <div className="da-meaning-item">
                            <strong>Probability % (Exponential Decay):</strong>
                            <p>Calculates what document type is most likely to be requested next. It looks at the last 28 days, prioritizing what was requested yesterday over what was requested 3 weeks ago.</p>
                        </div>
                        <div className="da-meaning-item">
                            <strong>Daily Trend (Δ/day):</strong>
                            <p>The average change in requests per day. A positive number (↑) means the volume of requests is actively increasing.</p>
                        </div>
                    </div>
                </div>
            </div>

            <Section label="Trend Analysis" />
            <div className="da-grid-trend">
              <ChartBlock
                title="Monthly Volume + Forecast"
                sub={`Holt's DES · trend=${mUp ? '+' : ''}${Number(E.mTrend || 0).toFixed(2)} Δ/mo · ${(E.mKeys || []).length} months data`}
                chartClass="da-chart-tall"
                meaning="Tracks the total number of document requests month over month. The dashed green line projects the expected volume for the next two months based on historical momentum."
              >
                <Line data={{
                  labels: [...(E.mKeys || []).map(fmtMonth), 'Mo+1', 'Mo+2'],
                  datasets: [
                    {
                      label: 'Volume',
                      data: E.mVals || [],
                      borderColor: '#3b82f6',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      fill: true, tension: 0.4, borderWidth: 2,
                      pointRadius: 3,
                      pointBackgroundColor: '#3b82f6',
                      pointBorderColor: '#fff',
                      pointBorderWidth: 1.5,
                    },
                    {
                      label: 'Forecast',
                      data: [
                        ...Array(Math.max(0, (E.mKeys || []).length - 1)).fill(null),
                        (E.mVals || []).length > 0 ? E.mVals[E.mVals.length - 1] : 0,
                        E.mF1 || 0, E.mF2 || 0,
                      ],
                      borderColor: '#22c55e',
                      borderDash: [5, 4],
                      borderWidth: 2,
                      pointRadius: 4,
                      pointBackgroundColor: '#22c55e',
                      pointBorderColor: '#fff',
                      pointBorderWidth: 1.5,
                    },
                  ],
                }} options={chartOpts(false)} />
              </ChartBlock>

              <ChartBlock
                title="Daily Requests (14d) + Tomorrow"
                sub={`Holt's DES · predicted_tomorrow=~${E.tomorrowP || 0}`}
                chartClass="da-chart-tall"
                meaning="Shows the daily volume of requests over the last two weeks. The final dashed point represents the statistically expected number of requests for tomorrow."
              >
                <Line data={{
                  labels: [...(E.dKeys || []).map(fmtDay), 'Tomorrow'],
                  datasets: [
                    {
                      label: 'Daily',
                      data: E.dVals || [],
                      borderColor: '#14b8a6',
                      backgroundColor: 'rgba(20, 184, 166, 0.08)',
                      fill: true, tension: 0.4, borderWidth: 2,
                      pointRadius: 3,
                      pointBackgroundColor: '#14b8a6',
                      pointBorderColor: '#fff',
                      pointBorderWidth: 1.5,
                    },
                    {
                      label: 'Predicted',
                      data: [
                        ...Array(Math.max(0, (E.dKeys || []).length - 1)).fill(null),
                        (E.dVals || []).length > 0 ? E.dVals[E.dVals.length - 1] : 0,
                        E.tomorrowP || 0,
                      ],
                      borderColor: '#22c55e',
                      borderDash: [5, 4],
                      borderWidth: 2,
                      pointRadius: 4,
                      pointBackgroundColor: '#22c55e',
                      pointBorderColor: '#fff',
                      pointBorderWidth: 1.5,
                    },
                  ],
                }} options={chartOpts(false)} />
              </ChartBlock>
            </div>

            <Section label="Distribution Filtered Reports" />
            <div className="da-grid-3">
              <ChartBlock
                title="Purok Demand"
                sub="doc → resident_id → purok"
                chartClass="da-chart-short"
                dropdown={DropdownPurok}
                meaning="Compares the total volume of requests originating from each Purok. Useful for identifying which local areas require the most administrative attention."
              >
                <Bar data={{
                  labels: purokLabels,
                  datasets: [{
                    label: 'Requests',
                    data: purokData,
                    backgroundColor: purokLabels.map((_, i) => BLUES[i % BLUES.length]),
                    borderRadius: 4,
                    borderSkipped: false,
                  }],
                }} options={chartOpts()} />
              </ChartBlock>

              <ChartBlock
                title="Document Types"
                sub="all records mapped"
                chartClass="da-chart-short"
                dropdown={DropdownDoc}
                meaning="Displays the proportion of each document type requested. Helps identify the most frequently processed clearances or certificates."
              >
                <Doughnut data={{
                  labels: docLabels,
                  datasets: [{
                    data: docData,
                    backgroundColor: TYPE_PAL.slice(0, docLabels.length),
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 4,
                  }],
                }} options={doughnutOpts} />
              </ChartBlock>

              <ChartBlock
                title="Sex Distribution"
                sub="residents_records.sex"
                chartClass="da-chart-short"
                dropdown={DropdownSex}
                meaning="Shows the demographic breakdown of residents by sex, based on the total registered population in the system."
              >
                <Doughnut data={{
                  labels: sexLabels,
                  datasets: [{
                    data: sexData,
                    backgroundColor: ['#3b82f6', '#ec4899'].slice(0, sexLabels.length),
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 4,
                  }],
                }} options={doughnutOpts} />
              </ChartBlock>
            </div>

            <Section label="Demographics" />
            <div className="da-grid-2">
              {/* REMOVED chartClass="da-chart-mini" so it dynamically grows to fill the vertical gap */}
              <ChartBlock
                title="Age Group Spread"
                sub="residents_records.dob → computed_age"
                meaning="Categorizes the registered population into specific age brackets to help visualize the demographic makeup of the barangay."
              >
                <Bar data={{
                  labels: Object.keys(E.ages || {}),
                  datasets: [{
                    label: 'Residents',
                    data: Object.values(E.ages || {}),
                    backgroundColor: BLUES.slice(0, 4),
                    borderRadius: 4,
                    borderSkipped: false,
                  }],
                }} options={chartOpts()} />
              </ChartBlock>

              <div className="da-block da-flex-col">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <div className="da-chart-title">Special Categories</div>
                  <div className="da-chart-sub" style={{ margin: 0 }}>residents_records → boolean flags</div>
                </div>
                <div className="da-cat-list da-flex-grow">
                  {Object.entries(E.specials || {}).map(([label, count]) => {
                    const c = count as number;
                    const pct = E.totalResidents > 0
                      ? Math.round((c / E.totalResidents) * 100) : 0;
                    return (
                      <div key={label}>
                        <div className="da-cat-row">
                          <span className="da-cat-name">{label}</span>
                          <span className="da-cat-val">
                            {c}
                            <span className="da-cat-pct">{pct}%</span>
                          </span>
                        </div>
                        <div className="da-cat-track">
                          <div className="da-cat-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="da-chart-meaning" style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px dashed #cbd5e1' }}>
                  <strong className="da-chart-meaning-label">Meaning:</strong> Highlights vulnerable or specialized groups (e.g., Senior Citizens, PWDs) within the population to guide targeted community programs.
                </div>
              </div>
            </div>

            <Section label="Resident ID Activity" />
            <div className="da-table">
              <div className="da-table__head">
                {['#', 'Resident ID', 'Purok', 'Document Count'].map(h => (
                  <span key={h} className="da-table__col">{h}</span>
                ))}
              </div>

              {(!E.topResidents || E.topResidents.length === 0) ? (
                <div className="da-table__empty">No linked document records found.</div>
              ) : E.topResidents.map((r: any, i: number) => (
                <div key={r.id} className="da-table__row">
                  <span className="da-table__rank">{i + 1}</span>
                  <span className="da-table__id">{r.id}</span>
                  <span className="da-table__purok">{r.purok}</span>
                  <div className="da-table__bar-wrap">
                    <div className="da-table__bar-track">
                      <div
                        className="da-table__bar-fill"
                        style={{
                          width: `${Math.round(
                            (r.count / (E.topResidents[0]?.count || 1)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="da-table__count">{r.count}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="da-summary">
              <p className="da-summary__text">
                <strong>SUMMARY — </strong>
                n_doc={E.totalDocs} (100% sourced from Live DB) ·
                n_res={E.totalResidents} ·
                monthly_trend=
                <span className={`da-trend-text ${mUp ? 'da-trend-up' : 'da-trend-down'}`}>
                  {mUp ? 'EXPANDING' : 'CONTRACTING'} ({mUp ? '+' : ''}{Number(E.mTrend || 0).toFixed(2)} Δ/mo)
                </span>
                {' '}· top_purok={E.topPurok || 'N/A'} ·
                predicted_tomorrow=~{E.tomorrowP || 0} ·
                predicted_type=[<strong>{E.predType || 'N/A'}</strong> · {E.predTypePct || 0}%] ·
                model=Holt_DES
              </p>
            </div>

          </>)}
        </div>
      </div>
      
      {showPDF && (
        <Data_Analytics_pdf 
          onClose={() => setShowPDF(false)} 
          initialFilter={'All'} 
        />
      )}
    </div>
  );
}