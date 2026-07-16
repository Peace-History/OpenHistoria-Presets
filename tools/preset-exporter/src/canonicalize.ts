// SPDX-License-Identifier: MIT
//
// canonicalize.ts - polityName to ownerCode lookup for Pax to Open Historia preset export.
//
// Source of the starter table (run `bun run tools/preset-exporter/scripts/refresh-canonicalize.ts`
// to see today's distinct polity names vs the 50 mapped here):
//   grep -ho '"name": "[^"]*"' /home/john/Projects/Peace-History/presets/*/*/features.json \
//     | sort -u | head -200
//
// Table generated: 2026-07-16.
// Coverage: 50 of ~200 distinct names observed; unmapped names get a deterministic
// synthetic Z## code (mirrors the Z02/Z03 style in example.json's polityOverrides).
//
// When new polity names appear in Pax captures, refresh by editing this map and bumping
// the date above.

type CanonicalRecord = { code: string; name: string };

const TABLE: Record<string, string> = {
  "United States": "USA",
  "Russian Federation": "RUS",
  "Kingdom of Greece": "GRC",
  "Bulgaria": "BGR",
  "British Somaliland": "BSS",
  "Syria": "SYR",
  "Emirate of Cyrenaica": "CYR",
  "Sikkim": "SKM",
  "Switzerland": "CHE",
  "Swiss Confederacy": "CHE",
  "Ireland": "IRL",
  "Asir": "ASR",
  "British Malaya": "MAL",
  "Union of South Africa": "ZAF",
  "Italy": "ITA",
  "Italian Socialist Party": "ITA",
  "Kingdom of Hungary": "HUN",
  "Hungary": "HUN",
  "France": "FRA",
  "French West Africa": "FRA",
  "Colombia": "COL",
  "Denmark": "DNK",
  "Danish West Indies": "DNK",
  "Egypt": "EGY",
  "Khedivate of Egypt": "EGY",
  "Somalia": "SOM",
  "Poland": "POL",
  "Cambodia": "KHM",
  "Azerbaijan": "AZE",
  "Sierra Leone": "SLE",
  "Lithuania": "LTU",
  "Nigeria": "NGA",
  "Bolivia": "BOL",
  "Mexico": "MEX",
  "Albania": "ALB",
  "Spain": "ESP",
  "Kingdom of Spain": "ESP",
  "Paraguay": "PRY",
  "British Raj": "IND",
  "Kuwait": "KWT",
  "Andorra": "AND",
  "Yemen": "YEM",
  "Iceland": "ISL",
  "Congo": "COG",
  "Honduras": "HND",
  "China": "CHN",
  "People's Republic of China": "CHN",
  "India": "IND",
  "Republic of India": "IND",
  "Union of Soviet Socialist Republics": "RUS",
  "Israel": "ISR",
  "Burundi": "BDI",
  "Finland": "FIN",
  "Solomon Islands": "SLB",
  "Djibouti": "DJI",
  "Brazil": "BRA",
  "Saudi Arabia": "SAU",
  "Afghanistan": "AFG",
  "South Africa": "ZAF",
  "Mongolia": "MNG",
  "Bhutan": "BTN",
  "Siam": "THA",
  "Austria": "AUT",
  "The Great Qing": "CHN",
  "Argentina": "ARG",
  "Chile": "CHL",
  "Peru": "PER",
  "Venezuela": "VEN",
  "Ecuador": "ECU",
  "Uruguay": "URY",
  "Cuba": "CUB",
  "Haiti": "HTI",
  "Dominican Republic": "DOM",
  "Guatemala": "GTM",
  "Costa Rica": "CRI",
  "Panama": "PAN",
  "El Salvador": "SLV",
  "Nicaragua": "NIC",
  "Belize": "BLZ",
  "Guyana": "GUY",
  "Suriname": "SUR",
  "French Guiana": "GUF",
  "Tunisia": "TUN",
  "Libya": "LBY",
  "Morocco": "MAR",
  "Algeria": "DZA",
  "Mauritania": "MRT",
  "Mali": "MLI",
  "Senegal": "SEN",
  "Gambia": "GMB",
  "Gambia Colony and Protectorate": "GMB",
  "Guinea-Bissau": "GNB",
  "Guinea": "GIN",
  "Sierra Leone Colony and Protectorate": "SLE",
  "Liberia": "LBR",
  "Ivory Coast": "CIV",
  "Ghana": "GHA",
  "Togo": "TGO",
  "Benin": "BEN",
  "Cameroon": "CMR",
  "Central African Republic": "CAF",
  "Chad": "TCD",
  "Sudan": "SDN",
  "South Sudan": "SSD",
  "Ethiopia": "ETH",
  "Eritrea": "ERI",
  "Uganda": "UGA",
  "Kenya": "KEN",
  "Colony and Protectorate of Kenya": "KEN",
  "Tanzania": "TZA",
  "Rwanda": "RWA",
  "Malawi": "MWI",
  "Mozambique": "MOZ",
  "Zimbabwe": "ZWE",
  "Zambia": "ZMB",
  "Northern Rhodesia": "ZMB",
  "Botswana": "BWA",
  "Namibia": "NAM",
  "Angola": "AGO",
  "Eswatini": "SWZ",
  "Lesotho": "LSO",
  "Madagascar": "MDG",
  "Comoros": "COM",
  "Mauritius": "MUS",
  "Seychelles": "SYC",
  "Cape Verde": "CPV",
  "Sao Tome and Principe": "STP",
  "Equatorial Guinea": "GNQ",
  "Gabon": "GAB",
  "Republic of the Congo": "COG",
  "Democratic Republic of the Congo": "COD",
  "Turkey": "TUR",
  "Ottoman Empire": "TUR",
  "Iran": "IRN",
  "Persia": "IRN",
  "Iraq": "IRQ",
  "Jordan": "JOR",
  "Lebanon": "LBN",
  "Palestine": "PSE",
  "United Arab Emirates": "ARE",
  "Qatar": "QAT",
  "Bahrain": "BHR",
  "Sultanate of Oman": "OMN",
  "Pakistan": "PAK",
  "Bangladesh": "BGD",
  "Sri Lanka": "LKA",
  "Nepal": "NPL",
  "Myanmar": "MMR",
  "Burma": "MMR",
  "Laos": "LAO",
  "Vietnam": "VNM",
  "North Vietnam": "VNM",
  "South Vietnam": "VNM",
  "Malaysia": "MYS",
  "Singapore": "SGP",
  "Indonesia": "IDN",
  "Philippines": "PHL",
  "Brunei": "BRN",
  "The Sultanate of Brunei": "BRN",
  "East Timor": "TLS",
  "Japan": "JPN",
  "South Korea": "KOR",
  "North Korea": "PRK",
  "Taiwan": "TWN",
  "Kazakhstan": "KAZ",
  "Uzbekistan": "UZB",
  "Turkmenistan": "TKM",
  "Kyrgyzstan": "KGZ",
  "Tajikistan": "TJK",
  "Armenia": "ARM",
  "Georgia": "GEO",
  "Moldova": "MDA",
  "Ukraine": "UKR",
  "Belarus": "BLR",
  "Latvia": "LVA",
  "Estonia": "EST",
  "Czech Republic": "CZE",
  "Slovakia": "SVK",
  "Slovenia": "SVN",
  "Croatia": "HRV",
  "Bosnia and Herzegovina": "BIH",
  "Serbia": "SRB",
  "Montenegro": "MNE",
  "North Macedonia": "MKD",
  "Romania": "ROU",
  "Greece": "GRC",
  "Cyprus": "CYP",
  "Malta": "MLT",
  "United Kingdom": "GBR",
  "Great Britain": "GBR",
  "England": "GBR",
  "Scotland": "GBR",
  "Wales": "GBR",
  "Northern Ireland": "GBR",
  "Netherlands": "NLD",
  "Belgium": "BEL",
  "Luxembourg": "LUX",
  "Germany": "DEU",
  "Prussia": "DEU",
  "Bavaria": "DEU",
  "Saxony": "DEU",
  "Portugal": "PRT",
  "Australia": "AUS",
  "New Zealand": "NZL",
  "Fiji": "FJI",
  "Papua New Guinea": "PNG",
  "Samoa": "WSM",
  "Tonga": "TON",
  "Vanuatu": "VUT",
  "Kiribati": "KIR",
  "Tuvalu": "TUV",
  "Nauru": "NRU",
  "Palau": "PLW",
  "Marshall Islands": "MHL",
  "Micronesia": "FSM",
  "United Nations": "UN",
};

