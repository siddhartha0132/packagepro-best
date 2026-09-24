import { nanoid } from "nanoid";
import { FLIGHTS, GUIDES, HOTELS, PACKAGES, datesBetween, getAlternatives, guideCheck, realityCheck, type FlightRecord, type GuideRecord, type HotelRecord, type PackageComponent, type PackageRecord } from "./packagepro";

export type TripStatus = "select_flight" | "select_hotel" | "select_package" | "select_guide" | "negotiate" | "review" | "confirmed";

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
  status: TripStatus;
  flightOptions: FlightRecord[];
  hotelOptions: HotelRecord[];
  chosenFlight: FlightRecord | null;
  chosenHotel: HotelRecord | null;
  package: PackageRecord | null;
  packageComponents: PackageComponent[];
  chosenGuide: (GuideRecord & { daysBooked: number; totalCost: number; bookedDates: string[] }) | null;
  guideAvailabilityIssue: {
    guide: GuideRecord;
    conflictingDates: string[];
    requestedDates: string[];
    replacement: GuideRecord | null;
    replacementTotalCost: number | null;
    priceDelta: number | null;
  } | null;
  negotiationOptions: { choice: string; amount?: number; item_label: string; label: string }[];
  pending: { amount: number; label: string; retryStatus: TripStatus; advanceStatus: TripStatus; payload?: Record<string, unknown> } | null;
  trace: { kind: string; text: string }[];
};

const trips = new Map<string, Trip>();

const CITY_BY_CODE: Record<string, string> = {
  GOI: "Goa", JAI: "Jaipur", VNS: "Varanasi", BLR: "Thanjavur", MAA: "Thanjavur",
  UDR: "Jaipur", AGR: "Jaipur", SXR: "Goa", LKO: "Varanasi",
};

function snapshot(trip: Trip) {
  return {
    ...trip,
    remaining: trip.budgetCap - trip.runningTotal,
    reality: realityCheck(trip.destination, trip.budgetCap, trip.durationDays),
  };
}

function log(trip: Trip, kind: string, text: string) {
  trip.trace.push({ kind, text });
}

function tryAdd(trip: Trip, amount: number, label: string, advanceTo: TripStatus, payload?: Record<string, unknown>) {
  const next = trip.runningTotal + amount;
  if (next <= trip.budgetCap) {
    trip.runningTotal = next;
    trip.status = advanceTo;
    trip.pending = null;
    trip.negotiationOptions = [];
    log(trip, "decision", `Added ${label} — running total now ₹${Math.round(trip.runningTotal).toLocaleString("en-IN")}`);
    return true;
  }
  const overage = next - trip.budgetCap;
  const retryStatus = trip.status === "negotiate" ? (trip.pending?.retryStatus ?? "select_flight") : trip.status;
  trip.status = "negotiate";
  trip.pending = { amount, label, retryStatus, advanceStatus: advanceTo, payload };
  trip.negotiationOptions = [
    { choice: "approve_overage", amount: overage, item_label: label, label: `Approve the extra ₹${Math.round(overage).toLocaleString("en-IN")} for ${label}` },
    { choice: "swap_cheaper", item_label: label, label: `Swap ${label} for a cheaper alternative` },
    { choice: "remove_item", item_label: label, label: `Drop ${label} and keep the rest` },
    { choice: "raise_cap", item_label: label, label: "Raise my overall trip budget" },
  ];
  log(trip, "decision", `${label} would exceed your budget by ₹${Math.round(overage).toLocaleString("en-IN")}`);
  return false;
}

function flightsFor(origin: string, destination: string): FlightRecord[] {
  return FLIGHTS.map(flight => ({ ...flight, route: `${origin} → ${destination.slice(0, 3).toUpperCase()}` }));
}

function hotelsFor(city: string) {
  const matches = HOTELS.filter(hotel => hotel.city === city);
  return matches.length ? matches : HOTELS.filter(hotel => hotel.city === "Thanjavur");
}

function packageFor(city: string) {
  return PACKAGES.find(pkg => pkg.city === city) ?? PACKAGES[0];
}

function defaultComponents(pkg: PackageRecord) {
  const groups = new Map<string, PackageComponent>();
  for (const component of pkg.components) {
    const key = component.swapGroup || component.id;
    if (!groups.has(key)) groups.set(key, component);
  }
  return Array.from(groups.values());
}

