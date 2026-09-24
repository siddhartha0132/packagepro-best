export type ExportTrip = {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  durationDays: number;
  travelers: number;
  budgetCap: number;
  runningTotal: number;
  chosenFlight?: { airline?: string; id?: string; route?: string; depart?: string; duration?: string; price?: number } | null;
  chosenTransport?: { mode?: string; operator?: string; route?: string; depart?: string; duration?: string; price?: number } | null;
  chosenHotel?: { name?: string; rating?: number; detail?: string; total?: number } | null;
  package?: { name?: string; city?: string } | null;
  packagePrice?: number;
  packageComponents?: { type?: string; label?: string; detail?: string; price?: number }[];
  chosenGuide?: { name?: string; languages?: string[]; specialisation?: string; daysBooked?: number; totalCost?: number; bookedDates?: string[]; phone?: string; email?: string } | null;
  status?: string;
};

const money = (value: number | undefined) => `₹${Math.round(value || 0).toLocaleString("en-IN")}`;
const cityNames: Record<string, string> = { DEL: "New Delhi", BOM: "Mumbai", BLR: "Bengaluru", MAA: "Chennai", HYD: "Hyderabad", CCU: "Kolkata", JAI: "Jaipur", GOI: "Goa", VNS: "Varanasi", AMD: "Ahmedabad", UDR: "Udaipur", AGR: "Agra" };

function datesFrom(start: string, duration: number) {
  const first = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: Math.max(1, duration) }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function prettyDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function schedule(trip: ExportTrip) {
  const dates = datesFrom(trip.departDate, trip.durationDays);
  const components = trip.packageComponents || [];
  return dates.map((date, index) => {
    const assigned = components.filter((_, componentIndex) => componentIndex % dates.length === index);
    const lines = assigned.map(component => `${component.label || "Package component"} — ${component.detail || "included"}`).join("; ");
    const arrival = index === 0 ? `Arrive via ${trip.chosenTransport?.operator || trip.chosenFlight?.airline || "selected route"}` : "Flexible morning start";
    const hotel = index === 0 ? `Check in: ${trip.chosenHotel?.name || "selected stay"}` : `Stay: ${trip.chosenHotel?.name || "selected stay"}`;
    return `Day ${index + 1} · ${prettyDate(date)}\n${arrival}\n${hotel}${lines ? `\n${lines}` : ""}`;
  }).join("\n\n");
}

export function buildWhatsAppItineraryMessage(trip: ExportTrip) {
  const guide = trip.chosenGuide;
  const route = `${cityNames[trip.origin] || trip.origin} → ${cityNames[trip.destination] || trip.destination}`;
  const transportLine = trip.chosenTransport
    ? `${trip.chosenTransport.operator || trip.chosenTransport.mode || "Ground transport"} · ${trip.chosenTransport.route || route} · ${trip.chosenTransport.duration || ""} · ${money(trip.chosenTransport.price)}`
    : `${trip.chosenFlight?.airline || "Flight"} ${trip.chosenFlight?.id || ""} · ${trip.chosenFlight?.route || route} · ${trip.chosenFlight?.depart || ""} · ${trip.chosenFlight?.duration || ""} · ${money(trip.chosenFlight?.price)}`;
  const guideContact = guide
    ? `${guide.phone || guide.email || "Direct contact shared securely after confirmation"}`
    : "No guide added";
  const componentLedger = (trip.packageComponents || []).map(component => `  • ${component.label || "Component"}: ${money(component.price)} (included in package baseline)`).join("\n");

  return [
    "PACKAGEPRO · TRIP ITINERARY",
    "",
    `${route} · ${prettyDate(trip.departDate)} to ${prettyDate(trip.returnDate)}`,
    `${trip.durationDays} days · ${trip.travelers} traveller${trip.travelers === 1 ? "" : "s"}`,
    "",
    "DAY-BY-DAY PLAN",
    schedule(trip),
    "",
    "SELECTED TRAVEL",
    `Transport: ${transportLine}`,
    `Hotel: ${trip.chosenHotel?.name || "Not selected"}${trip.chosenHotel?.rating ? ` · ${trip.chosenHotel.rating}★` : ""} · ${money(trip.chosenHotel?.total)}`,
    `Package: ${trip.package?.name || "Not selected"} · ${money(trip.packagePrice)}`,
    "",
    "PACKAGE COMPONENT LEDGER",
    componentLedger || "  • No package components selected",
    "",
    "LOCAL GUIDE",
    guide
      ? `${guide.name} · ${guide.specialisation || "local specialist"} · ${(guide.languages || []).join(", ")}\nBooked for ${guide.daysBooked || 0} day(s): ${(guide.bookedDates || []).map(prettyDate).join(", ") || "dates pending"}\nGuide contact: ${guideContact} · ${money(guide.totalCost)}`
      : "No guide added",
    "",
    "BUDGET LEDGER",
    `Running total: ${money(trip.runningTotal)}`,
    `Budget cap: ${money(trip.budgetCap)}`,
    `Remaining: ${money(Math.max(0, trip.budgetCap - trip.runningTotal))}`,
    `Status: ${trip.status === "confirmed" ? "Confirmed" : "Ready for review — nothing booked until confirmation"}`,
    "",
    "Built transparently by PackagePro. Reply here if you want to change the hotel, transport, package component, or guide.",
  ].join("\n");
}

export function buildWhatsAppUrl(trip: ExportTrip, phone?: string) {
  const cleanPhone = phone?.replace(/\D/g, "");
  const base = cleanPhone ? `https://wa.me/${cleanPhone}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(buildWhatsAppItineraryMessage(trip))}`;
}
