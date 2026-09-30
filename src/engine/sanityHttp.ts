/**
 * A very small Sanity client over `fetch`, so the engine needs no Sanity
 * package on the server. Five calls: query, read by id, read several by id,
 * mutate, and the author of a document's first transaction (from the history
 * API, to check who created a job). Queries use the raw perspective so drafts
 * are visible.
 */
import { EngineError } from "./errors";

type Json = Record<string, unknown>;

export interface SanityLike {
  fetch<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T>;
  getDocument(id: string): Promise<Json | null>;
  getDocuments(ids: readonly string[]): Promise<Json[]>;
  mutate(mutations: readonly Json[]): Promise<void>;
  /**
   * The Sanity user id that created a document, from its transaction history.
   * Null when the history has no author. Optional: a client without it cannot
   * verify who created a job, and the approval route then refuses.
   */
  documentAuthor?(id: string): Promise<string | null>;
}

export interface SanityHttpConfig {
  projectId: string;
  dataset: string;
  /** A token that can read and write the dataset. Server only. */
  token: string;
  apiVersion?: string;
  fetch?: typeof globalThis.fetch;
}

export function createSanityHttp(config: SanityHttpConfig): SanityLike {
  const apiVersion = (config.apiVersion ?? "2024-01-01").replace(/^v/, "");
  const base = `https://${config.projectId}.api.sanity.io/v${apiVersion}/data`;
  const doFetch = config.fetch ?? globalThis.fetch;

  const request = async (path: string, init?: RequestInit): Promise<Json> => {
    if (!config.projectId || !config.dataset || !config.token) throw new EngineError("dataset");
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch {
      throw new EngineError("dataset");
    }
    if (!response.ok) {
      throw new EngineError("dataset", {
        details: [`Sanity answered ${response.status}`],
      });
    }
    return (await response.json()) as Json;
  };

  return {
    async fetch<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
      const body = await request(`/query/${config.dataset}?perspective=raw`, {
        method: "POST",
        body: JSON.stringify({ query, params }),
      });
      return body.result as T;
    },
    async getDocument(id: string): Promise<Json | null> {
      const body = await request(`/doc/${config.dataset}/${encodeURIComponent(id)}`);
      const documents = (body.documents ?? []) as Json[];
      return documents[0] ?? null;
    },
    async getDocuments(ids: readonly string[]): Promise<Json[]> {
      const out: Json[] = [];
      // The ids travel in the URL, so long lists go in batches.
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        if (batch.length === 0) continue;
        const body = await request(`/doc/${config.dataset}/${batch.map(encodeURIComponent).join(",")}`);
        out.push(...((body.documents ?? []) as Json[]));
      }
      return out;
    },
    async mutate(mutations: readonly Json[]): Promise<void> {
      await request(`/mutate/${config.dataset}?visibility=sync`, { method: "POST", body: JSON.stringify({ mutations }) });
    },
    async documentAuthor(id: string): Promise<string | null> {
      // The history endpoint answers with one JSON object per line, oldest first.
      if (!config.projectId || !config.dataset || !config.token) throw new EngineError("dataset");
      let response: Response;
      try {
        response = await doFetch(`${base}/history/${config.dataset}/transactions/${encodeURIComponent(id)}?excludeContent=true&limit=1`, {
          headers: { Authorization: `Bearer ${config.token}` },
        });
      } catch {
        throw new EngineError("dataset");
      }
      if (!response.ok) throw new EngineError("dataset", { details: [`Sanity answered ${response.status}`] });
      const text = await response.text();
      const first = text.split("\n").find((line) => line.trim() !== "");
      if (!first) return null;
      try {
        const parsed = JSON.parse(first) as { author?: unknown };
        return typeof parsed.author === "string" ? parsed.author : null;
      } catch {
        return null;
      }
    },
  };
}