export function createTrip(input: { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap: number; language: string; interests?: string }) {
  const origin = input.origin.trim().toUpperCase();
  const code = input.destination.trim().toUpperCase();
  if (origin === code) throw new Error("origin and destination can't be the same");
  const durationDays = Math.round((Date.parse(`${input.returnDate}T00:00:00Z`) - Date.parse(`${input.departDate}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(durationDays) || durationDays <= 0) throw new Error("return_date must be after depart_date");
  const destination = CITY_BY_CODE[code] ?? "Thanjavur";
  const trip: Trip = {
    tripId: `trp_${nanoid(8)}`,
    origin, destination, destinationCode: code,
    departDate: input.departDate, returnDate: input.returnDate, durationDays,
    travelers: input.travelers, budgetCap: input.budgetCap, runningTotal: 0,
    language: input.language, interests: input.interests || "",
    status: "select_flight",
    flightOptions: flightsFor(origin, destination),
    hotelOptions: [], chosenFlight: null, chosenHotel: null,
    package: null, packageComponents: [], chosenGuide: null, guideAvailabilityIssue: null,
    negotiationOptions: [], pending: null, trace: [],
  };
  log(trip, "reasoning", `Planning ${durationDays}-day trip to ${destination}, cap ₹${trip.budgetCap.toLocaleString("en-IN")}`);
  log(trip, "tool_result", `Found ${trip.flightOptions.length} flight options`);
  trips.set(trip.tripId, trip);
  return snapshot(trip);
}

export function getTrip(tripId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  return snapshot(trip);
}

export function selectFlight(tripId: string, flightId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "select_flight") throw new Error(`Can't book a flight from '${trip.status}'`);
  const flight = trip.flightOptions.find(item => item.id === flightId);
  if (!flight) throw new Error("Flight not in this trip's options");
  if (tryAdd(trip, flight.price, `the ${flight.airline} flight`, "select_hotel")) {
    trip.chosenFlight = flight;
    trip.hotelOptions = hotelsFor(trip.destination);
    log(trip, "tool_result", `Found ${trip.hotelOptions.length} hotel options`);
  }
  else {
    trip.pending && (trip.pending.payload = { flight });
  }
  return snapshot(trip);
}

export function selectHotel(tripId: string, hotelId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "select_hotel") throw new Error(`Can't book a hotel from '${trip.status}'`);
  const hotel = trip.hotelOptions.find(item => item.id === hotelId);
  if (!hotel) throw new Error("Hotel not in this trip's options");
  if (tryAdd(trip, hotel.total, hotel.name, "select_package")) {
    trip.chosenHotel = hotel;
    const pkg = packageFor(trip.destination);
    trip.package = pkg;
    trip.packageComponents = defaultComponents(pkg);
    log(trip, "tool_result", `Loaded package '${pkg.name}' with ${trip.packageComponents.length} components`);
  }
  else {
    trip.pending && (trip.pending.payload = { hotel });
  }
  return snapshot(trip);
}

export function swapComponent(tripId: string, fromId: string, toId: string) {
  const trip = trips.get(tripId);
  if (!trip?.package) throw new Error("No package selected yet");
  if (trip.status !== "select_package") throw new Error(`Can't swap from '${trip.status}'`);
  const from = trip.packageComponents.find(item => item.id === fromId);
  const target = getAlternatives(trip.package, fromId).find(item => item.id === toId);
  if (!from || !target) throw new Error("Not a valid swap target");
  const delta = target.price - from.price;
  if (tryAdd(trip, delta, `swapping in ${target.label}`, "select_package")) {
    trip.packageComponents = trip.packageComponents.map(item => item.id === fromId ? { ...target, swapGroup: from.swapGroup } : item);
  }
  return snapshot(trip);
}

export function continueFromPackage(tripId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "select_package") throw new Error(`Can't continue from '${trip.status}'`);
  trip.status = "select_guide";
  log(trip, "decision", "Package review complete — continuing to guide selection");
  return snapshot(trip);
}

export function listGuides(tripId: string, specialisation?: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  return GUIDES.filter(guide => guide.city === trip.destination && (!specialisation || guide.specialisation === specialisation) && (guide.languages.includes(trip.language) || guide.languages.includes("en-IN")));
}

export function selectGuide(tripId: string, guideId: string, days: number) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "select_guide") throw new Error(`Can't book a guide from '${trip.status}'`);
  const guide = GUIDES.find(item => item.id === guideId);
  if (!guide) throw new Error("Guide not found for this destination");
  const bookedDays = Math.min(days, trip.durationDays);
  const dates = datesBetween(trip.departDate, bookedDays);
  const check = guideCheck(guide, dates);
  if (check.conflicts.length) {
    trip.guideAvailabilityIssue = {
      guide, conflictingDates: check.conflicts, requestedDates: dates, replacement: check.replacement,
      replacementTotalCost: check.replacement ? check.replacement.dayRate * dates.length : null,
      priceDelta: check.priceDelta,
    };
    log(trip, "decision", `Guide ${guide.name} unavailable on ${check.conflicts.join(", ")}${check.replacement ? `; offered ${check.replacement.name} instead` : ""}`);
    return snapshot(trip);
  }
  const cost = guide.dayRate * dates.length;
  if (tryAdd(trip, cost, `guide ${guide.name} (${dates.length}d)`, "review")) {
    trip.chosenGuide = { ...guide, daysBooked: dates.length, totalCost: cost, bookedDates: dates };
    trip.guideAvailabilityIssue = null;
  }
  else {
    trip.pending && (trip.pending.payload = { guide: { ...guide, daysBooked: dates.length, totalCost: cost, bookedDates: dates } });
  }
  return snapshot(trip);
}

