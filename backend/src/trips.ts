import { nanoid } from "nanoid";
import { fromPaise, toPaise } from "./catalogue";
import { CITIES, GUIDES, LANGUAGE_TAGS, PACKAGES, TRANSPORTS, datesBetween, getAlternatives, guideCheck, guideCost, isGuideFree, liveAvailability, packageForCity, realityCheck, withLiveAvailability, type FlightRecord, type GuideRecord, type PackageComponent, type PackageRecord, type TransportRecord } from "./packagepro";
import { DESTINATIONS, ORIGINS, searchFlightsLive, sendConfirmation } from "./integrations";
import { GuideSlotTakenError, loadTrip, recordBooking, saveTrip, type CanonicalItem, type CanonicalTrip } from "./appStore";
import { DEFAULT_TRAVELLER_ID, getTraveller } from "./travellers";

// Flow: select_flight → select_package (customise: itinerary, swaps, add-ons, guide, duration) → review → confirmed.
// The total is never accumulated: it is recomputed from the current selection after every change.
export type TripStatus = "select_flight" | "select_package" | "negotiate" | "review" | "confirmed";

/** A line of the customised package: the component currently filling a slot, plus the default it replaced. */
export type TripComponent = PackageComponent & { included: boolean; defaultId: string; defaultPrice: number };

/** A guide on the plan. `wholeTrip` guides were checked on every trip date (the mandatory rule); day-by-day guides only on their own dates. */
export type ChosenGuide = GuideRecord & { daysBooked: number; totalCost: number; bookedDates: string[]; wholeTrip?: boolean };

/** Every guide on the plan: the primary one plus day-by-day extras (each date belongs to at most one guide). */
export const allGuides = (trip: Pick<Trip, "chosenGuide" | "extraGuides">) => [trip.chosenGuide, ...(trip.extraGuides ?? [])].filter((guide): guide is ChosenGuide => Boolean(guide));

function assignGuide(guide: GuideRecord, dates: string[], wholeTrip: boolean): ChosenGuide {
  const bookedDates = [...dates].sort();
  return { ...guide, daysBooked: bookedDates.length, bookedDates, totalCost: guideCost(guide, bookedDates), wholeTrip };
}

/** Split a guide list back into the primary guide (most days first kept) and extras. */
function guideFields(guides: ChosenGuide[]): Pick<Trip, "chosenGuide" | "extraGuides"> {
  const kept = guides.filter(guide => guide.bookedDates.length > 0);
  return { chosenGuide: kept[0] ?? null, extraGuides: kept.slice(1) };
}

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
  /** Day-by-day guides beyond the primary one (disjoint dates). */
  extraGuides?: ChosenGuide[];
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
  pending: { amount: number; label: string; retryStatus: TripStatus; advanceStatus: TripStatus; patch: Partial<Trip>; total?: number; overage?: number; fixes?: BudgetFix[]; applied?: FixStep[]; lowestTotal?: number } | null;
  booking?: { bookingId: string; reference: string; itineraryId?: string } | null;
  /** users.user_id of the traveller (canonical trips.owner_user_id / bookings.user_id). */
  userId: string;
  /** Canonical bookings.channel: web app, or mobile_app for the Telegram bot. */
  channel: "web" | "mobile_app";
  trace: { kind: string; text: string }[];
  /** Plan states before each applied change (newest last), for Undo. */
  history?: PlanState[];
  /** Trip length as first planned, for "Discard changes". */
  plannedDays?: number;
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

/** A saved trip carries copies of catalogue records; refresh them so descriptions match the current catalogue (prices and choices stay as saved). */
function refreshCatalogue(trip: Trip): Trip {
  const pkg = trip.package ? PACKAGES.find(item => item.id === trip.package!.id) : undefined;
  if (!pkg) return trip;
  const fresh = new Map(pkg.components.map(item => [item.id, item]));
  trip.package = pkg;
  trip.packageComponents = trip.packageComponents.map(line => ({ ...line, detail: fresh.get(line.id)?.detail ?? line.detail }));
  return trip;
}

/** In-memory working copy, backed by the app database so trips survive restarts and share links resolve. */
function need(tripId: string) {
  let trip = trips.get(tripId);
  if (!trip) {
    trip = loadTrip<Trip>(tripId) ?? undefined;
    if (trip) trips.set(tripId, refreshCatalogue(trip));
  }
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
/** How many units of a component a party needs: per person, per room (2 per room) or per vehicle (up to 4); guides are per group. */
export function partyUnits(travelers: number) {
  const pax = Math.max(1, Math.floor(travelers || 1));
  return { pax, rooms: Math.ceil(pax / 2), vehicles: Math.ceil(pax / 4) };
}
export const unitsFor = (type: PackageComponent["type"], party: ReturnType<typeof partyUnits>) => (type === "hotel" ? party.rooms : type === "transfer" ? party.vehicles : party.pax);

/** A component counts only when its day falls inside the trip (shortening a trip drops later days). */
const inTrip = (component: PackageComponent, days: number) => (component.dayIndex ?? 1) <= Math.max(1, days);

/** Party units × (for the hotel) the share of the package's nights actually stayed. */
function chargeFactor(trip: Pick<Trip, "travelers" | "durationDays" | "package">, component: PackageComponent) {
  const units = unitsFor(component.type, partyUnits(trip.travelers));
  const nights = component.type === "hotel" && trip.package ? Math.max(1, trip.durationDays) / Math.max(1, trip.package.durationNights) : 1;
  return units * nights;
}

/** What one component adds to the total, in rupees (price_delta × units, hotel prorated by nights). */
export function componentCharge(trip: Pick<Trip, "travelers" | "durationDays" | "package">, component: PackageComponent) {
  return fromPaise(Math.round(paise(component.price) * chargeFactor(trip, component)));
}

/**
 * PS-04 pricing: package base + the price_delta of every component you keep (never a float: all sums in integer paise).
 * The base is per person and prorated by days; components scale per person / room / vehicle; the guide is per group.
 */
function priceBreakdown(trip: Pick<Trip, "package" | "packageComponents" | "durationDays" | "chosenFlight" | "chosenTransport" | "chosenGuide" | "extraGuides" | "travelers">) {
  const party = partyUnits(trip.travelers);
  const transport = paise(trip.chosenTransport?.price ?? trip.chosenFlight?.price ?? 0) * party.pax;
  const base = trip.package ? Math.round(paise(trip.package.basePrice) * Math.max(1, trip.durationDays) / Math.max(1, trip.package.duration)) * party.pax : 0;
  let components = 0;
  let addOns = 0;
  let swaps = 0;
  for (const component of trip.packageComponents) {
    if (!component.included || !inTrip(component, trip.durationDays)) continue;
    const charge = paise(componentCharge(trip, component));
    if (component.optional) addOns += charge;
    else {
      components += charge;
      swaps += charge - Math.round(paise(component.defaultPrice) * chargeFactor(trip, component));
    }
  }
  const guide = allGuides(trip).reduce((sum, item) => sum + paise(item.totalCost), 0);
  const packageTotal = base + components + addOns;
  return {
    transport: fromPaise(transport),
    packageBase: fromPaise(base),
    components: fromPaise(components),
    /** How much of `components` comes from the traveller's swaps (informational; already inside `components`). */
    swapAdjustments: fromPaise(swaps),
    addOns: fromPaise(addOns),
    packageTotal: fromPaise(packageTotal),
    guide: fromPaise(guide),
    total: fromPaise(transport + packageTotal + guide),
    party,
    nightsFactor: trip.package ? Math.max(1, trip.durationDays) / Math.max(1, trip.package.durationNights) : 1,
  };
}

/** Default package total for a party and trip length — the same formula, used by the estimate before a trip exists. */
export function defaultComponentsTotal(pkg: PackageRecord, days: number, travelers: number) {
  const trip = { package: pkg, durationDays: days, travelers };
  return fromPaise(pkg.components.filter(component => component.isDefault && !component.optional && inTrip(component, days)).reduce((sum, component) => sum + paise(componentCharge(trip, component)), 0));
}

const SLOT_ORDER: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, overnight: 3 };

