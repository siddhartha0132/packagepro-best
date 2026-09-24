import { all, rupees } from "./catalogue";
import { partyUnits, unitsFor } from "./trips";
import { completeGrounded, languageName } from "./aiChat";
import { getDestinationInsight } from "./insights";
import { DESTINATIONS, searchFlightsLive } from "./integrations";
import { GUIDES, PACKAGES, datesBetween, guideCost, packageForCity } from "./packagepro";

// ---------------------------------------------------------------------------
// What past PackagePro travellers did in a city (PS-04 trips, bookings, itineraries, preferences)
// ---------------------------------------------------------------------------

export type CityPopularity = {
  trips: number;
  confirmedBookings: number;
  avgBookingInr: number | null;
  avgItineraryInr: number | null;
  avgDays: number | null;
  avgParty: number | null;
  topPlaces: { title: string; count: number }[];
  topHotels: { title: string; count: number }[];
  tripTypes: { type: string; count: number }[];
  topInterests: { interest: string; count: number }[];
};

const popularityCache = new Map<string, CityPopularity>();
const pretty = (value: string) => value.replaceAll("_", " ").replace(/^\w/, char => char.toUpperCase());

export function cityPopularity(cityId: string): CityPopularity {
  const cached = popularityCache.get(cityId);
  if (cached) return cached;
  const [summary] = all<{ trips: number; avg_days: number | null; avg_party: number | null }>(
    `SELECT COUNT(*) AS trips, ROUND(AVG(julianday(end_date) - julianday(start_date)), 1) AS avg_days, ROUND(AVG(party_size), 1) AS avg_party
     FROM trips WHERE destination_city_id = ? AND status != 'archived'`, cityId);
  const [bookings] = all<{ n: number; avg_total: number | null }>(
    `SELECT COUNT(*) AS n, AVG(CAST(b.total_amount AS REAL)) AS avg_total
     FROM bookings b JOIN trips t USING (trip_id)
     WHERE t.destination_city_id = ? AND b.status = 'confirmed' AND b.currency = 'INR'`, cityId);
  const [itinerary] = all<{ avg_cost: number | null }>(
    `SELECT AVG(CAST(i.total_cost AS REAL)) AS avg_cost FROM itineraries i JOIN trips t USING (trip_id)
     WHERE t.destination_city_id = ? AND i.currency = 'INR'`, cityId);
  const ranked = (itemType: string) => all<{ title: string; count: number }>(
    `SELECT ii.title, COUNT(*) AS count FROM itinerary_items ii JOIN itineraries i USING (itinerary_id) JOIN trips t USING (trip_id)
     WHERE t.destination_city_id = ? AND ii.item_type = ? GROUP BY ii.title ORDER BY count DESC, ii.title LIMIT 5`, cityId, itemType);
  const tripTypes = all<{ type: string; count: number }>(
    `SELECT trip_type AS type, COUNT(*) AS count FROM trips WHERE destination_city_id = ? GROUP BY trip_type ORDER BY count DESC LIMIT 4`, cityId);
  const interestCounts = new Map<string, number>();
  for (const row of all<{ interests: string }>(
    `SELECT p.interests FROM user_preferences p JOIN trips t ON t.owner_user_id = p.user_id WHERE t.destination_city_id = ?`, cityId)) {
    for (const interest of (row.interests || "").split(",").map(item => item.trim()).filter(Boolean)) interestCounts.set(interest, (interestCounts.get(interest) ?? 0) + 1);
  }
  const value: CityPopularity = {
    trips: summary?.trips ?? 0,
    confirmedBookings: bookings?.n ?? 0,
    avgBookingInr: bookings?.avg_total ? Math.round(bookings.avg_total) : null,
    avgItineraryInr: itinerary?.avg_cost ? Math.round(itinerary.avg_cost) : null,
    avgDays: summary?.avg_days ?? null,
    avgParty: summary?.avg_party ?? null,
    topPlaces: ranked("poi"),
    topHotels: ranked("hotel"),
    tripTypes: tripTypes.map(row => ({ type: pretty(row.type), count: row.count })),
    topInterests: Array.from(interestCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([interest, count]) => ({ interest: pretty(interest), count })),
  };
  popularityCache.set(cityId, value);
  return value;
}

