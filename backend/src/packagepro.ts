import { fromPaise, loadCatalogue, rupees, toPaise, type HotelRow } from "./catalogue";
import { guideBookedCount } from "./appStore";

export type PackageComponent = {
  id: string;
  type: "hotel" | "experience" | "transfer" | "meal" | "entry_ticket";
  label: string;
  detail: string;
  price: number;
  swapGroup?: string;
  dayIndex?: number;
  slot?: string;
  optional?: boolean;
  entityId?: string;
  /** true for the line the curated package ships with; false for swap alternatives */
  isDefault?: boolean;
};

export type PackageRecord = {
  id: string;
  cityId: string;
  name: string;
  theme: string;
  tier: string;
  difficulty: string;
  city: string;
  duration: number;
  durationNights: number;
  basePrice: number;
  currency: string;
  /** tour_packages.min_group_size / max_group_size — enforced when a trip is created. */
  minGroupSize: number;
  maxGroupSize: number;
  description: string;
  inclusions: string;
  exclusions: string;
  languagesOffered: string[];
  guideSpecialisation: string;
  image: string;
  tags: string[];
  components: PackageComponent[];
};

export type GuideRecord = {
  id: string;
  name: string;
  city: string;
  cityId: string;
  languages: string[];
  specialisation: string;
  secondarySpecialisation: string | null;
  rating: number;
  reviewCount: number;
  yearsExperience: number;
  certified: boolean;
  dayRate: number;
  halfDayRate: number;
  bio: string;
  /** guide_availability.is_available by for_date; a missing date means unknown and is treated as unavailable. */
  availability: Record<string, boolean>;
  /** guide_availability.price_multiplier by for_date (peak-date uplift). */
  priceMultiplier: Record<string, number>;
  /** guide_availability.slots_available by for_date: how many groups the guide can take that day. */
  slots: Record<string, number>;
};

export type FlightRecord = { id: string; airline: string; route: string; depart: string; arrive?: string; duration: string; stops?: number; via?: string; logo?: string; aircraft?: string; price: number; confidence: number; source?: string };
export type HotelRecord = { id: string; name: string; city: string; rating: number; detail: string; total: number; nightly?: number };
export type TransportRecord = { id: string; mode: "train" | "cab"; operator: string; route: string; depart: string; duration: string; price: number; confidence: number };

export const FLIGHTS: FlightRecord[] = [
  { id: "AI-203", airline: "Air India", route: "DEL → MAA", depart: "06:20", arrive: "09:05", duration: "2h 45m", price: 6800, confidence: 0.94 },
  { id: "6E-441", airline: "IndiGo", route: "DEL → MAA", depart: "09:10", arrive: "12:00", duration: "2h 50m", price: 5900, confidence: 0.89 },
  { id: "UK-821", airline: "Vistara", route: "DEL → MAA", depart: "17:35", arrive: "20:30", duration: "2h 55m", price: 7600, confidence: 0.92 },
];

export const TRANSPORTS: TransportRecord[] = [
  { id: "vande-bharat-del-jai", mode: "train", operator: "Vande Bharat Express", route: "New Delhi → Jaipur", depart: "06:10", duration: "4h 25m", price: 1850, confidence: 0.93 },
  { id: "cab-del-jai", mode: "cab", operator: "Private sedan", route: "New Delhi → Jaipur", depart: "Flexible", duration: "5h 15m", price: 6200, confidence: 0.89 },
  { id: "vande-bharat-del-agra", mode: "train", operator: "Intercity Express", route: "New Delhi → Agra", depart: "07:00", duration: "2h 10m", price: 950, confidence: 0.91 },
];

// ---------------------------------------------------------------------------
// Catalogue loaded from the PS-04 dataset
// ---------------------------------------------------------------------------

const data = loadCatalogue();

export const CITIES = data.cities;
/** Legal BCP-47 tags from the languages table (rule R6). */
export const LANGUAGE_TAGS = new Set(data.languages);
const cityById = new Map(data.cities.map(city => [city.city_id, city]));
const cityName = (cityId: string) => cityById.get(cityId)?.name ?? cityId;

