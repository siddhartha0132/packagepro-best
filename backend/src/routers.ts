import { z } from "zod";
import { MAX_VOICE_SECONDS, hear, speak, speakable, voiceEnabled } from "./voice";
import { clientOf, enforceLimit } from "./rateLimit";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, travelDeskProcedure } from "./_core/trpc";
import { GUIDES, PACKAGES, datesBetween, getAlternatives, guideCheck, guideCost, realityCheck, recommendPackages, withLiveAvailability } from "./packagepro";
import { DESTINATIONS, ORIGINS, prewarmTranslations, translateMany } from "./integrations";
import { explainWithFreeOpenRouter } from "../../ai/pipeline";
import { cityImage, getDestinationInsight, warmCityImages } from "./insights";
import { PACKAGE_POPULARITY, estimateTrip } from "./estimate";
import * as trips from "./trips";
import { listBookings } from "./appStore";
import { DEMO_TRAVELLERS, getTraveller, travellerSummary } from "./travellers";
import { REJECT_REASONS, approvalRequired, dashboardKey } from "./agentDesk";
import { pdfEnabled, pdfPath } from "./pdf";
import { notifyAgentOfRequest, notifyAgentOfTravellerAnswer, notifyTravellerOfDecision } from "./telegramBot";

const languageSchema = z.string().min(2).max(20).default("en-IN");

void warmCityImages(PACKAGES.map(pkg => pkg.city));
// Demo languages: package names, cities, themes and copy translate once in the background (Sarvam, cached on disk).
void prewarmTranslations(Array.from(new Set([
  ...PACKAGES.flatMap(pkg => [pkg.name, pkg.city, pkg.theme, pkg.description, pkg.inclusions, pkg.exclusions]),
  ...PACKAGES.flatMap(pkg => pkg.components.filter(component => component.type !== "hotel").map(component => component.label)),
  ...ORIGINS.flatMap(origin => [origin.city, origin.airport]),
  "Free time to explore", "At your own pace", "Your guide is with you today", "Journey home", "Return travel is not part of this quote",
])), ["hi", "ta", "te"]);

const counterSchema = z.object({
  swaps: z.array(z.object({ fromId: z.string().max(80), toId: z.string().max(80) })).max(20).optional(),
  addOns: z.array(z.object({ componentId: z.string().max(80), include: z.boolean() })).max(20).optional(),
  adjustment: z.number().min(-1_000_000).max(1_000_000).optional(),
  note: z.string().max(500).optional(),
});
const agentName = z.string().trim().min(1).max(60).optional();
const deskName = (name?: string) => name ? `${name} (travel agent)` : "travel agent";
function stillWaiting(tripId: string) {
  if (trips.getTrip(tripId).status !== "awaiting_approval") throw new Error("This request was already decided");
}

/** One row of the travel desk's list. */
function deskSummary(trip: ReturnType<typeof trips.getTrip>) {
  return {
    tripId: trip.tripId, reference: trip.booking?.reference ?? null, status: trip.status, origin: trip.origin, destination: trip.destination,
    departDate: trip.departDate, returnDate: trip.returnDate, travelers: trip.travelers, total: trip.runningTotal, budget: trip.budgetCap,
    channel: trip.channel, language: trip.language, traveller: getTraveller(trip.userId)?.name ?? null, packageName: trip.package?.name ?? null,
    requestedAt: trip.approval?.requestedAt ?? null, attempt: trip.approval?.attempt ?? 1, decision: trip.approval?.decision ?? null,
    decidedBy: trip.approval?.decidedBy ?? null, reason: trip.approval?.reason ?? null, counter: trip.approval?.counter ?? null,
  };
}

/** Package as served to the client: real destination photo when warmed, plus dataset popularity. */
function withMedia<T extends (typeof PACKAGES)[number]>(pkg: T) {
  return { ...pkg, image: cityImage(pkg.city) ?? pkg.image, fallbackImage: pkg.image, popularity: PACKAGE_POPULARITY[pkg.cityId] ?? { trips: 0, bookings: 0 } };
}

