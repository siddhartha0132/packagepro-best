export type PackageComponent = {
  id: string;
  type: "hotel" | "experience" | "transfer";
  label: string;
  detail: string;
  price: number;
  swapGroup?: string;
};

export type PackageRecord = {
  id: string;
  name: string;
  theme: string;
  city: string;
  duration: number;
  basePrice: number;
  description: string;
  tags: string[];
  components: PackageComponent[];
};

export type GuideRecord = {
  id: string;
  name: string;
  city: string;
  languages: string[];
  specialisation: string;
  rating: number;
  dayRate: number;
  bio: string;
  availability: Record<string, boolean>;
};

export type FlightRecord = { id: string; airline: string; route: string; depart: string; duration: string; price: number; confidence: number };
export type HotelRecord = { id: string; name: string; city: string; rating: number; detail: string; total: number };

export const FLIGHTS: FlightRecord[] = [
  { id: "AI-203", airline: "Air India", route: "DEL → MAA", depart: "06:20", duration: "2h 45m", price: 6800, confidence: 0.94 },
  { id: "6E-441", airline: "IndiGo", route: "DEL → MAA", depart: "09:10", duration: "2h 50m", price: 5900, confidence: 0.89 },
  { id: "UK-821", airline: "Vistara", route: "DEL → MAA", depart: "17:35", duration: "2h 55m", price: 7600, confidence: 0.92 },
];

export const HOTELS: HotelRecord[] = [
  { id: "hotel-courtyard", name: "Courtyard heritage stay", city: "Thanjavur", rating: 4.7, detail: "Boutique · breakfast included · old town", total: 6800 },
  { id: "hotel-palace", name: "Palace garden stay", city: "Thanjavur", rating: 4.9, detail: "Luxury · breakfast included · private garden", total: 11900 },
  { id: "hotel-haveli", name: "Pink haveli", city: "Jaipur", rating: 4.8, detail: "Boutique · breakfast included · old city", total: 9200 },
  { id: "hotel-goa", name: "Garden boutique", city: "Goa", rating: 4.6, detail: "Boutique · breakfast included · quiet lane", total: 7600 },
  { id: "hotel-vns", name: "Riverfront guesthouse", city: "Varanasi", rating: 4.5, detail: "Boutique · breakfast included · ghat-side", total: 6100 },
];

