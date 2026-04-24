import React, { useState, useEffect, useMemo, useRef } from 'react';
import { validateResidentForm } from './Tools/Resident_Model/Logic_Error'; 
import { PGSU } from './Tools/Resident_Model/location'; 
import './styles/Resident_modal.css';
import { ApiService } from '../UI/api'; 

export interface IResident {
  id?: string;
  lastName: string;
  firstName: string;
  middleName: string;
  sex: 'Male' | 'Female';
  dob: string; 
  birthCountry: string;
  birthProvince: string;
  birthCity: string;
  birthPlace: string; 
  civilStatus: string;
  nationality: string;
  religion: string;
  contact_number: string; 
  email: string;
  currentAddress: string;
  purok: string;
  education: string;
  employment: string; 
  employmentStatus: string; 
  occupation: string;
  activityStatus: 'Active' | 'Inactive' | 'Leave';
  isVoter: boolean;
  isPWD: boolean;
  is4Ps: boolean;
  isSoloParent: boolean;
  isSeniorCitizen: boolean;
  isIP: boolean;
  voterIdNumber?: string;
  pwdIdNumber?: string;
  soloParentIdNumber?: string;
  seniorIdNumber?: string;
  fourPsIdNumber?: string;
}

const initialState: IResident = {
  lastName: '', firstName: '', middleName: '',
  sex: 'Male', dob: '', 
  birthCountry: 'PHILIPPINES', birthProvince: '', birthCity: '',
  birthPlace: '', nationality: 'FILIPINO', religion: 'ROMAN CATHOLIC', contact_number: '', email: '', 
  currentAddress: '', purok: '', civilStatus: 'SINGLE',
  education: 'ELEMENTARY GRADUATE', employment: '', employmentStatus: 'UNEMPLOYED', occupation: '', 
  activityStatus: 'Active', isVoter: false, isPWD: false, 
  is4Ps: false, isSoloParent: false, isSeniorCitizen: false, isIP: false,
  voterIdNumber: '', pwdIdNumber: '', soloParentIdNumber: '', seniorIdNumber: '', fourPsIdNumber: ''
};

