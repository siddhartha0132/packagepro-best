import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { GUIDES, PACKAGES, datesBetween, getAlternatives, guideCheck, recommendPackages } from "./packagepro";

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
      return GUIDES.filter(guide => guide.city.toLowerCase() === input.city.toLowerCase() && (!input.language || guide.languages.includes(input.language) || guide.languages.includes("en-IN")) && (!input.specialisation || guide.specialisation === input.specialisation));
    }),
    checkGuide: publicProcedure.input(z.object({ guideId: z.string(), departDate: z.string(), duration: z.number().int().min(1).max(30) })).query(({ input }) => {
      const guide = GUIDES.find(item => item.id === input.guideId);
      if (!guide) throw new Error("Guide not found");
      const dates = datesBetween(input.departDate, input.duration);
      const result = guideCheck(guide, dates);
      return { guide, dates, ...result, accepted: result.conflicts.length === 0, total: guide.dayRate * dates.length, replacementTotal: result.replacement ? result.replacement.dayRate * dates.length : null };
    }),
    recommend: publicProcedure.input(z.object({ query: z.string().default(""), language: languageSchema })).query(({ input }) => ({ ...recommendPackages(input.query, input.language), groundedIn: ["PackagePro package catalogue", "guide availability records", "language preferences"] })),
  }),
});

export type AppRouter = typeof appRouter;
