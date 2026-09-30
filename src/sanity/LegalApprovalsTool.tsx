import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckmarkCircleIcon } from "@sanity/icons";
import { Box, Button, Card, Container, Flex, Heading, Spinner, Stack, Tab, TabList, TabPanel, Text, TextArea } from "@sanity/ui";
import { useClient, useCurrentUser, type Tool } from "sanity";
import { useRouter } from "sanity/router";
import { isLegalApprover, type TranslationJob } from "../core/engineModel";
import type { LanguagesConfig } from "../core/languages";
import {
  LEGAL_APPROVAL_TYPE,
  legalPathSegments,
  occurrenceKey,
  unitText,
  type LegalApproval,
  type LegalDecision,
  type LegalOccurrence,
} from "../core/legal";
import { getAtPath } from "../core/paths";
import { readUnit, type TranslationUnit, type UnitValue } from "../core/payload";
import { sha256Hex } from "../core/sha256";
import type { TranslationLabels } from "../core/translations";
import { STUDIO_API_VERSION } from "./ApiKeyInput";
import { createJob, DEFAULT_APPROVE_ENDPOINT, isFinished, startJob, useLegalApprovers, watchJob, type StudioEngineOptions } from "./studioEngine";

export interface LegalApprovalsToolOptions extends StudioEngineOptions {
  titles?: Readonly<Record<string, string>>;
  labels?: TranslationLabels;
}

type Json = Record<string, unknown>;

interface QueueEntry extends LegalApproval {
  _createdAt?: string;
}

interface LogRow {
  unitId: string;
  language: string;
  sourceText: string;
  decision: LegalDecision;
}

const APPROVER_NOTICE =
  "You can see the queue, but only a listed legal approver can approve or send back. Ask the site owner to add your email under Site Settings, Languages, Legal approvers.";

function who(person: LegalDecision["decidedBy"]): string {
  if (!person) return "the translation engine";
  return person.name && person.email ? `${person.name} (${person.email})` : person.name || person.email || person.id || "someone";
}

function when(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function outcomeWord(status: LegalDecision["status"]): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "sent_back":
      return "Sent back";
    case "superseded":
      return "Superseded (the English changed)";
    default:
      return "Proposed";
  }
}

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The log: every decision on every unit, newest first. Exported for tests. */
export function buildLog(entries: readonly Pick<LegalApproval, "_id" | "language" | "sourceText" | "history">[]): LogRow[] {
  const rows: LogRow[] = [];
  for (const entry of entries) {
    for (const decision of entry.history ?? []) rows.push({ unitId: entry._id, language: entry.language, sourceText: entry.sourceText, decision });
  }
  return rows.sort((a, b) => (a.decision.decidedAt < b.decision.decidedAt ? 1 : a.decision.decidedAt > b.decision.decidedAt ? -1 : 0));
}

/**
 * Resubmit a sent-back unit with the wording now in one of its drafts. Any
 * editor may do this with their own session: it proposes, it does not
 * approve. Returns false when no draft carries the unit.
 */