export const PACKAGES: PackageRecord[] = [
  {
    id: "pkg-thanjavur-heritage",
    name: "The Chola trail",
    theme: "Heritage",
    city: "Thanjavur",
    duration: 3,
    basePrice: 21400,
    description: "Tamil-speaking stories, living bronze craft, and the quiet geometry of the Chola heartland.",
    tags: ["heritage", "culture", "slow travel"],
    components: [
      { id: "hotel-thanjavur-courtyard", type: "hotel", label: "Courtyard heritage stay", detail: "Boutique · breakfast included", price: 6800, swapGroup: "hotel" },
      { id: "hotel-thanjavur-palace", type: "hotel", label: "Palace garden stay", detail: "Luxury · breakfast included", price: 11900, swapGroup: "hotel" },
      { id: "experience-thanjavur-temple", type: "experience", label: "Brihadisvara at first light", detail: "Private heritage walk", price: 4100, swapGroup: "experience" },
      { id: "experience-thanjavur-bronze", type: "experience", label: "The bronze makers", detail: "Living craft studio visit", price: 3500, swapGroup: "experience" },
      { id: "transfer-thanjavur", type: "transfer", label: "Station to the old town", detail: "Private sedan", price: 1500, swapGroup: "transfer" },
    ],
  },
  {
    id: "pkg-jaipur-heritage",
    name: "Rose City, slowly",
    theme: "Heritage",
    city: "Jaipur",
    duration: 4,
    basePrice: 28500,
    description: "Pink city mornings, hand-block prints, and a heritage stay close to the old walls.",
    tags: ["heritage", "food", "slow travel"],
    components: [
      { id: "hotel-jaipur-boutique", type: "hotel", label: "Courtyard haveli stay", detail: "Boutique · breakfast included", price: 9200, swapGroup: "hotel" },
      { id: "hotel-jaipur-grand", type: "hotel", label: "Grand palace hotel", detail: "Luxury · breakfast included", price: 16800, swapGroup: "hotel" },
      { id: "experience-jaipur-walk", type: "experience", label: "Old city at first light", detail: "Guided heritage walk", price: 4200, swapGroup: "experience" },
      { id: "experience-jaipur-food", type: "experience", label: "The thali trail", detail: "Market-to-table tasting", price: 5600, swapGroup: "experience" },
      { id: "transfer-jaipur", type: "transfer", label: "Airport to haveli", detail: "Private sedan", price: 1800, swapGroup: "transfer" },
    ],
  },
  {
    id: "pkg-goa-coast",
    name: "Goa, beyond the beach",
    theme: "Slow travel",
    city: "Goa",
    duration: 4,
    basePrice: 22400,
    description: "A softer Goa built around local kitchens, quiet coves, and an unhurried final day.",
    tags: ["beach", "food", "slow travel"],
    components: [
      { id: "hotel-goa-garden", type: "hotel", label: "Garden boutique", detail: "Boutique · breakfast included", price: 7600, swapGroup: "hotel" },
      { id: "hotel-goa-retreat", type: "hotel", label: "Sea-facing retreat", detail: "Luxury · breakfast included", price: 14200, swapGroup: "hotel" },
      { id: "experience-goa-kitchen", type: "experience", label: "Home kitchen supper", detail: "Local food experience", price: 3900, swapGroup: "experience" },
      { id: "experience-goa-cove", type: "experience", label: "Coves by scooter", detail: "Half-day coastal route", price: 3300, swapGroup: "experience" },
      { id: "transfer-goa", type: "transfer", label: "Airport to coast", detail: "Private sedan", price: 1600, swapGroup: "transfer" },
    ],
  },
  {
    id: "pkg-varanasi-river",
    name: "River, ritual, morning light",
    theme: "Pilgrimage",
    city: "Varanasi",
    duration: 3,
    basePrice: 19800,
    description: "A grounded introduction to the riverfront, living craft, and the city's devotional rhythm.",
    tags: ["heritage", "religious", "culture"],
    components: [
      { id: "hotel-vns-house", type: "hotel", label: "Riverfront guesthouse", detail: "Boutique · breakfast included", price: 6100, swapGroup: "hotel" },
      { id: "hotel-vns-palace", type: "hotel", label: "Ghat-side palace", detail: "Luxury · breakfast included", price: 11200, swapGroup: "hotel" },
      { id: "experience-vns-dawn", type: "experience", label: "Dawn on the ghats", detail: "Private boat and walk", price: 3600, swapGroup: "experience" },
      { id: "experience-vns-craft", type: "experience", label: "Silk and living craft", detail: "Textile studio visit", price: 3100, swapGroup: "experience" },
      { id: "transfer-vns", type: "transfer", label: "Station to ghat", detail: "Private sedan", price: 1400, swapGroup: "transfer" },
    ],
  },
];