export function skipGuide(tripId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "select_guide") throw new Error(`Can't skip a guide from '${trip.status}'`);
  trip.status = "review";
  log(trip, "decision", "Skipped guide booking");
  return snapshot(trip);
}

export function negotiate(tripId: string, choice: string, newCap?: number) {
  const trip = trips.get(tripId);
  if (!trip?.pending) throw new Error("Nothing to negotiate right now");
  const pending = trip.pending;
  if (choice === "approve_overage") {
    trip.runningTotal += pending.amount;
    trip.status = pending.advanceStatus;
    applyPending(trip, pending);
    log(trip, "decision", `Approved the overage for ${pending.label}`);
  } else if (choice === "raise_cap") {
    if (!newCap || newCap <= trip.budgetCap) throw new Error("new_cap must be greater than the current cap");
    trip.budgetCap = newCap;
    trip.runningTotal += pending.amount;
    trip.status = pending.advanceStatus;
    applyPending(trip, pending);
    log(trip, "decision", `Raised cap to ₹${trip.budgetCap.toLocaleString("en-IN")} and approved ${pending.label}`);
  } else {
    trip.status = pending.retryStatus;
    log(trip, "decision", `Dropped ${pending.label} — back to ${pending.retryStatus.replaceAll("_", " ")}`);
  }
  trip.pending = null;
  trip.negotiationOptions = [];
  return snapshot(trip);
}

function applyPending(trip: Trip, pending: NonNullable<Trip["pending"]>) {
  const payload = pending.payload ?? {};
  if (payload.flight) {
    trip.chosenFlight = payload.flight as FlightRecord;
    trip.hotelOptions = hotelsFor(trip.destination);
    log(trip, "tool_result", `Found ${trip.hotelOptions.length} hotel options`);
  }
  if (payload.hotel) {
    trip.chosenHotel = payload.hotel as HotelRecord;
    const pkg = packageFor(trip.destination);
    trip.package = pkg;
    trip.packageComponents = defaultComponents(pkg);
    log(trip, "tool_result", `Loaded package '${pkg.name}' with ${trip.packageComponents.length} components`);
  }
  if (payload.guide) trip.chosenGuide = payload.guide as Trip["chosenGuide"];
}

export function confirmTrip(tripId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status === "negotiate") throw new Error("Resolve the pending budget negotiation first");
  trip.status = "confirmed";
  log(trip, "decision", `Trip confirmed — final total ₹${Math.round(trip.runningTotal).toLocaleString("en-IN")} of ₹${trip.budgetCap.toLocaleString("en-IN")} cap`);
  return snapshot(trip);
}
