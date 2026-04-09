import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiService } from '../api';

export const useDashboardLogic = (onLogout: () => void) => {
  const [resident, setResident] = useState<any>(null);
  const [blotters, setBlotters] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [newsList, setNewsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const initialLoadDone = useRef(false);
  const isFetching = useRef(false); 

  const [activeTab, setActiveTab] = useState<string>('Pending');

  const fetchData = useCallback(async (residentId?: string) => {
    if (isFetching.current) return;

    const sessionStr = localStorage.getItem('resident_session');
    const sessionData = sessionStr ? JSON.parse(sessionStr) : {};
    // Safely check all possible ID locations
    const targetId = residentId || sessionData?.profile?.record_id || sessionData?.record_id || sessionData?.profile?.RECORD_ID;

    if (!targetId) return;
    
    isFetching.current = true;

    try {
      if (!initialLoadDone.current) setLoading(true);

      const [blotterData, docData, newsData] = await Promise.all([
        ApiService.getBlotters(),    
        ApiService.getDocuments(),   
        ApiService.getAnnouncements()
      ]);

      if (blotterData === null || docData === null) {
         console.warn("Session invalid or Server Offline. Mastermind blocked data.");
         return; 
      }

      setBlotters(
        blotterData
          // 1. Added more fallback ID checks just in case the DB column is named differently
          .filter((b: any) => b.complainant_id === targetId || b.resident_id === targetId || b.user_id === targetId)
          .map((b: any) => {
            // 2. Extract the true name from the database before it gets lost
            const rawName = b.resident_name || b.complainant_name || b.full_name || b.complainant || 'RESIDENT';
            
            return {
              record_id: b.id || b.record_id,
              case_no: b.case_number || b.case_no,
              incident_type: b.incident_type,
              // 3. Pass the true name to the UI in strict uppercase
              complainant: rawName.toUpperCase(),
              incident_date: b.date_filed || b.incident_date,
              status: b.status,
              rawStatus: b.status,
              details: `Vs ${b.respondent || 'Unknown'}: ${b.incident_type}`,
              price: 'Free',
              hearingDate: b.hearing_date,
              hearingTime: b.hearing_time,
              rejectionReason: b.rejection_reason,
              narrative: b.narrative || b.details || 'No description provided.',
            };
          })
      );
      
      setDocuments(
        docData
          .filter((d: any) => (d.residentId || d.resident_id) === targetId)
          .map((d: any) => {
            const isPending = (d.status || 'Pending').toLowerCase() === 'pending';
            const displayPrice = isPending
              ? 'To be assessed'
              : (!d.price || d.price === 0 ? 'Free' : `₱${parseFloat(d.price).toFixed(2)}`);
            
            return {
              record_id: d.id || d.record_id,
              id: d.referenceNo || d.reference_no || d.control_no || 'REF-N/A',
              type: d.type || 'Document',
              document_type: d.type || d.document_type,
              status: d.status || 'Pending',
              rawStatus: d.status,
              purpose: d.purpose || 'Not Stated',
              details: `Purpose: ${d.purpose}`,
              date_requested: d.dateRequested || d.date_requested,
              date: new Date(d.dateRequested || d.date_requested).toLocaleDateString(),
              price: displayPrice,
              fee: d.price || d.fee || 0,
            };
          })
      );

      setNewsList(newsData || []);
      initialLoadDone.current = true;
    } catch (err) {
      console.error('Dashboard Sync Error:', err);
    } finally {
      setLoading(false);
      setTimeout(() => { isFetching.current = false; }, 500);
    }
  }, []);

  useEffect(() => {
    const savedSession = localStorage.getItem('resident_session');
    if (!savedSession) {
      onLogout();
      return;
    }

    try {
      const parsed = JSON.parse(savedSession);
      const profile = parsed.profile || parsed;

      // 🛡️ Safe ID Extraction
      const recordId = profile.record_id || profile.RECORD_ID || parsed.record_id;

      if (!recordId) {
        onLogout();
        return;
      }

      // 🛡️ Safe Name Extraction & CAPSLOCK ENFORCEMENT
      // Checks multiple key variations so it never fails.
      const firstName = profile.first_name || profile.FIRST_NAME || profile.firstName || '';
      const lastName = profile.last_name || profile.LAST_NAME || profile.lastName || '';
      
      let safeName = `${firstName} ${lastName}`.trim().toUpperCase();
      
      // The ultimate fallback: If it's completely blank or contains undefined
      if (!safeName || safeName.includes('UNDEFINED')) {
          safeName = 'UNKNOWN RESIDENT';
      }

      setResident({
        ...profile,
        record_id: recordId, // Normalize ID
        formattedName: safeName,
      });

      fetchData(recordId);
    } catch (e) {
      console.error("Session parse error:", e);
      onLogout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { resident, blotters, documents, newsList, loading, fetchData, activeTab, setActiveTab };
};

export default useDashboardLogic;