function itinerary(trip: Trip) {
  const dates = datesBetween(trip.departDate, trip.durationDays);
  const lines = trip.packageComponents.filter(component => component.included);
  const hotel = lines.find(component => component.type === "hotel");
  return dates.map((date, index) => {
    const day = index + 1;
    const items: { kind: string; slot: string; label: string; detail: string; price?: number; componentId?: string; guideId?: string }[] = [];
    if (day === 1) {
      const leg = trip.chosenTransport ?? trip.chosenFlight;
      if (leg) items.push({ kind: "arrival", slot: "morning", label: trip.chosenTransport ? `Arrive by ${trip.chosenTransport.operator}` : `Arrive on ${trip.chosenFlight!.airline} ${trip.chosenFlight!.id}`, detail: leg.route });
    }
    for (const component of lines) {
      if (component.type === "hotel") continue;
      // Same rule as the price (inTrip): a line planned after a shortened trip's last day is neither shown nor charged.
      if ((component.dayIndex ?? 1) !== day) continue;
      items.push({ kind: component.type, slot: component.slot ?? "morning", label: component.label, detail: component.detail, price: componentCharge(trip, component), componentId: component.id });
    }
    const dayGuide = allGuides(trip).find(guide => guide.bookedDates.includes(date));
    if (dayGuide) {
      items.push({ kind: "guide", slot: "morning", label: `Guide: ${dayGuide.name}`, detail: `${dayGuide.specialisation} · ${dayGuide.languages.join(", ")}`, price: guideCost(dayGuide, [date]), guideId: dayGuide.id });
    }
    if (hotel) items.push({ kind: "hotel", slot: "overnight", label: day === 1 ? `Check in: ${hotel.label}` : `Stay: ${hotel.label}`, detail: hotel.detail, price: day === 1 ? componentCharge(trip, hotel) : undefined, componentId: hotel.id });
    items.sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9));
    return { day, date, items };
  });
}

