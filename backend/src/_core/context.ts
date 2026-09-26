import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // Authentication is optional for public procedures.
  const user: User | null = await sdk.authenticateRequest(opts.req).catch(() => null);

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
