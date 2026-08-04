export const MAX_SEMANTIC_UNIT_CHARACTERS = 1_400;

type ContextualPrefixInput = {
  project: string;
  task?: string | null;
  sourceType: string;
  sourceId: string;
  sourcePart: number;
  status: string;
  recordedAt: Date;
  validFromAt: Date | null;
  validUntilAt: Date | null;
  authorityBasisPoints: number;
  sensitivity: string;
  metadata: Record<string, unknown>;
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_API_KEY]'],
  [/(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\b\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/@]+(@)/gi, '$1[REDACTED]$2'],
];

export function redactEmbeddingText(value: string): string {
  return SECRET_PATTERNS.reduce((redacted, [pattern, replacement]) => redacted.replace(pattern, replacement), value);
}

export function semanticUnits(value: string, maxCharacters = MAX_SEMANTIC_UNIT_CHARACTERS): string[] {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [''];
  const units: string[] = [];
  let current = '';
  for (const paragraph of normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    for (const part of splitLongPart(paragraph, maxCharacters)) {
      const combined = current ? `${current}\n\n${part}` : part;
      if (combined.length <= maxCharacters) current = combined;
      else {
        if (current) units.push(current);
        current = part;
      }
    }
  }
  if (current) units.push(current);
  return units;
}

export function buildContextualPrefix(input: ContextualPrefixInput): string {
  const metadata = input.metadata;
  const repository = metadata.effectiveRepository ?? metadata.repository ?? metadata.repositoryReference;
  const fromCommit = metadata.effectiveFromCommit ?? metadata.validFromCommit;
  const untilCommit = metadata.effectiveUntilCommit ?? metadata.validUntilCommit;
  const fields: Array<[string, unknown]> = [
    ['project', input.project],
    ['task', input.task],
    ['source', `${input.sourceType}:${input.sourceId}:${input.sourcePart}`],
    ['status', input.status],
    ['recorded', input.recordedAt.toISOString()],
    ['validity', `${input.validFromAt?.toISOString() ?? 'unspecified'}..${input.validUntilAt?.toISOString() ?? 'open'}`],
    ['repository', repository],
    ['git', fromCommit || untilCommit ? `${fromCommit ?? 'unspecified'}..${untilCommit ?? 'open'}` : null],
    ['classification', metadata.classification],
    ['provider', metadata.provider],
    ['authority', (input.authorityBasisPoints / 10_000).toFixed(4)],
    ['sensitivity', input.sensitivity],
  ];
  return fields.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([key, value]) => `${key}:${safeValue(String(value))}`).join(' | ');
}

export function buildEmbeddingText(contextualPrefix: string, title: string, content: string): string {
  return redactEmbeddingText(`${contextualPrefix}\n${title}\n${content}`);
}

function splitLongPart(value: string, maxCharacters: number): string[] {
  if (value.length <= maxCharacters) return [value];
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > maxCharacters) {
    const whitespaceBoundary = remaining.lastIndexOf(' ', maxCharacters);
    const boundary = whitespaceBoundary >= Math.floor(maxCharacters / 2) ? whitespaceBoundary : maxCharacters;
    parts.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function safeValue(value: string): string {
  return value.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
}
