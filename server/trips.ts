import { nanoid } from "nanoid";
import { fromPaise, toPaise } from "./catalogue";
import { GUIDES, TRANSPORTS, datesBetween, getAlternatives, guideCheck, guideCost, packageForCity, realityCheck, type FlightRecord, type GuideRecord, type PackageComponent, type PackageRecord, type TransportRecord } from "./packagepro";
import { DESTINATIONS, searchFlightsLive, sendConfirmation } from "./integrations";

// Flow: select_flight → select_package (customise: itinerary, swaps, add-ons, guide, duration) → review → confirmed.
// The total is never accumulated: it is recomputed from the current selection after every change.
export type TripStatus = "select_flight" | "select_package" | "negotiate" | "review" | "confirmed";

/** A line of the customised package: the component currently filling a slot, plus the default it replaced. */
export type TripComponent = PackageComponent & { included: boolean; defaultId: string; defaultPrice: number };

export type ChosenGuide = GuideRecord & { daysBooked: number; totalCost: number; bookedDates: string[] };

export type Trip = {
  tripId: string;
  origin: string;
  destination: string;
  destinationCode: string;
  departDate: string;
  returnDate: string;
  durationDays: number;
  travelers: number;
  budgetCap: number;
  runningTotal: number;
  language: string;
  interests: string;
  guideSpecialisation: string;
  status: TripStatus;
  flightOptions: FlightRecord[];
  chosenFlight: FlightRecord | null;
  chosenTransport: TransportRecord | null;
  package: PackageRecord | null;
  packageComponents: TripComponent[];
  chosenGuide: ChosenGuide | null;
  guideAvailabilityIssue: {
    guide: GuideRecord;
    conflictingDates: string[];
    requestedDates: string[];
    replacement: GuideRecord | null;
    replacementOptions: { guide: GuideRecord; priceDelta: number; totalCost: number; distanceKm: number; newTotal: number }[];
    replacementTotalCost: number | null;
    priceDelta: number | null;
    currentTotal: number;
  } | null;
  flightSource: string;
  flightNote?: string;
  flightInsights?: { lowestPrice?: number; typicalRange?: [number, number]; priceLevel?: string };
  negotiationOptions: { choice: string; amount?: number; item_label: string; label: string }[];
  pending: { amount: number; label: string; retryStatus: TripStatus; advanceStatus: TripStatus; patch: Partial<Trip> } | null;
  trace: { kind: string; text: string }[];
};

const trips = new Map<string, Trip>();
const EDITABLE: TripStatus[] = ["select_package", "review"];
const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const paise = (value: number) => toPaise(value.toFixed(2));