export const GUIDES: GuideRecord[] = [
  { id: "guide-arjun", name: "Arjun Nair", city: "Thanjavur", languages: ["ta", "en-IN", "kn"], specialisation: "heritage", rating: 4.9, dayRate: 2400, bio: "Living history, temple architecture, and the details most guidebooks miss.", availability: { "2026-09-02": false, "2026-09-03": true, "2026-09-04": true } },
  { id: "guide-meera", name: "Meera Novak", city: "Thanjavur", languages: ["ta", "en-IN"], specialisation: "heritage", rating: 4.8, dayRate: 2700, bio: "A Tamil-speaking heritage specialist with a calm, story-rich pace.", availability: { "2026-09-02": true, "2026-09-03": true, "2026-09-04": true } },
  { id: "guide-kavya", name: "Kavya Menon", city: "Jaipur", languages: ["hi", "en-IN"], specialisation: "heritage", rating: 4.7, dayRate: 2600, bio: "Old-city walks, palace courtyards, and the quieter craft lanes.", availability: { "2026-09-02": true, "2026-09-03": true, "2026-09-04": true } },
  { id: "guide-ravi", name: "Ravi D'Souza", city: "Goa", languages: ["en-IN", "hi"], specialisation: "food", rating: 4.6, dayRate: 2100, bio: "Home kitchens, quiet coves, and the Goa that isn't on the postcard.", availability: { "2026-09-02": true, "2026-09-03": true, "2026-09-04": true } },
  { id: "guide-anika", name: "Anika Mishra", city: "Varanasi", languages: ["hi", "en-IN"], specialisation: "heritage", rating: 4.8, dayRate: 2300, bio: "River mornings, living craft, and the city's devotional rhythm.", availability: { "2026-09-02": true, "2026-09-03": true, "2026-09-04": true } },
  { id: "guide-priya", name: "Priya Reddy", city: "Ahmedabad", languages: ["gu", "en-IN"], specialisation: "heritage", rating: 4.8, dayRate: 2500, bio: "Heritage precincts, stepwells, and food traditions of Gujarat.", availability: { "2026-09-02": false, "2026-09-03": true, "2026-09-04": true } },
  { id: "guide-riya", name: "Riya Costa", city: "Ahmedabad", languages: ["gu", "en-IN"], specialisation: "heritage", rating: 4.7, dayRate: 2200, bio: "A warm local storyteller for old-city walks and architecture.", availability: { "2026-09-02": true, "2026-09-03": true, "2026-09-04": true } },
];

export function getAlternatives(pkg: PackageRecord, componentId: string) {
  const component = pkg.components.find(item => item.id === componentId);
  return component ? pkg.components.filter(item => item.swapGroup === component.swapGroup && item.id !== component.id) : [];
}

export function datesBetween(start: string, duration: number) {
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: duration }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function guideCheck(guide: GuideRecord, dates: string[]) {
  const conflicts = dates.filter(date => guide.availability[date] === false);
  const candidates = GUIDES.filter(candidate => candidate.id !== guide.id && candidate.city === guide.city && candidate.specialisation === guide.specialisation && candidate.languages.some(language => guide.languages.includes(language)) && dates.every(date => candidate.availability[date] === true));
  const replacement = candidates.sort((a, b) => Math.abs(a.dayRate - guide.dayRate) - Math.abs(b.dayRate - guide.dayRate) || b.rating - a.rating)[0] ?? null;
  return { conflicts, replacement, priceDelta: replacement ? (replacement.dayRate - guide.dayRate) * dates.length : null };
}

export function recommendPackages(query: string, language: string) {
  const terms = query.toLowerCase().split(/[^a-z-]+/).filter(term => term.length > 2);
  const packages = PACKAGES.map(pkg => ({ ...pkg, score: terms.filter(term => `${pkg.name} ${pkg.description} ${pkg.tags.join(" ")}`.toLowerCase().includes(term)).length })).sort((a, b) => b.score - a.score || a.basePrice - b.basePrice);
  const guides = GUIDES.filter(guide => guide.languages.includes(language) || guide.languages.includes("en-IN")).sort((a, b) => b.rating - a.rating);
  return { packages: packages.slice(0, 3), guides: guides.slice(0, 3) };
}

export function realityCheck(destination: string, budget: number, duration: number) {
  const pkg = PACKAGES.find(item => item.city.toLowerCase() === destination.toLowerCase()) ?? PACKAGES[0];
  const typical = pkg.basePrice + FLIGHTS[1].price + (HOTELS.find(hotel => hotel.city === pkg.city)?.total ?? 7000);
  const gap = Math.round(((budget - typical) / typical) * 100);
  return { destination: pkg.city, typical, budget, gap, verdict: budget >= typical * 1.1 ? "comfortable" : budget >= typical * .82 ? "tight" : "unrealistic", closestPackage: pkg.name, duration };
}
