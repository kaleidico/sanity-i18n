import { useCallback, useEffect, useRef, useState } from "react";
import { TranslateIcon } from "@sanity/icons";
import { Box, Button, Card, Flex, Radio, Spinner, Stack, Text } from "@sanity/ui";
import { useClient, useCurrentUser, useSchema, type DocumentActionComponent, type DocumentActionProps } from "sanity";
import { useRouter } from "sanity/router";
import { translationId, type JobMode, type TranslationJob } from "../core/engineModel";
import type { Language } from "../core/languages";
import { I18N_FIELD, LANGUAGE_FIELD, translationStatusLabel, type TranslationLabels } from "../core/translations";
import { STUDIO_API_VERSION } from "./ApiKeyInput";
import {
  createJob,
  DEFAULT_ENDPOINT,
  ensureManifest,
  formatCount,
  formatDollars,
  isFinished,
  startJob,
  useEnabledLanguageIds,
  watchJob,
  type StudioEngineOptions,
} from "./studioEngine";

export interface TranslateActionOptions extends StudioEngineOptions {
  /** The language this action translates into. */
  language: Language;
  labels?: TranslationLabels;
}

interface DialogProps {
  options: TranslateActionOptions;
  sourceId: string;
  sourceType: string;
  onClose: () => void;
}

interface Existing {
  _id: string;
  status?: string;
  hasHashes?: boolean;
}

/** One report line, in plain words. */
function Line({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <Text size={1} muted={muted}>
      {children}
    </Text>
  );
}

export function JobOutcomeView({ job, languageTitle }: { job: TranslationJob; languageTitle: string }) {
  const report = job.report;
  if (job.status === "failed") {
    return (
      <Card padding={3} radius={2} tone="critical" border>
        <Stack space={3}>
          <Text size={1} weight="medium">
            The translation did not finish
          </Text>
          <Line>{job.error?.message ?? "Something went wrong. Nothing was saved."}</Line>
          {(job.error?.details ?? []).slice(0, 8).map((detail, i) => (
            <Line key={i} muted>
              {detail}
            </Line>
          ))}
        </Stack>
      </Card>
    );
  }
  if (!report) return null;

  const usage = (
    <Line muted>
      {formatCount(report.inputTokens)} tokens in, {formatCount(report.outputTokens)} out, about {formatDollars(report.costUsd)} ({report.translatorModel}
      {report.reviewerModel !== report.translatorModel ? ` and ${report.reviewerModel}` : ""}).
    </Line>
  );

  if (job.status === "held") {
    return (
      <Card padding={3} radius={2} tone="caution" border>
        <Stack space={3}>
          <Text size={1} weight="medium">
            Held for a person to look at
          </Text>
          {report.holdReasons.map((reason, i) => (
            <Line key={i}>{reason}</Line>
          ))}
          {report.check1Failures.slice(0, 10).map((f, i) => (
            <Line key={`f${i}`} muted>
              {f.path}: English "{f.source}", {languageTitle} "{f.translated}". {f.note}
            </Line>
          ))}
          {report.reviewIssues
            .filter((issue) => issue.severity === "high")
            .slice(0, 10)
            .map((issue, i) => (
              <Line key={`r${i}`} muted>
                {issue.path}: {issue.note}
              </Line>
            ))}
          <Line muted>{report.saved ? `The ${languageTitle} draft was saved so it can be corrected.` : "Nothing was saved."}</Line>
          {report.inputTokens > 0 ? usage : null}
        </Stack>
      </Card>
    );
  }

  if (!report.saved) {
    return (
      <Card padding={3} radius={2} tone="positive" border>
        <Text size={1} weight="medium">
          The {languageTitle} is already up to date. Nothing needed translating.
        </Text>
      </Card>
    );
  }

  const notes = report.reviewIssues.length;
  return (
    <Card padding={3} radius={2} tone="positive" border>
      <Stack space={3}>
        <Text size={1} weight="medium">
          {languageTitle} draft saved. Both checks passed.
        </Text>
        <Line>
          {report.unitsTranslated} piece(s) of text translated
          {report.unitsReused > 0 ? `, ${report.unitsReused} kept as they were` : ""}. {report.check1Checked} string(s) checked for numbers, links and other exact values.
        </Line>
        {report.check1Warnings.length > 0 ? <Line>{report.check1Warnings.length} value(s) are written in a different format. Worth a look.</Line> : null}
        {notes > 0 ? <Line>The reviewer left {notes} note(s), none of them serious.</Line> : <Line>The reviewer found nothing to report.</Line>}
        {(report.legalPending ?? 0) > 0 ? <Line>{report.legalPending} piece(s) of legal text are waiting in Legal approvals. The {languageTitle} page stays unpublished until they are approved.</Line> : null}
        {(report.legalApproved ?? 0) > 0 ? <Line>{report.legalApproved} piece(s) of legal text carry wording that was approved before.</Line> : null}
        {report.inputTokens > 0 ? usage : <Line muted>No text needed translating, so nothing was sent to Anthropic.</Line>}
        {report.published ? (
          <Line>Published: both checks passed and no legal text is waiting.</Line>
        ) : report.status === "approved" ? (
          <Line muted>Approved and saved as a draft. {report.publishNote ?? "Publish it from the document when ready."}</Line>
        ) : (
          <Line muted>It is a draft. Nothing has been published.</Line>
        )}
      </Stack>
    </Card>
  );
}

