import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TranslateIcon } from "@sanity/icons";
import { Box, Button, Card, Checkbox, Container, Flex, Heading, Select, Spinner, Stack, Text } from "@sanity/ui";
import { useClient, useCurrentUser, useSchema, type Tool } from "sanity";
import { SECRETS_ID, type CostEstimate, type JobMode, type TranslationJob } from "../core/engineModel";
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

export interface TranslationsToolOptions extends StudioEngineOptions {
  /** Titles per document type. Defaults to the type name. */
  titles?: Readonly<Record<string, string>>;
  labels?: TranslationLabels;
}

interface SourceRow {
  _id: string;
  _type: string;
}

interface TranslationRow {
  _id: string;
  _type: string;
  source?: string;
  status?: string;
  hasHashes?: boolean;
  /** The English moved since this translation was made (set by the stale check on publish). */
  stale?: boolean;
}

interface TypeCounts {
  type: string;
  total: number;
  translated: number;
  needsUpdate: number;
  awaitingApproval: number;
  approved: number;
  /** What a run would do: translate documents that have no translation, update the ones that need it. */
  work: { sourceId: string; mode: JobMode }[];
}

interface RunItem {
  sourceId: string;
  type: string;
  mode: JobMode;
  state: "waiting" | "running" | "done" | "held" | "failed";
  message?: string;
}

const cell: React.CSSProperties = { padding: "10px 12px", textAlign: "right", borderBottom: "1px solid var(--card-border-color)" };
const firstCell: React.CSSProperties = { ...cell, textAlign: "left" };

function summarise(sources: SourceRow[], translations: TranslationRow[], types: readonly string[]): TypeCounts[] {
  // A translation can exist as a draft and as a published document. The draft is the newer state.
  const bySource = new Map<string, TranslationRow>();
  for (const row of translations) {
    if (!row.source) continue;
    const current = bySource.get(row.source);
    if (!current || row._id.startsWith("drafts.")) bySource.set(row.source, row);
  }
  return types.map((type) => {
    const counts: TypeCounts = { type, total: 0, translated: 0, needsUpdate: 0, awaitingApproval: 0, approved: 0, work: [] };
    for (const source of sources) {
      if (source._type !== type) continue;
      counts.total++;
      const translation = bySource.get(source._id);
      if (!translation) {
        counts.work.push({ sourceId: source._id, mode: "full" });
        continue;
      }
      counts.translated++;
      if (translation.status === "needs_update" || translation.stale) {
        counts.needsUpdate++;
        counts.work.push({ sourceId: source._id, mode: translation.hasHashes ? "changes" : "full" });
      } else if (translation.status === "awaiting_approval") counts.awaitingApproval++;
      else if (translation.status === "approved") counts.approved++;
    }
    return counts;
  });
}

