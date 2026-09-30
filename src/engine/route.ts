/**
 * @kaleidico/sanity-i18n/engine/route
 *
 * The route handler a site mounts for the Studio to call. It accepts one
 * thing, the id of a job document, and does nothing unless that job exists
 * and is pending. Mount it in a Next.js app as:
 *
 *   // src/app/api/i18n/translate/route.ts
 *   import { createTranslateRoute } from "@kaleidico/sanity-i18n/engine/route";
 *   export const maxDuration = 300;
 *   export const { POST } = createTranslateRoute({ sanity: { projectId, dataset, token }, languages });
 */
import { JOB_ID_PREFIX, type JobKind } from "../core/engineModel";
import { EngineError } from "./errors";
import { APPROVAL_JOB_KINDS, runJob, TRANSLATE_JOB_KINDS, type EngineConfig, type JobOutcome } from "./job";

function assertServer(): void {
  if (typeof window !== "undefined" || typeof document !== "undefined") {
    throw new Error(
      "@kaleidico/sanity-i18n/engine/route is server-only. Import it from a Route Handler, never from client code.",
    );
  }
}

assertServer();

const JOB_ID = new RegExp(`^${JOB_ID_PREFIX.replace(/\./g, "\\.")}[A-Za-z0-9-]{8,64}$`);

function json(outcome: JobOutcome): Response {
  const { httpStatus, ...body } = outcome;
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export interface TranslateRoute {
  POST(request: Request): Promise<Response>;
}

function createJobRoute(config: EngineConfig, kinds: readonly JobKind[]): TranslateRoute {
  return {
    async POST(request: Request): Promise<Response> {
      const refuse = () => {
        const error = new EngineError("bad_request");
        return json({ httpStatus: 400, ok: false, error: { code: error.code, message: error.message } });
      };

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return refuse();
      }
      const keys = body !== null && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
      const id = (body as { jobId?: unknown } | null)?.jobId;
      // A job id and nothing else: no document ids, no text, no options.
      if (keys.length !== 1 || typeof id !== "string" || !JOB_ID.test(id)) return refuse();

      return json(await runJob(config, id, kinds));
    },
  };
}

/** The translation route: runs `translate` and `estimate` jobs. */
export function createTranslateRoute(config: EngineConfig): TranslateRoute {
  return createJobRoute(config, TRANSLATE_JOB_KINDS);
}

/**
 * The approval route: runs `approve` and `send_back` jobs, after checking
 * that the job names a listed legal approver and was created by that Studio
 * user. Mount it next to the translation route:
 *
 *   // src/app/api/i18n/approve/route.ts
 *   export const { POST } = createApprovalRoute({ sanity: { projectId, dataset, token }, languages });
 */
export function createApprovalRoute(config: EngineConfig): TranslateRoute {
  return createJobRoute(config, APPROVAL_JOB_KINDS);
}

export type { EngineConfig, JobOutcome } from "./job";
export type { SanityHttpConfig, SanityLike } from "./sanityHttp";
