import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import styles from './styles/Archive.module.css';
import { ApiService } from '../api';
import { generateVectorPDF, type DocumentPayload } from '../../buttons/Tools/Document_tools/PDF_Algorithm';
import { getSchemaById } from '../../buttons/Tools/Document_tools/Barangay_Documents/schemaRegistry';

type ArchiveTab = 'Documents' | 'Incidents' | 'Residents' | 'Officials' | 'Households' | 'Announcements' | 'Account';
type AcctSourceFilter = 'All' | 'Residents' | 'Officials';

// Positions where only one official may hold the seat at a time. Restoring an
// archived official into one of these must first check nobody else already
// holds it — otherwise the barangay would end up with two "active" Captains.
const SINGLE_SEAT_POSITIONS = ['Barangay Hall', 'Punong Barangay', 'Barangay Secretary', 'Barangay Treasurer', 'SK Chairperson'];

// Statuses assignable from the Archive preview — mirrors the live directory's
// dropdown so an official can be reclassified (e.g. Resigned → Suspended)
// without first restoring them to Active.
const OFFICIAL_STATUS_OPTIONS = ['Active', 'Suspended', 'Resigned'];

// 🔒 Only the Punong Barangay / Barangay Hall may restore an official — same
// tier that's allowed to change an official's Status on the live directory.
const canRestoreOfficials = (): boolean => {
  try {
    const sessionStr = localStorage.getItem('admin_session');
    if (!sessionStr) return false;
    const session = JSON.parse(sessionStr);
    const role = String(session.role || session.user?.role || '').toLowerCase().replace(/\s+/g, '');
    const pos = String(session.position || session.profile?.position || '').toLowerCase().replace(/\s+/g, '');
    const whitelist = ['superadmin', 'punongbarangay', 'barangayhall'];
    return whitelist.includes(role) || whitelist.includes(pos);
  } catch {
    return false;
  }
};

// Pull evidence (photos + a video) out of an archived incident narrative so the
// vault can still SHOW + let you download it, even though incidents aren't restorable.
const parseEvidence = (text: string): { images: string[]; videoUrl: string | null } => {
  if (!text) return { images: [], videoUrl: null };
  const re = /\[ATTACHED (EVIDENCE|VIDEO)\]\s*(\S+)/g;
  const images: string[] = [];
  let videoUrl: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] === 'VIDEO') videoUrl = m[2];
    else images.push(m[2]);
  }
  return { images, videoUrl };
};