const NATIONALITIES = [
  "AFGHAN", "ALBANIAN", "ALGERIAN", "AMERICAN", "ANDORRAN", "ANGOLAN", "ANTIGUAN", "ARGENTINE", "ARMENIAN", "AUSTRALIAN", "AUSTRIAN", "AZERBAIJANI", "BAHAMIAN", "BAHRAINI", "BANGLADESHI", "BARBADIAN", "BELARUSIAN", "BELGIAN", "BELIZEAN", "BENINESE", "BHUTANESE", "BOLIVIAN", "BOSNIAN", "BRAZILIAN", "BRITISH", "BRUNEIAN", "BULGARIAN", "BURKINABE", "BURMESE", "BURUNDIAN", "CAMBODIAN", "CAMEROONIAN", "CANADIAN", "CAPE VERDEAN", "CENTRAL AFRICAN", "CHADIAN", "CHILEAN", "CHINESE", "COLOMBIAN", "COMORAN", "CONGOLESE", "COSTA RICAN", "CROATIAN", "CUBAN", "CYPRIOT", "CZECH", "DANISH", "DJIBOUTIAN", "DOMINICAN", "DUTCH", "EAST TIMORESE", "ECUADORIAN", "EGYPTIAN", "EMIRATI", "EQUATORIAL GUINEAN", "ERITREAN", "ESTONIAN", "ETHIOPIAN", "FIJIAN", "FILIPINO", "FINNISH", "FRENCH", "GABONESE", "GAMBIAN", "GEORGIAN", "GERMAN", "GHANAIAN", "GREEK", "GRENADIAN", "GUATEMALAN", "GUINEAN", "GUINEA-BISSAUAN", "GUYANESE", "HAITIAN", "HONDURAN", "HUNGARIAN", "ICELANDIC", "INDIAN", "INDONESIAN", "IRANIAN", "IRAQI", "IRISH", "ISRAELI", "ITALIAN", "IVORIAN", "JAMAICAN", "JAPANESE", "JORDANIAN", "KAZAKH", "KENYAN", "KIRIBATI", "KUWAITI", "KYRGYZ", "LAO", "LATVIAN", "LEBANESE", "LIBERIAN", "LIBYAN", "LIECHTENSTEINER", "LITHUANIAN", "LUXEMBOURGER", "MACEDONIAN", "MALAGASY", "MALAWIAN", "MALAYSIAN", "MALDIVIAN", "MALIAN", "MALTESE", "MARSHALLESE", "MAURITANIAN", "MAURITIAN", "MEXICAN", "MICRONESIAN", "MOLDOVAN", "MONACAN", "MONGOLIAN", "MONTENEGRIN", "MOROCCAN", "MOZAMBICAN", "NAMIBIAN", "NAURUAN", "NEPALESE", "NEW ZEALANDER", "NICARAGUAN", "NIGERIAN", "NIGERIEN", "NORTH KOREAN", "NORWEGIAN", "OMANI", "PAKISTANI", "PALAUAN", "PANAMANIAN", "PAPUA NEW GUINEAN", "PARAGUAYAN", "PERUVIAN", "POLISH", "PORTUGUESE", "QATARI", "ROMANIAN", "RUSSIAN", "RWANDAN", "SAINT LUCIAN", "SALVADORAN", "SAMOAN", "SAN MARINESE", "SAO TOMEAN", "SAUDI", "SENEGALESE", "SERBIAN", "SEYCHELLOIS", "SIERRA LEONEAN", "SINGAPOREAN", "SLOVAK", "SLOVENIAN", "SOLOMON ISLANDER", "SOMALI", "SOUTH AFRICAN", "SOUTH KOREAN", "SPANISH", "SRI LANKAN", "SUDANESE", "SURINAMESE", "SWAZI", "SWEDISH", "SWISS", "SYRIAN", "TAIWANESE", "TAJIK", "TANZANIAN", "THAI", "TOGOLESE", "TONGAN", "TRINIDADIAN", "TUNISIAN", "TURKISH", "TURKMEN", "TUVALUAN", "UGANDAN", "UKRAINIAN", "URUGUAYAN", "UZBEK", "VANUATUAN", "VENEZUELAN", "VIETNAMESE", "YEMENI", "ZAMBIAN", "ZIMBABWEAN"
];

