// Import raw JSON datasets
import rawProvinces from './data/provinces.json'; 
import rawCities from './data/municipalities.json'; 
import rawBarangays from './data/barangays.json';

/**
 * P.G.S.U. (Philippine Geographic Standard Unit)
 * Proprietary High-Performance Geographic Engine
 * Features: Smart Data Miner, Self-Healing Reverse Mapping, and Instant Indexing
 */
class PGSUEngine {
  private provinceList: string[] = [];
  // ALL Maps now strictly use Normalized Keys to prevent lookup failures
  private cityIndex: Map<string, string[]> = new Map();
  private brgyIndex: Map<string, string[]> = new Map();
  private reverseCityMap: Map<string, string> = new Map(); 

  constructor() {
    this.buildIndexes();
  }

  /**
   * SMART DATA MINER
   * Normalizes keys by stripping noise words and rogue punctuation.
   */
  private normalizeKey(name: string): string {
    if (!name) return "";
    
    const noiseWords = [
      'CITY', 'OF', 'CAPITAL', '(CAPITAL)', 
      '(POB.)', '(POBLACION)', 'POBLACION', 'PROVINCE'
    ];
    
    return name.toString()
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '') // Strips rogue punctuation
      .split(/\s+/)
      .filter(word => !noiseWords.includes(word))
      .join(' ')
      .trim();
  }

  /**
   * INITIALIZATION ENGINE
   * Converts flat JSON arrays into O(1) Hash Maps on application startup.
   */
  private buildIndexes() {
    try {
      // 1. Build Province Master List
      this.provinceList = rawProvinces
        .map((p: any) => (p.name || "").toString().toUpperCase().trim())
        .sort();

      // 2. Build City Index & Reverse Map
      rawCities.forEach((c: any) => {
        const provOriginal = (c.province || "").toString().toUpperCase().trim();
        const provNormalized = this.normalizeKey(provOriginal); 
        const cityOriginal = (c.name || "").toString().toUpperCase().trim();
        const cityNormalized = this.normalizeKey(cityOriginal);

        if (provNormalized && cityOriginal) {
          // Forward Index: Normalized Province -> [Raw Cities]
          if (!this.cityIndex.has(provNormalized)) {
            this.cityIndex.set(provNormalized, []);
          }
          this.cityIndex.get(provNormalized)!.push(cityOriginal);
          
          // Reverse Map: Normalized City -> Raw Province 
          this.reverseCityMap.set(cityNormalized, provOriginal);
        }
      });

      // 3. Build Barangay Index
      rawBarangays.forEach((b: any) => {
        const cityKey = this.normalizeKey(b.citymun);
        const brgyName = (b.name || "").toString().toUpperCase().trim();
        
        if (cityKey && brgyName) {
          if (!this.brgyIndex.has(cityKey)) {
            this.brgyIndex.set(cityKey, []);
          }
          this.brgyIndex.get(cityKey)!.push(brgyName);
        }
      });

      // 4. Final Alphabetization
      this.cityIndex.forEach(list => list.sort());
      this.brgyIndex.forEach(list => list.sort());

    } catch (error) {
      // Silently catch indexing errors without console logging to keep startup clean
    }
  }

  // =========================================================================
  // SURGICAL VALIDATION APIs
  // =========================================================================
  
  public isValidCity(province: string, city: string): boolean {
    const provKey = this.normalizeKey(province);
    const validCities = this.cityIndex.get(provKey) || [];
    // Compare normalized input against normalized list to ensure perfect match
    return validCities.some(c => this.normalizeKey(c) === this.normalizeKey(city));
  }

  public isValidBarangay(city: string, brgy: string): boolean {
    const cityKey = this.normalizeKey(city);
    const validBrgys = this.brgyIndex.get(cityKey) || [];
    // Strict uppercase match for Barangays
    return validBrgys.some(b => b === brgy.toUpperCase().trim());
  }

  // =========================================================================
  // PUBLIC API - HIGH-SPEED RETRIEVAL
  // =========================================================================

  /**
   * Returns a comprehensive list of all global countries.
   */
  public getCountries(): string[] {
    return [
      "PHILIPPINES", "AFGHANISTAN", "ALBANIA", "ALGERIA", "ANDORRA", "ANGOLA", "ANTIGUA AND BARBUDA", 
      "ARGENTINA", "ARMENIA", "AUSTRALIA", "AUSTRIA", "AZERBAIJAN", "BAHAMAS", "BAHRAIN", 
      "BANGLADESH", "BARBADOS", "BELARUS", "BELGIUM", "BELIZE", "BENIN", "BHUTAN", 
      "BOLIVIA", "BOSNIA AND HERZEGOVINA", "BOTSWANA", "BRAZIL", "BRUNEI", "BULGARIA", 
      "BURKINA FASO", "BURUNDI", "CABO VERDE", "CAMBODIA", "CAMEROON", "CANADA", 
      "CENTRAL AFRICAN REPUBLIC", "CHAD", "CHILE", "CHINA", "COLOMBIA", "COMOROS", 
      "CONGO", "COSTA RICA", "CROATIA", "CUBA", "CYPRUS", "CZECHIA", 
      "DEMOCRATIC REPUBLIC OF THE CONGO", "DENMARK", "DJIBOUTI", "DOMINICA", 
      "DOMINICAN REPUBLIC", "ECUADOR", "EGYPT", "EL SALVADOR", "EQUATORIAL GUINEA", 
      "ERITREA", "ESTONIA", "ESWATINI", "ETHIOPIA", "FIJI", "FINLAND", "FRANCE", 
      "GABON", "GAMBIA", "GEORGIA", "GERMANY", "GHANA", "GREECE", "GRENADA", 
      "GUATEMALA", "GUINEA", "GUINEA-BISSAU", "GUYANA", "HAITI", "HONDURAS", 
      "HUNGARY", "ICELAND", "INDIA", "INDONESIA", "IRAN", "IRAQ", "IRELAND", 
      "ISRAEL", "ITALY", "IVORY COAST", "JAMAICA", "JAPAN", "JORDAN", "KAZAKHSTAN", 
      "KENYA", "KIRIBATI", "KUWAIT", "KYRGYZSTAN", "LAOS", "LATVIA", "LEBANON", 
      "LESOTHO", "LIBERIA", "LIBYA", "LIECHTENSTEIN", "LITHUANIA", "LUXEMBOURG", 
      "MADAGASCAR", "MALAWI", "MALAYSIA", "MALDIVES", "MALI", "MALTA", 
      "MARSHALL ISLANDS", "MAURITANIA", "MAURITIUS", "MEXICO", "MICRONESIA", 
      "MOLDOVA", "MONACO", "MONGOLIA", "MONTENEGRO", "MOROCCO", "MOZAMBIQUE", 
      "MYANMAR", "NAMIBIA", "NAURU", "NEPAL", "NETHERLANDS", "NEW ZEALAND", 
      "NICARAGUA", "NIGER", "NIGERIA", "NORTH KOREA", "NORTH MACEDONIA", "NORWAY", 
      "OMAN", "PAKISTAN", "PALAU", "PALESTINE", "PANAMA", "PAPUA NEW GUINEA", 
      "PARAGUAY", "PERU", "POLAND", "PORTUGAL", "QATAR", "ROMANIA", "RUSSIA", 
      "RWANDA", "SAINT KITTS AND NEVIS", "SAINT LUCIA", "SAINT VINCENT AND THE GRENADINES", 
      "SAMOA", "SAN MARINO", "SAO TOME AND PRINCIPE", "SAUDI ARABIA", "SENEGAL", 
      "SERBIA", "SEYCHELLES", "SIERRA LEONE", "SINGAPORE", "SLOVAKIA", "SLOVENIA", 
      "SOLOMON ISLANDS", "SOMALIA", "SOUTH AFRICA", "SOUTH KOREA", "SOUTH SUDAN", 
      "SPAIN", "SRI LANKA", "SUDAN", "SURINAME", "SWEDEN", "SWITZERLAND", "SYRIA", 
      "TAIWAN", "TAJIKISTAN", "TANZANIA", "THAILAND", "TIMOR-LESTE", "TOGO", "TONGA", 
      "TRINIDAD AND TOBAGO", "TUNISIA", "TURKEY", "TURKMENISTAN", "TUVALU", "UGANDA", 
      "UKRAINE", "UNITED ARAB EMIRATES", "UNITED KINGDOM", "UNITED STATES OF AMERICA", 
      "URUGUAY", "UZBEKISTAN", "VANUATU", "VATICAN CITY", "VENEZUELA", "VIETNAM", 
      "YEMEN", "ZAMBIA", "ZIMBABWE", "OTHERS"
    ];
  }

  public getProvinces(): string[] {
    return this.provinceList;
  }

  /**
   * CASCADING LOOKUP: Gets cities for a province.
   * Includes recovery logic for misplaced city names in the province field.
   */
  public getCities(provinceName: string): string[] {
    if (!provinceName) return [];
    const normalized = this.normalizeKey(provinceName);
    
    // Self-Healing: If the input is actually a City (like Baguio), return the city name back
    if (this.brgyIndex.has(normalized) && !this.cityIndex.has(normalized)) {
      return [provinceName.toUpperCase()];
    }
    
    return this.cityIndex.get(normalized) || [];
  }

  /**
   * CASCADING LOOKUP: Gets barangays for a city.
   */
  public getBarangays(cityName: string): string[] {
    if (!cityName) return [];
    return this.brgyIndex.get(this.normalizeKey(cityName)) || [];
  }

  /**
   * SELF-HEALING HELPER: 
   * Essential for DataMapper. Reconstructs correct hierarchy if data is misaligned.
   */
  public findProvinceOfCity(cityName: string): string | null {
    if (!cityName) return null;
    return this.reverseCityMap.get(this.normalizeKey(cityName)) || null;
  }
}

// Export Singleton Instance
export const PGSU = new PGSUEngine();