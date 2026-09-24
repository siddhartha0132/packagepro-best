import { describe, expect, it } from "vitest";
import { buildWhatsAppItineraryMessage, buildWhatsAppUrl } from "../client/src/lib/itineraryExport";

const trip = {
  origin: "DEL",
  destination: "Jaipur",
  departDate: "2026-09-25",
  returnDate: "2026-09-27",
  durationDays: 2,
  travelers: 1,
  budgetCap: 40000,
  runningTotal: 29750,
  status: "review",
  chosenFlight: { airline: "IndiGo", id: "6E-441", route: "DEL → JAI", depart: "09:10", duration: "2h 50m", price: 5900 },
  chosenHotel: { name: "Pink haveli", rating: 4.8, detail: "Boutique", total: 9200 },
  package: { name: "Rose City, slowly", city: "Jaipur" },
  packagePrice: 14250,
  packageComponents: [
    { type: "experience", label: "Old city at first light", detail: "Guided heritage walk", price: 4200 },
    { type: "transfer", label: "Airport to haveli", detail: "Private sedan", price: 1800 },
  ],
  chosenGuide: { name: "Kavya Menon", languages: ["hi", "en-IN"], specialisation: "heritage", daysBooked: 2, totalCost: 5200, bookedDates: ["2026-09-25", "2026-09-26"] },
};

describe("WhatsApp itinerary export", () => {
  it("includes day-by-day components, ledger, and guide details", () => {
    const message = buildWhatsAppItineraryMessage(trip);
    expect(message).toContain("New Delhi");
    expect(message).toContain("Jaipur");
    expect(message).toContain("Day 1");
    expect(message).toContain("Old city at first light");
    expect(message).toContain("Kavya Menon");
    expect(message).toContain("heritage");
    expect(message).toContain("Running total: ₹29,750");
    expect(message).toContain("Ready for review");
  });

  it("encodes the message in a WhatsApp click-to-chat URL", () => {
    const url = buildWhatsAppUrl(trip, "+91 98765 43210");
    expect(url.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toContain("PACKAGEPRO · TRIP ITINERARY");
  });
});