function snapshot(trip: Trip) {
  saveTrip(trip, canonicalTrip(trip));
  const breakdown = priceBreakdown(trip);
  const hotel = trip.packageComponents.find(component => component.type === "hotel" && component.included);
  return {
    ...trip,
    // Budget fixes go out without their internal patches (the server re-applies them by id).
    pending: trip.pending ? { ...trip.pending, fixes: (trip.pending.fixes ?? []).map(({ patch: _patch, ...fix }) => fix) } : null,
    suggestions: suggestionsFor(trip).map(({ patch: _patch, ...item }) => item),
    canUndo: Boolean(trip.history?.length),
    /** For each line on the plan, the alternatives it can be swapped for on this trip. */
    swapOptions: Object.fromEntries(trip.package ? trip.packageComponents.map(component => [component.id, swapOptions(trip, component.id).map(option => option.id)]) : []),
    history: undefined,
    priceBreakdown: breakdown,
    packagePrice: breakdown.packageTotal,
    chosenHotel: hotel ? { id: hotel.id, name: hotel.label, rating: Number(hotel.detail.match(/(\d)★/)?.[1] || 0), detail: hotel.detail, total: hotel.price } : null,
    itinerary: trip.package ? itinerary(trip) : [],
    /** Day-by-day guide plan: which guide (if any) covers each trip date, and that day's cost. */
    guidePlan: datesBetween(trip.departDate, trip.durationDays).map(date => {
      const guide = allGuides(trip).find(item => item.bookedDates.includes(date));
      return { date, guideId: guide?.id ?? null, guideName: guide?.name ?? null, cost: guide ? guideCost(guide, [date]) : 0 };
    }),
    extraGuides: trip.extraGuides ?? [],
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
  // A change that doesn't raise an existing plan's total always applies — even when an approved overage leaves the plan above the cap.
  const noDearer = trip.runningTotal > 0 && trip.package != null && total <= trip.runningTotal;
  if (total <= trip.budgetCap || noDearer) {
    const delta = total - trip.runningTotal;
    remember(trip);
    Object.assign(trip, patch);
    trip.runningTotal = total;
    trip.status = advanceTo;
    trip.pending = null;
    trip.negotiationOptions = [];
    log(trip, "decision", `${label} — ${delta >= 0 ? "+" : "−"}${inr(Math.abs(delta))}, total now ${inr(total)}`);
    return true;
  }
  const overage = Math.round((total - trip.budgetCap) * 100) / 100;
  // What approving adds beyond anything already approved (a plan may already sit above the cap).
  const newExtra = Math.round((total - Math.max(trip.budgetCap, trip.package ? trip.runningTotal : 0)) * 100) / 100;
  const retryStatus = trip.status === "negotiate" ? (trip.pending?.retryStatus ?? "select_flight") : trip.status;
  trip.status = "negotiate";
  const fixes = budgetFixes({ ...trip, ...patch }, trip.budgetCap);
  // The lowest this plan can reach with the cuts on offer — the honest minimum budget when nothing fits.
  const lowestTotal = Math.min(total, ...fixes.map(fix => fix.newTotal));
  trip.pending = { amount: total - trip.runningTotal, label, retryStatus, advanceStatus: advanceTo, patch, total, overage, fixes, lowestTotal };
  // Declining puts the plan back as it was; on the very first flight + package pick that means choosing another flight.
  const declineLabel = retryStatus === "select_flight" ? "Choose a different flight" : "Keep the plan as it was";
  trip.negotiationOptions = [
    { choice: "approve_overage", amount: newExtra, item_label: label, label: `Approve the extra ${inr(newExtra)} for ${label}` },
    { choice: "swap_cheaper", item_label: label, label: declineLabel },
    { choice: "raise_cap", item_label: label, label: "Raise my overall trip budget" },
  ];
  log(trip, "decision", `${label} would exceed your budget by ${inr(overage)}${fixes.length ? `; ${fixes.length} ways to fit it offered` : ""}`);
  return false;
}

type FixStep = { kind: BudgetFix["kind"]; from?: string; to?: string };

/** A concrete change that brings an over-budget plan down, priced by re-running the whole plan. */
export type BudgetFix = {
  id: string;
  kind: "auto" | "flight" | "hotel" | "experience" | "transfer" | "meal" | "entry_ticket" | "addon" | "guide" | "days";
  from?: string;
  to?: string;
  saving: number;
  newTotal: number;
  fits: boolean;
  steps?: { kind: BudgetFix["kind"]; from?: string; to?: string }[];
  patch: Partial<Trip>;
};

type FixCandidate = Omit<BudgetFix, "saving" | "newTotal" | "fits">;

/** Every single change that makes the plan cheaper: cheaper flights, cheaper alternatives in each swap group, dropping add-ons or guides, one day less. */
function fixCandidates(plan: Trip): FixCandidate[] {
  const out: FixCandidate[] = [];
  const flight = plan.chosenFlight;
  if (flight) {
    for (const option of plan.flightOptions.filter(item => item.price < flight.price)) {
      out.push({ id: `flight:${option.id}`, kind: "flight", from: `${flight.airline} ${flight.depart}`, to: `${option.airline} ${option.depart}`, patch: { chosenFlight: option } });
    }
  }
  if (plan.package) {
    for (const component of plan.packageComponents.filter(item => item.included)) {
      const cheaper = swapOptions(plan, component.id).filter(item => item.price < component.price).sort((a, b) => a.price - b.price);
      for (const option of cheaper.slice(0, 2)) {
        const next = replacement(component, option);
        out.push({ id: `swap:${component.id}:${option.id}`, kind: (component.type as BudgetFix["kind"]) ?? "experience", from: component.label, to: option.label, patch: { packageComponents: plan.packageComponents.map(item => item.id === component.id ? next : item) } });
      }
      if (component.optional) {
        out.push({ id: `addon:${component.id}`, kind: "addon", from: component.label, patch: { packageComponents: plan.packageComponents.map(item => item.id === component.id ? { ...item, included: false } : item) } });
      }
    }
    const guides = allGuides(plan);
    for (const guide of guides) {
      out.push({ id: `guide:${guide.id}`, kind: "guide", from: guide.name, patch: { ...guideFields(guides.filter(item => item.id !== guide.id)), guideAvailabilityIssue: null } });
    }
    // One day shorter (only without guides, whose dates would need re-checking), never below 2 days.
    if (!guides.length && plan.durationDays > 2) {
      out.push({ id: `days:${plan.durationDays - 1}`, kind: "days", from: String(plan.durationDays), to: String(plan.durationDays - 1), patch: { durationDays: plan.durationDays - 1, returnDate: addDays(plan.departDate, plan.durationDays - 1) } });
    }
  }
  return out;
}

/**
 * Ways to bring an over-budget plan back under the cap, best first: a combined "fit my budget" plan (the smallest set of cuts
 * that fits), then single changes — the ones that fit with the least given up first, then the biggest savings.
 */
function budgetFixes(plan: Trip, cap: number): BudgetFix[] {
  const total = priceBreakdown(plan).total;
  const priced = (candidate: FixCandidate, base: Trip) => {
    const newTotal = priceBreakdown({ ...base, ...candidate.patch }).total;
    return { ...candidate, newTotal, saving: Math.round((priceBreakdown(base).total - newTotal) * 100) / 100, fits: newTotal <= cap };
  };
  const singles = fixCandidates(plan).map(candidate => priced(candidate, plan)).filter(fix => fix.saving > 0);
  // Per kind keep the most useful options: the gentlest one that fits, and the biggest saving.
  const byKind = new Map<string, BudgetFix[]>();
  for (const fix of singles) byKind.set(fix.kind, [...(byKind.get(fix.kind) ?? []), fix]);
  const shortlisted: BudgetFix[] = [];
  byKind.forEach(fixes => {
    const gentlestFit = fixes.filter(fix => fix.fits).sort((a, b) => a.saving - b.saving)[0];
    const biggest = [...fixes].sort((a, b) => b.saving - a.saving)[0];
    for (const fix of [gentlestFit, biggest]) if (fix && !shortlisted.includes(fix)) shortlisted.push(fix);
  });
  shortlisted.sort((a, b) => Number(b.fits) - Number(a.fits) || (a.fits ? a.saving - b.saving : b.saving - a.saving));

  // Greedy combination: keep applying the change that fits with the least saving, else the biggest saving, until under the cap.
  let current = plan;
  const steps: { kind: BudgetFix["kind"]; from?: string; to?: string }[] = [];
  for (let round = 0; round < 6 && priceBreakdown(current).total > cap; round++) {
    const options = fixCandidates(current).map(candidate => priced(candidate, current)).filter(fix => fix.saving > 0 && !steps.some(step => step.kind === fix.kind && step.from === fix.from));
    if (!options.length) break;
    const pick = options.filter(fix => fix.fits).sort((a, b) => a.saving - b.saving)[0] ?? options.sort((a, b) => b.saving - a.saving)[0];
    current = { ...current, ...pick.patch };
    steps.push({ kind: pick.kind, from: pick.from, to: pick.to });
  }
  const combinedTotal = priceBreakdown(current).total;
  const fixes = shortlisted.slice(0, 6);
  if (steps.length > 1 && combinedTotal < total) {
    const patch: Partial<Trip> = { chosenFlight: current.chosenFlight, packageComponents: current.packageComponents, chosenGuide: current.chosenGuide, extraGuides: current.extraGuides, durationDays: current.durationDays, returnDate: current.returnDate, guideAvailabilityIssue: current.guideAvailabilityIssue };
    fixes.unshift({ id: "auto", kind: "auto", steps, saving: Math.round((total - combinedTotal) * 100) / 100, newTotal: combinedTotal, fits: combinedTotal <= cap, patch });
  }
  return fixes;
}

/** The parts of a trip that customising changes — what Undo restores. */
type PlanState = Pick<Trip, "chosenFlight" | "chosenTransport" | "packageComponents" | "chosenGuide" | "extraGuides" | "durationDays" | "returnDate" | "guideAvailabilityIssue">;

/** Save the plan before an applied change (only once a package is loaded: the first flight + package pick has nothing to undo). */
function remember(trip: Trip) {
  if (!trip.package) return;
  const state: PlanState = { chosenFlight: trip.chosenFlight, chosenTransport: trip.chosenTransport, packageComponents: trip.packageComponents, chosenGuide: trip.chosenGuide, extraGuides: trip.extraGuides ?? [], durationDays: trip.durationDays, returnDate: trip.returnDate, guideAvailabilityIssue: trip.guideAvailabilityIssue };
  trip.history = [...(trip.history ?? []), state].slice(-15);
}

/**
 * Worthwhile upgrades that still fit the budget: a better-rated stay, a dearer alternative for an activity or transfer,
 * a recommended add-on, or one more day (up to the package's own length).
 */
function upgradeCandidates(plan: Trip): FixCandidate[] {
  const out: FixCandidate[] = [];
  if (!plan.package) return out;
  const stars = (item: PackageComponent) => Number(item.detail.match(/(\d)★/)?.[1] || 0);
  for (const component of plan.packageComponents.filter(item => item.included)) {
    const dearer = swapOptions(plan, component.id).filter(item => item.price > component.price);
    // Hotels: the best-rated step up; other components: the next step up.
    const pick = component.type === "hotel"
      ? dearer.filter(item => stars(item) > stars(component)).sort((a, b) => stars(b) - stars(a) || a.price - b.price)[0]
      : dearer.sort((a, b) => a.price - b.price)[0];
    if (!pick) continue;
    const next = replacement(component, pick);
    out.push({ id: `swap:${component.id}:${pick.id}`, kind: (component.type as BudgetFix["kind"]) ?? "experience", from: component.label, to: pick.label, patch: { packageComponents: plan.packageComponents.map(item => item.id === component.id ? next : item) } });
  }
  for (const addOn of plan.packageComponents.filter(item => item.optional && !item.included)) {
    out.push({ id: `addon-in:${addOn.id}`, kind: "addon", to: addOn.label, patch: { packageComponents: plan.packageComponents.map(item => item.id === addOn.id ? { ...item, included: true } : item) } });
  }
  if (!allGuides(plan).length && plan.durationDays < plan.package.duration) {
    out.push({ id: `days:${plan.durationDays + 1}`, kind: "days", from: String(plan.durationDays), to: String(plan.durationDays + 1), patch: { durationDays: plan.durationDays + 1, returnDate: addDays(plan.departDate, plan.durationDays + 1) } });
  }
  return out;
}

export type Suggestion = Omit<BudgetFix, "patch"> & { direction: "save" | "upgrade" };

/** What to recommend on the customise screen: over the cap, the best ways back under it; within it, upgrades that still fit. */
function suggestionsFor(trip: Trip): (Suggestion & { patch: Partial<Trip> })[] {
  if (!trip.package || !EDITABLE.includes(trip.status)) return [];
  const total = priceBreakdown(trip).total;
  if (total > trip.budgetCap) return budgetFixes(trip, trip.budgetCap).slice(0, 4).map(fix => ({ ...fix, direction: "save" as const }));
  const priced = upgradeCandidates(trip).map(candidate => {
    const newTotal = priceBreakdown({ ...trip, ...candidate.patch }).total;
    return { ...candidate, newTotal, saving: Math.round((total - newTotal) * 100) / 100, fits: newTotal <= trip.budgetCap, direction: "upgrade" as const };
  }).filter(item => item.fits && item.newTotal > total);
  // Most visible upgrades first (stay, extra day, add-ons), then the rest; cheapest within each kind.
  const rank: Record<string, number> = { hotel: 0, days: 1, addon: 2, experience: 3, meal: 4, transfer: 5, entry_ticket: 6 };
  return priced.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.newTotal - b.newTotal).slice(0, 4);
}