/** Accepts a dataset city_id, an airport code or a city name. */
function resolveDestination(value: string) {
  const needle = value.trim().toLowerCase();
  const match = DESTINATIONS.find(item => item.code.toLowerCase() === needle || item.city.toLowerCase() === needle) ?? DESTINATIONS.find(item => item.airport.toLowerCase() === needle);
  if (!match) throw new Error(`No PackagePro package covers '${value}' yet`);
  return match;
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function addDays(start: string, days: number) {
  return datesBetween(start, days + 1)[days];
}

function need(tripId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  return trip;
}

function editable(trip: Trip, action: string) {
  if (!trip.package) throw new Error("No package selected yet");
  if (!EDITABLE.includes(trip.status)) throw new Error(`Can't ${action} while the trip is '${trip.status}'`);
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * tour_packages.base_price covers the default (non-optional) components for duration_days.
 * Swapping a line applies price_delta(new) − price_delta(default); optional add-ons add their own price_delta.
 */
function priceBreakdown(trip: Pick<Trip, "package" | "packageComponents" | "durationDays" | "chosenFlight" | "chosenTransport" | "chosenGuide">) {
  const transport = paise(trip.chosenTransport?.price ?? trip.chosenFlight?.price ?? 0);
  const base = trip.package ? Math.round(paise(trip.package.basePrice) * Math.max(1, trip.durationDays) / Math.max(1, trip.package.duration)) : 0;
  let swaps = 0;
  let addOns = 0;
  for (const component of trip.packageComponents) {
    if (!component.included) continue;
    if (component.optional) addOns += paise(component.price);
    else swaps += paise(component.price) - paise(component.defaultPrice);
  }
  const guide = paise(trip.chosenGuide?.totalCost ?? 0);
  const packageTotal = base + swaps + addOns;
  return {
    transport: fromPaise(transport),
    packageBase: fromPaise(base),
    swapAdjustments: fromPaise(swaps),
    addOns: fromPaise(addOns),
    packageTotal: fromPaise(packageTotal),
    guide: fromPaise(guide),
    total: fromPaise(transport + packageTotal + guide),
  };
}

const SLOT_ORDER: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, overnight: 3 };

function itinerary(trip: Trip) {
  const dates = datesBetween(trip.departDate, trip.durationDays);
  const lines = trip.packageComponents.filter(component => component.included);
  const hotel = lines.find(component => component.type === "hotel");
  return dates.map((date, index) => {
    const day = index + 1;
    const items: { kind: string; slot: string; label: string; detail: string; price?: number; componentId?: string }[] = [];
    if (day === 1) {
      const leg = trip.chosenTransport ?? trip.chosenFlight;
      if (leg) items.push({ kind: "arrival", slot: "morning", label: trip.chosenTransport ? `Arrive by ${trip.chosenTransport.operator}` : `Arrive on ${trip.chosenFlight!.airline} ${trip.chosenFlight!.id}`, detail: leg.route });
    }
    for (const component of lines) {
      if (component.type === "hotel") continue;
      if (Math.min(component.dayIndex ?? 1, dates.length) !== day) continue;
      items.push({ kind: component.type, slot: component.slot ?? "morning", label: component.label, detail: component.detail, price: component.price, componentId: component.id });
    }
    if (trip.chosenGuide?.bookedDates.includes(date)) {
      items.push({ kind: "guide", slot: "morning", label: `Guide: ${trip.chosenGuide.name}`, detail: `${trip.chosenGuide.specialisation} · ${trip.chosenGuide.languages.join(", ")}`, price: guideCost(trip.chosenGuide, [date]) });
    }
    if (hotel) items.push({ kind: "hotel", slot: "overnight", label: day === 1 ? `Check in: ${hotel.label}` : `Stay: ${hotel.label}`, detail: hotel.detail.replace(/^Day \d+ · \w+ · /, ""), componentId: hotel.id });
    items.sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9));
    return { day, date, items };
  });
}

function snapshot(trip: Trip) {
  const breakdown = priceBreakdown(trip);
  const hotel = trip.packageComponents.find(component => component.type === "hotel" && component.included);
  return {
    ...trip,
    priceBreakdown: breakdown,
    packagePrice: breakdown.packageTotal,
    chosenHotel: hotel ? { id: hotel.id, name: hotel.label, rating: Number(hotel.detail.match(/(\d)★/)?.[1] || 0), detail: hotel.detail, total: hotel.price } : null,
    itinerary: trip.package ? itinerary(trip) : [],
    remaining: trip.budgetCap - trip.runningTotal,
    reality: realityCheck(trip.destination, trip.budgetCap, trip.durationDays),
    canGoBack: trip.status !== "confirmed" && trip.status !== "select_flight",
  };
}

function log(trip: Trip, kind: string, text: string) {
  trip.trace.push({ kind, text });
}

/**
 * Apply a change if the recomputed total stays within the cap; otherwise park it in negotiation.
 * Returns true when applied.
 */
