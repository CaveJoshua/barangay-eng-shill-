// ─── Document Data Types & Processing ────────────────────────────────────────

import { decayW } from './Data_Math';
import { holts } from './Data_Algorithm';

/**
 * Document record interface
 * Supports both camelCase and snake_case from API
 */
export interface DocRecord {
  id: string;
  residentId?: string;
  resident_id?: string;
  type?: string;
  dateRequested?: string;
  date_requested?: string;
  status?: string;
  purok?: string;
  resident_purok?: string;
  sex?: string;
}

/**
 * Enriched document with resident mapping
 */
export interface EnrichedDoc {
  _res?: any;
  _rId?: string;
  _date: string;
  _purok?: string;
  [key: string]: any;
}

/**
 * Process documents and enrich with resident data
 * @param docs - Raw document records
 * @param resMap - Map of resident IDs to resident objects
 * @returns Enriched document array
 */
export const enrichDocuments = (docs: DocRecord[], resMap: Map<string, any>): EnrichedDoc[] => {
  return docs.map(d => {
    const rId = d.residentId || d.resident_id;
    const rDate = d.dateRequested || d.date_requested || '';
    const rPurok = d.purok || d.resident_purok;
    
    return {
      ...d,
      _res: rId ? resMap.get(rId) : undefined,
      _rId: rId,
      _date: rDate,
      _purok: rPurok
    };
  });
};

/**
 * Calculate monthly document counts and forecast
 * @param enrichedDocs - Enriched document array
 * @returns Monthly analysis object
 */
export const calculateMonthlyStats = (enrichedDocs: EnrichedDoc[]) => {
  const monthly: Record<string, number> = {};
  
  enrichedDocs.forEach(d => {
    const dt = new Date(d._date);
    if (isNaN(dt.getTime())) return;
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    monthly[k] = (monthly[k] || 0) + 1;
  });
  
  const mKeys = Object.keys(monthly).sort();
  const mVals = mKeys.map(k => monthly[k]);
  const mModel = holts(mVals);
  const mF1 = mModel.forecast(1);
  const mF2 = mModel.forecast(2);

  const today = new Date();
  const thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthCount = monthly[thisMonthKey] || 0;

  return {
    monthly,
    mKeys,
    mVals,
    mTrend: mModel.trend,
    mF1,
    mF2,
    thisMonthCount,
  };
};

/**
 * Calculate daily document counts and forecast (last 14 days)
 * @param enrichedDocs - Enriched document array
 * @returns Daily analysis object
 */
export const calculateDailyStats = (enrichedDocs: EnrichedDoc[]) => {
  const today = new Date();
  const daily: Record<string, number> = {};
  
  // Initialize last 14 days
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    daily[d.toISOString().split('T')[0]] = 0;
  }
  
  // Count documents per day
  enrichedDocs.forEach(d => {
    const k = d._date.split('T')[0];
    if (k in daily) daily[k]++;
  });
  
  const dKeys = Object.keys(daily);
  const dVals = dKeys.map(k => daily[k]);
  const dModel = holts(dVals, 0.45, 0.1);
  const tomorrowP = dModel.forecast(1);
  
  const todayKey = today.toISOString().split('T')[0];
  const todayCount = daily[todayKey] || 0;

  return {
    daily,
    dKeys,
    dVals,
    dTrend: dModel.trend,
    tomorrowP,
    todayCount,
  };
};

/**
 * Calculate document type statistics with decay weighting
 * @param enrichedDocs - Enriched document array
 * @returns Type analysis object
 */
export const calculateTypeStats = (enrichedDocs: EnrichedDoc[]) => {
  // Time-weighted type prediction
  const typeWeights: Record<string, number> = {};
  enrichedDocs.forEach(d => {
    const t = d.type || 'Other';
    const w = d._date ? decayW(d._date) : 0.1;
    typeWeights[t] = (typeWeights[t] || 0) + w;
  });
  
  const totalW = Object.values(typeWeights).reduce((a, b) => a + b, 0) || 1;
  const sortedTypes = Object.entries(typeWeights).sort((a, b) => b[1] - a[1]);
  const predType = sortedTypes[0]?.[0] || 'N/A';
  const predTypePct = Math.round((sortedTypes[0]?.[1] || 0) / totalW * 100);

  // Simple type counts
  const typeCounts: Record<string, number> = {};
  enrichedDocs.forEach(d => {
    const t = d.type || 'Other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  return {
    typeWeights,
    typeCounts,
    sortedTypes,
    predType,
    predTypePct,
    totalW,
  };
};

/**
 * Calculate purok distribution from documents
 * @param enrichedDocs - Enriched document array
 * @returns Purok statistics object
 */
export const calculatePurokStats = (enrichedDocs: EnrichedDoc[]) => {
  const purokCounts: Record<string, number> = {};
  
  enrichedDocs.forEach(d => {
    const p = d._res?.purok || d._purok || 'Unassigned';
    purokCounts[p] = (purokCounts[p] || 0) + 1;
  });
  
  const topPurok = Object.entries(purokCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  return {
    purokCounts,
    topPurok,
  };
};

/**
 * Calculate top residents by document count
 * @param enrichedDocs - Enriched document array
 * @returns Array of top 10 residents with document counts
 */
export const calculateTopResidents = (enrichedDocs: EnrichedDoc[]) => {
  const resDocMap: Record<string, { id: string; count: number; purok: string }> = {};
  
  enrichedDocs.forEach(d => {
    if (!d._rId) return;
    const p = d._res?.purok || d._purok || '—';
    if (!resDocMap[d._rId]) {
      resDocMap[d._rId] = { id: d._rId, count: 0, purok: p };
    }
    resDocMap[d._rId].count++;
  });
  
  return Object.values(resDocMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
};