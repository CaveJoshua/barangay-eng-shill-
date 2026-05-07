import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiService } from '../api';

export const useDashboardLogic = (onLogout: () => void) => {
  const [resident, setResident] = useState<any>(null);
  const [blotters, setBlotters] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [newsList, setNewsList] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  
  const initialLoadDone = useRef(false);
  const isFetching = useRef(false); 

  const [activeTab, setActiveTab] = useState<string>('Pending');

  const fetchData = useCallback(async (residentId?: string, forceRefresh: boolean = false) => {
    if (isFetching.current && !forceRefresh) return;

    const sessionStr = localStorage.getItem('resident_session');
    const sessionData = sessionStr ? JSON.parse(sessionStr) : {};
    
    const targetId = residentId || sessionData?.profile?.record_id || sessionData?.record_id || sessionData?.profile?.RECORD_ID;

    if (!targetId) return;
    
    isFetching.current = true;

    try {
      if (!initialLoadDone.current) setLoading(true);

      const [blotterData, docData, newsData, notifData] = await Promise.all([
        ApiService.getResidentBlotters(targetId),     
        ApiService.getResidentDocuments(targetId),    
        ApiService.getAnnouncements(),
        ApiService.getNotifications()
      ]);

      if (blotterData === null || docData === null) {
         console.warn("Session invalid or Server Offline. Mastermind blocked data.");
         return; 
      }

      setBlotters(
        (blotterData || []).map((b: any) => {
            const rawName = b.resident_name || b.complainant_name || b.full_name || b.complainant || 'RESIDENT';
            const rawReason = b.rejection_reason || b.rejectionReason || b.reason || '';
            
            const rawBlotterStatus = b.status ? String(b.status).trim() : 'Pending';
            const normalizedBlotterStatus = rawBlotterStatus.charAt(0).toUpperCase() + rawBlotterStatus.slice(1).toLowerCase();
            
            return {
              ...b, 
              record_id: b.id || b.record_id,
              case_no: b.case_number || b.case_no,
              incident_type: b.incident_type,
              complainant: rawName.toUpperCase(),
              incident_date: b.date_filed || b.incident_date,
              status: normalizedBlotterStatus,
              rawStatus: b.status,
              details: `Vs ${b.respondent || 'Unknown'}: ${b.incident_type}`,
              price: 'To be assessed',
              hearingDate: b.hearing_date,
              hearingTime: b.hearing_time,
              rejection_reason: rawReason,
              rejectionReason: rawReason,
              narrative: b.narrative || b.details || 'No description provided.',
            };
          })
      );
      
      setDocuments(
        (docData || []).map((d: any) => {
            const rawStatus = d.status ? String(d.status).trim() : 'Pending';
            const normalizedStatus = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
            
            // Handle both Pending and New as the "Assessment" phase
            const isPendingPhase = ['Pending', 'New'].includes(normalizedStatus);
            
            // 🎯 THE FIX: Strip letters/currency symbols so parseFloat doesn't return NaN
            const cleanPriceStr = String(d.price || d.fee || 0).replace(/[^0-9.]/g, '');
            const rawPrice = parseFloat(cleanPriceStr);
            const validPrice = isNaN(rawPrice) ? 0 : rawPrice; // Fallback to 0 if totally invalid

            // 🎯 THE FIX: Calculate display price securely
            const displayPrice = isPendingPhase
              ? 'To be assessed'
              : (validPrice === 0 ? 'To be assessed' : `₱${validPrice.toFixed(2)}`);

            const rawReason = d.rejection_reason || d.rejectionReason || d.reason || d.rejection_message || '';
            
            return {
              ...d, 
              record_id: d.id || d.record_id,
              id: d.id || d.record_id,
              reference_no: d.referenceNo || d.reference_no || d.control_no || 'REF-N/A',
              displayId: d.referenceNo || d.reference_no || d.control_no || 'REF-N/A',
              type: d.type || 'Document',
              document_type: d.type || d.document_type,
              status: normalizedStatus, 
              rawStatus: rawStatus,
              purpose: d.purpose || 'Not Stated',
              details: `Purpose: ${d.purpose}`,
              date_requested: d.dateRequested || d.date_requested,
              date: new Date(d.dateRequested || d.date_requested).toLocaleDateString(),
              price: validPrice,         
              priceDisplay: displayPrice, 
              fee: validPrice,
              rejection_reason: rawReason,
              rejectionReason: rawReason
            };
          })
      );

      setNewsList(newsData || []);
      setNotifications(notifData || []); 

      initialLoadDone.current = true;
    } catch (err) {
      console.error('Dashboard Sync Error:', err);
    } finally {
      setLoading(false);
      isFetching.current = false;
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
      const userNode = parsed.user || {}; 

      const recordId = profile.record_id || profile.RECORD_ID || parsed.record_id;

      if (!recordId) {
        onLogout();
        return;
      }

      const firstName = profile.first_name || profile.FIRST_NAME || profile.firstName || '';
      const lastName = profile.last_name || profile.LAST_NAME || profile.lastName || '';
      
      let safeName = `${firstName} ${lastName}`.trim().toUpperCase();
      
      if (!safeName || safeName.includes('UNDEFINED')) {
          safeName = 'UNKNOWN RESIDENT';
      }

      const extractedEmail = profile.email || userNode.email || parsed.email || '';
      const extractedUsername = userNode.username || profile.username || parsed.username || '';

      setResident({
        ...parsed,         
        ...profile,        
        user: userNode,    
        email: extractedEmail,       
        username: extractedUsername, 
        record_id: recordId, 
        formattedName: safeName,
      });

      fetchData(recordId);
    } catch (e) {
      console.error("Session parse error:", e);
      onLogout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { resident, blotters, documents, newsList, notifications, loading, fetchData, activeTab, setActiveTab };
};

export default useDashboardLogic;