function commit(trip: Trip, label: string, patch: Partial<Trip>, advanceTo: TripStatus = trip.status) {
  const total = priceBreakdown({ ...trip, ...patch }).total;
  if (total <= trip.budgetCap) {
    const delta = total - trip.runningTotal;
    Object.assign(trip, patch);
    trip.runningTotal = total;
    trip.status = advanceTo;
    trip.pending = null;
    trip.negotiationOptions = [];
    log(trip, "decision", `${label} — ${delta >= 0 ? "+" : "−"}${inr(Math.abs(delta))}, total now ${inr(total)}`);
    return true;
  }
  const overage = total - trip.budgetCap;
  const retryStatus = trip.status === "negotiate" ? (trip.pending?.retryStatus ?? "select_flight") : trip.status;
  trip.status = "negotiate";
  trip.pending = { amount: total - trip.runningTotal, label, retryStatus, advanceStatus: advanceTo, patch };
  trip.negotiationOptions = [
    { choice: "approve_overage", amount: overage, item_label: label, label: `Approve the extra ${inr(overage)} for ${label}` },
    { choice: "swap_cheaper", item_label: label, label: `Keep the plan as it was and pick something cheaper` },
    { choice: "remove_item", item_label: label, label: `Drop ${label} and keep the rest` },
    { choice: "raise_cap", item_label: label, label: "Raise my overall trip budget" },
  ];
  log(trip, "decision", `${label} would exceed your budget by ${inr(overage)}`);
  return false;
}

function loadPackage(trip: Trip) {
  const pkg = packageForCity(trip.destination);
  if (!pkg) throw new Error(`No package found for ${trip.destination}`);
  const components: TripComponent[] = pkg.components
    .filter(component => component.isDefault)
    .map(component => ({ ...component, included: !component.optional, defaultId: component.id, defaultPrice: component.price }));
  return { package: pkg, packageComponents: components, guideSpecialisation: pkg.guideSpecialisation } satisfies Partial<Trip>;
}

// ---------------------------------------------------------------------------
// Trip lifecycle
// ---------------------------------------------------------------------------

export async function createTrip(input: { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap: number; language: string; interests?: string }) {
  const origin = input.origin.trim().toUpperCase();
  const place = resolveDestination(input.destination);
  const code = place.airport || place.code;
  if (origin === code) throw new Error("origin and destination can't be the same");
  const durationDays = daysBetween(input.departDate, input.returnDate);
  if (!Number.isFinite(durationDays) || durationDays <= 0) throw new Error("return_date must be after depart_date");
  const liveFlights = await searchFlightsLive(origin, code, input.departDate);
  const trip: Trip = {
    tripId: `trp_${nanoid(8)}`,
    origin, destination: place.city, destinationCode: code,
    departDate: input.departDate, returnDate: input.returnDate, durationDays,
    travelers: input.travelers, budgetCap: input.budgetCap, runningTotal: 0,
    language: input.language, interests: input.interests || "", guideSpecialisation: "heritage",
    status: "select_flight",
    flightOptions: liveFlights.flights, chosenFlight: null, chosenTransport: null,
    package: null, packageComponents: [], chosenGuide: null, guideAvailabilityIssue: null,
    flightSource: liveFlights.source, flightNote: liveFlights.note, flightInsights: liveFlights.insights,
    negotiationOptions: [], pending: null, trace: [],
  };
  log(trip, "reasoning", `Planning ${durationDays}-day trip to ${place.city}, cap ${inr(trip.budgetCap)}`);
  log(trip, "tool_result", `Found ${trip.flightOptions.length} flight options via ${liveFlights.source}`);
  trips.set(trip.tripId, trip);
  return snapshot(trip);
}

export function getTrip(tripId: string) {
  return snapshot(need(tripId));
}

export async function selectFlight(tripId: string, flightId: string) {
  const trip = need(tripId);
  if (trip.status !== "select_flight") throw new Error(`Can't book a flight from '${trip.status}'`);
  const flight = trip.flightOptions.find(item => item.id === flightId);
  if (!flight) throw new Error("Flight not in this trip's options");
  const patch = { chosenFlight: flight, chosenTransport: null, ...loadPackage(trip) };
  if (commit(trip, `the ${flight.airline} flight + ${patch.package.name}`, patch, "select_package")) {
    log(trip, "tool_result", `Loaded package '${patch.package.name}' with ${patch.packageComponents.length} components`);
  }
  return snapshot(trip);
}