/** Trips + confirmed bookings per package city, for "most booked" badges and sorting. */
export const PACKAGE_POPULARITY: Record<string, { trips: number; bookings: number }> = Object.fromEntries(
  all<{ city_id: string; trips: number; bookings: number }>(
    `SELECT t.destination_city_id AS city_id, COUNT(DISTINCT t.trip_id) AS trips, COUNT(b.booking_id) AS bookings
     FROM trips t LEFT JOIN bookings b ON b.trip_id = t.trip_id AND b.status = 'confirmed' GROUP BY t.destination_city_id`,
  ).map(row => [row.city_id, { trips: row.trips, bookings: row.bookings }]),
);

// ---------------------------------------------------------------------------
// Live trip estimate
// ---------------------------------------------------------------------------

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export async function estimateTrip(input: { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budget: number; language: string; interests?: string; uiLanguage?: string }) {
  const needle = input.destination.trim().toLowerCase();
  const place = DESTINATIONS.find(item => item.code.toLowerCase() === needle || item.city.toLowerCase() === needle) ?? DESTINATIONS.find(item => item.airport.toLowerCase() === needle);
  if (!place) throw new Error(`No PackagePro package covers '${input.destination}' yet`);
  const pkg = packageForCity(place.city) ?? PACKAGES[0];
  const days = Math.max(1, Math.round((Date.parse(`${input.returnDate}T00:00:00Z`) - Date.parse(`${input.departDate}T00:00:00Z`)) / 86400000));
  const dates = datesBetween(input.departDate, days);

  const [flightSearch, insight] = await Promise.all([
    searchFlightsLive(input.origin.toUpperCase(), place.airport || place.code, input.departDate),
    getDestinationInsight(place.city),
  ]);
  const party = partyUnits(input.travelers);
  // Fares and the package are per person; hotel upgrades per room; add-ons per their unit; guides per group.
  const fares = flightSearch.flights.map(flight => flight.price * party.pax).filter(price => price > 0);
  const cheapestFlight = [...flightSearch.flights].sort((a, b) => a.price - b.price)[0] ?? null;
  const flightLow = fares.length ? Math.min(...fares) : 0;
  const flightTypical = flightSearch.insights?.typicalRange ? Math.round((flightSearch.insights.typicalRange[0] + flightSearch.insights.typicalRange[1]) / 2) * party.pax : median(fares);
  const flightHigh = flightSearch.insights?.typicalRange?.[1] ? flightSearch.insights.typicalRange[1] * party.pax : (fares.length ? Math.max(...fares) : 0);

  const packageBase = Math.round(pkg.basePrice * days / Math.max(1, pkg.duration) * 100) * party.pax / 100;
  const defaultHotel = pkg.components.find(item => item.type === "hotel" && item.isDefault);
  const hotelOptions = pkg.components.filter(item => item.type === "hotel").map(item => ({ id: item.id, name: item.label, detail: item.detail, delta: Math.round((item.price - (defaultHotel?.price ?? item.price)) * party.rooms * 100) / 100, isDefault: !!item.isDefault }));
  const hotelUpgrade = Math.max(0, ...hotelOptions.map(item => item.delta));
  const addOns = pkg.components.filter(item => item.optional && item.isDefault);
  const addOnTotal = addOns.reduce((sum, item) => sum + item.price * unitsFor(item.type, party), 0);

  const guides = GUIDES.filter(guide => guide.cityId === pkg.cityId && guide.languages.includes(input.language)).map(guide => ({
    id: guide.id, name: guide.name, specialisation: guide.specialisation, rating: guide.rating, languages: guide.languages,
    tripCost: guideCost(guide, dates), available: dates.every(date => guide.availability[date] === true),
    unavailableDates: dates.filter(date => guide.availability[date] !== true),
  })).sort((a, b) => Number(b.available) - Number(a.available) || a.tripCost - b.tripCost);
  const guideTypical = guides.find(guide => guide.available)?.tripCost ?? 0;

  const low = Math.round(flightLow + packageBase);
  const typical = Math.round(flightTypical + packageBase + guideTypical);
  const high = Math.round(flightHigh + packageBase + hotelUpgrade + addOnTotal + Math.max(guideTypical, ...guides.map(guide => guide.tripCost)));
  const verdict = input.budget >= typical * 1.1 ? "comfortable" : input.budget >= low ? "tight" : "unrealistic";
  const popularity = cityPopularity(pkg.cityId);

  const grounded = {
    destination: place.city, days, departDate: input.departDate, travellers: input.travelers, budgetInr: input.budget, guideLanguage: input.language, interests: input.interests || "",
    package: { name: pkg.name, theme: pkg.theme, tier: pkg.tier, basePriceForTrip: packageBase, inclusions: pkg.inclusions },
    flights: { source: flightSearch.source, cheapest: cheapestFlight && { airline: cheapestFlight.airline, depart: cheapestFlight.depart, pricePerPerson: cheapestFlight.price }, typicalRangePerPerson: flightSearch.insights?.typicalRange, priceLevel: flightSearch.insights?.priceLevel },
    hotelUpgradeMax: hotelUpgrade, guides: guides.slice(0, 3).map(guide => ({ name: guide.name, specialisation: guide.specialisation, tripCost: guide.tripCost, available: guide.available })),
    estimate: { low, typical, high }, pastTravellers: popularity,
  };
  const ai = await completeGrounded(
    `You are PackagePro's trip-cost analyst. Use ONLY the JSON facts given. In 3 short bullet points: (1) whether the budget fits and the realistic per-traveller spend, (2) what past travellers to this city liked most, (3) one concrete money-saving or upgrade tip. Quote rupee figures from the facts; never invent prices. Reply in ${languageName(input.uiLanguage)}.`,
    JSON.stringify(grounded),
  );
  const fallbackAdvice = [
    `Realistic spend for ${days} days: ₹${typical.toLocaleString("en-IN")} (range ₹${low.toLocaleString("en-IN")}–₹${high.toLocaleString("en-IN")}); your budget of ₹${input.budget.toLocaleString("en-IN")} is ${verdict}.`,
    popularity.topPlaces.length ? `Past travellers here most often visited ${popularity.topPlaces.slice(0, 3).map(item => item.title).join(", ")}${popularity.topInterests[0] ? `, and came for ${popularity.topInterests.slice(0, 2).map(item => item.interest.toLowerCase()).join(" and ")}` : ""}.` : `${pkg.name} is the curated route for ${place.city}.`,
    flightSearch.insights?.priceLevel === "high" ? `Fares are running high for ${input.departDate}; shifting a day can move you toward ₹${flightSearch.insights.typicalRange?.[0]?.toLocaleString("en-IN")}.` : hotelUpgrade > 0 ? `A hotel-tier upgrade adds up to ₹${Math.round(hotelUpgrade).toLocaleString("en-IN")}; the default stay keeps you closest to the low estimate.` : `Adding a guide costs from ₹${Math.round(guideTypical).toLocaleString("en-IN")} for these dates.`,
  ];

  return {
    destination: place.city, cityId: pkg.cityId, days, dates, budget: input.budget,
    verdict, low, typical, high,
    package: { id: pkg.id, name: pkg.name, theme: pkg.theme, tier: pkg.tier, duration: pkg.duration, basePrice: pkg.basePrice, forTrip: packageBase, image: pkg.image, inclusions: pkg.inclusions, languagesOffered: pkg.languagesOffered },
    flights: { source: flightSearch.source, note: flightSearch.note, insights: flightSearch.insights, options: flightSearch.flights.slice(0, 5), low: flightLow, typical: flightTypical, high: flightHigh },
    hotels: { options: hotelOptions, upgradeMax: hotelUpgrade },
    addOns: addOns.map(item => ({ id: item.id, label: item.label, price: item.price * unitsFor(item.type, party) })),
    party,
    guides: guides.slice(0, 4),
    popularity,
    insight,
    ai: ai ? { source: "llm" as const, model: ai.model, text: ai.text } : { source: "rules" as const, model: "grounded-rules", text: fallbackAdvice.map(line => `• ${line}`).join("\n") },
  };
}