export const ResidentModal: React.FC<{
  isOpen: boolean; onClose: () => void; onSuccess: (newRecord: any) => void; residentData: IResident | null;
}> = ({ isOpen, onClose, onSuccess, residentData }) => {
  const [formData, setFormData] = useState<IResident>(initialState);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [visibleList, setVisibleList] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<Record<string, boolean>>({});
  
  // State for formal notification
  const [successMessage, setSuccessMessage] = useState('');
  const [isClosingPopup, setIsClosingPopup] = useState(false);

  const isUpdateMode = !!residentData?.id;

  const [search, setSearch] = useState({
    day: '', month: '', year: '', country: 'PHILIPPINES', province: '', city: '', nationality: 'FILIPINO'
  });

  const dateRefs = { day: useRef<HTMLDivElement>(null), month: useRef<HTMLDivElement>(null), year: useRef<HTMLDivElement>(null) };
  const locRefs = { country: useRef<HTMLDivElement>(null), prov: useRef<HTMLDivElement>(null), city: useRef<HTMLDivElement>(null), nat: useRef<HTMLDivElement>(null) };

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')), []);
  const days = useMemo(() => Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0')), []);
  const years = useMemo(() => Array.from({ length: 110 }, (_, i) => (new Date().getFullYear() - i).toString()), []);

  useEffect(() => {
    if (isOpen) {
      if (residentData) {
        setFormData({ ...residentData });
        const d = new Date(residentData.dob);
        
        const rawDB = residentData as any;
        let pCountry = residentData.birthCountry || rawDB.birth_country || 'PHILIPPINES';
        let pProv = residentData.birthProvince || rawDB.birth_province || '';
        let pCity = residentData.birthCity || rawDB.birth_city || '';
        let pPlace = residentData.birthPlace || rawDB.birth_place || '';

        if (pPlace && (!pProv || !pCity)) {
          const parts = pPlace.split(',').map((s: string) => s.trim().toUpperCase());
          if (parts.length >= 3) {
            pCountry = parts[0]; pProv = parts[1]; pCity = parts[2];
          } else if (parts.length === 2) {
            pProv = parts[0]; pCity = parts[1];
          }
        }

        const correctedProvince = PGSU.findProvinceOfCity(pProv);
        if (correctedProvince && pProv !== correctedProvince) {
            pCity = pProv; pProv = correctedProvince; 
        }

        setSearch({
          day: isNaN(d.getTime()) ? '' : d.getDate().toString().padStart(2, '0'),
          month: isNaN(d.getTime()) ? '' : (d.getMonth() + 1).toString().padStart(2, '0'),
          year: isNaN(d.getTime()) ? '' : d.getFullYear().toString(),
          country: pCountry,
          province: pProv.toUpperCase(),
          city: pCity.toUpperCase(),
          nationality: residentData.nationality || 'FILIPINO'
        });

        const standardReligion = ["ROMAN CATHOLIC", "IGLESIA NI CRISTO", "JEHOVAH'S WITNESSES"];
        const standardCivil = ["SINGLE", "MARRIED", "WIDOWED", "SEPARATED"];
        const standardEdu = ["ELEMENTARY GRADUATE", "HIGH SCHOOL GRADUATE", "COLLEGE GRADUATE", "MASTER'S DEGREE", "DOCTORATE"];
        const standardEmp = ["UNEMPLOYED", "FULL-TIME", "PART-TIME", "SELF-EMPLOYED", "STUDENT"];

        const customObj: Record<string, boolean> = {};
        if (residentData.religion && !standardReligion.includes(residentData.religion.toUpperCase())) customObj.religion = true;
        if (residentData.civilStatus && !standardCivil.includes(residentData.civilStatus.toUpperCase())) customObj.civilStatus = true;
        if (residentData.education && !standardEdu.includes(residentData.education.toUpperCase())) customObj.education = true;
        if (residentData.employmentStatus && !standardEmp.includes(residentData.employmentStatus.toUpperCase())) customObj.employmentStatus = true;
        
        setCustomFields(customObj);
      } else {
        setFormData(initialState);
        setSearch({ day: '', month: '', year: '', country: 'PHILIPPINES', province: '', city: '', nationality: 'FILIPINO' });
        setCustomFields({});
      }
      setErrors({});
      setSuccessMessage('');
      setIsClosingPopup(false);
    }
  }, [isOpen, residentData]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const allRefs = [...Object.values(dateRefs), ...Object.values(locRefs)];
      if (!allRefs.some(r => r.current?.contains(e.target as Node))) setVisibleList(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const availableCountries = useMemo(() => PGSU.getCountries(), []);
  const availableProvinces = useMemo(() => PGSU.getProvinces(), []);
  const availableCities = useMemo(() => PGSU.getCities(search.province), [search.province]);

  const filterLimit = (list: string[], term: string) => list.filter(i => i.toLowerCase().includes(term.toLowerCase())).slice(0, 20);

  const handleDateChange = (field: 'day' | 'month' | 'year', val: string) => {
    if (!/^[0-9]*$/.test(val)) return;

    if (field === 'month') {
      const m = parseInt(val, 10);
      if (val.length === 2 && (m < 1 || m > 12)) return;
      if (val.length > 2) return;
    }
    
    if (field === 'day') {
      const d = parseInt(val, 10);
      const m = parseInt(search.month || '0', 10);
      let maxDays = 31;
      
      if (m === 2) {
          const y = parseInt(search.year || '0', 10);
          const isLeap = y > 0 ? ((y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0)) : true;
          maxDays = isLeap ? 29 : 28;
      } else if ([4, 6, 9, 11].includes(m)) {
          maxDays = 30;
      }
      
      if (val.length >= 2 && (d < 1 || d > maxDays)) return;
      if (val.length > 2) return;
    }
    
    if (field === 'year') {
      if (val.length > 4) return;
    }
    
    setSearch(s => ({ ...s, [field]: val }));
  };

  const handleLocSearchChange = (field: string, val: string) => {
    if (field === 'province' || field === 'city') {
       if (!/^[A-Za-z\sñÑ]*$/.test(val)) return;
    }

    const upper = val.toUpperCase();
    if (field === 'province') setSearch(s => ({ ...s, province: upper, city: '' }));
    else if (field === 'city') setSearch(s => ({ ...s, city: upper }));
    else setSearch(s => ({ ...s, [field]: upper }));
  };

  useEffect(() => {
    if (search.day && search.month && search.year && !isUpdateMode) {
      setFormData(prev => ({ ...prev, dob: `${search.year}-${search.month}-${search.day}` }));
    }
    
    const full = [search.country, search.province, search.city].filter(Boolean).join(', ').toUpperCase();
    setFormData(prev => ({ 
      ...prev, birthCountry: search.country, birthProvince: search.province, 
      birthCity: search.city, birthPlace: full, nationality: search.nationality 
    }));
  }, [search, isUpdateMode]);

  const handleChange = (field: keyof IResident, value: any) => {
    if (isUpdateMode && field === 'dob') return;

    if (['lastName', 'firstName', 'middleName'].includes(field)) {
      if (!/^[A-Za-z\sñÑ]*$/.test(value)) return;
    }

    if (field === 'religion' && customFields.religion) {
      if (!/^[A-Za-z\sñÑ]*$/.test(value)) return;
    }

    if (field === 'contact_number') {
      if (!/^[0-9]*$/.test(value)) return; 
      if (value.length > 0 && value[0] !== '0') return; 
      if (value.length > 1 && value[1] !== '9') return; 
      if (value.length > 11) return; 
    }

    let v = value;
    const uppers = ['lastName', 'firstName', 'middleName', 'currentAddress', 'occupation', 'employment', 'pwdIdNumber', 'seniorIdNumber', 'fourPsIdNumber', 'soloParentIdNumber', 'voterIdNumber', 'religion', 'civilStatus', 'education', 'employmentStatus'];
    if (uppers.includes(field as string)) v = String(value).toUpperCase();

    if (v === 'OTHERS') {
      setCustomFields(prev => ({ ...prev, [field]: true }));
      v = ''; 
    }

    setFormData(p => ({ ...p, [field]: v }));
    if (errors[field as string]) setErrors(p => ({ ...p, [field]: '' }));
  };

  const handleCustomBlur = (field: keyof IResident) => {
    if (!formData[field] || String(formData[field]).trim() === '') {
      setCustomFields(prev => ({ ...prev, [field]: false }));
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valErrors = validateResidentForm(formData);
    if (Object.keys(valErrors).length > 0) { setErrors(valErrors); return; }
    
    setIsLoading(true);

    const safePayload = {
      firstName: formData.firstName, lastName: formData.lastName, middleName: formData.middleName,
      sex: formData.sex, dob: formData.dob, birthCountry: formData.birthCountry,
      birthProvince: formData.birthProvince, birthCity: formData.birthCity, birthPlace: formData.birthPlace,
      nationality: formData.nationality, religion: formData.religion, contact_number: formData.contact_number, 
      email: formData.email, currentAddress: formData.currentAddress, purok: formData.purok,
      civilStatus: formData.civilStatus, education: formData.education, employment: formData.employment,
      employmentStatus: formData.employmentStatus, occupation: formData.occupation, isVoter: formData.isVoter,
      isPWD: formData.isPWD, is4Ps: formData.is4Ps, isSoloParent: formData.isSoloParent,
      isSeniorCitizen: formData.isSeniorCitizen, isIP: formData.isIP, voterIdNumber: formData.voterIdNumber,
      pwdIdNumber: formData.pwdIdNumber, soloParentIdNumber: formData.soloParentIdNumber,
      seniorIdNumber: formData.seniorIdNumber, fourPsIdNumber: formData.fourPsIdNumber,
      activityStatus: formData.activityStatus
    };

    try {
      const result = await ApiService.saveResident(residentData?.id, safePayload);
      if (result.success) {
        // Trigger popup display
        setSuccessMessage(isUpdateMode ? 'Identity Updated Successfully' : 'Identity Registered Successfully');
        
        // Wait 2 seconds for admin to read it
        setTimeout(() => {
          setIsClosingPopup(true); // Trigger exit transition
          
          // Wait 400ms for exit animation to complete before actually closing modal
          setTimeout(() => {
            setSuccessMessage('');
            setIsClosingPopup(false);
            onSuccess(result.data); 
            onClose();
          }, 400); 
        }, 2000);
        
      } else {
        alert(`Request failed: ${result.error}`);
      }
    } catch (error) {
      alert('Handshake failed. Check connection.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const lockIcon = <i className="fas fa-lock" style={{ fontSize: '10px', color: '#cbd5e1', marginLeft: '5px' }}></i>;

  return (
    <div className="RMS_OVERLAY" onClick={onClose}>
      <div className="RMS_CARD" onClick={e => e.stopPropagation()}>
        
        {/* NEW PROFESSIONAL SUCCESS POPUP */}
        {successMessage && (
          <div 
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(255, 255, 255, 0.75)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              borderRadius: '8px',
              opacity: isClosingPopup ? 0 : 1,
              transition: 'opacity 0.4s ease-in-out',
            }}
          >
            <div 
              style={{
                backgroundColor: '#ffffff',
                padding: '35px 45px',
                borderRadius: '12px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05)',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
                transform: isClosingPopup ? 'translateY(-15px) scale(0.97)' : 'translateY(0) scale(1)',
                opacity: isClosingPopup ? 0 : 1,
                transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            >
              <div 
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  backgroundColor: '#ecfdf5',
                  color: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px'
                }}
              >
                <i className="fas fa-check"></i>
              </div>
              <div style={{ textAlign: 'center' }}>
                <h3 style={{ 
                  margin: '0 0 8px 0', 
                  color: '#0f172a', 
                  fontSize: '18px', 
                  fontWeight: '600',
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }}>
                  {successMessage}
                </h3>
                <p style={{ 
                  margin: 0, 
                  color: '#64748b', 
                  fontSize: '14px',
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }}>
                  The resident record has been securely saved.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="RMS_HEADER">
          <h2>{isUpdateMode ? 'UPDATE RESIDENT PROFILE' : 'RESIDENT REGISTRATION'}</h2>
          <button className="RMS_CLOSE_X" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={onSubmit} className="RMS_FORM">
          <div className="RMS_BODY">
            
            <div className="RMS_SECTION">
              <div className="RMS_SEC_TITLE">Personal Identity</div>
              <div className="RMS_GRID">
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">LAST NAME *</label>
                  <input className={`RMS_INPUT ${errors.lastName ? 'ERR_BORDER' : ''}`} value={formData.lastName} onChange={e => handleChange('lastName', e.target.value)} required />
                  {errors.lastName && <span className="RMS_ERROR_TXT">{errors.lastName}</span>}
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">FIRST NAME *</label>
                  <input className={`RMS_INPUT ${errors.firstName ? 'ERR_BORDER' : ''}`} value={formData.firstName} onChange={e => handleChange('firstName', e.target.value)} required />
                  {errors.firstName && <span className="RMS_ERROR_TXT">{errors.firstName}</span>}
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">MIDDLE NAME</label>
                  <input className="RMS_INPUT" value={formData.middleName} onChange={e => handleChange('middleName', e.target.value)} />
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">DATE OF BIRTH * {isUpdateMode && lockIcon}</label>
                  <div className="RMS_DATE_FLEX">
                    <div className="RMS_SEARCH_SELECT_WRAP" ref={dateRefs.month}>
                      <input className="RMS_INPUT" placeholder="MM" value={search.month} readOnly={isUpdateMode} onFocus={() => !isUpdateMode && setVisibleList('month')} onChange={e => handleDateChange('month', e.target.value)} maxLength={2} />
                      {visibleList === 'month' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(months, search.month).map(m => <li key={m} onClick={() => {handleDateChange('month', m); setVisibleList(null);}}>{m}</li>)}</ul>}
                    </div>
                    <div className="RMS_SEARCH_SELECT_WRAP" ref={dateRefs.day}>
                      <input className="RMS_INPUT" placeholder="DD" value={search.day} readOnly={isUpdateMode} onFocus={() => !isUpdateMode && setVisibleList('day')} onChange={e => handleDateChange('day', e.target.value)} maxLength={2} />
                      {visibleList === 'day' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(days, search.day).map(d => <li key={d} onClick={() => {handleDateChange('day', d); setVisibleList(null);}}>{d}</li>)}</ul>}
                    </div>
                    <div className="RMS_SEARCH_SELECT_WRAP" ref={dateRefs.year}>
                      <input className="RMS_INPUT" placeholder="YYYY" value={search.year} readOnly={isUpdateMode} onFocus={() => !isUpdateMode && setVisibleList('year')} onChange={e => handleDateChange('year', e.target.value)} maxLength={4} />
                      {visibleList === 'year' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(years, search.year).map(y => <li key={y} onClick={() => {handleDateChange('year', y); setVisibleList(null);}}>{y}</li>)}</ul>}
                    </div>
                  </div>
                  {errors.dob && <span className="RMS_ERROR_TXT">{errors.dob}</span>}
                </div>

                <div className="RMS_GROUP" ref={locRefs.country}>
                  <label className="RMS_LABEL">COUNTRY OF BIRTH</label>
                  <div className="RMS_SEARCH_SELECT_WRAP">
                    <input className="RMS_INPUT" value={search.country} onFocus={() => setVisibleList('country')} onChange={e => handleLocSearchChange('country', e.target.value)} />
                    {visibleList === 'country' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(availableCountries, search.country).map(c => <li key={c} onClick={() => {handleLocSearchChange('country', c); setVisibleList(null);}}>{c}</li>)}</ul>}
                  </div>
                </div>
                <div className="RMS_GROUP" ref={locRefs.prov}>
                  <label className="RMS_LABEL">PROVINCE OF BIRTH</label>
                  <div className="RMS_SEARCH_SELECT_WRAP">
                    <input className="RMS_INPUT" placeholder="SEARCH PROVINCE..." value={search.province} onFocus={() => setVisibleList('prov')} onChange={e => handleLocSearchChange('province', e.target.value)} />
                    {visibleList === 'prov' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(availableProvinces, search.province).map(p => <li key={p} onClick={() => {handleLocSearchChange('province', p); setVisibleList(null);}}>{p}</li>)}</ul>}
                  </div>
                </div>
                <div className="RMS_GROUP" ref={locRefs.city}>
                  <label className="RMS_LABEL">CITY/MUNICIPALITY</label>
                  <div className="RMS_SEARCH_SELECT_WRAP">
                    <input className="RMS_INPUT" placeholder="SEARCH CITY..." value={search.city} onFocus={() => setVisibleList('city')} onChange={e => handleLocSearchChange('city', e.target.value)} disabled={!search.province} />
                    {visibleList === 'city' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(availableCities, search.city).map(c => <li key={c} onClick={() => {handleLocSearchChange('city', c); setVisibleList(null);}}>{c}</li>)}</ul>}
                  </div>
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">SEX *</label>
                  <select className="RMS_INPUT" value={formData.sex} onChange={e => handleChange('sex', e.target.value as 'Male' | 'Female')}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">CIVIL STATUS</label>
                  {customFields.civilStatus ? (
                    <input className="RMS_INPUT" autoFocus placeholder="SPECIFY STATUS..." value={formData.civilStatus} onChange={e => handleChange('civilStatus', e.target.value)} onBlur={() => handleCustomBlur('civilStatus')} />
                  ) : (
                    <select className="RMS_INPUT" value={formData.civilStatus} onChange={e => handleChange('civilStatus', e.target.value)}>
                      <option value="SINGLE">Single</option>
                      <option value="MARRIED">Married</option>
                      <option value="WIDOWED">Widowed</option>
                      <option value="SEPARATED">Separated</option>
                      <option value="OTHERS">OTHERS (SPECIFY)</option>
                    </select>
                  )}
                </div>

                <div className="RMS_GROUP" ref={locRefs.nat}>
                  <label className="RMS_LABEL">NATIONALITY</label>
                  <div className="RMS_SEARCH_SELECT_WRAP">
                    <input className="RMS_INPUT" placeholder="SEARCH NATIONALITY..." value={search.nationality} onFocus={() => setVisibleList('nat')} onChange={e => handleLocSearchChange('nationality', e.target.value)} />
                    {visibleList === 'nat' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(NATIONALITIES, search.nationality).map(n => <li key={n} onClick={() => {handleLocSearchChange('nationality', n); setVisibleList(null);}}>{n}</li>)}</ul>}
                  </div>
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">RELIGION</label>
                  {customFields.religion ? (
                    <input className="RMS_INPUT" autoFocus placeholder="SPECIFY RELIGION..." value={formData.religion} onChange={e => handleChange('religion', e.target.value)} onBlur={() => handleCustomBlur('religion')} />
                  ) : (
                    <select className="RMS_INPUT" value={formData.religion} onChange={e => handleChange('religion', e.target.value)}>
                      <option value="ROMAN CATHOLIC">ROMAN CATHOLIC</option>
                      <option value="IGLESIA NI CRISTO">IGLESIA NI CRISTO</option>
                      <option value="JEHOVAH'S WITNESSES">JEHOVAH'S WITNESSES</option>
                      <option value="OTHERS">OTHERS (SPECIFY)</option>
                    </select>
                  )}
                </div>
              </div>
            </div>

            <div className="RMS_SECTION">
              <div className="RMS_SEC_TITLE">Socio-Economic Profile</div>
              <div className="RMS_GRID">
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">EDUCATIONAL ATTAINMENT</label>
                  {customFields.education ? (
                    <input className="RMS_INPUT" autoFocus placeholder="SPECIFY EDUCATION..." value={formData.education} onChange={e => handleChange('education', e.target.value)} onBlur={() => handleCustomBlur('education')} />
                  ) : (
                    <select className="RMS_INPUT" value={formData.education} onChange={e => handleChange('education', e.target.value)}>
                      <option value="ELEMENTARY GRADUATE">Elementary Graduate</option>
                      <option value="HIGH SCHOOL GRADUATE">High School Graduate</option>
                      <option value="COLLEGE GRADUATE">College Graduate</option>
                      <option value="MASTER'S DEGREE">Master's Degree</option>
                      <option value="DOCTORATE">Doctorate</option>
                    </select>
                  )}
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">EMPLOYMENT STATUS</label>
                  {customFields.employmentStatus ? (
                    <input className="RMS_INPUT" autoFocus placeholder="SPECIFY STATUS..." value={formData.employmentStatus} onChange={e => handleChange('employmentStatus', e.target.value)} onBlur={() => handleCustomBlur('employmentStatus')} />
                  ) : (
                    <select className="RMS_INPUT" value={formData.employmentStatus} onChange={e => handleChange('employmentStatus', e.target.value)}>
                      <option value="UNEMPLOYED">Unemployed</option>
                      <option value="FULL-TIME">Full-time</option>
                      <option value="PART-TIME">Part-time</option>
                      <option value="SELF-EMPLOYED">Self-Employed</option>
                      <option value="STUDENT">Student</option>
                      <option value="OTHERS">OTHERS (SPECIFY)</option>
                    </select>
                  )}
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">OCCUPATION</label>
                  <input className="RMS_INPUT" value={formData.occupation} onChange={e => handleChange('occupation', e.target.value)} placeholder="E.G. TEACHER, DRIVER" />
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">EMPLOYER / COMPANY</label>
                  <input className="RMS_INPUT" value={formData.employment} onChange={e => handleChange('employment', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="RMS_SECTION">
              <div className="RMS_SEC_TITLE">Residence & Contact</div>
              <div className="RMS_GRID">
                <div className="RMS_GROUP RMS_SPAN2">
                  <label className="RMS_LABEL">CURRENT ADDRESS *</label>
                  <input className="RMS_INPUT" value={formData.currentAddress} onChange={e => handleChange('currentAddress', e.target.value)} required />
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">PUROK *</label>
                  <select className="RMS_INPUT" value={formData.purok} onChange={e => handleChange('purok', e.target.value)} required>
                    <option value="">SELECT LOCATION</option>
                    {[1, 2, 3, 4, 5, 6, 7].map(p => <option key={p} value={`Purok ${p}`}>Purok {p}</option>)}
                  </select>
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">CONTACT NUMBER</label>
                  <input className="RMS_INPUT" value={formData.contact_number} onChange={e => handleChange('contact_number', e.target.value)} placeholder="09XXXXXXXXX" />
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">EMAIL ADDRESS</label>
                  <input type="email" className="RMS_INPUT" value={formData.email} onChange={e => handleChange('email', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="RMS_SECTION">
              <div className="RMS_SEC_TITLE">Classifications & Special IDs</div>
              <div className="RMS_CHECK_GRID">
                {[
                  { k: 'isVoter', l: "VOTER / SUFFRAGE (OPTIONAL)" }, 
                  { k: 'isPWD', l: 'PWD (OPTIONAL)' }, 
                  { k: 'is4Ps', l: '4PS (OPTIONAL)' }, 
                  { k: 'isSoloParent', l: 'SOLO PARENT (OPTIONAL)' }, 
                  { k: 'isSeniorCitizen', l: 'SENIOR (OPTIONAL)' }, 
                  { k: 'isIP', l: 'IP (OPTIONAL)' }
                ].map(item => (
                  <label key={item.k} className="RMS_CHECK_ITEM">
                    <input type="checkbox" checked={!!formData[item.k as keyof IResident]} onChange={e => handleChange(item.k as keyof IResident, e.target.checked)} />
                    <span>{item.l}</span>
                  </label>
                ))}
              </div>
              
              {(formData.isVoter || formData.isPWD || formData.is4Ps || formData.isSoloParent || formData.isSeniorCitizen) && (
                <div className="RMS_ID_CONTAINER">
                  {formData.isVoter && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">VOTER'S ID # (OPTIONAL)</label>
                      <input className="RMS_INPUT" value={formData.voterIdNumber} onChange={e => handleChange('voterIdNumber', e.target.value)} />
                    </div>
                  )}
                  {formData.isPWD && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">PWD ID #</label>
                      <input className="RMS_INPUT" value={formData.pwdIdNumber} onChange={e => handleChange('pwdIdNumber', e.target.value)} />
                    </div>
                  )}
                  {formData.is4Ps && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">4Ps ID #</label>
                      <input className="RMS_INPUT" value={formData.fourPsIdNumber} onChange={e => handleChange('fourPsIdNumber', e.target.value)} />
                    </div>
                  )}
                  {formData.isSoloParent && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">SOLO PARENT ID #</label>
                      <input className="RMS_INPUT" value={formData.soloParentIdNumber} onChange={e => handleChange('soloParentIdNumber', e.target.value)} />
                    </div>
                  )}
                  {formData.isSeniorCitizen && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">SENIOR CITIZEN ID #</label>
                      <input className="RMS_INPUT" value={formData.seniorIdNumber} onChange={e => handleChange('seniorIdNumber', e.target.value)} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="RMS_FOOTER">
            <button type="button" className="RMS_BTN_CANCEL" onClick={onClose} disabled={successMessage !== ''}>DISCARD</button>
            <button type="submit" className="RMS_BTN_SUBMIT" disabled={isLoading || successMessage !== ''}>
              {isLoading ? 'SAVING...' : (isUpdateMode ? 'UPDATE RECORD' : 'CONFIRM REGISTRATION')}
            </button>
          </div>
        </form>
      </div>
    </div>
  ); 
};