function selectTransport(trip: Trip, transport: TransportRecord) {
  const patch = { chosenTransport: transport, chosenFlight: null, ...loadPackage(trip) };
  commit(trip, `${transport.operator} + ${patch.package.name}`, patch, "select_package");
  return snapshot(trip);
}

export function swapComponent(tripId: string, fromId: string, toId: string) {
  const trip = need(tripId);
  editable(trip, "swap components");
  const from = trip.packageComponents.find(item => item.id === fromId);
  const target = getAlternatives(trip.package!, fromId).find(item => item.id === toId);
  if (!from || !target) throw new Error("Not a valid swap target");
  const next: TripComponent = { ...target, included: from.included, defaultId: from.defaultId, defaultPrice: from.defaultPrice };
  commit(trip, `swapping ${from.label} for ${target.label}`, { packageComponents: trip.packageComponents.map(item => item.id === fromId ? next : item) });
  return snapshot(trip);
}

/** Add or remove an optional component (meal, entry tickets) — the package's add-on recommendations. */
export function toggleAddOn(tripId: string, componentId: string, include: boolean) {
  const trip = need(tripId);
  editable(trip, "change add-ons");
  const component = trip.packageComponents.find(item => item.id === componentId);
  if (!component?.optional) throw new Error("That component is not an optional add-on");
  if (component.included === include) return snapshot(trip);
  commit(trip, `${include ? "adding" : "removing"} ${component.label}`, { packageComponents: trip.packageComponents.map(item => item.id === componentId ? { ...item, included: include } : item) });
  return snapshot(trip);
}

/** Change the trip length; the package base reprices pro rata and a booked guide is re-checked on the new dates. */
export function setDuration(tripId: string, days: number) {
  const trip = need(tripId);
  editable(trip, "change the duration");
  if (!Number.isInteger(days) || days < 1 || days > 21) throw new Error("Duration must be between 1 and 21 days");
  const returnDate = addDays(trip.departDate, days);
  const patch: Partial<Trip> = { durationDays: days, returnDate, guideAvailabilityIssue: null };
  const guide = trip.chosenGuide;
  if (guide) {
    const dates = datesBetween(trip.departDate, days);
    const bookedDates = dates.slice(0, Math.min(guide.daysBooked, days));
    const check = guideCheck(guide, dates, { language: trip.language, specialisation: guide.specialisation, chargeDates: bookedDates });
    if (check.conflicts.length) {
      patch.chosenGuide = null;
      patch.guideAvailabilityIssue = availabilityIssue(trip, guide, check, dates, { ...trip, ...patch, chosenGuide: null });
    } else {
      patch.chosenGuide = { ...guide, daysBooked: bookedDates.length, bookedDates, totalCost: guideCost(guide, bookedDates) };
    }
  }
  commit(trip, `${days}-day duration`, patch);
  if (trip.status !== "negotiate" && guide && !trip.chosenGuide) log(trip, "decision", `Guide ${guide.name} removed: unavailable on ${trip.guideAvailabilityIssue?.conflictingDates.join(", ")}`);
  return snapshot(trip);
}

