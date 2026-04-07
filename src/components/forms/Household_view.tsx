import { useState, useEffect, useRef } from 'react';
import './styles/Household_view.css';
// 🛡️ ZERO TRUST: Import the Mastermind Service
import { ApiService } from '../UI/api';

// --- INTERFACES ---
export interface HouseholdViewProps {
  householdId: string;
  onClose: () => void;
}

interface IMemberDetails {
  record_id: string;
  first_name: string;
  last_name: string;
  sex: string;
  dob: string;
  occupation: string;
  is_4ps: boolean;
  monthly_income: string;
  relationship_to_head?: string;
}

interface IHouseholdDetails {
  household_number: string;
  head_name: string;
  zone: string;
  address_raw: string; 
}

export default function Household_view({ householdId, onClose }: HouseholdViewProps) {
  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<IHouseholdDetails | null>(null);
  const [members, setMembers] = useState<IMemberDetails[]>([]);
  
  // ── SAFE REFS FOR THE HANDSHAKE ──
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const valve = new AbortController();

    const fetchHouseholdData = async () => {
      setLoading(true);
      try {
        // 🛡️ TRIGGER: Concurrent fetch through the Mastermind Service
        const [hhData, resData] = await Promise.all([
          ApiService.getHouseholds(valve.signal),
          ApiService.getResidents(valve.signal)
        ]);

        if (!isMounted.current) return;

        // Process Household Details
        if (hhData) {
          const targetHousehold = hhData.find((h: any) => h.id === householdId);
          if (targetHousehold) {
            setHousehold({
              household_number: targetHousehold.household_number,
              head_name: targetHousehold.head,
              zone: targetHousehold.zone,
              address_raw: targetHousehold.address || "Tenure: N/A",
            });
          }
        }

        // Process Family Members
        if (resData) {
          const familyMembers = resData.filter((r: any) => r.household_id === householdId);
          setMembers(familyMembers);
        }

      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error("[HH VIEW] Handshake Failure:", error);
        }
      } finally {
        if (isMounted.current) setLoading(false);
      }
    };

    if (householdId) fetchHouseholdData();

    return () => {
      isMounted.current = false;
      valve.abort();
    };
  }, [householdId]);

  // --- PARSING LOGIC (Simplified to Tenure Only) ---
  const parseTenureData = (rawString: string) => {
    if (!rawString) return 'N/A';
    const parts = rawString.split('|').map(s => s.trim());
    const found = parts.find(p => p.toLowerCase().includes('tenure'));
    return found ? found.split(':')[1]?.trim() || 'N/A' : 'N/A';
  };

  const tenure = household ? parseTenureData(household.address_raw) : 'N/A';
  
  const is4Ps = members.some(m => m.is_4ps);
  const isIndigent = members.some(m => {
      const incomeStr = String(m.monthly_income || '0').replace(/\D/g, '');
      const income = parseInt(incomeStr);
      return income > 0 && income < 5000;
  });

  return (
    <div className="HP_MODAL_OVERLAY">
      <div className="HP_MODAL_CARD HP_VIEW_CARD">
        
        <div className="HP_MODAL_HEADER">
          <div className="HP_HEADER_META">
            <h2 className="HP_MODAL_TITLE">Household Profile</h2>
            {household && <span className="HP_HH_ID_BADGE">{household.household_number}</span>}
          </div>
          <button className="HP_MODAL_CLOSE_X" onClick={onClose}>&times;</button>
        </div>

        <div className="HP_MODAL_SCROLL_BODY">
          {loading ? (
            <div className="HP_LOADING_STATE">
              <i className="fas fa-circle-notch fa-spin"></i>
              <p style={{marginLeft: '10px', display: 'inline-block'}}>Syncing household records...</p>
            </div>
          ) : household ? (
            <>
              <div className="HP_VIEW_STATS_GRID">
                <div className="HP_VIEW_INFO_BLOCK">
                  <div className="HP_FIELD_LABEL">Family Head</div>
                  <div className="HP_FIELD_VALUE_BOLD">{household.head_name}</div>
                  <div className="HP_BADGE_ROW">
                    <span className="HP_SUB_INFO"><i className="fas fa-map-marker-alt"></i> {household.zone}</span>
                    {is4Ps && <span className="HP_STATUS_BADGE HP_STATUS_4PS">4Ps</span>}
                    {isIndigent && <span className="HP_STATUS_BADGE HP_STATUS_INDIGENT">Indigent</span>}
                  </div>
                </div>

                <div className="HP_VIEW_INFO_BLOCK HP_SOCIO_DETAILS">
                  <div className="HP_SOCIO_ITEM">
                    <span className="HP_FIELD_LABEL">Tenure:</span>
                    <span className="HP_FIELD_VALUE" style={{fontWeight: 700, color: '#3b82f6'}}>{tenure}</span>
                  </div>
                  {/* Water and Toilet items removed */}
                </div>
              </div>

              <div className="HP_MEMBERS_SECTION">
                <div className="HP_SECTION_INDICATOR">Registered Family Members ({members.length})</div>
                <div className="HP_TABLE_WRAP">
                  <table className="HP_VIEW_TABLE">
                    <thead>
                      <tr>
                        <th>Full Name</th>
                        <th>Relationship</th>
                        <th>Sex</th>
                        <th className="HP_TEXT_CENTER">Age</th>
                        <th>Occupation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.length === 0 ? (
                        <tr><td colSpan={5} className="HP_TABLE_EMPTY">No members found in registry.</td></tr>
                      ) : (
                        members.map((m) => {
                          const age = m.dob ? new Date().getFullYear() - new Date(m.dob).getFullYear() : '-';
                          const isHead = `${m.last_name}, ${m.first_name}`.toLowerCase() === household.head_name.toLowerCase();

                          return (
                            <tr key={m.record_id}>
                              <td className="HP_MEMBER_NAME">{m.last_name}, {m.first_name}</td>
                              <td style={{fontWeight: 600, color: isHead ? '#3b82f6' : 'inherit'}}>
                                {isHead ? 'HEAD' : (m.relationship_to_head || 'Member')}
                              </td>
                              <td>{m.sex || 'N/A'}</td>
                              <td className="HP_TEXT_CENTER">{age}</td>
                              <td>{m.occupation || 'N/A'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="HP_ERROR_STATE">Identity Link Broken: Household not found.</div>
          )}
        </div>
      </div>
    </div>
  );
}