import { b as EngineConfig } from '../../job-DfpCEMeY.js';
export { J as JobOutcome, g as SanityHttpConfig, S as SanityLike } from '../../job-DfpCEMeY.js';
import '../../pricing-BbaX6X3K.js';
import '../../languages-BzBBGlPy.js';

interface TranslateRoute {
    POST(request: Request): Promise<Response>;
}
/** The translation route: runs `translate` and `estimate` jobs. */
declare function createTranslateRoute(config: EngineConfig): TranslateRoute;
/**
 * The approval route: runs `approve` and `send_back` jobs, after checking
 * that the job names a listed legal approver and was created by that Studio
 * user. Mount it next to the translation route:
 *
 *   // src/app/api/i18n/approve/route.ts
 *   export const { POST } = createApprovalRoute({ sanity: { projectId, dataset, token }, languages });
 */
declare function createApprovalRoute(config: EngineConfig): TranslateRoute;

export { EngineConfig, type TranslateRoute, createApprovalRoute, createTranslateRoute };