export default function Archive() {
  const [activeTab, setActiveTab] = useState<ArchiveTab>('Documents');
  
  // Data States
  const [documents, setDocuments] = useState<any[]>([]);
  const [blotters, setBlotters] = useState<any[]>([]);
  const [residents, setResidents] = useState<any[]>([]);
  const [officials, setOfficials] = useState<any[]>([]);
  const [households, setHouseholds] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [acctAccounts, setAcctAccounts] = useState<any[]>([]);
  const [acctSourceFilter, setAcctSourceFilter] = useState<AcctSourceFilter>('All');
  
  // Track which tabs have already been loaded to prevent redundant fetches
  const loadedTabs = useRef<Set<string>>(new Set());

  // UI States
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  // Preview modal (viewable + downloadable archived record)
  const [previewItem, setPreviewItem] = useState<any | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [genDoc, setGenDoc] = useState(false);
  const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null);
  
  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const isMounted = useRef(true);
  const isFetching = useRef(false);

  // --- 1. TARGETED HANDSHAKE (Only fetch what is needed & filter terminal states) ---
  const fetchSpecificArchive = useCallback(async (tab: ArchiveTab, signal?: AbortSignal) => {
    if (isFetching.current) return;
    
    setLoading(true);
    isFetching.current = true;

    try {
      let data: any = null;
      const now = new Date();

      switch (tab) {
        case 'Documents':
          data = await ApiService.getDocuments(signal);
          if (data && isMounted.current) {
            // 🛡️ Captures vanished documents
            setDocuments(data.filter((d: any) => {
              const stat = String(d.status || '').trim().toLowerCase();
              return ['completed', 'rejected', 'archived'].includes(stat);
            }));
          }
          break;
        case 'Incidents':
          data = await ApiService.getBlotters(signal);
          if (data && isMounted.current) {
            // 🛡️ Captures vanished incident reports
            setBlotters(data.filter((b: any) => {
              const stat = String(b.status || '').trim().toLowerCase();
              return ['settled', 'archived', 'dismissed', 'rejected'].includes(stat);
            }));
          }
          break;
        case 'Residents':
          data = await ApiService.getResidents(signal);
          if (data && isMounted.current) {
            // 🛡️ Captures vanished resident identities
            setResidents(data.filter((r: any) => {
              const stat = String(r.status || r.activity_status || r.activityStatus || '').trim().toLowerCase();
              return ['archived', 'deceased', 'relocated', 'inactive'].includes(stat);
            }));
          }
          break;
        case 'Officials':
          data = await ApiService.getOfficials(signal);
          if (data && isMounted.current) {
            // 🛡️ Only Resigned (and legacy archived/inactive/former values) leave
            // the live directory — Suspended stays tracked there, not here.
            setOfficials(data.filter((o: any) => {
              const stat = String(o.status || '').trim().toLowerCase();
              return ['archived', 'inactive', 'former', 'resigned'].includes(stat);
            }));
          }
          break;
        case 'Households':
          data = await ApiService.getHouseholds(signal);
          if (data && isMounted.current) {
            setHouseholds(data.filter((h: any) => {
              const stat = String(h.status || '').trim().toLowerCase();
              return ['archived', 'inactive', 'relocated'].includes(stat);
            }));
          }
          break;
        case 'Announcements':
          data = await ApiService.getAnnouncements(signal);
          if (data && isMounted.current) {
            setAnnouncements(data.filter((a: any) => {
              const stat = String(a.status || '').trim().toLowerCase();
              // Discarded drafts never went live, so they're included on status
              // alone — never fall back to the expiry check (a leftover default
              // expiry date is meaningless for something that was never published).
              if (stat === 'discarded') return true;
              return stat === 'archived' || new Date(a.expires_at) < now;
            }));
          }
          break;
        case 'Account':
          data = await ApiService.getAccounts(signal);
          if (data && isMounted.current) {
            // 🛡️ One combined pool — archived/inactive across BOTH residents and
            // officials, each judged against its own terminal-status vocabulary.
            // The Residents/Officials/All split is a client-side filter, not a
            // separate fetch, so switching it never re-hits the network.
            setAcctAccounts(data.filter((a: any) => {
              const stat = String(a.status || 'Active').trim().toLowerCase();
              if (a.source === 'resident') {
                return ['inactive', 'archived', 'deceased', 'relocated', 'suspended'].includes(stat);
              }
              if (a.source === 'official') {
                return ['inactive', 'archived', 'suspended', 'resigned'].includes(stat);
              }
              return false;
            }));
          }
          break;
      }

      if (isMounted.current) loadedTabs.current.add(tab);

    } catch (err) {
      console.error(`[ARCHIVE] Failed to load ${tab}:`, err);
    } finally {
      if (isMounted.current) {
        setLoading(false);
        isFetching.current = false;
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    const valve = new AbortController();

    if (!loadedTabs.current.has(activeTab)) {
      fetchSpecificArchive(activeTab, valve.signal);
    } else {
      setLoading(false);
    }

    return () => {
      isMounted.current = false;
      valve.abort();
    };
  }, [activeTab, fetchSpecificArchive]);

  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm, filterStatus]);
  useEffect(() => { setFilterStatus('All'); }, [activeTab]);

  // --- 2. SEARCH & DYNAMIC FILTERING ---
  const filteredData = useMemo(() => {
    const q = searchTerm.toLowerCase();

    switch (activeTab) {
      case 'Documents':
        return documents.filter(d => {
          const stat = String(d.status || '').trim().toLowerCase();
          return (filterStatus === 'All' || stat === filterStatus.toLowerCase()) &&
            ((d.reference_no || '').toLowerCase().includes(q) || (d.resident_name || '').toLowerCase().includes(q));
        }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      case 'Incidents':
        return blotters.filter(b => {
          const stat = String(b.status || '').trim().toLowerCase();
          return (filterStatus === 'All' || stat === filterStatus.toLowerCase()) &&
            ((b.case_number || '').toLowerCase().includes(q) || (b.complainant_name || '').toLowerCase().includes(q));
        }).sort((a, b) => new Date(b.date_filed || b.created_at).getTime() - new Date(a.date_filed || a.created_at).getTime());

      case 'Residents':
        return residents.filter(r => {
          const stat = String(r.status || r.activity_status || r.activityStatus || '').trim().toLowerCase();
          const fullName = `${r.first_name || r.firstName || ''} ${r.last_name || r.lastName || ''}`.toLowerCase();
          return (filterStatus === 'All' || stat === filterStatus.toLowerCase()) && fullName.includes(q);
        }).sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());

      case 'Officials':
        return officials.filter(o => {
          const stat = String(o.status || '').trim().toLowerCase();
          return (filterStatus === 'All' || stat === filterStatus.toLowerCase() || filterStatus === 'Archived') &&
            ((o.full_name || '').toLowerCase().includes(q) || (o.position || '').toLowerCase().includes(q));
        }).sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());

      case 'Households':
        return households.filter(h => {
          const stat = String(h.status || '').trim().toLowerCase();
          return (filterStatus === 'All' || stat === filterStatus.toLowerCase()) &&
            ((h.household_number || '').toLowerCase().includes(q) || (h.head || '').toLowerCase().includes(q));
        }).sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
      
      case 'Announcements':
        return announcements.filter(a => {
          const stat = String(a.status || '').trim().toLowerCase();
          // Mirrors the badge normalization: anything not explicitly Discarded
          // displays (and filters) as Archived, including expired items whose
          // DB status never got flipped from Active.
          const displayStat = stat === 'discarded' ? 'discarded' : 'archived';
          return (filterStatus === 'All' || displayStat === filterStatus.toLowerCase()) &&
            ((a.title || '').toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q));
        }).sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime());

      case 'Account':
        return acctAccounts.filter(a => {
          const stat = String(a.status || 'Active').trim().toLowerCase();
          const matchesSource =
            acctSourceFilter === 'All' ||
            (acctSourceFilter === 'Residents' && a.source === 'resident') ||
            (acctSourceFilter === 'Officials' && a.source === 'official');
          return matchesSource &&
            (filterStatus === 'All' || stat === filterStatus.toLowerCase()) &&
            ((a.username || '').toLowerCase().includes(q) || (a.profileName || '').toLowerCase().includes(q));
        }).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

      default: return [];
    }
  }, [documents, blotters, residents, officials, households, announcements, acctAccounts, activeTab, searchTerm, filterStatus, acctSourceFilter]);

  // --- 3. PAGINATION ---
  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredData.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredData, currentPage]);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleDateString();
  };

  const getFilterOptions = () => {
    switch (activeTab) {
      case 'Documents': return ['All', 'Completed', 'Rejected', 'Archived'];
      case 'Incidents': return ['All', 'Settled', 'Dismissed', 'Archived', 'Rejected'];
      case 'Residents': return ['All', 'Archived', 'Deceased', 'Relocated', 'Inactive'];
      case 'Officials': return ['All', 'Archived', 'Inactive', 'Former', 'Resigned'];
      case 'Households': return ['All', 'Archived', 'Inactive', 'Relocated'];
      case 'Announcements': return ['All', 'Archived', 'Discarded'];
      case 'Account': return ['All', 'Inactive', 'Archived', 'Deceased', 'Relocated', 'Suspended', 'Resigned'];
      default: return ['All'];
    }
  };

  // --- PREVIEW + DOWNLOAD HELPERS ---
  const fmt = (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v);

  // Field set shown in the preview modal AND written to the PDF (one source of truth).
  const getRecordFields = (tab: ArchiveTab, item: any): { label: string; value: string }[] => {
    switch (tab) {
      case 'Documents': return [
        { label: 'Reference No.', value: fmt(item.reference_no) },
        { label: 'Resident', value: fmt(item.resident_name) },
        { label: 'Type', value: fmt(item.type) },
        { label: 'Purpose', value: fmt(item.purpose) },
        { label: 'Status', value: fmt(item.status) },
        { label: 'Requested', value: formatDate(item.created_at) },
        { label: 'Released', value: formatDate(item.date_released) },
      ];
      case 'Incidents': return [
        { label: 'Case No.', value: fmt(item.case_number) },
        { label: 'Complainant', value: fmt(item.complainant_name) },
        { label: 'Respondent', value: fmt(item.respondent) },
        { label: 'Incident Type', value: fmt(item.incident_type) },
        { label: 'Narrative', value: fmt(item.narrative) },
        { label: 'Status', value: fmt(item.status) },
        { label: 'Date Filed', value: formatDate(item.date_filed) },
        { label: 'Resolution', value: fmt(item.resolution) },
      ];
      case 'Residents': return [
        { label: 'Record ID', value: fmt(item.record_id || item.id) },
        { label: 'Full Name', value: `${fmt(item.first_name || item.firstName)} ${item.middle_name || ''} ${fmt(item.last_name || item.lastName)}`.replace(/\s+/g, ' ').trim() },
        { label: 'Sex', value: fmt(item.sex) },
        { label: 'Date of Birth', value: formatDate(item.dob) },
        { label: 'Contact', value: fmt(item.contact_number) },
        { label: 'Email', value: fmt(item.email) },
        { label: 'Purok', value: fmt(item.purok) },
        { label: 'Status', value: fmt(item.activity_status || item.activityStatus || item.status) },
      ];
      case 'Officials': return [
        { label: 'Full Name', value: fmt(item.full_name) },
        { label: 'Position', value: fmt(item.position) },
        { label: 'Email', value: fmt(item.email) },
        { label: 'Contact', value: fmt(item.contact_number) },
        { label: 'Status', value: fmt(item.status) },
      ];
      case 'Households': return [
        { label: 'Household No.', value: fmt(item.household_number) },
        { label: 'Head', value: fmt(item.head) },
        { label: 'Zone', value: fmt(item.zone) },
        { label: 'Address', value: fmt(item.address) },
        { label: 'Status', value: fmt(item.status) },
      ];
      case 'Announcements': return [
        { label: 'Title', value: fmt(item.title) },
        { label: 'Category', value: fmt(item.category) },
        { label: 'Priority', value: fmt(item.priority) },
        { label: 'Content', value: fmt(item.content) },
      ];
      case 'Account': return [
        { label: 'Type', value: item.source === 'official' ? 'Official' : 'Resident' },
        { label: 'Profile Name', value: fmt(item.profileName) },
        { label: 'Username', value: fmt(item.username) },
        { label: 'Role', value: fmt(item.role) },
        { label: 'Status', value: fmt(item.status) },
        { label: 'Created', value: formatDate(item.created_at) },
      ];
      default: return [];
    }
  };

  // Lightweight lifecycle "action trail" built from the record's own timestamps.
  const getTrail = (tab: ArchiveTab, item: any): { label: string; date: string }[] => {
    const trail: { label: string; date: string }[] = [];
    if (tab === 'Documents') {
      if (item.date_requested || item.created_at) trail.push({ label: 'Requested', date: formatDate(item.date_requested || item.created_at) });
      if (item.date_released) trail.push({ label: 'Released', date: formatDate(item.date_released) });
      trail.push({ label: `Finalized — ${fmt(item.status) || 'Archived'}`, date: '' });
    } else if (tab === 'Incidents') {
      if (item.date_filed || item.created_at) trail.push({ label: 'Filed', date: formatDate(item.date_filed || item.created_at) });
      if (item.hearing_date) trail.push({ label: 'Hearing scheduled', date: formatDate(item.hearing_date) });
      trail.push({ label: `Closed — ${fmt(item.status) || 'Archived'}`, date: '' });
    }
    return trail;
  };

  // 📄 Rebuild the archived document in its REAL barangay format (the same engine
  // that issues it), with the current active officials' signatures. Shared by the
  // inline mini-preview and the download. View-only — never restored from here.
  const buildDocumentPdf = async (item: any) => {
    let captainName = '';
    let kagawadName = '';
    let captainSignatureUrl = '';
    let kagawadSignatureUrl = '';
    try {
      const offs = await ApiService.getOfficials();
      if (Array.isArray(offs)) {
        const active = (re: RegExp) =>
          offs.find((o: any) => re.test(String(o.position || '')) && String(o.status || '').toLowerCase() === 'active');
        const captain = active(/punong|captain/i);
        const kagawad = active(/kagawad/i);
        captainName = String(captain?.full_name || '').toUpperCase();
        kagawadName = String(kagawad?.full_name || '').toUpperCase();
        captainSignatureUrl = captain?.signature_url || '';
        kagawadSignatureUrl = kagawad?.signature_url || '';
      }
    } catch { /* signatures are best-effort */ }

    const schema = getSchemaById(item.type);
    const payload: DocumentPayload = {
      residentName: item.resident_name || 'N/A',
      address: item.address || '',
      type: item.type || '',
      purpose: item.purpose || item.other_purpose || '',
      dateIssued: item.date_released || item.created_at || new Date().toISOString(),
      ctcNo: item.ctc_no || '',
      orNo: item.or_no || '',
      feesPaid: String(item.price ?? '0'),
      certificateNo: item.reference_no || '',
      captainName,
      kagawadName,
      captainSignatureUrl,
      kagawadSignatureUrl,
      paymentDate: '',
    };
    return generateVectorPDF(schema, payload);
  };

  const handleDownloadDocumentFormat = async (item: any) => {
    setGenDoc(true);
    try {
      const pdf = await buildDocumentPdf(item);
      pdf.save(`document_${item.reference_no || item.id || 'archive'}`.replace(/\s+/g, '_') + '.pdf');
    } catch (e: any) {
      alert('Could not render the document format: ' + (e?.message || 'unknown error'));
    } finally {
      setGenDoc(false);
    }
  };

  // 🔍 Auto-render a compact inline preview when an archived DOCUMENT is opened,
  // so it's viewable in a small form factor without downloading. The blob URL is
  // revoked on close/change to avoid leaks.
  useEffect(() => {
    if (!previewItem || activeTab !== 'Documents') { setDocPreviewUrl(null); return; }
    let cancelled = false;
    let createdUrl: string | null = null;
    setDocPreviewUrl(null);
    (async () => {
      try {
        const pdf = await buildDocumentPdf(previewItem);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(pdf.output('blob') as Blob);
        setDocPreviewUrl(createdUrl);
      } catch { /* preview is best-effort */ }
    })();
    return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewItem, activeTab]);

  const handleDownloadPDF = (tab: ArchiveTab, item: any) => {
    const fields = getRecordFields(tab, item);
    const doc = new jsPDF();

    doc.setFontSize(15);
    doc.text("Barangay Engineer's Hill — Archived Record", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`${tab} • Generated ${new Date().toLocaleString()}`, 14, 25);
    doc.setDrawColor(200);
    doc.line(14, 29, 196, 29);

    doc.setTextColor(20);
    let y = 40;
    fields.forEach(({ label, value }) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`${label}:`, 14, y);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(String(value), 120);
      doc.text(lines, 62, y);
      y += Math.max(8, lines.length * 6);
      if (y > 278) { doc.addPage(); y = 20; }
    });

    const idPart = item.reference_no || item.case_number || item.record_id || item.household_number || item.id || 'record';
    doc.save(`archive_${tab}_${idPart}`.replace(/\s+/g, '_') + '.pdf');
  };

  // --- RESTORE (Announcements only) -------------------------------------------
  // Brings an archived announcement back to Active. If its expiry already lapsed,
  // push it 30 days out so it doesn't immediately re-archive.
  const handleRestoreAnnouncement = async (item: any) => {
    if (!window.confirm('Restore this announcement to Active? It will be visible to residents again.')) return;
    setRestoring(true);
    try {
      const now = new Date();
      const isExpired = item.expires_at && new Date(item.expires_at) < now;
      const expires_at = isExpired
        ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : item.expires_at;

      const payload = { ...item, status: 'Active', expires_at };
      const result = await ApiService.saveAnnouncement(item.id, payload);

      if (result.success) {
        // Drop it from the local archived list and force a fresh fetch next visit.
        setAnnouncements(prev => prev.filter(a => a.id !== item.id));
        loadedTabs.current.delete('Announcements');
        setPreviewItem(null);
      } else {
        alert(`Restore failed: ${result.error}`);
      }
    } catch {
      alert('System error during restore.');
    } finally {
      setRestoring(false);
    }
  };

  // --- STATUS CHANGE (Officials) ------------------------------------------------
  // The Archive isn't a dead end: an archived official's status can still be
  // reclassified here (e.g. Resigned → Suspended) exactly like the live
  // directory's dropdown. Reactivating (→ Active) is blocked if a single-seat
  // position is already validly held by someone else.
  const handleOfficialStatusChange = async (item: any, newStatus: string) => {
    if (newStatus === item.status) return;

    if (item.position === 'Barangay Hall') {
      alert('System Lock: the Barangay Hall master account status cannot be changed.');
      return;
    }

    const reactivating = newStatus === 'Active';

    setRestoring(true);
    try {
      if (reactivating) {
        // Check against the LIVE directory — the Archive's own official list only
        // holds inactive records, so a fresh read is needed to see who (if
        // anyone) currently, validly holds this seat.
        if (SINGLE_SEAT_POSITIONS.includes(item.position)) {
          const all = await ApiService.getOfficials();
          const holder = Array.isArray(all)
            ? all.find((o: any) =>
                o.id !== item.id &&
                o.position === item.position &&
                ['active', 'suspended'].includes(String(o.status || '').toLowerCase())
              )
            : null;

          if (holder) {
            alert(`Cannot restore: ${holder.full_name} currently holds the ${item.position} seat. Only one official may occupy this position at a time.`);
            return;
          }
        }

        if (!window.confirm(`Restore ${item.full_name} to Active? Their admin access will be re-enabled immediately.`)) return;
      } else {
        if (!window.confirm(`Set ${item.full_name}'s status to "${newStatus}"?`)) return;
      }

      const statusResult = await ApiService.updateOfficialStatus(item.id, newStatus);
      if (statusResult?.error) {
        alert(`Status change failed: ${statusResult.error}`);
        return;
      }

      if (reactivating) {
        // No longer archived — drop it from this list and force a fresh fetch next visit.
        setOfficials(prev => prev.filter(o => o.id !== item.id));
        loadedTabs.current.delete('Officials');
        setPreviewItem(null);
      } else {
        // Still archived under a different terminal status — update in place.
        const patch = { ...item, status: newStatus };
        setOfficials(prev => prev.map(o => (o.id === item.id ? patch : o)));
        setPreviewItem(patch);
      }
    } catch {
      alert('System error during status change.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className={styles.ARC_PAGE_WRAP}>
      <div className={styles.ARC_MAIN_CONTAINER}>
        
        <div className={styles.ARC_STATS_PANEL}>
           <div className={styles.ARC_STAT_COL}>
              <div className={styles.ARC_STAT_TITLE}>VAULT STATUS</div>
              <div className={styles.ARC_STAT_SUB}>Historical Records</div>
              <div className={styles.ARC_STAT_HIGHLIGHT}><i className="fas fa-lock"></i> Read-Only</div>
           </div>
           <div className={`${styles.ARC_STAT_COL} ${styles.ARC_STAT_WIDE}`}>
              <div className={styles.ARC_STAT_TITLE}>ARCHIVE DIRECTORY</div>
              <div className={styles.ARC_STAT_SUB}>Access permanently closed cases, deactivated accounts, and finalized records.</div>
           </div>
           <div className={styles.ARC_TOTAL_COL}>
              <div className={styles.ARC_BIG_NUMBER}>{filteredData.length}</div>
              <div className={styles.ARC_STAT_TITLE}>TOTAL {activeTab.toUpperCase()}</div>
           </div>
        </div>

        <div className={styles.ARC_TABS_CONTAINER}>
          {(['Documents', 'Incidents', 'Residents', 'Officials', 'Households', 'Announcements', 'Account'] as ArchiveTab[]).map((tab) => (
            <button key={tab} className={`${styles.ARC_TAB_BTN} ${activeTab === tab ? styles.ACTIVE : ''}`} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
        </div>

        <div className={styles.ARC_SEARCH_ROW}>
           <div className={styles.ARC_SEARCH_WRAPPER}>
             <i className={`fas fa-search ${styles.ARC_SEARCH_ICON}`}></i>
             <input className={styles.ARC_SEARCH_INPUT} placeholder={`Search ${activeTab.toLowerCase()} archive...`} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
           </div>
           {activeTab === 'Account' && (
             <div className={styles.ARC_FILTER_WRAPPER}>
               <label className={styles.ARC_FILTER_LABEL}>Type:</label>
               <select className={styles.ARC_FILTER_SELECT} value={acctSourceFilter} onChange={(e) => setAcctSourceFilter(e.target.value as AcctSourceFilter)}>
                 {(['All', 'Residents', 'Officials'] as AcctSourceFilter[]).map(opt => <option key={opt} value={opt}>{opt}</option>)}
               </select>
             </div>
           )}
           <div className={styles.ARC_FILTER_WRAPPER}>
             <label className={styles.ARC_FILTER_LABEL}>Status:</label>
             <select className={styles.ARC_FILTER_SELECT} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
               {getFilterOptions().map(opt => <option key={opt} value={opt}>{opt}</option>)}
             </select>
           </div>
           <button className={styles.ARC_REFRESH_BTN} onClick={() => { loadedTabs.current.delete(activeTab); fetchSpecificArchive(activeTab); }} title="Reload Current Tab">
              <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i>
           </button>
        </div>

        <div className={styles.ARC_TABLE_CARD}>
           <div className={styles.ARC_TABLE_WRAP}>
               {loading ? (
                  <div className={styles.ARC_LOADING_STATE}><i className="fas fa-circle-notch fa-spin"></i><p>Loading {activeTab}...</p></div>
               ) : (
                 <table className={styles.ARC_TABLE_MAIN}>
                   <thead>
                     <tr>
                       {activeTab === 'Documents' && (<><th>REF NO.</th><th>RESIDENT</th><th>TYPE</th><th>FINALIZED</th></>)}
                       {activeTab === 'Incidents' && (<><th>CASE NO.</th><th>COMPLAINANT</th><th>RESPONDENT</th><th>FILED</th></>)}
                       {activeTab === 'Residents' && (<><th>ID</th><th>FULL NAME</th><th>SEX</th><th>DOB</th></>)}
                       {activeTab === 'Officials' && (<><th>NAME</th><th>POSITION</th><th>EMAIL</th><th>CONTACT</th></>)}
                       {activeTab === 'Households' && (<><th>HH NO.</th><th>HEAD</th><th>ZONE</th><th>STATUS</th></>)}
                       {activeTab === 'Announcements' && (<><th>TITLE</th><th>CATEGORY</th><th>PRIORITY</th></>)}
                       {activeTab === 'Account' && (<><th>TYPE</th><th>PROFILE NAME</th><th>USERNAME</th><th>ROLE</th></>)}
                       <th className={styles.ARC_ALIGN_RIGHT}>FINAL STATUS</th>
                     </tr>
                   </thead>
                   <tbody>
                     {paginatedData.length === 0 ? (
                        <tr><td colSpan={activeTab === 'Announcements' ? 4 : 5} className={styles.ARC_EMPTY_STATE}><i className="fas fa-box-open"></i><br/>No archived records found.</td></tr>
                     ) : paginatedData.map((item, index) => {
                       
                       let currentStatus = String(item.status || item.activity_status || item.activityStatus || 'Archived').toUpperCase();
                       // An announcement's DB status can lag "Archived" for one that merely
                       // EXPIRED without ever being manually archived (still 'Active' in the
                       // row) — normalize that display to ARCHIVED. But preserve DISCARDED
                       // as its own distinct label — a discarded draft never went live and
                       // must never be shown/confused as a real archived announcement.
                       if (activeTab === 'Announcements' && currentStatus !== 'DISCARDED') {
                         currentStatus = 'ARCHIVED';
                       }
                       const badgeClass = styles[`STATUS_${currentStatus.replace(/\s+/g, '_')}`] || styles.STATUS_DEFAULT;

                       return (
                       <tr
                         key={item.id || item.record_id || index}
                         onClick={() => setPreviewItem(item)}
                         style={{ cursor: 'pointer' }}
                         title="Click to preview & download"
                       >
                         {activeTab === 'Documents' && (
                           <><td className={styles.ARC_ID_CELL}>{item.reference_no || 'N/A'}</td><td className={styles.ARC_NAME_CELL}>{item.resident_name}</td><td>{item.type}</td><td>{formatDate(item.created_at)}</td></>
                         )}
                         {activeTab === 'Incidents' && (
                           <><td className={styles.ARC_ID_CELL}>{item.case_number}</td><td className={styles.ARC_NAME_CELL}>{item.complainant_name}</td><td>{item.respondent}</td><td>{formatDate(item.date_filed)}</td></>
                         )}
                         {activeTab === 'Residents' && (
                           <><td className={styles.ARC_ID_CELL}>{item.record_id || item.id}</td><td className={styles.ARC_NAME_CELL}>{item.first_name || item.firstName} {item.last_name || item.lastName}</td><td>{item.sex}</td><td>{formatDate(item.dob)}</td></>
                         )}
                         {activeTab === 'Officials' && (
                           <><td className={styles.ARC_NAME_CELL}>{item.full_name}</td><td>{item.position}</td><td>{item.email || '—'}</td><td>{item.contact_number || '—'}</td></>
                         )}
                         {activeTab === 'Households' && (
                           <><td className={styles.ARC_ID_CELL}>{item.household_number}</td><td className={styles.ARC_NAME_CELL}>{item.head}</td><td>{item.zone}</td><td>{item.status}</td></>
                         )}
                         {activeTab === 'Announcements' && (
                           <><td className={styles.ARC_NAME_CELL}>{item.title}</td><td>{item.category}</td><td>{item.priority}</td></>
                         )}
                         {activeTab === 'Account' && (
                           <><td>{item.source === 'official' ? 'Official' : 'Resident'}</td><td className={styles.ARC_NAME_CELL}>{item.profileName}</td><td>{item.username}</td><td>{item.role}</td></>
                         )}
                         <td className={styles.ARC_ALIGN_RIGHT}>
                           <span className={`${styles.ARC_BADGE} ${badgeClass}`}>{currentStatus}</span>
                         </td>
                       </tr>
                     )})}
                   </tbody>
                 </table>
               )}
           </div>

           <div className={styles.ARC_PAGINATION}>
             <span className={styles.ARC_PAGE_INFO}>Page {currentPage} of {totalPages || 1}</span>
             <div className={styles.ARC_NAV_GROUP}>
               <button className={styles.ARC_NAV_BTN} disabled={currentPage === 1 || loading} onClick={() => setCurrentPage(p => p - 1)}><i className="fas fa-chevron-left"></i></button>
               <button className={styles.ARC_NAV_BTN} disabled={currentPage === totalPages || totalPages === 0 || loading} onClick={() => setCurrentPage(p => p + 1)}><i className="fas fa-chevron-right"></i></button>
             </div>
           </div>
        </div>

      </div>

      {/* ── PREVIEW + DOWNLOAD MODAL ── */}
      {previewItem && (
        <div
          onClick={() => setPreviewItem(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
        >
          <div
            className="ARC_PREVIEW_PANEL"
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '14px', width: 'min(560px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                  Archived {activeTab.replace(/s$/, '')} Record
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  <i className="fas fa-lock" style={{ marginRight: 5 }} /> Read-only archive preview
                </p>
              </div>
              <button onClick={() => setPreviewItem(null)} style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}>
                <i className="fas fa-times" />
              </button>
            </div>

            <div style={{ padding: '12px 22px', overflowY: 'auto' }}>
              {getRecordFields(activeTab, previewItem).map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', gap: '12px', padding: '9px 0', borderBottom: '1px dashed #eef2f7' }}>
                  <div style={{ flex: '0 0 140px', fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
                  <div style={{ flex: 1, fontSize: '0.88rem', color: '#0f172a', fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
                </div>
              ))}

              {/* 🧠 OFFICIALS — proactive restore guidance, computed from data already on hand. */}
              {activeTab === 'Officials' && previewItem.position !== 'Barangay Hall' && SINGLE_SEAT_POSITIONS.includes(previewItem.position) && (
                <div style={{ marginTop: '10px', display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, fontSize: '0.8rem', lineHeight: 1.5, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a' }}>
                  <i className="fas fa-circle-info" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>Single-seat position — restore is blocked if another official currently, validly holds {previewItem.position}.</div>
                </div>
              )}

              {/* 🔍 DOCUMENT MINI-PREVIEW — the real format, viewable inline (read-only). */}
              {activeTab === 'Documents' && (
                <div style={{ paddingTop: '14px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>
                    <i className="fas fa-file-pdf" style={{ marginRight: 6 }} />Document Preview
                  </div>
                  {docPreviewUrl ? (
                    <iframe
                      title="Archived document preview"
                      src={docPreviewUrl}
                      style={{ width: '100%', height: 320, border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}
                    />
                  ) : (
                    <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#64748b', border: '1px dashed #e2e8f0', borderRadius: 8, fontSize: '0.85rem' }}>
                      <i className="fas fa-spinner fa-spin" /> Rendering document…
                    </div>
                  )}
                </div>
              )}

              {/* 📎 INCIDENT EVIDENCE — still viewable + downloadable in the vault (read-only). */}
              {activeTab === 'Incidents' && (() => {
                const { images, videoUrl } = parseEvidence(previewItem.narrative || '');
                if (images.length === 0 && !videoUrl) return null;
                return (
                  <div style={{ paddingTop: '14px' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>
                      <i className="fas fa-paperclip" style={{ marginRight: 6 }} />Evidence ({images.length} photo{images.length === 1 ? '' : 's'}{videoUrl ? ' + 1 video' : ''})
                    </div>
                    {images.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {images.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer" title="Open full size / download" style={{ display: 'block', lineHeight: 0 }}>
                            <img src={url} alt={`evidence ${i + 1}`} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                          </a>
                        ))}
                      </div>
                    )}
                    {videoUrl && (
                      <div style={{ marginTop: 10 }}>
                        <video src={videoUrl} controls style={{ width: '100%', maxHeight: 240, borderRadius: 8, background: '#000' }} />
                        <a href={videoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#2563eb', fontWeight: 700, marginTop: 4 }}>
                          <i className="fas fa-download" /> Download video
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 🧭 ACTION TRAIL — record lifecycle from its own timestamps. */}
              {getTrail(activeTab, previewItem).length > 0 && (
                <div style={{ paddingTop: '14px', marginTop: '6px', borderTop: '1px solid #eef2f7' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>
                    <i className="fas fa-route" style={{ marginRight: 6 }} />Action Trail
                  </div>
                  {getTrail(activeTab, previewItem).map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 600 }}>{s.label}</span>
                      {s.date && <span style={{ fontSize: '0.78rem', color: '#64748b', marginLeft: 'auto' }}>{s.date}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 22px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {/* ♻️ Restore is offered for archived ANNOUNCEMENTS and OFFICIALS — other vaults stay read-only. */}
              {activeTab === 'Announcements' && (
                <button
                  onClick={() => handleRestoreAnnouncement(previewItem)}
                  disabled={restoring}
                  style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: restoring ? '#86efac' : '#16a34a', color: '#fff', fontWeight: 700, cursor: restoring ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}
                >
                  <i className={`fas ${restoring ? 'fa-spinner fa-spin' : 'fa-trash-restore'}`} /> {restoring ? 'Restoring…' : 'Restore'}
                </button>
              )}
              {activeTab === 'Officials' && previewItem.position !== 'Barangay Hall' && (
                canRestoreOfficials() ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Status:
                    </label>
                    <select
                      value={previewItem.status}
                      disabled={restoring}
                      onChange={(e) => handleOfficialStatusChange(previewItem, e.target.value)}
                      style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: restoring ? '#f1f5f9' : '#fff', color: '#0f172a', fontWeight: 700, fontSize: '0.85rem', cursor: restoring ? 'default' : 'pointer' }}
                    >
                      {!OFFICIAL_STATUS_OPTIONS.includes(previewItem.status) && (
                        <option value={previewItem.status}>{previewItem.status}</option>
                      )}
                      {OFFICIAL_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {restoring && <i className="fas fa-spinner fa-spin" style={{ color: '#64748b' }} />}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', marginRight: 'auto', alignSelf: 'center' }}>
                    Only the Punong Barangay / Barangay Hall may change an official's status here.
                  </span>
                )
              )}
              <button onClick={() => setPreviewItem(null)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', fontWeight: 700, cursor: 'pointer', color: '#334155' }}>
                Close
              </button>
              <button onClick={() => handleDownloadPDF(activeTab, previewItem)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #2563eb', background: '#fff', fontWeight: 700, cursor: 'pointer', color: '#2563eb', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <i className="fas fa-list" /> Summary PDF
              </button>
              {/* 📄 Real document format (Documents tab only) — the issued layout, view + download. */}
              {activeTab === 'Documents' && (
                <button onClick={() => handleDownloadDocumentFormat(previewItem)} disabled={genDoc} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: genDoc ? '#93c5fd' : '#2563eb', color: '#fff', fontWeight: 700, cursor: genDoc ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <i className={`fas ${genDoc ? 'fa-spinner fa-spin' : 'fa-file-pdf'}`} /> {genDoc ? 'Rendering…' : 'Download Document'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}