export function swapHotel(tripId: string, target: string) {
  const trip = need(tripId);
  editable(trip, "swap the hotel");
  const current = trip.packageComponents.find(item => item.type === "hotel");
  if (!current) throw new Error("There is no hotel in this package");
  const options = [current, ...getAlternatives(trip.package!, current.id)];
  const needle = target.toLowerCase();
  const terms = needle.split(/[^a-z0-9]+/).filter(term => term.length > 3 && !["the", "with", "from", "stay", "hotel"].includes(term));
  const stars = (item: PackageComponent) => Number(item.detail.match(/(\d)★/)?.[1] || 0);
  const candidate = /luxur|5.?star|premium|best/.test(needle) ? [...options].sort((a, b) => stars(b) - stars(a) || b.price - a.price)[0]
    : /budget|cheap|basic/.test(needle) ? [...options].sort((a, b) => a.price - b.price)[0]
      : options.find(item => item.label.toLowerCase().includes(needle)) ?? options.find(item => terms.some(term => `${item.label} ${item.detail}`.toLowerCase().includes(term)));
  if (!candidate) throw new Error(`I couldn't find a ${target} hotel in ${trip.destination}`);
  if (candidate.id === current.id) return snapshot(trip);
  return swapComponent(tripId, current.id, candidate.id);
}

export function continueFromPackage(tripId: string) {
  const trip = need(tripId);
  if (trip.status !== "select_package") throw new Error(`Can't continue from '${trip.status}'`);
  trip.status = "review";
  log(trip, "decision", "Package customisation complete — ready for review");
  return snapshot(trip);
}

