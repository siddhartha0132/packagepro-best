import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { GUIDES, PACKAGES, datesBetween, getAlternatives, guideCheck, realityCheck, recommendPackages } from "./packagepro";
import { DESTINATIONS, ORIGINS, translateMany } from "./integrations";
import { explainWithFreeOpenRouter } from "./aiChat";
import { getDestinationInsight } from "./insights";
import * as trips from "./trips";

const languageSchema = z.string().min(2).max(20).default("en-IN");

export const appRouter = router({
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
      const theme = input?.theme?.toLowerCase();
      return PACKAGES.filter(pkg => !theme || pkg.theme.toLowerCase() === theme || pkg.tags.some(tag => tag.toLowerCase() === theme));
    }),
    detail: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
      const pkg = PACKAGES.find(item => item.id === input.id);
      if (!pkg) throw new Error("Package not found");
      return pkg;
    }),
    alternatives: publicProcedure.input(z.object({ packageId: z.string(), componentId: z.string() })).query(({ input }) => {
      const pkg = PACKAGES.find(item => item.id === input.packageId);
      return pkg ? getAlternatives(pkg, input.componentId) : [];
    }),
    guides: publicProcedure.input(z.object({ city: z.string(), language: languageSchema.optional(), specialisation: z.string().optional() })).query(({ input }) => {
      return GUIDES.filter(guide => guide.city.toLowerCase() === input.city.toLowerCase() && (!input.language || guide.languages.includes(input.language) || guide.languages.includes("en-IN") || guide.languages.includes("en")) && (!input.specialisation || guide.specialisation === input.specialisation));
    }),
    checkGuide: publicProcedure.input(z.object({ guideId: z.string(), departDate: z.string(), duration: z.number().int().min(1).max(30), language: languageSchema.optional(), specialisation: z.string().optional() })).query(({ input }) => {
      const guide = GUIDES.find(item => item.id === input.guideId);
      if (!guide) throw new Error("Guide not found");
      const dates = datesBetween(input.departDate, input.duration);
      const result = guideCheck(guide, dates, { language: input.language, specialisation: input.specialisation });
      return { guide, dates, ...result, accepted: result.conflicts.length === 0, total: guide.dayRate * dates.length, replacementTotal: result.replacement ? result.replacement.dayRate * dates.length : null };
    }),
    recommend: publicProcedure.input(z.object({ query: z.string().default(""), language: languageSchema, destination: z.string().optional(), budget: z.number().positive().optional() })).query(async ({ input }) => ({ ...recommendPackages(input.query, input.language, input.destination, input.budget), destinationInsight: input.destination ? await getDestinationInsight(input.destination) : null, groundedIn: ["PackagePro package catalogue", "guide availability records", "language preferences", "cached destination insight"] })),
    translate: publicProcedure.input(z.object({ texts: z.array(z.string()).max(40), language: languageSchema })).mutation(({ input }) => translateMany(input.texts, input.language)),
    explain: publicProcedure.input(z.object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) })),
      context: z.record(z.string(), z.unknown()).optional(),
    })).mutation(({ input }) => explainWithFreeOpenRouter(input.messages, input.context)),
  }),
  trip: router({
    create: publicProcedure.input(z.object({
      origin: z.string(), destination: z.string(), departDate: z.string(), returnDate: z.string(),
      travelers: z.number().int().min(1).max(20), budgetCap: z.number().positive(), language: languageSchema, interests: z.string().optional(),
    })).mutation(({ input }) => trips.createTrip(input)),
    autoBuild: publicProcedure.input(z.object({
      origin: z.string(), destination: z.string(), departDate: z.string(), returnDate: z.string(),
      travelers: z.number().int().min(1).max(20), budgetCap: z.number().positive().optional(), language: languageSchema, interests: z.string().optional(), hotelTier: z.enum(["budget", "boutique", "luxury"]).optional(), transportMode: z.enum(["flight", "train", "cab"]).optional(),
    })).mutation(({ input }) => trips.autoBuildTrip(input)),
    get: publicProcedure.input(z.object({ tripId: z.string() })).query(({ input }) => trips.getTrip(input.tripId)),
    selectFlight: publicProcedure.input(z.object({ tripId: z.string(), flightId: z.string() })).mutation(({ input }) => trips.selectFlight(input.tripId, input.flightId)),
    selectHotel: publicProcedure.input(z.object({ tripId: z.string(), hotelId: z.string() })).mutation(({ input }) => trips.selectHotel(input.tripId, input.hotelId)),
    swapHotel: publicProcedure.input(z.object({ tripId: z.string(), target: z.string().min(2).max(120) })).mutation(({ input }) => trips.swapHotel(input.tripId, input.target)),
    removeGuide: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.removeGuide(input.tripId)),
    swap: publicProcedure.input(z.object({ tripId: z.string(), fromId: z.string(), toId: z.string() })).mutation(({ input }) => trips.swapComponent(input.tripId, input.fromId, input.toId)),
    continuePackage: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.continueFromPackage(input.tripId)),
    guides: publicProcedure.input(z.object({ tripId: z.string(), specialisation: z.string().optional() })).query(({ input }) => trips.listGuides(input.tripId, input.specialisation)),
    selectGuide: publicProcedure.input(z.object({ tripId: z.string(), guideId: z.string(), days: z.number().int().min(1).max(30) })).mutation(({ input }) => trips.selectGuide(input.tripId, input.guideId, input.days)),
    skipGuide: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.skipGuide(input.tripId)),
    negotiate: publicProcedure.input(z.object({ tripId: z.string(), choice: z.enum(["approve_overage", "swap_cheaper", "remove_item", "raise_cap"]), newCap: z.number().optional() })).mutation(({ input }) => trips.negotiate(input.tripId, input.choice, input.newCap)),
    goBack: publicProcedure.input(z.object({ tripId: z.string() })).mutation(({ input }) => trips.goBack(input.tripId)),
    setLanguage: publicProcedure.input(z.object({ tripId: z.string(), language: languageSchema })).mutation(({ input }) => trips.setLanguage(input.tripId, input.language)),
    confirm: publicProcedure.input(z.object({ tripId: z.string(), email: z.string().email().optional(), phone: z.string().optional() })).mutation(({ input }) => trips.confirmTrip(input.tripId, { email: input.email, phone: input.phone })),
  }),
});

export type AppRouter = typeof appRouter;