function TranslationsToolView({ tool }: { tool: Tool<TranslationsToolOptions> }) {
  const options = tool.options as TranslationsToolOptions;
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const schema = useSchema();
  const user = useCurrentUser();
  const defaultLanguage = options.languages.defaultLanguage;
  const enabledIds = useEnabledLanguageIds(client, options);
  const targets = useMemo(
    () => options.languages.languages.filter((l) => l.id !== defaultLanguage.id && (enabledIds ?? []).includes(l.id)),
    [options.languages, defaultLanguage.id, enabledIds],
  );

  const [languageId, setLanguageId] = useState("");
  const [rows, setRows] = useState<TypeCounts[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [estimate, setEstimate] = useState<{ key: string; value: CostEstimate } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [problem, setProblem] = useState("");
  const [items, setItems] = useState<RunItem[]>([]);
  const [runningBulk, setRunningBulk] = useState(false);
  const stop = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);

  useEffect(() => {
    if (!languageId && targets.length > 0) setLanguageId(targets[0].id);
  }, [languageId, targets]);

  const language = targets.find((l) => l.id === languageId);
  const typeTitle = useCallback((type: string) => options.titles?.[type] ?? type, [options.titles]);

  const load = useCallback(async () => {
    if (!languageId) return;
    const types = [...options.translatableTypes];
    const [sources, translations, keyCount] = await Promise.all([
      client.fetch<SourceRow[]>(
        `*[_type in $types && (${LANGUAGE_FIELD} == $default || !defined(${LANGUAGE_FIELD})) && !(_id in path("drafts.**"))]{ _id, _type }`,
        { types, default: defaultLanguage.id },
        { perspective: "raw" },
      ),
      client.fetch<TranslationRow[]>(
        `*[_type in $types && ${LANGUAGE_FIELD} == $lang]{ _id, _type, "source": ${I18N_FIELD}.source._ref, "status": ${I18N_FIELD}.status, "hasHashes": defined(${I18N_FIELD}.sourceHashes), "stale": defined(${I18N_FIELD}.staleSince) }`,
        { types, lang: languageId },
        { perspective: "raw" },
      ),
      client.fetch<number>(`count(*[_id == $id && defined(anthropicKey.ciphertext)])`, { id: SECRETS_ID }),
    ]);
    if (!alive.current) return;
    setRows(summarise(sources, translations, types));
    setHasKey(keyCount > 0);
  }, [client, languageId, options.translatableTypes, defaultLanguage.id]);

  useEffect(() => {
    setRows(null);
    setEstimate(null);
    void load().catch(() => setProblem("The translation counts could not be loaded."));
  }, [load]);

  // Nothing ticked means everything.
  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.size === 0 || selected.has(r.type)), [rows, selected]);
  const work = useMemo(() => chosen.flatMap((r) => r.work.map((w) => ({ ...w, type: r.type }))), [chosen]);
  const selectionKey = `${languageId}|${chosen.map((r) => r.type).join(",")}|${work.length}`;
  const scope = selected.size === 0 ? "all types" : `${selected.size} selected type(s)`;

  const toggle = (type: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const runEstimate = useCallback(async () => {
    if (!language || work.length === 0) return;
    setEstimating(true);
    setProblem("");
    setEstimate(null);
    try {
      await ensureManifest(client, schema, options);
      const id = await createJob(client, {
        kind: "estimate",
        language: language.id,
        sourceIds: work.map((w) => w.sourceId),
        requestedBy: user?.name ?? user?.email ?? user?.id,
      });
      void startJob(options.endpoint ?? DEFAULT_ENDPOINT, id).then((message) => {
        if (message && alive.current) setProblem(message);
      });
      const job = await watchJob(client, id, () => undefined, { cancelled: () => !alive.current });
      if (!alive.current) return;
      if (job?.status === "done" && job.estimate) setEstimate({ key: selectionKey, value: job.estimate });
      else if (job?.status === "failed") setProblem(job.error?.message ?? "The estimate could not be made.");
      else if (!isFinished(job)) setProblem("The estimate is taking longer than expected. Try again in a moment.");
    } catch {
      setProblem("The estimate could not be started. Check that you are allowed to edit content.");
    }
    if (alive.current) setEstimating(false);
  }, [client, schema, options, language, work, user, selectionKey]);

  const runBulk = useCallback(async () => {
    if (!language || work.length === 0) return;
    stop.current = false;
    setRunningBulk(true);
    setProblem("");
    const queue: RunItem[] = work.map((w) => ({ sourceId: w.sourceId, type: w.type, mode: w.mode, state: "waiting" }));
    setItems(queue);
    const update = (index: number, patch: Partial<RunItem>) => {
      queue[index] = { ...queue[index], ...patch };
      if (alive.current) setItems([...queue]);
    };

    try {
      await ensureManifest(client, schema, options);
    } catch {
      setProblem("The run could not be started. Check that you are allowed to edit content.");
      setRunningBulk(false);
      return;
    }

    let next = 0;
    const worker = async () => {
      while (!stop.current) {
        const index = next++;
        if (index >= queue.length) return;
        const item = queue[index];
        update(index, { state: "running" });
        try {
          const id = await createJob(client, {
            kind: "translate",
            language: language.id,
            mode: item.mode,
            sourceId: item.sourceId,
            sourceType: item.type,
            requestedBy: user?.name ?? user?.email ?? user?.id,
          });
          let refused: string | null = null;
          void startJob(options.endpoint ?? DEFAULT_ENDPOINT, id).then((message) => {
            refused = message;
          });
          const job: TranslationJob | null = await watchJob(client, id, () => undefined, { cancelled: () => !alive.current || refused !== null });
          if (job?.status === "done") {
            const r = job.report;
            update(index, { state: "done", message: !r?.saved ? "Already up to date" : r.published ? "Published" : r.status === "awaiting_approval" ? "Draft saved, legal text awaiting approval" : "Draft saved" });
          }
          else if (job?.status === "held") update(index, { state: "held", message: job.report?.holdReasons[0] ?? "Held for a person to look at" });
          else update(index, { state: "failed", message: job?.error?.message ?? refused ?? "Did not finish in time" });
        } catch {
          update(index, { state: "failed", message: "The job could not be created" });
        }
      }
    };
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 5));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (alive.current) {
      setRunningBulk(false);
      setEstimate(null);
      void load();
    }
  }, [client, schema, options, language, work, user, load]);

  const done = items.filter((i) => i.state === "done").length;
  const held = items.filter((i) => i.state === "held").length;
  const failed = items.filter((i) => i.state === "failed").length;
  const estimateIsCurrent = estimate?.key === selectionKey;

  if (enabledIds === null) {
    return (
      <Flex padding={5} justify="center">
        <Spinner muted />
      </Flex>
    );
  }

  return (
    <Container width={4} padding={4}>
      <Stack space={5}>
        <Stack space={3}>
          <Heading size={2}>Translations</Heading>
          <Text size={1} muted>
            Where every translatable document stands, per language. Estimate the cost before a run. A run saves drafts; a translation that passes both checks and carries no legal text waiting for approval goes live on its own when "Publish marketing pages automatically" is on in Site Settings. Legal text waits in Legal approvals.
          </Text>
        </Stack>

        {targets.length === 0 ? (
          <Card padding={4} radius={2} border tone="transparent">
            <Text size={1}>No other language is switched on yet. Switch one on in Site Settings under Languages.</Text>
          </Card>
        ) : (
          <Stack space={4}>
            {targets.length > 1 ? (
              <Box style={{ maxWidth: 280 }}>
                <Select value={languageId} onChange={(event) => setLanguageId(event.currentTarget.value)}>
                  {targets.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </Select>
              </Box>
            ) : (
              <Heading size={1}>{language?.nativeTitle ? `${language.title} (${language.nativeTitle})` : language?.title}</Heading>
            )}

            {hasKey === false ? (
              <Card padding={3} radius={2} border tone="caution">
                <Text size={1}>No Anthropic API key is saved yet. Add it in Site Settings under Languages. An estimate still works without one, from the length of the text.</Text>
              </Card>
            ) : null}

            <Card radius={2} border style={{ overflowX: "auto" }}>
              {rows === null ? (
                <Flex padding={4} justify="center">
                  <Spinner muted />
                </Flex>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Document type", "Total", "Translated", "Needs update", translationStatusLabel("awaiting_approval", options.labels), translationStatusLabel("approved", options.labels), "To do"].map(
                        (heading, i) => (
                          <th key={heading} style={i === 0 ? firstCell : cell}>
                            <Text size={1} weight="medium">
                              {heading}
                            </Text>
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.type}>
                        <td style={firstCell}>
                          <Flex align="center" gap={2} as="label">
                            <Checkbox checked={selected.has(row.type)} onChange={() => toggle(row.type)} disabled={runningBulk} />
                            <Text size={1}>{typeTitle(row.type)}</Text>
                          </Flex>
                        </td>
                        {[row.total, row.translated, row.needsUpdate, row.awaitingApproval, row.approved, row.work.length].map((value, i) => (
                          <td key={i} style={cell}>
                            <Text size={1} muted={value === 0}>
                              {formatCount(value)}
                            </Text>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Text size={1} muted>
              "To do" counts documents with no {language?.title} version yet, plus the ones marked Needs update or re-locked because the English changed. Tick types to limit a run; with nothing ticked a run covers all of them.
            </Text>

            <Flex gap={2} align="center" wrap="wrap">
              <Button
                text={estimating ? "Estimating" : `Estimate cost for ${scope}`}
                mode="ghost"
                disabled={estimating || runningBulk || work.length === 0}
                onClick={() => void runEstimate()}
              />
              <Button
                text={`Translate ${formatCount(work.length)} document(s)`}
                tone="primary"
                disabled={!estimateIsCurrent || runningBulk || estimating || work.length === 0 || hasKey === false}
                onClick={() => void runBulk()}
              />
              {runningBulk ? <Button text="Stop after the current ones" mode="ghost" tone="critical" onClick={() => (stop.current = true)} /> : null}
              {!estimateIsCurrent && work.length > 0 && !runningBulk ? (
                <Text size={1} muted>
                  Estimate first. The cost is shown before anything runs.
                </Text>
              ) : null}
            </Flex>

            {problem ? (
              <Card padding={3} radius={2} border tone="critical">
                <Text size={1}>{problem}</Text>
              </Card>
            ) : null}

            {estimateIsCurrent && estimate ? (
              <Card padding={4} radius={2} border tone="primary">
                <Stack space={3}>
                  <Text size={2} weight="medium">
                    About {formatDollars(estimate.value.costUsd)} for {formatCount(estimate.value.documents)} document(s)
                  </Text>
                  <Text size={1}>
                    {formatCount(estimate.value.inputTokens)} tokens in and about {formatCount(estimate.value.outputTokens)} out, across {formatCount(estimate.value.strings)} strings ({formatCount(estimate.value.characters)} characters).
                  </Text>
                  <Text size={1} muted>
                    Translator {estimate.value.translatorModel}, reviewer {estimate.value.reviewerModel}, at Anthropic's published rates as of {estimate.value.ratesAsOf}. {estimate.value.note} Documents that only need an update usually cost less than shown, because only what changed is sent. Anthropic bills the account that owns the API key.
                  </Text>
                </Stack>
              </Card>
            ) : null}

            {items.length > 0 ? (
              <Card padding={4} radius={2} border>
                <Stack space={3}>
                  <Flex align="center" gap={3}>
                    {runningBulk ? <Spinner muted /> : null}
                    <Text size={1} weight="medium">
                      {done + held + failed} of {items.length} finished: {done} saved, {held} held, {failed} failed
                    </Text>
                  </Flex>
                  {items
                    .filter((i) => i.state !== "waiting")
                    .slice(-40)
                    .map((item) => (
                      <Text key={item.sourceId} size={1} muted={item.state === "done"}>
                        {typeTitle(item.type)} {item.sourceId}: {item.state === "running" ? "working" : item.message ?? item.state}
                      </Text>
                    ))}
                </Stack>
              </Card>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}

/** The "Translations" Studio tool: counts per language and type, a cost estimate, and a bulk run. */
export function translationsTool(options: TranslationsToolOptions): Tool<TranslationsToolOptions> {
  return {
    name: "translations",
    title: "Translations",
    icon: TranslateIcon,
    component: TranslationsToolView,
    options,
  };
}

export { summarise as summariseTranslations };
