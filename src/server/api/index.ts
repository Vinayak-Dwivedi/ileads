import "server-only";
import { callsRouter } from "./routers/calls";

export const appRouter = {
  calls: callsRouter,
} as const;

export type AppRouter = typeof appRouter;

export { ApiError, isApiError } from "./errors";
export type { Context, ActorIdentity } from "./context";
export {
  createContextFromSession,
  buildApiKeyContext,
  actorFromSession,
  requireScope,
} from "./context";