export const appRouter = router({
  // Voice: a short clip (base64, ≤ ~3 MB) → what was said, its English meaning and the language; text → an MP3 reply.
  voice: router({
    status: publicProcedure.query(() => ({ enabled: voiceEnabled(), maxSeconds: MAX_VOICE_SECONDS })),
    hear: publicProcedure.input(z.object({ audio: z.string().min(1).max(4_000_000), mime: z.string().max(80) })).mutation(async ({ input, ctx }) => {
      if (!voiceEnabled()) throw new Error("Voice needs the speech service, which isn't set up here — please type instead.");
      enforceLimit("voiceHear", clientOf(ctx.req));
      return hear(new Uint8Array(Buffer.from(input.audio, "base64")), input.mime.split(";")[0]);
    }),
    speak: publicProcedure.input(z.object({ text: z.string().min(1).max(4000), language: z.string().max(10) })).mutation(async ({ input, ctx }) => {
      enforceLimit("voiceSpeak", clientOf(ctx.req));
      const audio = voiceEnabled() ? await speak(speakable(input.text), input.language) : null;
      return audio ? { audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" } : null;
    }),
  }),
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  packagepro: router({
    cities: publicProcedure.query(() => ({ origins: ORIGINS, destinations: DESTINATIONS })),
    reality: publicProcedure.input(z.object({ destination: z.string(), budget: z.number().positive(), duration: z.number().int().positive() })).query(({ input }) => realityCheck(input.destination, input.budget, input.duration)),
    list: publicProcedure.input(z.object({ theme: z.string().optional(), language: languageSchema.optional() }).optional()).query(({ input }) => {
      const theme = input?.theme?.toLowerCase().replace(/\s+/g, "_");
      const language = input?.language;
      return PACKAGES
        .filter(pkg => !theme || pkg.tags.includes(theme))
        .map(withMedia)
        .sort((a, b) => Number(!!language && b.languagesOffered.includes(language)) - Number(!!language && a.languagesOffered.includes(language)) || b.popularity.bookings - a.popularity.bookings);
    }),
    detail: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
      const pkg = PACKAGES.find(item => item.id === input.id);
      if (!pkg) throw new Error("Package not found");
      return withMedia(pkg);
    }),
    alternatives: publicProcedure.input(z.object({ packageId: z.string(), componentId: z.string() })).query(({ input }) => {
      const pkg = PACKAGES.find(item => item.id === input.packageId);
      return pkg ? getAlternatives(pkg, input.componentId) : [];
    }),
    guides: publicProcedure.input(z.object({ city: z.string(), language: languageSchema.optional(), specialisation: z.string().optional() })).query(({ input }) => {
      return GUIDES.filter(guide => guide.city.toLowerCase() === input.city.toLowerCase() && (!input.language || guide.languages.includes(input.language) || guide.languages.includes("en-IN") || guide.languages.includes("en")) && (!input.specialisation || guide.specialisation === input.specialisation)).map(withLiveAvailability);
    }),
    checkGuide: publicProcedure.input(z.object({ guideId: z.string(), departDate: z.string(), duration: z.number().int().min(1).max(30), language: languageSchema.optional(), specialisation: z.string().optional() })).query(({ input }) => {
      const guide = GUIDES.find(item => item.id === input.guideId);
      if (!guide) throw new Error("Guide not found");
      const dates = datesBetween(input.departDate, input.duration);
      const result = guideCheck(guide, dates, { language: input.language, specialisation: input.specialisation });
      return { guide: withLiveAvailability(guide), dates, ...result, accepted: result.conflicts.length === 0, total: guideCost(guide, dates), replacementTotal: result.replacementOptions[0]?.totalCost ?? null };
    }),
    /** Demo travellers from the dataset: users + user_preferences (languages, interests) + booking history. */
    travellers: publicProcedure.query(() => DEMO_TRAVELLERS.map(profile => ({ ...travellerSummary(profile), userId: profile.userId, locale: profile.locale, segment: profile.segment, recentTrips: profile.history.slice(0, 3).map(item => ({ city: item.city, startDate: item.startDate })) }))),
    recommend: publicProcedure.input(z.object({ query: z.string().default(""), language: languageSchema, destination: z.string().optional(), budget: z.number().positive().optional() })).query(async ({ input }) => ({ ...recommendPackages(input.query, input.language, input.destination, input.budget), destinationInsight: input.destination ? await getDestinationInsight(input.destination) : null, groundedIn: ["PackagePro package catalogue", "guide availability records", "language preferences", "cached destination insight"] })),
    estimate: publicProcedure.input(z.object({ origin: z.string(), destination: z.string(), departDate: z.string(), returnDate: z.string(), travelers: z.number().int().min(1).max(20), budget: z.number().positive(), language: languageSchema, interests: z.string().optional(), uiLanguage: z.string().max(10).optional() })).query(({ input }) => estimateTrip(input)),
    translate: publicProcedure.input(z.object({ texts: z.array(z.string()).max(40), language: languageSchema })).mutation(({ input, ctx }) => {
      enforceLimit("translate", clientOf(ctx.req));
      return translateMany(input.texts, input.language);
    }),
    explain: publicProcedure.input(z.object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) })),
      context: z.record(z.string(), z.unknown()).optional(),
    })).mutation(({ input, ctx }) => {
      enforceLimit("ai", clientOf(ctx.req));
      return explainWithFreeOpenRouter(input.messages, input.context);
    }),
  }),
  trip: router({
    create: publicProcedure.input(z.object({
      origin: z.string(), destination: z.string(), departDate: z.string(), returnDate: z.string(),
      travelers: z.number().int().min(1).max(20), budgetCap: z.number().positive(), language: languageSchema, interests: z.string().optional(), userId: z.string().regex(/^usr_/).optional(),
    })).mutation(({ input }) => trips.createTrip(input)),
    autoBuild: publicProcedure.input(z.object({
      origin: z.string(), destination: z.string(), departDate: z.string(), returnDate: z.string(),
      travelers: z.number().int().min(1).max(20), budgetCap: z.number().positive().optional(), language: languageSchema, interests: z.string().optional(), hotelTier: z.enum(["budget", "boutique", "luxury"]).optional(), transportMode: z.enum(["flight", "train", "cab"]).optional(), userId: z.string().regex(/^usr_/).optional(),
    })).mutation(({ input }) => trips.autoBuildTrip(input)),
    get: publicProcedure.input(z.object({ tripId: z.string() })).query(({ input }) => trips.getTrip(input.tripId)),
    selectFlight: publicProcedure.input(z.object({ tripId: z.string(), flightId: z.string() })).mutation(({ input }) => trips.selectFlight(input.tripId, input.flightId)),
    toggleAddOn: publicProcedure.input(z.object({ tripId: z.string(), componentId: z.string(), include: z.boolean() })).mutation(({ input }) => trips.toggleAddOn(input.tripId, input.componentId, input.include)),
    setDuration: publicProcedure.input(z.object({ tripId: z.string(), days: z.number().int().min(1).max(21) })).mutation(({ input }) => trips.setDuration(input.tripId, input.days)),
    swapHotel: publicProcedure.input(z.object({ tripId: z.string(), target: z.string().min(2).max(120) })).mutation(({ input }) => trips.swapHotel(input.tripId, input.target)),
    removeGuide: publicProcedure.input(z.object({ tripId: z.string(), guideId: z.string().optional() })).mutation(({ input }) => trips.removeGuide(input.tripId, input.guideId)),
    bookGuideDays: publicProcedure.input(z.object({ tripId: z.string(), guideId: z.string(), dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(21) })).mutation(({ input }) => trips.bookGuideDays(input.tripId, input.guideId, input.dates)),
    swap: publicProcedure.input(z.object({ tripId: z.string(), fromId: z.string(), toId: z.string() })).mutation(({ input }) => trips.swapComponent(input.tripId, input.fromId, input.toId)),
    setIncluded: publicProcedure.input(z.object({ tripId: z.string(), componentId: z.string(), include: z.boolean() })).mutation(({ input }) => trips.setComponentIncluded(input.tripId, input.componentId, input.include)),
    applySuggestion: publicProcedure.input(z.object({ tripId: z.string(), suggestionId: z.string().max(200) })).mutation(({ input }) => trips.applySuggestion(input.tripId, input.suggestionId)),
    undo: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.undoChange(input.tripId)),
    discardChanges: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.discardChanges(input.tripId)),
    continuePackage: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.continueFromPackage(input.tripId)),
    guides: publicProcedure.input(z.object({ tripId: z.string(), specialisation: z.string().optional() })).query(({ input }) => trips.listGuides(input.tripId, input.specialisation)),
    selectGuide: publicProcedure.input(z.object({ tripId: z.string(), guideId: z.string(), days: z.number().int().min(1).max(30) })).mutation(({ input }) => trips.selectGuide(input.tripId, input.guideId, input.days)),
    skipGuide: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.skipGuide(input.tripId)),
    negotiate: publicProcedure.input(z.object({ tripId: z.string(), choice: z.enum(["approve_overage", "swap_cheaper", "remove_item", "raise_cap", "apply_fix"]), newCap: z.number().optional(), fixId: z.string().max(200).optional() })).mutation(({ input }) => trips.negotiate(input.tripId, input.choice, input.newCap, input.fixId)),
    goBack: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.goBack(input.tripId)),
    setLanguage: publicProcedure.input(z.object({ tripId: z.string(), language: languageSchema })).mutation(({ input }) => trips.setLanguage(input.tripId, input.language)),
    bookings: publicProcedure.query(() => listBookings()),
    confirm: publicProcedure.input(z.object({ tripId: z.string(), email: z.string().email().optional(), phone: z.string().optional(), idempotencyKey: z.string().min(8).max(80).optional() })).mutation(({ input }) => trips.confirmTrip(input.tripId, { email: input.email, phone: input.phone }, { idempotencyKey: input.idempotencyKey })),
    /** Ask the travel desk to book (when approvals are on): a pending booking with the guide's dates held. */
    requestBooking: publicProcedure.input(z.object({ tripId: z.string(), email: z.string().email().optional(), phone: z.string().max(20).optional() })).mutation(async ({ input }) => {
      const before = trips.getTrip(input.tripId).status;
      const trip = await trips.requestBooking(input.tripId, { email: input.email, phone: input.phone });
      if (before !== "awaiting_approval" && trip.status === "awaiting_approval") void notifyAgentOfRequest(trip.tripId);
      return trip;
    }),
    acceptCounter: publicProcedure.input(z.object({ tripId: z.string() })).mutation(async ({ input }) => {
      const trip = await trips.acceptCounter(input.tripId);
      void notifyAgentOfTravellerAnswer(trip.tripId, "accepted");
      return trip;
    }),
    declineCounter: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => {
      const trip = trips.declineCounter(input.tripId);
      void notifyAgentOfTravellerAnswer(trip.tripId, "declined");
      return trip;
    }),
    /** Signed PDF links (quotation; bill once confirmed) when this server can print PDFs. */
    pdfLinks: publicProcedure.input(z.object({ tripId: z.string(), lang: z.enum(["en-IN", "hi", "ta", "te"]) })).query(({ input }) => {
      if (!pdfEnabled()) return null;
      const trip = trips.getTrip(input.tripId);
      return { quote: pdfPath(trip.tripId, "quote", input.lang), bill: trip.status === "confirmed" ? pdfPath(trip.tripId, "bill", input.lang) : null };
    }),
  }),
  /** The travel desk: booking requests from the web and Telegram, approve / reject / counter-offer. Needs AGENT_DASHBOARD_KEY. */
  agent: router({
    mode: publicProcedure.query(() => ({ approvalRequired: approvalRequired(), dashboard: Boolean(dashboardKey()), reasons: REJECT_REASONS })),
    list: travelDeskProcedure.query(() => {
      const all = trips.listApprovals(60).map(deskSummary);
      const waiting = all.filter(item => item.status === "awaiting_approval").sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
      return { waiting, decided: all.filter(item => item.status !== "awaiting_approval").slice(0, 30) };
    }),
    get: travelDeskProcedure.input(z.object({ tripId: z.string() })).query(({ input }) => {
      const trip = trips.getTrip(input.tripId);
      if (!trip.approval) throw new Error("This trip was never sent to the travel desk");
      return { trip, summary: deskSummary(trip), choices: trip.status === "awaiting_approval" ? trips.counterChoices(trip.tripId) : null };
    }),
    preview: travelDeskProcedure.input(z.object({ tripId: z.string(), counter: counterSchema })).query(({ input }) => trips.previewCounter(input.tripId, input.counter)),
    counter: travelDeskProcedure.input(z.object({ tripId: z.string(), counter: counterSchema, agentName })).mutation(({ input }) => {
      stillWaiting(input.tripId);
      const trip = trips.proposeCounter(input.tripId, input.counter, deskName(input.agentName));
      void notifyTravellerOfDecision(trip.tripId);
      return trip;
    }),
    approve: travelDeskProcedure.input(z.object({ tripId: z.string(), agentName })).mutation(({ input }) => {
      stillWaiting(input.tripId);
      const trip = trips.approveBooking(input.tripId, deskName(input.agentName));
      void notifyTravellerOfDecision(trip.tripId);
      return trip;
    }),
    reject: travelDeskProcedure.input(z.object({ tripId: z.string(), reason: z.string().trim().min(3).max(300), agentName })).mutation(({ input }) => {
      stillWaiting(input.tripId);
      const trip = trips.rejectBooking(input.tripId, input.reason, deskName(input.agentName));
      void notifyTravellerOfDecision(trip.tripId);
      return trip;
    }),
  }),
});

export type AppRouter = typeof appRouter;