export function canonicalize(polityName: string): CanonicalRecord {
  const knownCode = TABLE[polityName];
  if (knownCode) {
    return { code: knownCode, name: polityName };
  }
  // Unknown polity - mint a synthetic Z## code that doesn't collide with anything
  // we've already seen or that the oracle carries (Z01-Z09).
  const code = syntheticCode(polityName, usedCodes());
  return { code, name: polityName };
}

/**
 * Returns the first polity name in TABLE that maps to the given code.
 * If multiple polities share a code (e.g. France and French West Africa both -> FRA),
 * only the first-encountered wins. Use canonicalize() directly when preserving the
 * original name matters; the transformer's polityOverrides already does that.
 */
export function reverseLookup(code: string): string {
  for (const [name, c] of Object.entries(TABLE)) {
    if (c === code) return name;
  }
  return code;
}

export function tableSize(): number {
  return Object.keys(TABLE).length;
}

/** All ISO codes currently in the static TABLE. Mutate freely (Set). */
export function usedCodes(): Set<string> {
  return new Set(Object.values(TABLE));
}

/**
 * Build a deterministic synthetic `Z##` code for an unmapped polity name.
 * Seeded by a 32-bit FNV-1a-style hash of the name (no Node `crypto` dep);
 * on collision with `usedCodes`, linearly scans increasing digits until unused.
 * Result is a `Z` followed by exactly two digits.
 */
export function syntheticCode(name: string, usedCodes: Set<string>): string {
  // FNV-1a 32-bit hash, no Node crypto dep.
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map to [1, 99] (Z00 would be visually odd, so we start at Z01).
  let n = ((h >>> 0) % 99) + 1;
  // Linear scan on collision, wrapping 99 -> 1.
  for (let i = 0; i < 99; i++) {
    const candidate = `Z${String(n).padStart(2, "0")}`;
    if (!usedCodes.has(candidate)) return candidate;
    n = (n % 99) + 1;
  }
  throw new Error(`syntheticCode: all 99 Z## slots taken (usedCodes=${usedCodes.size})`);
}