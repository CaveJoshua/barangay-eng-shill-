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
  genderIdentity: 'MEN' | 'WOMEN' | 'LGBTQ+' | string; // Updated types
  dob: string; 
  birthCountry: string;
  birthProvince: string;
  birthCity: string;
  birthBarangay: string;
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

// HOTFIX 1: Sync the initial state values to be UPPERCASE
const initialState: IResident = {
  lastName: '', firstName: '', middleName: '',
  sex: 'Male', genderIdentity: 'MEN', dob: '', 
  birthCountry: 'PHILIPPINES', birthProvince: '', birthCity: '', birthBarangay: '',
  birthPlace: '', nationality: 'FILIPINO', religion: 'ROMAN CATHOLIC', contact_number: '09', email: '', 
  currentAddress: '', purok: '', civilStatus: 'SINGLE',
  education: 'NONE', employment: '', employmentStatus: 'UNEMPLOYED', occupation: '', 
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

  const [search, setSearch] = useState({
    day: '', month: '', year: '', country: 'PHILIPPINES', province: '', city: '', brgy: '', nationality: 'FILIPINO'
  });

  const dateRefs = { day: useRef<HTMLDivElement>(null), month: useRef<HTMLDivElement>(null), year: useRef<HTMLDivElement>(null) };
  const locRefs = { country: useRef<HTMLDivElement>(null), prov: useRef<HTMLDivElement>(null), city: useRef<HTMLDivElement>(null), brgy: useRef<HTMLDivElement>(null), nat: useRef<HTMLDivElement>(null) };

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
        let pBrgy = residentData.birthBarangay || rawDB.birth_barangay || '';
        let pPlace = residentData.birthPlace || rawDB.birth_place || '';

        if (pPlace && (!pProv || !pCity)) {
          const parts = pPlace.split(',').map((s: string) => s.trim().toUpperCase());
          if (parts.length >= 4) {
            pCountry = parts[0];
            pProv = parts[1];
            pCity = parts[2];
            pBrgy = parts[3];
          } else if (parts.length === 3) {
            pProv = parts[0];
            pCity = parts[1];
            pBrgy = parts[2];
          }
        }

        const correctedProvince = PGSU.findProvinceOfCity(pProv);
        if (correctedProvince && pProv !== correctedProvince) {
            pCity = pProv; 
            pProv = correctedProvince; 
        }

        setSearch({
          day: isNaN(d.getTime()) ? '' : d.getDate().toString().padStart(2, '0'),
          month: isNaN(d.getTime()) ? '' : (d.getMonth() + 1).toString().padStart(2, '0'),
          year: isNaN(d.getTime()) ? '' : d.getFullYear().toString(),
          country: pCountry,
          province: pProv.toUpperCase(),
          city: pCity.toUpperCase(),
          brgy: pBrgy.toUpperCase(),
          nationality: residentData.nationality || 'FILIPINO'
        });

        const standardReligion = ["ROMAN CATHOLIC", "ISLAM", "IGLESIA NI CRISTO"];
        const standardCivil = ["SINGLE", "MARRIED", "WIDOWED", "SEPARATED"];
        const standardGender = ["MEN", "WOMEN", "LGBTQ+"];
        const standardEdu = ["NONE", "ELEMENTARY", "HIGH SCHOOL", "COLLEGE", "POST-GRAD"];
        const standardEmp = ["UNEMPLOYED", "FULL-TIME", "PART-TIME", "SELF-EMPLOYED", "STUDENT"];

        const customObj: Record<string, boolean> = {};
        if (residentData.religion && !standardReligion.includes(residentData.religion.toUpperCase())) customObj.religion = true;
        if (residentData.civilStatus && !standardCivil.includes(residentData.civilStatus.toUpperCase())) customObj.civilStatus = true;
        if (residentData.genderIdentity && !standardGender.includes(residentData.genderIdentity.toUpperCase())) customObj.genderIdentity = true;
        if (residentData.education && !standardEdu.includes(residentData.education.toUpperCase())) customObj.education = true;
        if (residentData.employmentStatus && !standardEmp.includes(residentData.employmentStatus.toUpperCase())) customObj.employmentStatus = true;
        
        setCustomFields(customObj);
      } else {
        setFormData(initialState);
        setSearch({ day: '', month: '', year: '', country: 'PHILIPPINES', province: '', city: '', brgy: '', nationality: 'FILIPINO' });
        setCustomFields({});
      }
      setErrors({});
    }
  }, [isOpen, residentData, months]);

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
  const availableBrgys = useMemo(() => PGSU.getBarangays(search.city), [search.city]);

  const filterLimit = (list: string[], term: string) => list.filter(i => i.toLowerCase().includes(term.toLowerCase())).slice(0, 20);

  const filteredBrgyList = useMemo(() => {
    if (!search.brgy) return availableBrgys.slice(0, 20);
    return filterLimit(availableBrgys, search.brgy);
  }, [availableBrgys, search.brgy]);

  const handleLocSearchChange = (field: string, val: string) => {
    const upper = val.toUpperCase();
    if (field === 'province') setSearch(s => ({ ...s, province: upper, city: '', brgy: '' }));
    else if (field === 'city') setSearch(s => ({ ...s, city: upper, brgy: '' }));
    else setSearch(s => ({ ...s, [field]: upper }));
  };

  useEffect(() => {
    if (search.day && search.month && search.year) {
      setFormData(prev => ({ ...prev, dob: `${search.year}-${search.month}-${search.day}` }));
    }
    const full = `${search.country}, ${search.province}, ${search.city}, ${search.brgy}`.toUpperCase();
    setFormData(prev => ({ 
      ...prev, birthCountry: search.country, birthProvince: search.province, 
      birthCity: search.city, birthBarangay: search.brgy, birthPlace: full, nationality: search.nationality 
    }));
  }, [search]);

  const handleChange = (field: keyof IResident, value: any) => {
    let v = value;
    const uppers = ['lastName', 'firstName', 'middleName', 'currentAddress', 'occupation', 'employment', 'pwdIdNumber', 'seniorIdNumber', 'fourPsIdNumber', 'soloParentIdNumber', 'voterIdNumber', 'religion', 'civilStatus', 'genderIdentity', 'education', 'employmentStatus'];
    if (uppers.includes(field)) v = String(value).toUpperCase();

    if (v === 'OTHERS') {
      setCustomFields(prev => ({ ...prev, [field]: true }));
      v = ''; 
    }

    setFormData(p => ({ ...p, [field]: v }));
    if (errors[field]) setErrors(p => ({ ...p, [field]: '' }));
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
      FIRST_NAME: formData.firstName,
      LAST_NAME: formData.lastName,
      MIDDLE_NAME: formData.middleName,
      SEX: formData.sex,
      GENDER_IDENTITY: formData.genderIdentity,
      DOB: formData.dob,
      BIRTH_COUNTRY: formData.birthCountry,
      BIRTH_PROVINCE: formData.birthProvince,
      BIRTH_CITY: formData.birthCity,
      BIRTH_BARANGAY: formData.birthBarangay,
      BIRTH_PLACE: formData.birthPlace,
      NATIONALITY: formData.nationality,
      RELIGION: formData.religion,
      CONTACT_NUMBER: formData.contact_number, 
      EMAIL: formData.email,
      CURRENT_ADDRESS: formData.currentAddress,
      PUROK: formData.purok,
      CIVIL_STATUS: formData.civilStatus,
      EDUCATION: formData.education,
      EMPLOYMENT: formData.employment,
      EMPLOYMENT_STATUS: formData.employmentStatus,
      OCCUPATION: formData.occupation,
      IS_VOTER: formData.isVoter,
      IS_PWD: formData.isPWD,
      IS_4PS: formData.is4Ps,
      IS_SOLO_PARENT: formData.isSoloParent,
      IS_SENIOR_CITIZEN: formData.isSeniorCitizen,
      IS_IP: formData.isIP,
      VOTER_ID_NUMBER: formData.voterIdNumber,
      PWD_ID_NUMBER: formData.pwdIdNumber,
      SOLO_PARENT_ID_NUMBER: formData.soloParentIdNumber,
      SENIOR_ID_NUMBER: formData.seniorIdNumber,
      FOUR_PS_ID_NUMBER: formData.fourPsIdNumber,
      ACTIVITY_STATUS: formData.activityStatus
    };

    try {
      const result = await ApiService.saveResident(residentData?.id, safePayload);
      
      if (result.success) {
        onSuccess(result.data); 
        onClose();
      } else {
        alert(`Registration failed: ${result.error}`);
      }
    } catch (error) {
      console.error("Submission Error:", error);
      alert('Handshake failed. Check connection.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="RMS_OVERLAY" onClick={onClose}>
      <div className="RMS_CARD" onClick={e => e.stopPropagation()}>
        <div className="RMS_HEADER">
          <h2>{residentData ? 'UPDATE RESIDENT PROFILE' : 'RESIDENT REGISTRATION'}</h2>
          <button className="RMS_CLOSE_X" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={onSubmit} className="RMS_FORM">
          <div className="RMS_BODY">
            
            {/* SECTION 1: PERSONAL IDENTITY */}
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
                  {errors.middleName && <span className="RMS_ERROR_TXT">{errors.middleName}</span>}
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">DATE OF BIRTH *</label>
                  <div className="RMS_DATE_FLEX">
                    <div className="RMS_SEARCH_SELECT_WRAP" ref={dateRefs.month}>
                      <input className="RMS_INPUT" placeholder="MM" value={search.month} onFocus={() => setVisibleList('month')} onChange={e => setSearch({...search, month: e.target.value})} maxLength={2} />
                      {visibleList === 'month' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(months, search.month).map(m => <li key={m} onClick={() => {setSearch({...search, month: m}); setVisibleList(null);}}>{m}</li>)}</ul>}
                    </div>
                    <div className="RMS_SEARCH_SELECT_WRAP" ref={dateRefs.day}>
                      <input className="RMS_INPUT" placeholder="DD" value={search.day} onFocus={() => setVisibleList('day')} onChange={e => setSearch({...search, day: e.target.value})} maxLength={2} />
                      {visibleList === 'day' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(days, search.day).map(d => <li key={d} onClick={() => {setSearch({...search, day: d}); setVisibleList(null);}}>{d}</li>)}</ul>}
                    </div>
                    <div className="RMS_SEARCH_SELECT_WRAP" ref={dateRefs.year}>
                      <input className="RMS_INPUT" placeholder="YYYY" value={search.year} onFocus={() => setVisibleList('year')} onChange={e => setSearch({...search, year: e.target.value})} maxLength={4} />
                      {visibleList === 'year' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(years, search.year).map(y => <li key={y} onClick={() => {setSearch({...search, year: y}); setVisibleList(null);}}>{y}</li>)}</ul>}
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
                  {errors.birthCountry && <span className="RMS_ERROR_TXT">{errors.birthCountry}</span>}
                </div>
                <div className="RMS_GROUP" ref={locRefs.prov}>
                  <label className="RMS_LABEL">PROVINCE OF BIRTH</label>
                  <div className="RMS_SEARCH_SELECT_WRAP">
                    <input className="RMS_INPUT" placeholder="SEARCH PROVINCE..." value={search.province} onFocus={() => setVisibleList('prov')} onChange={e => handleLocSearchChange('province', e.target.value)} />
                    {visibleList === 'prov' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(availableProvinces, search.province).map(p => <li key={p} onClick={() => {handleLocSearchChange('province', p); setVisibleList(null);}}>{p}</li>)}</ul>}
                  </div>
                  {errors.birthProvince && <span className="RMS_ERROR_TXT">{errors.birthProvince}</span>}
                </div>
                <div className="RMS_GROUP" ref={locRefs.city}>
                  <label className="RMS_LABEL">CITY/MUNICIPALITY</label>
                  <div className="RMS_SEARCH_SELECT_WRAP">
                    <input className="RMS_INPUT" placeholder={search.province ? "SEARCH CITY..." : "SELECT PROVINCE"} value={search.city} onFocus={() => setVisibleList('city')} onChange={e => handleLocSearchChange('city', e.target.value)} disabled={!search.province} />
                    {visibleList === 'city' && <ul className="RMS_SEARCH_RESULTS">{filterLimit(availableCities, search.city).map(c => <li key={c} onClick={() => {handleLocSearchChange('city', c); setVisibleList(null);}}>{c}</li>)}</ul>}
                  </div>
                  {errors.birthCity && <span className="RMS_ERROR_TXT">{errors.birthCity}</span>}
                </div>
                <div className="RMS_GROUP" ref={locRefs.brgy}>
                  <label className="RMS_LABEL">BARANGAY OF BIRTH</label>
                  <div className="RMS_SEARCH_SELECT_WRAP">
                    <input className="RMS_INPUT" placeholder={search.city ? "SEARCH BRGY..." : "SELECT CITY"} value={search.brgy} onFocus={() => setVisibleList('brgy')} onChange={e => handleLocSearchChange('brgy', e.target.value)} disabled={!search.city} />
                    {visibleList === 'brgy' && (
                      <ul className="RMS_SEARCH_RESULTS">
                        {filteredBrgyList.length > 0 ? (
                          filteredBrgyList.map(b => <li key={b} onClick={() => {handleLocSearchChange('brgy', b); setVisibleList(null);}}>{b}</li>)
                        ) : (
                          <li style={{padding: '10px', color: '#94a3b8', fontSize: '0.7rem', textAlign: 'center'}}>NO BARANGAYS FOUND</li>
                        )}
                      </ul>
                    )}
                  </div>
                  {errors.birthBarangay && <span className="RMS_ERROR_TXT">{errors.birthBarangay}</span>}
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">SEX *</label>
                  <select className="RMS_INPUT" value={formData.sex} onChange={e => handleChange('sex', e.target.value)}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                
                {/* HOTFIX 2: Sync dropdown values to match state */}
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
                      <option value="ISLAM">ISLAM</option>
                      <option value="IGLESIA NI CRISTO">IGLESIA NI CRISTO</option>
                      <option value="OTHERS">OTHERS (SPECIFY)</option>
                    </select>
                  )}
                </div>

                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">GENDER IDENTITY</label>
                  {customFields.genderIdentity ? (
                    <input className="RMS_INPUT" autoFocus placeholder="SPECIFY GENDER..." value={formData.genderIdentity} onChange={e => handleChange('genderIdentity', e.target.value)} onBlur={() => handleCustomBlur('genderIdentity')} />
                  ) : (
                    <select className="RMS_INPUT" value={formData.genderIdentity} onChange={e => handleChange('genderIdentity', e.target.value)}>
                      <option value="MEN">Men</option>
                      <option value="WOMEN">Women</option>
                      <option value="LGBTQ+">LGBTQ+</option>
                      <option value="OTHERS">OTHERS (SPECIFY)</option>
                    </select>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION 2: SOCIO-ECONOMIC PROFILE */}
            <div className="RMS_SECTION">
              <div className="RMS_SEC_TITLE">Socio-Economic Profile</div>
              <div className="RMS_GRID">
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">HIGHEST EDUCATION</label>
                  {customFields.education ? (
                    <input className="RMS_INPUT" autoFocus placeholder="SPECIFY EDUCATION..." value={formData.education} onChange={e => handleChange('education', e.target.value)} onBlur={() => handleCustomBlur('education')} />
                  ) : (
                    <select className="RMS_INPUT" value={formData.education} onChange={e => handleChange('education', e.target.value)}>
                      <option value="NONE">None</option>
                      <option value="ELEMENTARY">Elementary</option>
                      <option value="HIGH SCHOOL">High School</option>
                      <option value="COLLEGE">College</option>
                      <option value="POST-GRAD">Post-Grad</option>
                      <option value="OTHERS">OTHERS (SPECIFY)</option>
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
                  {errors.occupation && <span className="RMS_ERROR_TXT">{errors.occupation}</span>}
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">EMPLOYER / COMPANY</label>
                  <input className="RMS_INPUT" value={formData.employment} onChange={e => handleChange('employment', e.target.value)} />
                </div>
              </div>
            </div>

            {/* SECTION 3: RESIDENCE & CONTACT */}
            <div className="RMS_SECTION">
              <div className="RMS_SEC_TITLE">Residence & Contact</div>
              <div className="RMS_GRID">
                <div className="RMS_GROUP RMS_SPAN2">
                  <label className="RMS_LABEL">CURRENT ADDRESS *</label>
                  <input className="RMS_INPUT" value={formData.currentAddress} onChange={e => handleChange('currentAddress', e.target.value)} required />
                  {errors.currentAddress && <span className="RMS_ERROR_TXT">{errors.currentAddress}</span>}
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">PUROK *</label>
                  <select className="RMS_INPUT" value={formData.purok} onChange={e => handleChange('purok', e.target.value)} required>
                    <option value="">SELECT LOCATION</option>
                    {[1, 2, 3, 4, 5, 6, 7].map(p => <option key={p} value={`Purok ${p}`}>Purok {p}</option>)}
                  </select>
                  {errors.purok && <span className="RMS_ERROR_TXT">{errors.purok}</span>}
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">CONTACT NUMBER</label>
                  <input className="RMS_INPUT" value={formData.contact_number} onChange={e => handleChange('contact_number', e.target.value)} maxLength={11} placeholder="09XXXXXXXXX" />
                  {errors.contact_number && <span className="RMS_ERROR_TXT">{errors.contact_number}</span>}
                </div>
                <div className="RMS_GROUP">
                  <label className="RMS_LABEL">EMAIL ADDRESS</label>
                  <input type="email" className="RMS_INPUT" value={formData.email} onChange={e => handleChange('email', e.target.value)} />
                  {errors.email && <span className="RMS_ERROR_TXT">{errors.email}</span>}
                </div>
              </div>
            </div>

            {/* SECTION 4: CLASSIFICATIONS & IDs */}
            <div className="RMS_SECTION">
              <div className="RMS_SEC_TITLE">Classifications & Special IDs</div>
              <div className="RMS_CHECK_GRID">
                {[
                  { k: 'isVoter', l: 'VOTER' }, { k: 'isPWD', l: 'PWD' }, 
                  { k: 'is4Ps', l: '4PS' }, { k: 'isSoloParent', l: 'SOLO PARENT' }, 
                  { k: 'isSeniorCitizen', l: 'SENIOR' }, { k: 'isIP', l: 'IP' }
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
                      <input className="RMS_INPUT" value={formData.voterIdNumber} onChange={e => handleChange('voterIdNumber', e.target.value)} placeholder="LEAVE BLANK IF NONE" />
                    </div>
                  )}
                  {formData.isPWD && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">PWD ID #</label>
                      <input className="RMS_INPUT" value={formData.pwdIdNumber} onChange={e => handleChange('pwdIdNumber', e.target.value)} />
                      {errors.pwdIdNumber && <span className="RMS_ERROR_TXT">{errors.pwdIdNumber}</span>}
                    </div>
                  )}
                  {formData.is4Ps && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">4Ps ID #</label>
                      <input className="RMS_INPUT" value={formData.fourPsIdNumber} onChange={e => handleChange('fourPsIdNumber', e.target.value)} />
                      {errors.fourPsIdNumber && <span className="RMS_ERROR_TXT">{errors.fourPsIdNumber}</span>}
                    </div>
                  )}
                  {formData.isSoloParent && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">SOLO PARENT ID #</label>
                      <input className="RMS_INPUT" value={formData.soloParentIdNumber} onChange={e => handleChange('soloParentIdNumber', e.target.value)} />
                      {errors.soloParentIdNumber && <span className="RMS_ERROR_TXT">{errors.soloParentIdNumber}</span>}
                    </div>
                  )}
                  {formData.isSeniorCitizen && (
                    <div className="RMS_GROUP">
                      <label className="RMS_LABEL">SENIOR ID #</label>
                      <input className="RMS_INPUT" value={formData.seniorIdNumber} onChange={e => handleChange('seniorIdNumber', e.target.value)} />
                      {errors.seniorIdNumber && <span className="RMS_ERROR_TXT">{errors.seniorIdNumber}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="RMS_FOOTER">
            <button type="button" className="RMS_BTN_CANCEL" onClick={onClose}>DISCARD</button>
            <button type="submit" className="RMS_BTN_SUBMIT" disabled={isLoading}>{isLoading ? 'SAVING...' : 'CONFIRM REGISTRATION'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};