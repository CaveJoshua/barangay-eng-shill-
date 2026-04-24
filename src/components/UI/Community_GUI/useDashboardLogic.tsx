import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiService } from '../api';

export const useDashboardLogic = (onLogout: () => void) => {
  const [resident, setResident] = useState<any>(null);
  const [blotters, setBlotters] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [newsList, setNewsList] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]); // 🛡️ NEW: Notification State
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

      // 🛡️ THE FIX: Call the Resident-Specific endpoints to bypass the 403 RBAC Admin Block
      // 🛡️ THE ADDITION: Call getNotifications to wake up the alert system
      const [blotterData, docData, newsData, notifData] = await Promise.all([
      ApiService.getResidentBlotters(targetId),     // 👈 THIS MUST BE getResidentBlotters
      ApiService.getResidentDocuments(targetId),    
      ApiService.getAnnouncements(),
      ApiService.getNotifications()
      ]);

      if (blotterData === null || docData === null) {
         console.warn("Session invalid or Server Offline. Mastermind blocked data.");
         return; 
      }

      // We no longer need to .filter() here because the backend already filtered it!
      setBlotters(
        (blotterData || []).map((b: any) => {
            const rawName = b.resident_name || b.complainant_name || b.full_name || b.complainant || 'RESIDENT';
            
            return {
              record_id: b.id || b.record_id,
              case_no: b.case_number || b.case_no,
              incident_type: b.incident_type,
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
      
      // We no longer need to .filter() here because the backend already filtered it!
      setDocuments(
        (docData || []).map((d: any) => {
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
      setNotifications(notifData || []); // 🛡️ Load the notifications into state

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
      const userNode = parsed.user || {}; // 🛡️ Ensure we grab the user node

      // 🛡️ Safe ID Extraction
      const recordId = profile.record_id || profile.RECORD_ID || parsed.record_id;

      if (!recordId) {
        onLogout();
        return;
      }

      // 🛡️ Safe Name Extraction & CAPSLOCK ENFORCEMENT
      const firstName = profile.first_name || profile.FIRST_NAME || profile.firstName || '';
      const lastName = profile.last_name || profile.LAST_NAME || profile.lastName || '';
      
      let safeName = `${firstName} ${lastName}`.trim().toUpperCase();
      
      if (!safeName || safeName.includes('UNDEFINED')) {
          safeName = 'UNKNOWN RESIDENT';
      }

      // 🛡️ THE FIX: Deep Identity Extraction
      // Actively hunt for the email and username across the entire session object
      const extractedEmail = profile.email || userNode.email || parsed.email || '';
      const extractedUsername = userNode.username || profile.username || parsed.username || '';

      setResident({
        ...parsed,         // Keep the root payload intact
        ...profile,        // Prioritize profile data
        user: userNode,    // Explicitly attach the user node so it isn't dropped
        email: extractedEmail,       // Force email to the surface
        username: extractedUsername, // Force username to the surface
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

  // 🛡️ Export the notifications so the UI can use them!
  return { resident, blotters, documents, newsList, notifications, loading, fetchData, activeTab, setActiveTab };
};

export default useDashboardLogic;