export async function resubmitLegalUnit(
  client: { fetch<T>(query: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<T>; mutate(mutations: unknown): Promise<unknown> },
  entry: Pick<LegalApproval, "_id" | "kind" | "occurrences" | "sourceHash">,
  by: { id?: string; name?: string; email?: string } | undefined,
): Promise<boolean> {
  for (const occurrence of entry.occurrences ?? []) {
    const draft = await client.fetch<Json | null>(`*[_id == $id][0]`, { id: `drafts.${occurrence.documentId}` }, { perspective: "raw" });
    if (!draft) continue;
    const segments = legalPathSegments(occurrence.path);
    const unit = { path: occurrence.path, segments, kind: entry.kind, value: "" } as unknown as TranslationUnit;
    const value: UnitValue | undefined = readUnit(draft, unit) ?? (getAtPath(draft, segments) as UnitValue | undefined);
    if (value === undefined) continue;
    const now = new Date().toISOString();
    const decision: LegalDecision = {
      _key: sha256Hex(`${now}\npending\n${entry._id}`).slice(0, 12),
      status: "pending",
      decidedAt: now,
      sourceHash: entry.sourceHash,
      comment: `Resubmitted with the wording in ${occurrence.documentId}.`,
      ...(by ? { decidedBy: by } : {}),
    };
    await client.mutate([
      { patch: { id: entry._id, set: { status: "pending", translatedText: unitText(value), translatedValue: JSON.stringify(value), updatedAt: now }, unset: ["decidedBy", "decidedAt", "comment", "supersededBy"] } },
      { patch: { id: entry._id, setIfMissing: { history: [] } } },
      { patch: { id: entry._id, insert: { after: "history[-1]", items: [decision] } } },
    ]);
    return true;
  }
  return false;
}

function Occurrences({ occurrences, titles, typeTitle }: { occurrences: LegalOccurrence[]; titles: Map<string, string>; typeTitle: (type: string) => string }) {
  const router = useRouter();
  if (occurrences.length === 0) return <Text size={1} muted>Not on any translation yet.</Text>;
  return (
    <Stack space={2}>
      {occurrences.map((o) => (
        <Flex key={o._key ?? occurrenceKey(o.documentId, o.path)} align="center" gap={2} wrap="wrap">
          <Button
            mode="bleed"
            padding={1}
            fontSize={1}
            text={`${typeTitle(o.documentType)}: ${titles.get(o.documentId) ?? o.documentId}`}
            onClick={() => router.navigateIntent("edit", { id: o.documentId, type: o.documentType })}
          />
          <Text size={1} muted>
            {o.path}
          </Text>
        </Flex>
      ))}
    </Stack>
  );
}

function History({ history }: { history: LegalDecision[] }) {
  const [open, setOpen] = useState(false);
  if (!history || history.length === 0) return null;
  return (
    <Stack space={2}>
      <Button mode="bleed" padding={1} fontSize={1} text={open ? "Hide history" : `History (${history.length})`} onClick={() => setOpen((v) => !v)} />
      {open
        ? [...history].reverse().map((d) => (
            <Text key={d._key} size={1} muted>
              {when(d.decidedAt)}: {outcomeWord(d.status)} by {who(d.decidedBy)}
              {d.comment ? `. ${d.comment}` : ""}
            </Text>
          ))
        : null}
    </Stack>
  );
}

function UnitCard({
  entry,
  languages,
  titles,
  typeTitle,
  canDecide,
  busy,
  onApprove,
  onSendBack,
  onResubmit,
}: {
  entry: QueueEntry;
  languages: LanguagesConfig;
  titles: Map<string, string>;
  typeTitle: (type: string) => string;
  canDecide: boolean;
  busy: boolean;
  onApprove: (entry: QueueEntry) => void;
  onSendBack: (entry: QueueEntry, comment: string) => void;
  onResubmit: (entry: QueueEntry) => void;
}) {
  const [sendingBack, setSendingBack] = useState(false);
  const [comment, setComment] = useState("");
  const language = languages.languages.find((l) => l.id === entry.language);
  const languageTitle = language?.title ?? entry.language.toUpperCase();
  const sentBack = entry.status === "sent_back";

  return (
    <Card padding={4} radius={2} border tone={sentBack ? "caution" : "default"}>
      <Stack space={4}>
        <Flex align="center" gap={3} wrap="wrap">
          <Text size={1} weight="medium">
            {languageTitle} · {sentBack ? "Sent back" : "Waiting for approval"} · since {when(entry.createdAt ?? entry._createdAt)}
          </Text>
        </Flex>
        <Flex gap={4} wrap="wrap">
          <Box flex={1} style={{ minWidth: 280 }}>
            <Stack space={2}>
              <Text size={1} muted>
                {languages.defaultLanguage.title}
              </Text>
              <Card padding={3} radius={2} tone="transparent" border>
                <Text size={1} style={{ whiteSpace: "pre-wrap" }}>
                  {entry.sourceText}
                </Text>
              </Card>
            </Stack>
          </Box>
          <Box flex={1} style={{ minWidth: 280 }}>
            <Stack space={2}>
              <Text size={1} muted>
                {languageTitle}
              </Text>
              <Card padding={3} radius={2} tone="primary" border>
                <Text size={1} style={{ whiteSpace: "pre-wrap" }}>
                  {entry.translatedText}
                </Text>
              </Card>
            </Stack>
          </Box>
        </Flex>
        {sentBack && entry.comment ? (
          <Text size={1}>
            Sent back by {who(entry.decidedBy)} on {when(entry.decidedAt)}: {entry.comment}
          </Text>
        ) : null}
        <Stack space={2}>
          <Text size={1} muted>
            Where it appears
          </Text>
          <Occurrences occurrences={entry.occurrences ?? []} titles={titles} typeTitle={typeTitle} />
        </Stack>
        <History history={entry.history ?? []} />
        {canDecide ? (
          <Stack space={3}>
            {sendingBack ? (
              <Stack space={2}>
                <TextArea rows={3} placeholder="What needs to change (required)" value={comment} onChange={(event) => setComment(event.currentTarget.value)} disabled={busy} />
                <Flex gap={2}>
                  <Button text="Send back with this comment" tone="critical" disabled={busy || comment.trim() === ""} onClick={() => onSendBack(entry, comment.trim())} />
                  <Button text="Cancel" mode="ghost" disabled={busy} onClick={() => setSendingBack(false)} />
                </Flex>
              </Stack>
            ) : (
              <Flex gap={2} wrap="wrap">
                <Button text={sentBack ? "Approve as it is" : "Approve"} tone="positive" icon={CheckmarkCircleIcon} disabled={busy} onClick={() => onApprove(entry)} />
                {!sentBack ? <Button text="Send back" mode="ghost" tone="critical" disabled={busy} onClick={() => setSendingBack(true)} /> : null}
                {sentBack ? <Button text="Resubmit with the draft's current wording" mode="ghost" disabled={busy} onClick={() => onResubmit(entry)} /> : null}
              </Flex>
            )}
          </Stack>
        ) : sentBack ? (
          <Button text="Resubmit with the draft's current wording" mode="ghost" disabled={busy} onClick={() => onResubmit(entry)} />
        ) : null}
      </Stack>
    </Card>
  );
}

function LegalApprovalsToolView({ tool }: { tool: Tool<LegalApprovalsToolOptions> }) {
  const options = tool.options as LegalApprovalsToolOptions;
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const user = useCurrentUser();
  const approvers = useLegalApprovers(client, options);
  const canDecide = approvers !== null && isLegalApprover(user?.email, approvers);

  const [tab, setTab] = useState<"queue" | "log">("queue");
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "positive" | "critical" | "caution"; text: string } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const typeTitle = useCallback((type: string) => options.titles?.[type] ?? type, [options.titles]);

  const load = useCallback(async () => {
    const [pending, all] = await Promise.all([
      client.fetch<QueueEntry[]>(`*[_type == $type && status in ["pending", "sent_back"]] | order(createdAt asc, _createdAt asc)`, { type: LEGAL_APPROVAL_TYPE }),
      client.fetch<Pick<LegalApproval, "_id" | "language" | "sourceText" | "history">[]>(`*[_type == $type]{ _id, language, sourceText, history }`, { type: LEGAL_APPROVAL_TYPE }),
    ]);
    const ids = [...new Set(pending.flatMap((e) => (e.occurrences ?? []).map((o) => o.documentId)))];
    const named = ids.length > 0 ? await client.fetch<{ _id: string; title?: string }[]>(`*[_id in $ids || _id in $drafts]{ _id, "title": coalesce(title, name, siteName, heading, _id) }`, { ids, drafts: ids.map((id) => `drafts.${id}`) }, { perspective: "raw" }) : [];
    if (!alive.current) return;
    const map = new Map<string, string>();
    for (const row of named) map.set(row._id.replace(/^drafts\./, ""), String(row.title ?? row._id));
    setTitles(map);
    setQueue(pending);
    setLog(buildLog(all));
  }, [client]);

  useEffect(() => {
    void load().catch(() => setMessage({ tone: "critical", text: "The approval queue could not be loaded." }));
  }, [load]);

  const decide = useCallback(
    async (entry: QueueEntry, kind: "approve" | "send_back", comment?: string) => {
      setBusy(entry._id);
      setMessage(null);
      try {
        const id = await createJob(client, {
          kind,
          language: entry.language,
          unitId: entry._id,
          ...(comment ? { comment } : {}),
          approver: { id: user?.id, name: user?.name, email: user?.email },
          requestedBy: user?.name ?? user?.email ?? user?.id,
        });
        let refused: string | null = null;
        void startJob(options.approveEndpoint ?? DEFAULT_APPROVE_ENDPOINT, id).then((m) => {
          refused = m;
        });
        const job: TranslationJob | null = await watchJob(client, id, () => undefined, { cancelled: () => !alive.current || refused !== null, timeoutMs: 2 * 60 * 1000 });
        if (!alive.current) return;
        if (job?.status === "done" && job.approval) {
          const published = job.approval.translations.filter((t) => t.published).length;
          const approved = job.approval.translations.filter((t) => t.status === "approved").length;
          setMessage({
            tone: "positive",
            text:
              kind === "approve"
                ? `Approved. ${job.approval.translations.length} translation(s) updated with the approved wording; ${approved} now Approved, ${published} published.`
                : `Sent back. ${job.approval.translations.length} translation(s) stay held until the wording is fixed and resubmitted.`,
          });
        } else if (job?.status === "failed") setMessage({ tone: "critical", text: job.error?.message ?? "The decision could not be recorded." });
        else if (!isFinished(job)) setMessage({ tone: "critical", text: refused ?? "The decision is taking longer than expected. Reload in a moment." });
        await load();
      } catch {
        setMessage({ tone: "critical", text: "The decision could not be started. Check that you are allowed to edit content." });
      }
      if (alive.current) setBusy(null);
    },
    [client, user, options.approveEndpoint, load],
  );

  const resubmit = useCallback(
    async (entry: QueueEntry) => {
      setBusy(entry._id);
      setMessage(null);
      try {
        const done = await resubmitLegalUnit(client, entry, user ? { id: user.id, name: user.name, email: user.email } : undefined);
        setMessage(done ? { tone: "positive", text: "Resubmitted. It is waiting for approval again with the draft's current wording." } : { tone: "caution", text: "No draft carries this text yet, so there is nothing to resubmit. Run Translate on the page first." });
        await load();
      } catch {
        setMessage({ tone: "critical", text: "The text could not be resubmitted. Check that you are allowed to edit content." });
      }
      if (alive.current) setBusy(null);
    },
    [client, user, load],
  );

  const byLanguage = useMemo(() => {
    const groups = new Map<string, QueueEntry[]>();
    for (const entry of queue ?? []) groups.set(entry.language, [...(groups.get(entry.language) ?? []), entry]);
    return [...groups.entries()];
  }, [queue]);

  return (
    <Container width={4} padding={4}>
      <Stack space={5}>
        <Stack space={3}>
          <Heading size={2}>Legal approvals</Heading>
          <Text size={1} muted>
            Legal and disclosure text waits here before it goes live in another language. Each piece is approved once and reused on every page that carries the same English. A translation with legal text waiting stays unpublished.
          </Text>
        </Stack>

        {approvers !== null && !canDecide ? (
          <Card padding={3} radius={2} border tone="caution">
            <Text size={1}>{APPROVER_NOTICE}</Text>
          </Card>
        ) : null}

        <TabList space={2}>
          <Tab id="queue-tab" aria-controls="queue-panel" label={`Queue${queue ? ` (${queue.length})` : ""}`} selected={tab === "queue"} onClick={() => setTab("queue")} />
          <Tab id="log-tab" aria-controls="log-panel" label="Log" selected={tab === "log"} onClick={() => setTab("log")} />
        </TabList>

        {message ? (
          <Card padding={3} radius={2} border tone={message.tone}>
            <Text size={1}>{message.text}</Text>
          </Card>
        ) : null}

        <TabPanel id="queue-panel" aria-labelledby="queue-tab" hidden={tab !== "queue"}>
          {queue === null ? (
            <Flex padding={4} justify="center">
              <Spinner muted />
            </Flex>
          ) : queue.length === 0 ? (
            <Card padding={4} radius={2} border tone="positive">
              <Text size={1}>Nothing is waiting. Every piece of legal text in the queue has been decided.</Text>
            </Card>
          ) : (
            <Stack space={5}>
              {byLanguage.map(([languageId, entries]) => (
                <Stack key={languageId} space={3}>
                  <Heading size={1}>{options.languages.languages.find((l) => l.id === languageId)?.title ?? languageId}</Heading>
                  {entries.map((entry) => (
                    <UnitCard
                      key={entry._id}
                      entry={entry}
                      languages={options.languages}
                      titles={titles}
                      typeTitle={typeTitle}
                      canDecide={canDecide}
                      busy={busy !== null}
                      onApprove={(e) => void decide(e, "approve")}
                      onSendBack={(e, comment) => void decide(e, "send_back", comment)}
                      onResubmit={(e) => void resubmit(e)}
                    />
                  ))}
                </Stack>
              ))}
            </Stack>
          )}
        </TabPanel>

        <TabPanel id="log-panel" aria-labelledby="log-tab" hidden={tab !== "log"}>
          {log === null ? (
            <Flex padding={4} justify="center">
              <Spinner muted />
            </Flex>
          ) : log.length === 0 ? (
            <Card padding={4} radius={2} border tone="transparent">
              <Text size={1}>No decisions yet.</Text>
            </Card>
          ) : (
            <Card radius={2} border style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["When", "Who", "Language", "English", "Outcome", "Comment"].map((heading) => (
                      <th key={heading} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid var(--card-border-color)" }}>
                        <Text size={1} weight="medium">
                          {heading}
                        </Text>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.map((row) => (
                    <tr key={`${row.unitId}-${row.decision._key}`}>
                      {[when(row.decision.decidedAt), who(row.decision.decidedBy), row.language.toUpperCase(), excerpt(row.sourceText), outcomeWord(row.decision.status), row.decision.comment ?? ""].map((value, i) => (
                        <td key={i} style={{ padding: "10px 12px", verticalAlign: "top", borderBottom: "1px solid var(--card-border-color)" }}>
                          <Text size={1} muted={i === 0 || i === 5}>
                            {value}
                          </Text>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabPanel>
      </Stack>
    </Container>
  );
}

/** The "Legal approvals" Studio tool: the queue per language, side by side, with Approve and Send back, and a log of every decision. */
export function legalApprovalsTool(options: LegalApprovalsToolOptions): Tool<LegalApprovalsToolOptions> {
  return {
    name: "legal-approvals",
    title: "Legal approvals",
    icon: CheckmarkCircleIcon,
    component: LegalApprovalsToolView,
    options,
  };
}

export { APPROVER_NOTICE as LEGAL_APPROVER_NOTICE };