/** Apply a suggestion shown on the customise screen (re-derived from the current plan, so it is never stale). */
export function applySuggestion(tripId: string, suggestionId: string) {
  const trip = need(tripId);
  editable(trip, "apply a suggestion");
  const suggestion = suggestionsFor(trip).find(item => item.id === suggestionId);
  if (!suggestion) throw new Error("That suggestion no longer applies to this plan");
  const describe = (item: { from?: string; to?: string }) => item.to && item.from ? `${item.from} → ${item.to}` : item.to ? `adding ${item.to}` : `without ${item.from}`;
  const label = suggestion.kind === "auto" ? `fitting the budget (${(suggestion.steps ?? []).map(describe).join(", ")})` : describe(suggestion);
  commit(trip, label, suggestion.patch);
  return snapshot(trip);
}

/** Undo the last applied change. */
export function undoChange(tripId: string) {
  const trip = need(tripId);
  editable(trip, "undo");
  const previous = trip.history?.pop();
  if (!previous) throw new Error("Nothing to undo");
  Object.assign(trip, previous);
  trip.runningTotal = priceBreakdown(trip).total;
  log(trip, "decision", `Undid the last change — total ${inr(trip.runningTotal)}`);
  return snapshot(trip);
}

/** Discard every customisation: the package's recommended components and the trip length first planned (flight kept). */
export function discardChanges(tripId: string) {
  const trip = need(tripId);
  editable(trip, "discard changes");
  const days = trip.plannedDays ?? trip.durationDays;
  const patch: Partial<Trip> = { packageComponents: loadPackage(trip).packageComponents };
  if (days !== trip.durationDays) {
    // A different length would move guide dates, so guides are cleared with it; otherwise they stay.
    Object.assign(patch, { durationDays: days, returnDate: addDays(trip.departDate, days), chosenGuide: null, extraGuides: [], guideAvailabilityIssue: null });
  }
  commit(trip, "discarding your changes (recommended package)", patch);
  return snapshot(trip);
}