function TranslateDialog({ options, sourceId, sourceType, onClose }: DialogProps) {
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const schema = useSchema();
  const user = useCurrentUser();
  const router = useRouter();
  const language = options.language;
  const targetId = translationId(sourceId, language.id);

  const [existing, setExisting] = useState<Existing | null | undefined>(undefined);
  const [mode, setMode] = useState<JobMode>("full");
  const [job, setJob] = useState<TranslationJob | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    client
      .fetch<Existing[]>(
        `*[_id in [$draft, $published]]{ _id, "status": ${I18N_FIELD}.status, "hasHashes": defined(${I18N_FIELD}.sourceHashes) }`,
        { draft: `drafts.${targetId}`, published: targetId },
        { perspective: "raw" },
      )
      .then((found) => {
        const current = found.find((d) => d._id.startsWith("drafts.")) ?? found[0] ?? null;
        setExisting(current);
        if (current?.hasHashes) setMode("changes");
      })
      .catch(() => setExisting(null));
    return () => {
      cancelled.current = true;
    };
  }, [client, targetId]);

  const run = useCallback(async () => {
    setRunning(true);
    setProblem("");
    setJob(null);
    try {
      await ensureManifest(client, schema, options);
      const id = await createJob(client, {
        kind: "translate",
        language: language.id,
        mode,
        sourceId,
        sourceType,
        requestedBy: user?.name ?? user?.email ?? user?.id,
      });
      void startJob(options.endpoint ?? DEFAULT_ENDPOINT, id).then((message) => {
        if (message && !cancelled.current) setProblem(message);
      });
      const finished = await watchJob(client, id, (next) => setJob(next), { cancelled: () => cancelled.current });
      if (!isFinished(finished) && !cancelled.current) {
        setProblem("This is taking longer than expected. The job may still finish; check the translation in a few minutes.");
      }
    } catch {
      setProblem("The job could not be created. Check that you are allowed to edit this document.");
    }
    setRunning(false);
  }, [client, schema, options, language.id, mode, sourceId, sourceType, user]);

  const finished = isFinished(job);
  const title = language.title;

  return (
    <Box padding={4}>
      <Stack space={4}>
        {!running && !finished ? (
          <Stack space={4}>
            <Line>
              The published English is sent to Anthropic with the API key saved in Site Settings, translated as a whole with the site's glossary and style guide, and checked twice. Legal text goes to the Legal approvals queue. A page with no legal text waiting is published when automatic publishing is on in Site Settings; otherwise it is saved as a {title} draft.
            </Line>
            {existing === undefined ? <Line muted>Looking for an existing {title} version</Line> : null}
            {existing ? (
              <Stack space={3}>
                <Line>
                  A {title} version already exists ({translationStatusLabel(existing.status, options.labels)}).
                </Line>
                {existing.hasHashes ? (
                  <Flex align="center" gap={2} as="label">
                    <Radio checked={mode === "changes"} onChange={() => setMode("changes")} name="i18n-mode" />
                    <Line>Only what changed in the English. The rest of the {title} stays as it is.</Line>
                  </Flex>
                ) : null}
                <Flex align="center" gap={2} as="label">
                  <Radio checked={mode === "full"} onChange={() => setMode("full")} name="i18n-mode" />
                  <Line>The whole document again. This replaces the {title} draft, including any edits made to it by hand.</Line>
                </Flex>
              </Stack>
            ) : null}
          </Stack>
        ) : null}

        {running ? (
          <Flex align="center" gap={3}>
            <Spinner muted />
            <Line>{job?.progress && job.status === "running" ? `${job.progress}...` : "Starting..."}</Line>
          </Flex>
        ) : null}

        {problem && !finished ? (
          <Card padding={3} radius={2} tone="critical" border>
            <Line>{problem}</Line>
          </Card>
        ) : null}

        {finished && job ? <JobOutcomeView job={job} languageTitle={title} /> : null}

        <Flex gap={2} justify="flex-end">
          {finished && job?.report?.saved ? (
            <Button
              text={`Open the ${title} draft`}
              tone="primary"
              onClick={() => {
                onClose();
                router.navigateIntent("edit", { id: targetId, type: sourceType });
              }}
            />
          ) : null}
          {!running && !finished ? <Button text={`Translate to ${title}`} tone="primary" disabled={existing === undefined} onClick={() => void run()} /> : null}
          <Button text={finished ? "Close" : "Cancel"} mode="ghost" disabled={running} onClick={onClose} />
        </Flex>
      </Stack>
    </Box>
  );
}

/**
 * The document action "Translate to <Language>". Shown on default-language
 * documents of a translatable type, for a language that is switched on in
 * Site Settings. It translates the published document, so it is disabled
 * until there is one.
 */
export function translateAction(options: TranslateActionOptions): DocumentActionComponent {
  const defaultId = options.languages.defaultLanguage.id;
  const language = options.language;

  const TranslateAction: DocumentActionComponent = (props: DocumentActionProps) => {
    const client = useClient({ apiVersion: STUDIO_API_VERSION });
    const enabled = useEnabledLanguageIds(client, options);
    const [open, setOpen] = useState(false);

    const current = (props.draft ?? props.published) as Record<string, unknown> | null;
    const documentLanguage = current?.[LANGUAGE_FIELD];
    if (typeof documentLanguage === "string" && documentLanguage !== "" && documentLanguage !== defaultId) return null;
    if (!enabled || !enabled.includes(language.id)) return null;

    const close = () => {
      setOpen(false);
      props.onComplete();
    };

    return {
      label: `Translate to ${language.title}`,
      icon: TranslateIcon,
      disabled: !props.published,
      title: props.published ? undefined : "Publish this document first. The published version is what gets translated.",
      onHandle: () => setOpen(true),
      dialog: open
        ? {
            type: "dialog",
            header: `Translate to ${language.title}`,
            onClose: close,
            content: <TranslateDialog options={options} sourceId={props.id} sourceType={props.type} onClose={close} />,
          }
        : null,
    };
  };
  TranslateAction.displayName = `TranslateTo_${language.id}`;
  return TranslateAction;
}
