import { nanoid } from "nanoid";
import { GUIDES, PACKAGES, datesBetween, getAlternatives, guideCheck, realityCheck, type FlightRecord, type GuideRecord, type HotelRecord, type PackageComponent, type PackageRecord } from "./packagepro";
import { DESTINATIONS, searchFlightsLive, searchHotelsLive, sendConfirmation } from "./integrations";

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
  flightSource: string;
  hotelSource: string;
  negotiationOptions: { choice: string; amount?: number; item_label: string; label: string }[];
  pending: { amount: number; label: string; retryStatus: TripStatus; advanceStatus: TripStatus; payload?: Record<string, unknown> } | null;
  trace: { kind: string; text: string }[];
};

const trips = new Map<string, Trip>();
const CITY_BY_CODE: Record<string, string> = Object.fromEntries(DESTINATIONS.map(item => [item.code, item.city]));

function snapshot(trip: Trip) {
  return {
    ...trip,
    remaining: trip.budgetCap - trip.runningTotal,
    reality: realityCheck(trip.destination, trip.budgetCap, trip.durationDays),
    canGoBack: trip.status !== "confirmed" && trip.status !== "select_flight",
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

export async function createTrip(input: { origin: string; destination: string; departDate: string; returnDate: string; travelers: number; budgetCap: number; language: string; interests?: string }) {
  const origin = input.origin.trim().toUpperCase();
  const code = input.destination.trim().toUpperCase();
  if (origin === code) throw new Error("origin and destination can't be the same");
  const durationDays = Math.round((Date.parse(`${input.returnDate}T00:00:00Z`) - Date.parse(`${input.departDate}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(durationDays) || durationDays <= 0) throw new Error("return_date must be after depart_date");
  const destination = CITY_BY_CODE[code] ?? "Thanjavur";
  const liveFlights = await searchFlightsLive(origin, code, input.departDate);
  const trip: Trip = {
    tripId: `trp_${nanoid(8)}`,
    origin, destination, destinationCode: code,
    departDate: input.departDate, returnDate: input.returnDate, durationDays,
    travelers: input.travelers, budgetCap: input.budgetCap, runningTotal: 0,
    language: input.language, interests: input.interests || "",
    status: "select_flight",
    flightOptions: liveFlights.flights,
    hotelOptions: [], chosenFlight: null, chosenHotel: null,
    package: null, packageComponents: [], chosenGuide: null, guideAvailabilityIssue: null,
    flightSource: liveFlights.source, hotelSource: "catalogue",
    negotiationOptions: [], pending: null, trace: [],
  };
  log(trip, "reasoning", `Planning ${durationDays}-day trip to ${destination}, cap ₹${trip.budgetCap.toLocaleString("en-IN")}`);
  log(trip, "tool_result", `Found ${trip.flightOptions.length} flight options via ${liveFlights.source}`);
  trips.set(trip.tripId, trip);
  return snapshot(trip);
}

export function getTrip(tripId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  return snapshot(trip);
}

export async function selectFlight(tripId: string, flightId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status !== "select_flight") throw new Error(`Can't book a flight from '${trip.status}'`);
  const flight = trip.flightOptions.find(item => item.id === flightId);
  if (!flight) throw new Error("Flight not in this trip's options");
  if (tryAdd(trip, flight.price, `the ${flight.airline} flight`, "select_hotel")) {
    trip.chosenFlight = flight;
    const liveHotels = await searchHotelsLive(trip.destination, trip.departDate, trip.returnDate, trip.travelers);
    trip.hotelOptions = liveHotels.hotels;
    trip.hotelSource = liveHotels.source;
    log(trip, "tool_result", `Found ${trip.hotelOptions.length} hotel options via ${liveHotels.source}`);
  } else {
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
  } else {
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
  return GUIDES.filter(guide => guide.city === trip.destination && (!specialisation || guide.specialisation === specialisation) && (guide.languages.includes(trip.language) || guide.languages.includes("en-IN") || guide.languages.includes("en")));
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
  } else {
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

export async function negotiate(tripId: string, choice: string, newCap?: number) {
  const trip = trips.get(tripId);
  if (!trip?.pending) throw new Error("Nothing to negotiate right now");
  const pending = trip.pending;
  if (choice === "approve_overage") {
    trip.runningTotal += pending.amount;
    trip.status = pending.advanceStatus;
    await applyPending(trip, pending);
    log(trip, "decision", `Approved the overage for ${pending.label}`);
  } else if (choice === "raise_cap") {
    if (!newCap || newCap <= trip.budgetCap) throw new Error("new_cap must be greater than the current cap");
    trip.budgetCap = newCap;
    trip.runningTotal += pending.amount;
    trip.status = pending.advanceStatus;
    await applyPending(trip, pending);
    log(trip, "decision", `Raised cap to ₹${trip.budgetCap.toLocaleString("en-IN")} and approved ${pending.label}`);
  } else {
    trip.status = pending.retryStatus;
    log(trip, "decision", `Dropped ${pending.label} — back to ${pending.retryStatus.replaceAll("_", " ")}`);
  }
  trip.pending = null;
  trip.negotiationOptions = [];
  return snapshot(trip);
}

async function applyPending(trip: Trip, pending: NonNullable<Trip["pending"]>) {
  const payload = pending.payload ?? {};
  if (payload.flight) {
    trip.chosenFlight = payload.flight as FlightRecord;
    const liveHotels = await searchHotelsLive(trip.destination, trip.departDate, trip.returnDate, trip.travelers);
    trip.hotelOptions = liveHotels.hotels;
    trip.hotelSource = liveHotels.source;
    log(trip, "tool_result", `Found ${trip.hotelOptions.length} hotel options via ${liveHotels.source}`);
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

export function goBack(tripId: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status === "confirmed") throw new Error("A confirmed trip cannot go back");
  if (trip.status === "negotiate") {
    trip.status = trip.pending?.retryStatus ?? "select_flight";
    trip.pending = null;
    trip.negotiationOptions = [];
    log(trip, "decision", "Left negotiation without adding the item");
    return snapshot(trip);
  }
  if (trip.status === "select_hotel") {
    if (trip.chosenFlight) {
      trip.runningTotal -= trip.chosenFlight.price;
      trip.chosenFlight = null;
    }
    trip.runningTotal = Math.max(0, trip.runningTotal);
    trip.status = "select_flight";
    log(trip, "decision", "Went back to flight selection");
    return snapshot(trip);
  }
  if (trip.status === "select_package") {
    if (trip.chosenHotel) {
      trip.runningTotal -= trip.chosenHotel.total;
      trip.chosenHotel = null;
    }
    trip.runningTotal = Math.max(0, trip.runningTotal);
    trip.package = null;
    trip.packageComponents = [];
    trip.status = "select_hotel";
    log(trip, "decision", "Went back to hotel selection");
    return snapshot(trip);
  }
  if (trip.status === "select_guide") {
    trip.status = "select_package";
    trip.guideAvailabilityIssue = null;
    log(trip, "decision", "Went back to package review");
    return snapshot(trip);
  }
  if (trip.status === "review") {
    if (trip.chosenGuide) {
      trip.runningTotal -= trip.chosenGuide.totalCost;
      trip.chosenGuide = null;
    }
    trip.runningTotal = Math.max(0, trip.runningTotal);
    trip.status = "select_guide";
    log(trip, "decision", "Went back to guide selection");
    return snapshot(trip);
  }
  throw new Error("Already at the first planning stage");
}

export function setLanguage(tripId: string, language: string) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  trip.language = language;
  log(trip, "decision", `Language switched to ${language}`);
  return snapshot(trip);
}

export async function confirmTrip(tripId: string, contact?: { email?: string; phone?: string }) {
  const trip = trips.get(tripId);
  if (!trip) throw new Error("Trip not found");
  if (trip.status === "negotiate") throw new Error("Resolve the pending budget negotiation first");
  trip.status = "confirmed";
  const summary = `PackagePro confirmed: ${trip.origin} → ${trip.destination} ${trip.departDate} to ${trip.returnDate}. Total ₹${Math.round(trip.runningTotal).toLocaleString("en-IN")} of ₹${trip.budgetCap.toLocaleString("en-IN")}.`;
  log(trip, "decision", `Trip confirmed — final total ₹${Math.round(trip.runningTotal).toLocaleString("en-IN")} of ₹${trip.budgetCap.toLocaleString("en-IN")} cap`);
  if (contact?.email || contact?.phone) {
    const sent = await sendConfirmation({ email: contact.email, phone: contact.phone, summary });
    log(trip, "tool_result", `Notifications: email ${sent.email ? "sent" : "skipped"}, sms ${sent.sms ? "sent" : "skipped"}`);
  }
  return snapshot(trip);
}
