import { loadCatalogue, rupees } from "./catalogue";
import { PACKAGES } from "./packagepro";

// Traveller identity and preference, read from the dataset: users (identity + segment), user_preferences (the explicit
// language / interest signal PS-04's language requirement reads from) and bookings → trips → cities (booking history the
// AI package-builder uses). Nothing here is invented; every field maps to a canonical column.

export type TravellerProfile = {
  userId: string;
  name: string;
  /** users.locale — BCP-47 tag for the app interface. */
  locale: string;
  segment: string;
  travellerType: string;
  travelStyle: string;
  budgetBand: string;
  /** user_preferences.preferred_languages — BCP-47 tags, most preferred first. */
  preferredLanguages: string[];
  /** user_preferences.guide_language — BCP-47 tag for guide / tour delivery. */
  guideLanguage: string | null;
  /** user_preferences.interests — category codes such as heritage_temple. */
  interests: string[];
  maxDailyBudget: number | null;
  history: { bookingId: string; city: string; cityId: string; startDate: string; tripType: string; amount: number; status: string; partySize: number; theme: string | null }[];
};

const data = loadCatalogue();
const themeByCity = new Map(PACKAGES.map(pkg => [pkg.cityId, pkg.tags[0] ?? null]));

export const TRAVELLERS = new Map<string, TravellerProfile>(data.users.map(row => [row.user_id, {
  userId: row.user_id,
  name: row.display_name,
  locale: row.locale,
  segment: row.segment,
  travellerType: row.traveller_type,
  travelStyle: row.travel_style,
  budgetBand: row.budget_band,
  preferredLanguages: row.preferred_languages.split(",").map(tag => tag.trim()).filter(Boolean),
  guideLanguage: row.guide_language,
  interests: row.interests.split(",").map(tag => tag.trim()).filter(Boolean),
  maxDailyBudget: row.max_daily_budget ? rupees(row.max_daily_budget) : null,
  history: [],
}]));

for (const row of data.history) {
  TRAVELLERS.get(row.user_id)?.history.push({
    bookingId: row.booking_id, city: row.city, cityId: row.destination_city_id, startDate: row.start_date, tripType: row.trip_type,
    amount: rupees(row.total_amount), status: row.status, partySize: row.party_size, theme: themeByCity.get(row.destination_city_id) ?? null,
  });
}

/** "heritage_temple" → "heritage temple": readable interests for prompts and the planner's interest field. */
export const interestText = (codes: string[]) => codes.map(code => code.replaceAll("_", " ")).join(", ");

/** Demo personas: for each UI language the user with the richest booking history who wants a guide in that language, plus a cold-start user. */
export const DEMO_TRAVELLERS: TravellerProfile[] = (() => {
  const all = Array.from(TRAVELLERS.values());
  const richest = (language: string) => all.filter(user => user.guideLanguage === language).sort((a, b) => b.history.length - a.history.length)[0];
  const picks = ["ta", "hi", "te", "en-IN"].map(richest).filter((user): user is TravellerProfile => Boolean(user));
  const cold = all.find(user => user.segment === "cold_start" && user.history.length === 0 && !picks.includes(user));
  return cold ? [...picks, cold] : picks;
})();

/** The traveller trips belong to when none is chosen: the Tamil-preferring heavy user (fits the PS-04 example scenario). */
export const DEFAULT_TRAVELLER_ID = DEMO_TRAVELLERS[0]?.userId ?? Array.from(TRAVELLERS.keys())[0];

export function getTraveller(userId?: string | null) {
  return TRAVELLERS.get(userId || DEFAULT_TRAVELLER_ID) ?? null;
}

/** Persona for a Telegram chat, by the chat's UI language. */
export function travellerForLanguage(language: string) {
  return DEMO_TRAVELLERS.find(user => user.guideLanguage === language) ?? DEMO_TRAVELLERS[0];
}

/** Compact, grounded summary for the AI package-builder: preferences + what this traveller actually booked before. */
export function travellerSummary(profile: TravellerProfile) {
  const cities = Array.from(new Set(profile.history.map(item => item.city)));
  const themes = profile.history.map(item => item.theme).filter(Boolean) as string[];
  const themeCounts = Object.entries(themes.reduce<Record<string, number>>((acc, theme) => ({ ...acc, [theme]: (acc[theme] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  return {
    name: profile.name,
    preferredLanguages: profile.preferredLanguages,
    guideLanguage: profile.guideLanguage,
    interests: interestText(profile.interests),
    travelStyle: profile.travelStyle,
    travellerType: profile.travellerType,
    budgetBand: profile.budgetBand,
    maxDailyBudgetInr: profile.maxDailyBudget,
    pastTrips: profile.history.length,
    pastCities: cities.slice(0, 8),
    favouriteThemes: themeCounts.slice(0, 3).map(([theme]) => theme),
  };
}
