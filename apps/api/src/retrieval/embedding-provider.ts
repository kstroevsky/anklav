import { Injectable } from '@nestjs/common';
import { z } from 'zod';

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export type EmbeddingProfileContract = {
  key: string;
  model: string;
  modelRevision: string;
  dimensions: number;
  queryPrefix: string;
  documentPrefix: string;
};

export interface EmbeddingProvider {
  configured(): boolean;
  embed(profile: EmbeddingProfileContract, kind: 'query' | 'document', inputs: string[]): Promise<number[][]>;
}

const responseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()) })),
});

@Injectable()
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  configured(): boolean {
    return Boolean(process.env.EMBEDDING_BASE_URL && process.env.EMBEDDING_MODEL_REVISION);
  }

  async embed(profile: EmbeddingProfileContract, kind: 'query' | 'document', inputs: string[]): Promise<number[][]> {
    if (!inputs.length) return [];
    const baseUrl = process.env.EMBEDDING_BASE_URL?.replace(/\/+$/, '');
    const configuredRevision = process.env.EMBEDDING_MODEL_REVISION;
    if (!baseUrl || !configuredRevision) throw new Error('Embedding provider is not configured. Set EMBEDDING_BASE_URL and EMBEDDING_MODEL_REVISION.');
    if (configuredRevision !== profile.modelRevision) throw new Error(`Embedding provider revision does not match profile ${profile.key}.`);
    const prefix = kind === 'query' ? profile.queryPrefix : profile.documentPrefix;
    const timeoutMs = environmentInteger('EMBEDDING_REQUEST_TIMEOUT_MS', 30_000, 1_000, 120_000);
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.EMBEDDING_API_KEY ? { authorization: `Bearer ${process.env.EMBEDDING_API_KEY}` } : {}),
      },
      body: JSON.stringify({ model: profile.model, input: inputs.map((input) => `${prefix}${input}`), encoding_format: 'float' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}.`);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Embedding provider returned an invalid response.');
    const ordered = [...parsed.data.data].sort((left, right) => left.index - right.index);
    if (ordered.length !== inputs.length || ordered.some((entry, index) => entry.index !== index)) throw new Error('Embedding provider returned an incomplete or misordered batch.');
    if (ordered.some((entry) => entry.embedding.length !== profile.dimensions)) throw new Error(`Embedding provider did not return ${profile.dimensions}-dimensional vectors for profile ${profile.key}.`);
    return ordered.map((entry) => entry.embedding);
  }
}

function environmentInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}