/** The alternative takes over the replaced line's place in the day (same day and slot), so a swap never moves the plan around. */
function replacement(current: TripComponent, option: PackageComponent): TripComponent {
  return { ...option, dayIndex: current.dayIndex, slot: current.slot, included: current.included, defaultId: current.defaultId, defaultPrice: current.defaultPrice };
}

/**
 * Alternatives that make sense for this trip: the package's swap group, with transfers limited to legs that start where the
 * traveller actually arrives (the airport after a flight, the railway station after a train).
 */
function swapOptions(trip: Pick<Trip, "package" | "chosenFlight" | "chosenTransport">, componentId: string) {
  if (!trip.package) return [];
  const options = getAlternatives(trip.package, componentId);
  const arrival = trip.chosenTransport ? (trip.chosenTransport.mode === "train" ? "Railway station" : null) : trip.chosenFlight ? "Airport" : null;
  return arrival ? options.filter(option => option.type !== "transfer" || option.label.startsWith(`${arrival} →`)) : options;
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

/**
 * PS-04 boundary rules, enforced before a trip exists:
 *  - party size within the package's tour_packages.min_group_size … max_group_size
 *  - guide/tour language is a BCP-47 tag present in the languages table (rule R6)
 *  - the package is priced in INR (the only currency this build sells)
 */
export function assertTripRules(city: string, travelers: number, language: string) {
  const pkg = packageForCity(city);
  if (!pkg) throw new Error(`No package found for ${city}`);
  if (!Number.isInteger(travelers) || travelers < pkg.minGroupSize || travelers > pkg.maxGroupSize) {
    throw new Error(`${pkg.name} takes groups of ${pkg.minGroupSize}–${pkg.maxGroupSize} travellers (you asked for ${travelers})`);
  }
  if (!LANGUAGE_TAGS.has(language)) throw new Error(`'${language}' is not a BCP-47 language tag from the languages table`);
  if (pkg.currency !== "INR") throw new Error(`${pkg.name} is priced in ${pkg.currency}; PackagePro sells INR packages only`);
  return pkg;
}

export async function createTrip(input: { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap: number; language: string; interests?: string; userId?: string; channel?: "web" | "mobile_app" }) {
  const traveller = getTraveller(input.userId);
  if (!traveller) throw new Error(`Unknown traveller '${input.userId}' (not in the users table)`);
  const origin = input.origin.trim().toUpperCase();
  const place = resolveDestination(input.destination);
  const code = place.airport || place.code;
  if (origin === code) throw new Error("origin and destination can't be the same");
  const durationDays = daysBetween(input.departDate, input.returnDate);
  if (!Number.isFinite(durationDays) || durationDays <= 0) throw new Error("return_date must be after depart_date");
  assertTripRules(place.city, input.travelers, input.language);
  const liveFlights = await searchFlightsLive(origin, code, input.departDate);
  const trip: Trip = {
    tripId: `trp_${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "0")}`,
    userId: traveller.userId,
    channel: input.channel ?? "web",
    origin, destination: place.city, destinationCode: code,
    departDate: input.departDate, returnDate: input.returnDate, durationDays,
    travelers: input.travelers, budgetCap: input.budgetCap, runningTotal: 0,
    language: input.language, interests: input.interests || "", guideSpecialisation: "heritage",
    status: "select_flight",
    flightOptions: liveFlights.flights, chosenFlight: null, chosenTransport: null,
    package: null, packageComponents: [], chosenGuide: null, guideAvailabilityIssue: null,
    flightSource: liveFlights.source, flightNote: liveFlights.note, flightInsights: liveFlights.insights,
    negotiationOptions: [], pending: null, trace: [], plannedDays: durationDays,
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
  const target = swapOptions(trip, fromId).find(item => item.id === toId);
  if (!from || !target) throw new Error("Not a valid swap target");
  const next = replacement(from, target);
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

/**
 * Remove a line from the plan (or add it back): any activity, transfer, meal or ticket. The stay is swapped, never removed —
 * the package includes accommodation. Priced like every change: base + every kept component (PS-04).
 */
export function setComponentIncluded(tripId: string, componentId: string, include: boolean) {
  const trip = need(tripId);
  editable(trip, include ? "add a line back" : "remove a line");
  const component = trip.packageComponents.find(item => item.id === componentId);
  if (!component) throw new Error("That line is not in this package");
  if (component.type === "hotel") throw new Error("The stay can be swapped but not removed — the package includes accommodation");
  if (component.included === include) return snapshot(trip);
  commit(trip, `${include ? "adding back" : "removing"} ${component.label}`, { packageComponents: trip.packageComponents.map(item => item.id === componentId ? { ...item, included: include } : item) });
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
  const inRange = new Set(datesBetween(trip.departDate, days));
  // Day-by-day guides keep only their dates inside the new range that are still free.
  patch.extraGuides = (trip.extraGuides ?? []).map(extra => assignGuide(extra, extra.bookedDates.filter(date => inRange.has(date) && isGuideFree(extra, date)), false)).filter(extra => extra.bookedDates.length);
  if (guide && guide.wholeTrip === false) {
    const kept = guide.bookedDates.filter(date => inRange.has(date) && isGuideFree(guide, date));
    Object.assign(patch, guideFields([assignGuide(guide, kept, false), ...(patch.extraGuides ?? [])]));
  } else if (guide) {
    const dates = datesBetween(trip.departDate, days);
    const bookedDates = dates.slice(0, Math.min(guide.daysBooked, days));
    const check = guideCheck(guide, dates, { language: trip.language, specialisation: guide.specialisation, chargeDates: bookedDates });
    if (check.conflicts.length) {
      patch.chosenGuide = null;
      patch.guideAvailabilityIssue = availabilityIssue(trip, guide, check, dates, { ...trip, ...patch, chosenGuide: null });
    } else {
      patch.chosenGuide = { ...guide, daysBooked: bookedDates.length, bookedDates, totalCost: guideCost(guide, bookedDates), wholeTrip: true };
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
  const options = [current, ...swapOptions(trip, current.id)];
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
    availability: liveAvailability(guide),
    /** Per-date cost (day_rate × that date's price_multiplier), for day-by-day planning. */
    dayCosts: Object.fromEntries(requestedDates.map(date => [date, guideCost(guide, [date])])),
    unavailableDates: requestedDates.filter(date => !isGuideFree(guide, date)),
    isAvailableForTrip: requestedDates.every(date => isGuideFree(guide, date)),
  })).sort((a, b) => Number(b.matchesPackage) - Number(a.matchesPackage) || Number(b.isAvailableForTrip) - Number(a.isAvailableForTrip) || b.rating - a.rating);
}

function availabilityIssue(trip: Trip, guide: GuideRecord, check: ReturnType<typeof guideCheck>, dates: string[], base: Trip): NonNullable<Trip["guideAvailabilityIssue"]> {
  const currentTotal = priceBreakdown(base).total;
  const replacementOptions = check.replacementOptions.map(option => ({ ...option, newTotal: priceBreakdown({ ...base, extraGuides: [...(base.extraGuides ?? []), { ...option.guide, daysBooked: 0, bookedDates: [], totalCost: option.totalCost }] }).total }));
  return {
    guide: withLiveAvailability(guide), conflictingDates: check.conflicts, requestedDates: dates, replacement: check.replacement, replacementOptions,
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
    trip.guideAvailabilityIssue = availabilityIssue(trip, guide, check, packageDates, { ...trip, chosenGuide: null, extraGuides: [] });
    log(trip, "decision", `Guide ${guide.name} unavailable on ${check.conflicts.join(", ")}; checked all ${packageDates.length} package date(s) for ${trip.language}/${guide.specialisation}${check.replacement ? `; offered ${check.replacement.name} (${check.priceDelta! >= 0 ? "+" : "−"}${inr(Math.abs(check.priceDelta!))})` : "; no compliant substitute available"}`);
    return snapshot(trip);
  }
  const chosen: ChosenGuide = { ...guide, daysBooked: bookedDays, totalCost: guideCost(guide, bookedDates), bookedDates, wholeTrip: true };
  commit(trip, `guide ${guide.name} (${bookedDays}d)`, { chosenGuide: chosen, extraGuides: [], guideAvailabilityIssue: null });
  return snapshot(trip);
}

/**
 * Day-by-day guide planning: book a guide only on the dates the traveller picks (e.g. the one day a favourite guide is free)
 * and cover other days with other guides. Only the picked dates are checked; any clash is refused with the dates named and
 * same-language, same-specialisation substitutes free on those dates, repriced — the same rule as a whole-trip booking.
 */
export function bookGuideDays(tripId: string, guideId: string, dates: string[]) {
  const trip = need(tripId);
  editable(trip, "book a guide");
  const guide = GUIDES.find(item => item.id === guideId);
  if (!guide) throw new Error("Guide not found for this destination");
  const offeredSubstitute = trip.guideAvailabilityIssue?.replacementOptions.some(option => option.guide.id === guide.id);
  if (guide.city !== trip.destination && !offeredSubstitute) throw new Error(`This guide is not based in ${trip.destination}`);
  if (!guide.languages.includes(trip.language)) throw new Error(`This guide does not match the requested ${trip.language} language preference`);
  const packageDates = datesBetween(trip.departDate, trip.durationDays);
  const picked = Array.from(new Set(dates)).sort();
  if (!picked.length) throw new Error("Pick at least one date for the guide");
  const outside = picked.filter(date => !packageDates.includes(date));
  if (outside.length) throw new Error(`${outside.join(", ")} is outside this trip (${trip.departDate} → ${packageDates[packageDates.length - 1]})`);
  // Everyone else keeps their other dates; the picked dates are freed for this guide.
  const others = allGuides(trip).filter(item => item.id !== guide.id).map(item => assignGuide(item, item.bookedDates.filter(date => !picked.includes(date)), item.wholeTrip === true && item.bookedDates.every(date => !picked.includes(date))));
  const check = guideCheck(guide, picked, { language: trip.language, specialisation: guide.specialisation, chargeDates: picked });
  if (check.conflicts.length) {
    const current = allGuides(trip).find(item => item.id === guide.id);
    trip.guideAvailabilityIssue = availabilityIssue(trip, guide, check, picked, { ...trip, ...guideFields([...(current ? [current] : []), ...others]) });
    log(trip, "decision", `Guide ${guide.name} refused for ${picked.join(", ")}: unavailable on ${check.conflicts.join(", ")}${check.replacement ? `; offered ${check.replacement.name}` : "; no compliant substitute free on those dates"}`);
    return snapshot(trip);
  }
  const existing = allGuides(trip).find(item => item.id === guide.id);
  const mine = assignGuide(guide, Array.from(new Set([...(existing?.bookedDates ?? []), ...picked])), false);
  const primaryFirst = trip.chosenGuide?.id === guide.id ? [mine, ...others] : [...others.filter(item => item.id === trip.chosenGuide?.id), mine, ...others.filter(item => item.id !== trip.chosenGuide?.id)];
  commit(trip, `guide ${guide.name} on ${picked.join(", ")}`, { ...guideFields(primaryFirst), guideAvailabilityIssue: null });
  return snapshot(trip);
}

/** Remove one guide from the plan (or every guide when no id is given). */
export function removeGuide(tripId: string, guideId?: string) {
  const trip = need(tripId);
  editable(trip, "remove the guide");
  const guides = allGuides(trip);
  if (!guides.length) throw new Error("No guide is currently added to this itinerary");
  const removed = guideId ? guides.filter(item => item.id === guideId) : guides;
  if (!removed.length) throw new Error("That guide is not on this itinerary");
  commit(trip, `removing guide ${removed.map(item => item.name).join(" + ")}`, { ...guideFields(guides.filter(item => !removed.includes(item))), guideAvailabilityIssue: null });
  return snapshot(trip);
}

// ---------------------------------------------------------------------------
// Budget negotiation, navigation, confirmation
// ---------------------------------------------------------------------------

export async function negotiate(tripId: string, choice: string, newCap?: number, fixId?: string) {
  const trip = need(tripId);
  if (!trip.pending) throw new Error("Nothing to negotiate right now");
  const pending = trip.pending;
  if (choice === "apply_fix") {
    // Apply the change together with the chosen fix; it is priced again and, if still over, negotiation continues with fresh fixes.
    const fix = pending.fixes?.find(item => item.id === fixId);
    if (!fix) throw new Error("That budget option is no longer available");
    const appliedBefore = pending.applied ?? [];
    commit(trip, pending.label, { ...pending.patch, ...fix.patch }, pending.advanceStatus);
    // Still over: keep a visible record of the cuts already accepted.
    if (trip.status === "negotiate" && trip.pending) trip.pending.applied = [...appliedBefore, ...(fix.kind === "auto" ? fix.steps ?? [] : [{ kind: fix.kind, from: fix.from, to: fix.to }])];
    if (trip.status !== "negotiate") log(trip, "decision", `Fitted the budget: ${fix.kind === "auto" ? (fix.steps ?? []).map(step => step.to ? `${step.from} → ${step.to}` : `without ${step.from}`).join(", ") : fix.to ? `${fix.from} → ${fix.to}` : `without ${fix.from}`}`);
    return snapshot(trip);
  }
  if (choice === "approve_overage" || choice === "raise_cap") {
    // Raising the budget can come with a fix: "set my budget to the lowest this trip can go" applies those cuts too.
    const fix = choice === "raise_cap" && fixId ? pending.fixes?.find(item => item.id === fixId) : undefined;
    if (choice === "raise_cap") {
      if (!newCap || newCap <= trip.budgetCap) throw new Error("new_cap must be greater than the current cap");
      trip.budgetCap = newCap;
    }
    remember(trip);
    Object.assign(trip, pending.patch, fix?.patch ?? {});
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
    Object.assign(trip, { chosenFlight: null, chosenTransport: null, package: null, packageComponents: [], chosenGuide: null, extraGuides: [], guideAvailabilityIssue: null });
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

/** The chosen guide lost a slot before confirmation: drop them, reprice, and offer same-language substitutes instead of booking. */
function guideTakenMeanwhile(trip: Trip, guide: GuideRecord) {
  const held = allGuides(trip).find(item => item.id === guide.id);
  const dates = held?.bookedDates ?? [];
  const checkDates = held?.wholeTrip === false ? dates : datesBetween(trip.departDate, trip.durationDays);
  const check = guideCheck(guide, checkDates, { language: trip.language, specialisation: guide.specialisation, chargeDates: dates });
  const remaining = guideFields(allGuides(trip).filter(item => item.id !== guide.id));
  trip.guideAvailabilityIssue = availabilityIssue(trip, guide, check, checkDates, { ...trip, ...remaining });
  Object.assign(trip, remaining);
  trip.runningTotal = priceBreakdown(trip).total;
  trip.status = "select_package";
  log(trip, "decision", `Guide ${guide.name} was booked by another traveller on ${check.conflicts.join(", ")} before this booking — removed and repriced${check.replacement ? `; offered ${check.replacement.name}` : "; no compliant substitute free"}`);
  return snapshot(trip);
}

export async function confirmTrip(tripId: string, contact?: { email?: string; phone?: string }, options: { idempotencyKey?: string } = {}) {
  const trip = need(tripId);
  // Idempotent: confirming an already-booked trip again returns the same booking instead of an error or a duplicate.
  if (trip.status === "confirmed" && trip.booking) return snapshot(trip);
  if (trip.status !== "review" && trip.status !== "select_package") throw new Error(trip.status === "negotiate" ? "Resolve the pending budget negotiation first" : `Can't confirm from '${trip.status}'`);
  // Re-check the guide at the moment of booking: another traveller may have taken the last slot since it was selected.
  const onPlan = allGuides(trip).map(item => ({ held: item, record: GUIDES.find(guide => guide.id === item.id)! })).filter(item => item.record);
  const lost = onPlan.find(item => item.held.bookedDates.some(date => !isGuideFree(item.record, date)));
  if (lost) return guideTakenMeanwhile(trip, lost.record);
  const items = canonicalItems(trip);
  try {
    trip.booking = recordBooking({
      tripId: trip.tripId, userId: trip.userId ?? DEFAULT_TRAVELLER_ID, total: trip.runningTotal, channel: trip.channel ?? "web",
      idempotencyKey: options.idempotencyKey ?? `idem_${trip.tripId}`, email: contact?.email, phone: contact?.phone,
      guides: onPlan.map(item => ({ guideId: item.record.id, dates: item.held.bookedDates, capacity: item.record.slots })),
      itinerary: { name: `${trip.package?.name ?? trip.destination} — ${trip.departDate}`, totalDurationMinutes: items.reduce((sum, item) => sum + item.duration_minutes, 0), items },
    });
  } catch (error) {
    if (error instanceof GuideSlotTakenError) {
      const taken = GUIDES.find(item => item.id === error.guideId);
      if (taken) return guideTakenMeanwhile(trip, taken);
    }
    throw error;
  }
  trip.status = "confirmed";
  const summary = `PackagePro booking ${trip.booking.reference} confirmed: ${trip.origin} → ${trip.destination} ${trip.departDate} to ${trip.returnDate}. Total ${inr(trip.runningTotal)} of ${inr(trip.budgetCap)}.`;
  log(trip, "decision", `Booking ${trip.booking.reference} (${trip.booking.bookingId}) confirmed — final total ${inr(trip.runningTotal)} of ${inr(trip.budgetCap)} cap`);
  if (contact?.email || contact?.phone) {
    const sent = await sendConfirmation({ email: contact.email, phone: contact.phone, summary });
    log(trip, "tool_result", `Notifications: email ${sent.email ? "sent" : "skipped"}, sms ${sent.sms ? "sent" : "skipped"}`);
  }
  return snapshot(trip);
}

// ---------------------------------------------------------------------------
// Canonical rows (shared data model): trips, itinerary_items
// ---------------------------------------------------------------------------

const CITY_ID_BY_NAME = new Map(CITIES.map(city => [city.name.toLowerCase(), city.city_id]));
const ORIGIN_CITY_BY_CODE = new Map(ORIGINS.map(origin => [origin.code, origin.city]));
const TRIP_STATUS: Record<TripStatus, CanonicalTrip["status"]> = { select_flight: "draft", select_package: "planning", negotiate: "planning", review: "planning", confirmed: "confirmed" };

/** The canonical trips row: owner, cities as city_id, party, trip_type (traveller_type enum) and trip_status. */
function canonicalTrip(trip: Trip): CanonicalTrip {
  const traveller = getTraveller(trip.userId);
  const originCity = ORIGIN_CITY_BY_CODE.get(trip.origin);
  return {
    owner_user_id: traveller?.userId ?? DEFAULT_TRAVELLER_ID,
    title: `${trip.package?.name ?? trip.destination} · ${trip.departDate}`,
    origin_city_id: originCity ? CITY_ID_BY_NAME.get(originCity.toLowerCase()) ?? null : null,
    destination_city_id: DESTINATIONS.find(item => item.city === trip.destination)?.code ?? trip.destinationCode,
    start_date: trip.departDate,
    end_date: trip.returnDate,
    party_size: trip.travelers,
    trip_type: trip.travelers === 1 ? "solo" : trip.travelers === 2 ? (traveller?.travellerType === "friends" ? "friends" : "couple") : traveller?.travellerType === "friends" ? "friends" : "family",
    status: TRIP_STATUS[trip.status] ?? "planning",
  };
}

const minutesOf = (text?: string) => {
  const match = text?.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/);
  const byMin = text?.match(/(\d+)\s*min/);
  if (byMin) return Number(byMin[1]);
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) : 0;
};

/** The confirmed plan as canonical itinerary_items: item_type / entity_type from enums.json, entity_id pointing at dataset rows. */
function canonicalItems(trip: Trip): CanonicalItem[] {
  const leg = trip.chosenFlight ?? trip.chosenTransport;
  const items: CanonicalItem[] = [];
  for (const day of itinerary(trip)) {
    for (const item of day.items) {
      const component = trip.packageComponents.find(entry => entry.id === item.componentId);
      const entityId = item.kind === "guide" ? item.guideId ?? null : item.kind === "hotel" ? component?.entityId ?? null : component ? (component.entityId?.startsWith("trf_") ? component.entityId : component.id) : null;
      const entityType = item.kind === "arrival" ? "flight" : item.kind === "guide" ? "guide" : item.kind === "hotel" ? "hotel" : entityId?.startsWith("trf_") ? "transfer" : component ? "package_component" : null;
      const itemType: CanonicalItem["item_type"] = item.kind === "arrival" ? (trip.chosenTransport ? "transfer" : "flight") : item.kind === "experience" || item.kind === "entry_ticket" ? "poi" : item.kind === "hotel" ? "hotel" : item.kind === "guide" ? "guide" : item.kind === "meal" ? "meal" : item.kind === "transfer" ? "transfer" : "free";
      const swapped = component && component.id !== component.defaultId;
      items.push({
        day_index: day.day,
        item_type: itemType,
        entity_type: entityType,
        entity_id: entityType === "flight" ? null : entityId,
        title: item.label,
        cost: item.kind === "arrival" ? (leg?.price ?? 0) * Math.max(1, trip.travelers) : item.price ?? 0,
        duration_minutes: item.kind === "arrival" ? minutesOf(leg?.duration) : item.kind === "transfer" ? minutesOf(item.detail) : 0,
        explanation: item.kind === "guide" ? "Guide checked against guide_availability and remaining slots on every trip date" : swapped ? "Swapped by the traveller from the package default" : null,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Chat auto-build
// ---------------------------------------------------------------------------

export async function autoBuildTrip(input: { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap?: number; language: string; interests?: string; hotelTier?: "budget" | "boutique" | "luxury"; transportMode?: "flight" | "train" | "cab"; userId?: string; channel?: "web" | "mobile_app" }) {
  const durationDays = Math.max(1, daysBetween(input.departDate, input.returnDate));
  const destination = resolveDestination(input.destination).city;
  const pkg = packageForCity(destination);
  if (!pkg) throw new Error(`No package found for ${destination}`);
  const packageEstimate = pkg.basePrice * durationDays / Math.max(1, pkg.duration);
  const guideRates = GUIDES.filter(guide => guide.city === destination && guide.languages.includes(input.language)).map(guide => guide.dayRate * 1.35);
  const guideEstimate = (guideRates.length ? Math.min(...guideRates) : 0) * durationDays;
  // The AI builder books at least the package's minimum group (tour_packages.min_group_size).
  const pax = Math.min(pkg.maxGroupSize, Math.max(pkg.minGroupSize, input.travelers));
  input = { ...input, travelers: pax };
  const suggestedCap = Math.ceil((7000 * pax + (packageEstimate * pax + defaultComponentsTotal(pkg, durationDays, pax)) * 1.25 + guideEstimate) * 1.12 / 500) * 500;
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
