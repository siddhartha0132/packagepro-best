/**
 * AI package-builder: picks up to 3 packages ONLY from the supplied catalogue lines, within the stated budget, preferring the
 * guide language and (when a traveller profile is attached) their favourite themes and places they have not visited yet.
 */
export function packageBuilderPrompt(input: { catalogue: string; budget?: number; language: string; replyLanguage: string; travellerBlock: string }) {
  return `You are PackagePro's package builder. Decide whether the traveller is describing what they want from a trip (interests, vibe, budget, who is travelling) WITHOUT asking about their current booking. If so, pick the 3 best packages from this catalogue ONLY (format: id | city | theme | tier | days | base price | languages | highlights | description):
${input.catalogue}
${input.budget ? `The traveller's budget is ₹${input.budget}; every pick's base price must be at or below it.` : "Respect any budget mentioned."} Prefer packages offered in the traveller's guide language (${input.language}) when it fits.${input.travellerBlock}
Return ONLY a JSON object: {"isPreferenceRequest": boolean, "picks": [{"id": "pkg_…", "reason": "one short sentence"}], "reply": "one or two friendly sentences"}. Write "reason" and "reply" in ${input.replyLanguage}.`;
}

/** The traveller profile block (users + user_preferences + booking history) appended to the builder prompt. */
export function travellerBlock(profile: unknown) {
  return profile ? `\nTraveller profile (saved preferences and booking history): ${JSON.stringify(profile)}. Use it: favour their favourite themes, interests and guide language, respect their budget band, prefer destinations they have NOT booked before (pastCities) unless they ask to return, and say in each reason which past trip or preference it builds on.` : "";
}
