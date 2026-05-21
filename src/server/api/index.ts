import "server-only";
import { callsRouter } from "./routers/calls";
import { agentsRouter } from "./routers/agents";
import { dashboardRouter } from "./routers/dashboard";
import { auditsRouter, transcriptsRouter } from "./routers/audits";
import { webhooksRouter } from "./routers/webhooks";
import { apikeysRouter } from "./routers/apikeys";

export const appRouter = {
  calls: callsRouter,
  agents: agentsRouter,
  dashboard: dashboardRouter,
  audits: auditsRouter,
  transcripts: transcriptsRouter,
  webhooks: webhooksRouter,
  apikeys: apikeysRouter,
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