/** Kept for API compatibility: the guide is optional, so skipping just moves on to review. */
export function skipGuide(tripId: string) {
  return continueFromPackage(tripId);
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

/** Guides based in the destination who speak the trip's guide language; the package's preferred specialisation ranks first. */
export function listGuides(tripId: string, specialisation?: string) {
  const trip = need(tripId);
  const requestedDates = datesBetween(trip.departDate, trip.durationDays);
  return GUIDES.filter(guide => guide.city === trip.destination && guide.languages.includes(trip.language) && (!specialisation || guide.specialisation === specialisation)).map(guide => ({
    ...guide,
    requestedDates,
    tripCost: guideCost(guide, requestedDates),
    matchesPackage: guide.specialisation === trip.guideSpecialisation,
    unavailableDates: requestedDates.filter(date => guide.availability[date] !== true),
    isAvailableForTrip: requestedDates.every(date => guide.availability[date] === true),
  })).sort((a, b) => Number(b.matchesPackage) - Number(a.matchesPackage) || Number(b.isAvailableForTrip) - Number(a.isAvailableForTrip) || b.rating - a.rating);
}

function availabilityIssue(trip: Trip, guide: GuideRecord, check: ReturnType<typeof guideCheck>, dates: string[], base: Trip): NonNullable<Trip["guideAvailabilityIssue"]> {
  const currentTotal = priceBreakdown(base).total;
  const replacementOptions = check.replacementOptions.map(option => ({ ...option, newTotal: priceBreakdown({ ...base, chosenGuide: { ...option.guide, daysBooked: 0, bookedDates: [], totalCost: option.totalCost } }).total }));
  return {
    guide, conflictingDates: check.conflicts, requestedDates: dates, replacement: check.replacement, replacementOptions,
    replacementTotalCost: replacementOptions[0]?.totalCost ?? null, priceDelta: check.priceDelta, currentTotal,
  };
}

export function selectGuide(tripId: string, guideId: string, days: number) {
  const trip = need(tripId);
  editable(trip, "book a guide");
  const guide = GUIDES.find(item => item.id === guideId);
  if (!guide) throw new Error("Guide not found for this destination");
  const offeredSubstitute = trip.guideAvailabilityIssue?.replacementOptions.some(option => option.guide.id === guide.id);
  if (guide.city !== trip.destination && !offeredSubstitute) throw new Error(`This guide is not based in ${trip.destination}`);
  if (!guide.languages.includes(trip.language)) throw new Error(`This guide does not match the requested ${trip.language} language preference`);
  if (!Number.isInteger(days) || days < 1) throw new Error("Guide days must be at least 1");
  const bookedDays = Math.min(days, trip.durationDays);
  const packageDates = datesBetween(trip.departDate, trip.durationDays);
  const bookedDates = packageDates.slice(0, bookedDays);
  const check = guideCheck(guide, packageDates, { language: trip.language, specialisation: guide.specialisation, chargeDates: bookedDates });
  if (check.conflicts.length) {
    // Refused: the current guide (if any) stays; substitutes are priced against the plan without this guide.
    trip.guideAvailabilityIssue = availabilityIssue(trip, guide, check, packageDates, { ...trip, chosenGuide: null });
    log(trip, "decision", `Guide ${guide.name} unavailable on ${check.conflicts.join(", ")}; checked all ${packageDates.length} package date(s) for ${trip.language}/${guide.specialisation}${check.replacement ? `; offered ${check.replacement.name} (${check.priceDelta! >= 0 ? "+" : "−"}${inr(Math.abs(check.priceDelta!))})` : "; no compliant substitute available"}`);
    return snapshot(trip);
  }
  const chosen: ChosenGuide = { ...guide, daysBooked: bookedDays, totalCost: guideCost(guide, bookedDates), bookedDates };
  commit(trip, `guide ${guide.name} (${bookedDays}d)`, { chosenGuide: chosen, guideAvailabilityIssue: null });
  return snapshot(trip);
}

export function removeGuide(tripId: string) {
  const trip = need(tripId);
  editable(trip, "remove the guide");
  if (!trip.chosenGuide) throw new Error("No guide is currently added to this itinerary");
  commit(trip, `removing guide ${trip.chosenGuide.name}`, { chosenGuide: null, guideAvailabilityIssue: null });
  return snapshot(trip);
}

// ---------------------------------------------------------------------------
// Budget negotiation, navigation, confirmation
// ---------------------------------------------------------------------------

export async function negotiate(tripId: string, choice: string, newCap?: number) {
  const trip = need(tripId);
  if (!trip.pending) throw new Error("Nothing to negotiate right now");
  const pending = trip.pending;
  if (choice === "approve_overage" || choice === "raise_cap") {
    if (choice === "raise_cap") {
      if (!newCap || newCap <= trip.budgetCap) throw new Error("new_cap must be greater than the current cap");
      trip.budgetCap = newCap;
    }
    Object.assign(trip, pending.patch);
    trip.runningTotal = priceBreakdown(trip).total;
    trip.status = pending.advanceStatus;
    log(trip, "decision", choice === "raise_cap" ? `Raised cap to ${inr(trip.budgetCap)} and applied ${pending.label}` : `Approved the overage for ${pending.label}`);
  } else {
    trip.status = pending.retryStatus;
    log(trip, "decision", `Dropped ${pending.label} — back to ${pending.retryStatus.replaceAll("_", " ")}`);
  }
  trip.pending = null;
  trip.negotiationOptions = [];
  return snapshot(trip);
}

export function goBack(tripId: string) {
  const trip = need(tripId);
  if (trip.status === "confirmed") throw new Error("A confirmed trip cannot go back");
  if (trip.status === "negotiate") {
    trip.status = trip.pending?.retryStatus ?? "select_flight";
    trip.pending = null;
    trip.negotiationOptions = [];
    log(trip, "decision", "Left negotiation without applying the change");
  } else if (trip.status === "review") {
    trip.status = "select_package";
    log(trip, "decision", "Back to package customisation");
  } else if (trip.status === "select_package") {
    Object.assign(trip, { chosenFlight: null, chosenTransport: null, package: null, packageComponents: [], chosenGuide: null, guideAvailabilityIssue: null });
    trip.runningTotal = 0;
    trip.status = "select_flight";
    log(trip, "decision", "Back to flight selection");
  } else {
    throw new Error("Already at the first planning stage");
  }
  return snapshot(trip);
}

export function setLanguage(tripId: string, language: string) {
  const trip = need(tripId);
  trip.language = language;
  log(trip, "decision", `Guide language switched to ${language}`);
  return snapshot(trip);
}

export async function confirmTrip(tripId: string, contact?: { email?: string; phone?: string }) {
  const trip = need(tripId);
  if (trip.status !== "review" && trip.status !== "select_package") throw new Error(trip.status === "negotiate" ? "Resolve the pending budget negotiation first" : `Can't confirm from '${trip.status}'`);
  trip.status = "confirmed";
  const summary = `PackagePro confirmed: ${trip.origin} → ${trip.destination} ${trip.departDate} to ${trip.returnDate}. Total ${inr(trip.runningTotal)} of ${inr(trip.budgetCap)}.`;
  log(trip, "decision", `Trip confirmed — final total ${inr(trip.runningTotal)} of ${inr(trip.budgetCap)} cap`);
  if (contact?.email || contact?.phone) {
    const sent = await sendConfirmation({ email: contact.email, phone: contact.phone, summary });
    log(trip, "tool_result", `Notifications: email ${sent.email ? "sent" : "skipped"}, sms ${sent.sms ? "sent" : "skipped"}`);
  }
  return snapshot(trip);
}

// ---------------------------------------------------------------------------
// Chat auto-build
// ---------------------------------------------------------------------------

export async function autoBuildTrip(input: { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap?: number; language: string; interests?: string; hotelTier?: "budget" | "boutique" | "luxury"; transportMode?: "flight" | "train" | "cab" }) {
  const durationDays = Math.max(1, daysBetween(input.departDate, input.returnDate));
  const destination = resolveDestination(input.destination).city;
  const pkg = packageForCity(destination);
  if (!pkg) throw new Error(`No package found for ${destination}`);
  const packageEstimate = pkg.basePrice * durationDays / Math.max(1, pkg.duration);
  const guideRates = GUIDES.filter(guide => guide.city === destination && guide.languages.includes(input.language)).map(guide => guide.dayRate * 1.35);
  const guideEstimate = (guideRates.length ? Math.min(...guideRates) : 0) * durationDays;
  const suggestedCap = Math.ceil((7000 + packageEstimate * 1.25 + guideEstimate) * 1.12 / 500) * 500;
  const created = await createTrip({ ...input, budgetCap: input.budgetCap && input.budgetCap > 0 ? input.budgetCap : suggestedCap });
  const trip = need(created.tripId);

  const requestedTransport = input.transportMode && input.transportMode !== "flight" ? TRANSPORTS.find(item => item.mode === input.transportMode && item.route.toLowerCase().includes(destination.toLowerCase())) : undefined;
  let built = requestedTransport ? selectTransport(trip, requestedTransport) : await (async () => {
    const cheapestFlight = [...trip.flightOptions].sort((a, b) => a.price - b.price)[0];
    if (!cheapestFlight) throw new Error("No flight option was found for this trip");
    return selectFlight(trip.tripId, cheapestFlight.id);
  })();
  if (built.status === "negotiate") throw new Error("The requested trip needs a larger budget before it can be auto-built");

  if (input.hotelTier && input.hotelTier !== "boutique") {
    built = swapHotel(trip.tripId, input.hotelTier);
    if (built.status === "negotiate") built = await negotiate(trip.tripId, "remove_item");
  }

  const guides = listGuides(trip.tripId);
  const preferredGuide = guides.find(guide => guide.isAvailableForTrip) ?? guides[0];
  if (preferredGuide) {
    built = selectGuide(trip.tripId, preferredGuide.id, durationDays);
    if (!built.chosenGuide && built.guideAvailabilityIssue?.replacement) built = selectGuide(trip.tripId, built.guideAvailabilityIssue.replacement.id, durationDays);
    // The guide is optional: if it doesn't fit the auto-built budget, leave it out instead of stalling in negotiation.
    if (built.status === "negotiate") built = await negotiate(trip.tripId, "remove_item");
  }
  built = continueFromPackage(trip.tripId);
  log(trip, "reasoning", `Auto-built the ${durationDays}-day ${destination} package from the chat request`);
  return getTrip(trip.tripId);
}