const THEME_LABEL: Record<string, string> = { food_trail: "Food trail" };
const themeLabel = (theme: string) => THEME_LABEL[theme] ?? theme.charAt(0).toUpperCase() + theme.slice(1);

// Which guide specialisation best serves each package theme.
const THEME_SPECIALISATION: Record<string, string[]> = {
  heritage: ["heritage", "photography"],
  pilgrimage: ["religious", "heritage"],
  food_trail: ["food", "shopping"],
  adventure: ["trekking", "photography"],
  wildlife: ["wildlife", "photography"],
  honeymoon: ["photography", "heritage", "food"],
  family: ["heritage", "accessibility", "food"],
  wellness: ["accessibility", "trekking"],
};

const THEME_COLOUR: Record<string, [string, string]> = {
  heritage: ["#8a5a2b", "#d9b27c"], pilgrimage: ["#7a3b2e", "#e0a36b"], food_trail: ["#9b4a1c", "#f0b56a"],
  adventure: ["#1f5c4a", "#7cc3a4"], wildlife: ["#2f5d2a", "#9ccf7a"], honeymoon: ["#7d2f4f", "#e9a3b9"],
  family: ["#2b4f7d", "#9ec3ea"], wellness: ["#3d5f5b", "#b5d9d0"],
};

function placeholderImage(city: string, theme: string) {
  const [from, to] = THEME_COLOUR[theme] ?? ["#17231f", "#286c62"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/><text x="40" y="440" font-family="Georgia,serif" font-size="64" fill="#fff" fill-opacity=".92">${city}</text><text x="42" y="480" font-family="sans-serif" font-size="22" letter-spacing="4" fill="#fff" fill-opacity=".7">${themeLabel(theme).toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function hotelRating(row: HotelRow) {
  return Math.round(row.guest_score * 5) / 10; // guest_score is /10 → /5 scale
}

function hotelDetail(row: HotelRow) {
  return `${row.star_rating}★ ${row.property_type} · ${row.room_name} · ${row.distance_to_centre_km} km from centre`;
}

/** One night in the cheapest active room; searchHotelsLive scales `total` to the stay length. */
export const HOTELS: HotelRecord[] = data.hotels.map(row => ({
  id: row.hotel_id,
  name: row.name,
  city: cityName(row.city_id),
  rating: hotelRating(row),
  detail: hotelDetail(row),
  total: rupees(row.min_rate),
  nightly: rupees(row.min_rate),
}));

export const GUIDES: GuideRecord[] = (() => {
  const availability = new Map<string, { availability: Record<string, boolean>; priceMultiplier: Record<string, number>; slots: Record<string, number> }>();
  for (const row of data.availability) {
    const entry = availability.get(row.guide_id) ?? { availability: {}, priceMultiplier: {}, slots: {} };
    entry.availability[row.for_date] = row.is_available === 1 && row.slots_available > 0;
    entry.priceMultiplier[row.for_date] = Number(row.price_multiplier) || 1;
    entry.slots[row.for_date] = row.is_available === 1 ? Number(row.slots_available) || 0 : 0;
    availability.set(row.guide_id, entry);
  }
  return data.guides.map(row => ({
    id: row.guide_id,
    name: row.display_name,
    city: cityName(row.city_id),
    cityId: row.city_id,
    languages: row.languages.split(",").map(tag => tag.trim()).filter(Boolean),
    specialisation: row.specialisation,
    secondarySpecialisation: row.secondary_specialisation || null,
    rating: row.rating ?? 0,
    reviewCount: row.review_count,
    yearsExperience: row.years_experience,
    certified: row.certified === 1,
    dayRate: rupees(row.day_rate),
    halfDayRate: rupees(row.half_day_rate),
    bio: row.bio,
    ...(availability.get(row.guide_id) ?? { availability: {}, priceMultiplier: {}, slots: {} }),
  }));
})();

/** Slots that match what a component is: dinner in the evening, monument tickets in the daytime, activities not "overnight". */
function contextSlot(type: PackageComponent["type"], title: string, slot: string) {
  if (type === "meal") return /breakfast/i.test(title) ? "morning" : /lunch/i.test(title) ? "afternoon" : /dinner|supper/i.test(title) ? "evening" : slot;
  if (type === "entry_ticket" && (slot === "overnight" || slot === "evening")) return "afternoon";
  if (type === "experience" && slot === "overnight") return "evening";
  return slot;
}

/** Where a traveller arrives: transfer alternatives must start here (an airport transfer is never swapped for a port-to-business-park ferry). */
const ARRIVAL_POINTS = ["Airport", "Railway station"];

export const PACKAGES: PackageRecord[] = data.packages.map(row => {
  const city = cityName(row.city_id);
  const rows = data.components.filter(component => component.package_id === row.package_id);
  const components: PackageComponent[] = [];
  const seenGroups = new Set<string>();
  for (const component of rows) {
    if (component.component_type === "guide") continue; // guides are booked through the availability-checked guide step
    const type: PackageComponent["type"] = component.component_type === "poi" ? "experience" : component.component_type as PackageComponent["type"];
    const hotel = type === "hotel" ? data.hotels.find(item => item.hotel_id === component.entity_id) : undefined;
    const arrivalTransfer = type === "transfer" && /airport|arrival|station/i.test(component.title);
    components.push({
      id: component.component_id,
      type,
      label: component.title,
      // Day and slot are shown by the itinerary itself; the detail says what the thing is.
      detail: hotel ? hotelDetail(hotel) : arrivalTransfer ? "private cab · arrival point → your hotel" : "",
      price: rupees(component.price_delta),
      swapGroup: component.swap_group || (type === "transfer" ? `transfer_${row.package_id.slice(-4)}` : undefined),
      // The arrival transfer belongs on day 1, straight after landing.
      dayIndex: arrivalTransfer ? 1 : component.day_index,
      slot: arrivalTransfer ? "morning" : contextSlot(type, component.title, component.slot),
      optional: component.is_optional === 1,
      entityId: component.entity_id || undefined,
      isDefault: !component.swap_group || !seenGroups.has(component.swap_group),
    });
    if (component.swap_group) seenGroups.add(component.swap_group);
  }

  // Hotel tier swap: other hotels in the same city, repriced from hotel_room_types against the included hotel.
  const includedHotel = components.find(component => component.type === "hotel");
  const includedHotelRow = data.hotels.find(item => item.hotel_id === includedHotel?.entityId);
  if (includedHotel && includedHotelRow) {
    const nights = Math.max(1, row.duration_nights);
    for (const alt of data.hotels.filter(item => item.city_id === row.city_id && item.hotel_id !== includedHotelRow.hotel_id)) {
      components.push({
        id: alt.hotel_id, type: "hotel", label: alt.name,
        detail: hotelDetail(alt),
        price: fromPaise(toPaise(includedHotel.price.toFixed(2)) + (toPaise(alt.min_rate) - toPaise(includedHotelRow.min_rate)) * nights),
        swapGroup: includedHotel.swapGroup, dayIndex: includedHotel.dayIndex, slot: includedHotel.slot, optional: false, entityId: alt.hotel_id, isDefault: false,
      });
    }
  }

  // Transfer swap: the city's legs from the transfers table that start where a traveller arrives (airport or railway station).
  const includedTransfer = components.find(component => component.type === "transfer");
  if (includedTransfer) {
    const legs = data.transfers.filter(item => item.city_id === row.city_id && ARRIVAL_POINTS.includes(item.from_label)).sort((a, b) => toPaise(a.cost) - toPaise(b.cost));
    for (const leg of legs) {
      components.push({
        id: leg.transfer_id, type: "transfer", label: `${leg.from_label} → ${leg.to_label}`,
        detail: `${leg.mode.replaceAll("_", " ")} · ${leg.duration_minutes} min`,
        price: rupees(leg.cost), swapGroup: includedTransfer.swapGroup, dayIndex: includedTransfer.dayIndex, slot: includedTransfer.slot, optional: false, entityId: leg.transfer_id, isDefault: false,
      });
    }
  }

  const cityGuides = data.guides.filter(guide => guide.city_id === row.city_id);
  const preferred = THEME_SPECIALISATION[row.theme] ?? ["heritage"];
  const guideSpecialisation = preferred.find(spec => cityGuides.some(guide => guide.specialisation === spec)) ?? cityGuides[0]?.specialisation ?? preferred[0];

  return {
    id: row.package_id,
    cityId: row.city_id,
    name: row.name,
    theme: themeLabel(row.theme),
    tier: row.tier,
    difficulty: row.difficulty,
    city,
    duration: row.duration_days,
    durationNights: row.duration_nights,
    basePrice: rupees(row.base_price),
    currency: row.currency,
    minGroupSize: row.min_group_size,
    maxGroupSize: row.max_group_size,
    description: row.description,
    inclusions: row.inclusions,
    exclusions: row.exclusions,
    languagesOffered: row.languages_offered.split(",").map(tag => tag.trim()).filter(Boolean),
    guideSpecialisation,
    image: placeholderImage(city, row.theme),
    tags: [row.theme, row.tier, row.difficulty],
    components,
  };
});

// ---------------------------------------------------------------------------
// Package + guide logic
// ---------------------------------------------------------------------------

export function getAlternatives(pkg: PackageRecord, componentId: string) {
  const component = pkg.components.find(item => item.id === componentId);
  return component?.swapGroup ? pkg.components.filter(item => item.swapGroup === component.swapGroup && item.id !== component.id) : [];
}

export function datesBetween(start: string, duration: number) {
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: duration }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

/** Guide cost for the given dates: day_rate × that date's price_multiplier, summed in paise. */
export function guideCost(guide: GuideRecord, dates: string[]) {
  const ratePaise = toPaise(guide.dayRate.toFixed(2));
  return fromPaise(dates.reduce((sum, date) => sum + Math.round(ratePaise * (guide.priceMultiplier[date] ?? 1)), 0));
}

function distanceKm(fromCityId: string, toCityId: string) {
  const a = cityById.get(fromCityId);
  const b = cityById.get(toCityId);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a.city_id === b.city_id) return 0;
  const rad = (deg: number) => deg * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

const SUBSTITUTE_RADIUS_KM = 400;

/**
 * Live availability: the dataset says the guide works that day AND a slot is still free after PackagePro's own confirmed
 * bookings (slots_available minus confirmed guide bookings). A confirmed trip therefore blocks the next traveller.
 */
export function isGuideFree(guide: GuideRecord, date: string) {
  return guide.availability[date] === true && (guide.slots?.[date] ?? 0) - guideBookedCount(guide.id, date) > 0;
}

/** The guide's availability map with confirmed bookings applied — what the UI shows as ✓ / ✕. */
export function liveAvailability(guide: GuideRecord): Record<string, boolean> {
  return Object.fromEntries(Object.keys(guide.availability).map(date => [date, isGuideFree(guide, date)]));
}

export function withLiveAvailability<T extends GuideRecord>(guide: T): T {
  return { ...guide, availability: liveAvailability(guide) };
}

/**
 * Check a guide against every actual package date. Unknown dates count as unavailable.
 * Substitutes must share the specialisation and the requested language and be free on every date;
 * they are ranked nearest-first (same city = 0 km), then by smallest price change.
 */
export function guideCheck(guide: GuideRecord, dates: string[], options: { language?: string; specialisation?: string; chargeDates?: string[] } = {}) {
  const requiredSpecialisation = options.specialisation || guide.specialisation;
  const chargeDates = options.chargeDates ?? dates;
  const conflicts = dates.filter(date => !isGuideFree(guide, date));
  const guideTotal = guideCost(guide, chargeDates);
  const replacementOptions = GUIDES
    .filter(candidate => candidate.id !== guide.id
      && candidate.specialisation === requiredSpecialisation
      && (!options.language || candidate.languages.includes(options.language))
      && dates.every(date => isGuideFree(candidate, date)))
    .map(candidate => {
      const totalCost = guideCost(candidate, chargeDates);
      return { guide: withLiveAvailability(candidate), totalCost, priceDelta: fromPaise(toPaise(totalCost.toFixed(2)) - toPaise(guideTotal.toFixed(2))), distanceKm: distanceKm(guide.cityId, candidate.cityId) };
    })
    .filter(option => option.distanceKm <= SUBSTITUTE_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm || Math.abs(a.priceDelta) - Math.abs(b.priceDelta) || b.guide.rating - a.guide.rating);
  const best = replacementOptions[0] ?? null;
  return { conflicts, guideTotal, replacement: best?.guide ?? null, replacementOptions, priceDelta: best ? best.priceDelta : null, requiredSpecialisation };
}

export function packageForCity(city: string) {
  return PACKAGES.find(pkg => pkg.city.toLowerCase() === city.toLowerCase());
}

/**
 * Interests a traveller can express (mood chips, free text, profile interests). Each maps to the dataset themes that serve it
 * and to the catalogue cities known for it — the dataset's descriptions are templated, so theme + place carry the signal.
 */
const INTERESTS: { key: string; words: RegExp; themes: string[]; cities: string[] }[] = [
  { key: "heritage", words: /heritage|histor|fort|palace|monument|museum|culture|architect|haveli|royal|विरासत|किला|பாரம்பரிய|వారసత్వ/i, themes: ["heritage"], cities: ["Agra", "Varanasi", "Jaipur", "Jodhpur", "Udaipur", "Jaisalmer", "Hampi", "Aurangabad", "New Delhi", "Lucknow", "Hyderabad", "Thanjavur", "Bhuj", "Madurai"] },
  { key: "temples", words: /temple|pilgrim|spiritual|religio|ritual|aarti|ghat|dawn|darshan|shrine|sacred|मंदिर|तीर्थ|கோயில்|கோவில்|ఆలయ|గుడి/i, themes: ["pilgrimage"], cities: ["Varanasi", "Tirupati", "Madurai", "Thanjavur", "Puri", "Amritsar", "Rishikesh", "Hampi", "Bhubaneswar"] },
  { key: "beach", words: /beach|sea\b|seaside|coast|island|backwater|surf|sand|ocean|समुद्र|बीच|கடற்கரை|బీచ్|సముద్ర/i, themes: [], cities: ["Panaji", "Gokarna", "Puri", "Pondicherry", "Alleppey", "Kochi", "Visakhapatnam", "Thiruvananthapuram", "Chennai", "Mumbai"] },
  { key: "food", words: /food|cuisine|street|eat|culinar|dining|bazaar|market|spice|खाना|भोजन|உணவு|ఆహార/i, themes: ["food_trail"], cities: ["Lucknow", "Hyderabad", "Amritsar", "Kolkata", "Chennai", "Mumbai", "New Delhi", "Pune"] },
  { key: "mountains", words: /mountain|trek|hike|hiking|hill|himalaya|snow|adventure|climb|पहाड़|மலை|కొండ/i, themes: ["adventure"], cities: ["Manali", "Shimla", "Darjeeling", "Gangtok", "Leh", "Nainital", "Munnar", "Ooty", "Shillong", "Srinagar", "Rishikesh"] },
  { key: "honeymoon", words: /honeymoon|romantic|romance|couple|हनीमून|தேனிலவு|హనీమూన్/i, themes: ["honeymoon"], cities: ["Udaipur", "Munnar", "Alleppey", "Manali", "Srinagar", "Gokarna"] },
  { key: "family", words: /family|kids|children|parents|परिवार|குடும்ப|కుటుంబ/i, themes: ["family"], cities: [] },
  { key: "wellness", words: /wellness|yoga|spa|relax|ayurved|retreat|slow|calm|योग|யோகா|యోగా/i, themes: ["wellness"], cities: ["Rishikesh", "Gokarna", "Munnar", "Alleppey", "Kochi"] },
  { key: "wildlife", words: /wildlife|safari|tiger|elephant|bird|jungle|nature|वन्य|வனவிலங்கு|వన్యప్రాణ/i, themes: ["wildlife"], cities: ["Wayanad", "Guwahati", "Mysuru"] },
];

/** Component lines shared by most packages ("Local guide (half day)", "Dinner at a local kitchen") say nothing about fit. */
let genericLabels: Set<string> | null = null;
function distinctiveLabels(pkg: PackageRecord) {
  if (!genericLabels) {
    const counts = new Map<string, number>();
    for (const item of PACKAGES) for (const label of Array.from(new Set(item.components.map(component => component.label)))) counts.set(label, (counts.get(label) ?? 0) + 1);
    genericLabels = new Set(Array.from(counts).filter(([, count]) => count > PACKAGES.length / 4).map(([label]) => label));
  }
  return pkg.components.map(item => item.label).filter(label => !genericLabels!.has(label));
}

export function recommendPackages(query: string, language: string, destination?: string, budget?: number) {
  const wanted = INTERESTS.filter(interest => interest.words.test(query));
  const city = destination?.trim().toLowerCase();
  const packages = PACKAGES.map(pkg => {
    const labels = distinctiveLabels(pkg).join(" ");
    const fits = wanted.map(interest => {
      const core = (interest.themes.includes(pkg.tags[0]) ? 10 : 0) + (interest.cities.includes(pkg.city) ? 8 : 0);
      return { key: interest.key, core, score: core + (interest.words.test(labels) ? 3 : 0) };
    }).filter(fit => fit.score > 0).sort((a, b) => b.score - a.score);
    const interestScore = fits.reduce((sum, fit) => sum + fit.score, 0);
    // The chosen destination leads only when its theme or place fits the mood; otherwise it is a light tie-break.
    const isDestination = Boolean(city && pkg.city.toLowerCase() === city);
    const destinationScore = isDestination ? (fits.some(fit => fit.core > 0) || !wanted.length ? 12 : 2) : 0;
    const languageScore = pkg.languagesOffered.includes(language) ? 3 : 0;
    const budgetScore = budget && pkg.basePrice <= budget ? 4 : budget ? -Math.min(8, Math.ceil((pkg.basePrice - budget) / 10000)) : 0;
    return {
      ...pkg,
      fitsMood: fits.some(fit => fit.core > 0),
      score: interestScore + destinationScore + languageScore + budgetScore,
      matchReasons: [
        ...fits.filter(fit => fit.core > 0).slice(0, 2).map(fit => `fit ${fit.key}`),
        ...(isDestination ? ["your destination"] : []),
        ...(!fits.some(fit => fit.core > 0) && !isDestination ? [fits.length ? "interest match" : "curated route"] : []),
        budgetScore >= 0 ? "within your budget" : "stretch option",
        languageScore ? "offered in your language" : "English delivery",
      ],
    };
  }).sort((a, b) => b.score - a.score || a.basePrice - b.basePrice);
  // One card per theme where possible, so a mood shows a spread of real options rather than three near-duplicates.
  const picked: typeof packages = [];
  for (const pkg of packages) if (picked.length < 3 && !picked.some(item => item.city === pkg.city || item.theme === pkg.theme)) picked.push(pkg);
  for (const pkg of packages) if (picked.length < 3 && !picked.includes(pkg)) picked.push(pkg);
  const guides = GUIDES.filter(guide => guide.languages.includes(language) && (!city || guide.city.toLowerCase() === city)).sort((a, b) => b.rating - a.rating);
  // Every package that truly fits the mood, best first — the home grid uses it to reorder the catalogue.
  const moodMatches = packages.filter(pkg => pkg.fitsMood).map(pkg => pkg.id);
  return { packages: picked, guides: guides.slice(0, 3), moodMatches };
}

export function realityCheck(destination: string, budget: number, duration: number) {
  const pkg = packageForCity(destination) ?? PACKAGES[0];
  const nightly = HOTELS.filter(hotel => hotel.city === pkg.city).map(hotel => hotel.nightly ?? hotel.total);
  const hotelEstimate = (nightly.length ? Math.min(...nightly) : 3000) * Math.max(1, duration);
  const typical = Math.round(pkg.basePrice + FLIGHTS[1].price + hotelEstimate);
  const gap = Math.round(((budget - typical) / typical) * 100);
  return { destination: pkg.city, typical, budget, gap, verdict: budget >= typical * 1.1 ? "comfortable" : budget >= typical * .82 ? "tight" : "unrealistic", closestPackage: pkg.name, duration };
}
