import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const PARSER_VERSION = 'anklav-codex-jsonl-v1';
const MAX_SESSION_BYTES = 64 * 1024 * 1024;

type JsonRecord = { timestamp?: string; type?: string; payload?: Record<string, unknown> };
type NativeTurn = { nativeTurnId: string; parentNativeTurnId: null; sequence: number; status: 'unknown' | 'running' | 'completed' | 'interrupted' | 'failed'; startedAt: string | null; completedAt: string | null; metadata: Record<string, unknown> };
type NativeItem = {
  nativeItemId: string; nativeTurnId: string | null; sequence: number;
  type: 'user_instruction' | 'assistant_message' | 'reasoning_summary' | 'tool_call' | 'tool_result' | 'patch' | 'compaction_marker' | 'interruption' | 'error' | 'usage_report' | 'other';
  role: 'user' | 'assistant' | 'system' | 'tool' | null; status: 'running' | 'complete' | 'interrupted' | 'failed';
  summary: string; redactedContent: Record<string, unknown>; contentHash: string; redactionStatus: 'redacted';
  correlationId: string | null; occurredAt: string; relatedNativeItemId?: string; relationshipType?: 'tool_result_for'; metadata: Record<string, unknown>;
};

export type ParsedCodexSession = {
  path: string;
  nativeSessionId: string;
  parentNativeSessionId: string | null;
  cwd: string;
  clientVersion: string | null;
  modelProvider: string | null;
  parserVersion: string;
  sourceRevision: string;
  complete: boolean;
  turns: NativeTurn[];
  items: NativeItem[];
  recentAssistantSummaries: string[];
  parseErrors: Record<string, unknown>[];
};

export async function discoverCodexSession(repositoryRoot: string, options: { explicitPath?: string; since?: Date; environment?: NodeJS.ProcessEnv } = {}): Promise<string | undefined> {
  if (options.explicitPath) {
    const explicit = resolve(options.explicitPath);
    const metadata = await sessionMetadata(explicit);
    if (!await sameRepository(metadata.cwd, repositoryRoot)) throw new Error(`Codex session ${explicit} belongs to ${metadata.cwd}, not ${repositoryRoot}.`);
    return explicit;
  }
  const environment = options.environment ?? process.env;
  const root = join(environment.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
  const files = await jsonlFiles(root).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  const candidates: { path: string; modified: number }[] = [];
  for (const path of files) {
    const details = await stat(path);
    if (options.since && details.mtimeMs < options.since.getTime() - 5 * 60_000) continue;
    const metadata = await sessionMetadata(path).catch(() => null);
    if (metadata && await sameRepository(metadata.cwd, repositoryRoot)) candidates.push({ path, modified: details.mtimeMs });
  }
  return candidates.sort((left, right) => right.modified - left.modified)[0]?.path;
}

export async function parseCodexSession(path: string): Promise<ParsedCodexSession> {
  const details = await stat(path);
  if (details.size > MAX_SESSION_BYTES) throw new Error(`Codex session exceeds the ${MAX_SESSION_BYTES / 1024 / 1024} MiB MVP ingestion limit.`);
  const raw = await readFile(path, 'utf8');
  const rawLines = raw.split('\n');
  const records: { line: number; value: JsonRecord }[] = [];
  const parseErrors: Record<string, unknown>[] = [];
  for (const [index, raw] of rawLines.entries()) {
    if (!raw.trim()) continue;
    try { records.push({ line: index + 1, value: JSON.parse(raw) as JsonRecord }); }
    catch (error) {
      if (index !== rawLines.length - 1) parseErrors.push({ line: index + 1, message: error instanceof Error ? error.message : 'Invalid JSONL record.' });
    }
  }
  const metaRecord = records.find(({ value }) => value.type === 'session_meta')?.value.payload;
  if (!metaRecord) throw new Error(`Codex session ${path} has no session_meta record.`);
  const nativeSessionId = string(metaRecord.session_id) || string(metaRecord.id);
  const cwd = string(metaRecord.cwd);
  if (!nativeSessionId || !cwd) throw new Error(`Codex session ${path} has incomplete identity metadata.`);

  const turns = new Map<string, NativeTurn>();
  let activeTurn: string | null = null;
  for (const { value } of records) {
    const payload = value.payload ?? {};
    const payloadType = string(payload.type);
    if (value.type === 'event_msg' && payloadType === 'task_started') {
      const id = string(payload.turn_id);
      if (!id) continue;
      activeTurn = id;
      if (!turns.has(id)) turns.set(id, { nativeTurnId: id, parentNativeTurnId: null, sequence: turns.size + 1, status: 'running', startedAt: date(payload.started_at ?? value.timestamp), completedAt: null, metadata: {} });
    } else if (value.type === 'turn_context') {
      const id = string(payload.turn_id);
      if (id) activeTurn = id;
    } else if (value.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(payloadType)) {
      const id = string(payload.turn_id);
      const turn = id ? turns.get(id) : undefined;
      if (turn) {
        turn.status = payloadType === 'task_complete' ? 'completed' : 'interrupted';
        turn.completedAt = date(payload.completed_at ?? value.timestamp);
      }
      if (activeTurn === id) activeTurn = null;
    }
  }

  const items: NativeItem[] = [];
  const calls = new Map<string, string>();
  activeTurn = null;
  for (const { line, value } of records) {
    const payload = value.payload ?? {};
    const payloadType = string(payload.type);
    if (value.type === 'event_msg' && payloadType === 'task_started') activeTurn = string(payload.turn_id) || activeTurn;
    if (value.type === 'turn_context') activeTurn = string(payload.turn_id) || activeTurn;
    const normalized = normalize(value, line, activeTurn, calls);
    if (normalized) {
      normalized.sequence = items.length + 1;
      items.push(normalized);
    }
    if (value.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(payloadType) && activeTurn === string(payload.turn_id)) activeTurn = null;
  }

  return {
    path,
    nativeSessionId,
    parentNativeSessionId: string(metaRecord.forked_from_id) || null,
    cwd,
    clientVersion: string(metaRecord.cli_version) || null,
    modelProvider: string(metaRecord.model_provider) || null,
    parserVersion: PARSER_VERSION,
    sourceRevision: createHash('sha256').update(raw).digest('hex'),
    complete: turns.size > 0 && [...turns.values()].every((turn) => ['completed', 'interrupted', 'failed'].includes(turn.status)),
    turns: [...turns.values()],
    items,
    recentAssistantSummaries: items.filter((item) => item.type === 'assistant_message').slice(-5).map((item) => item.summary).filter(Boolean),
    parseErrors,
  };
}

function normalize(record: JsonRecord, line: number, turnId: string | null, calls: Map<string, string>): NativeItem | undefined {
  const payload = record.payload ?? {};
  const payloadType = string(payload.type);
  const occurredAt = date(record.timestamp) ?? new Date(0).toISOString();
  let type: NativeItem['type'];
  let role: NativeItem['role'] = null;
  let summary = '';
  let content: Record<string, unknown> = {};
  let status: NativeItem['status'] = 'complete';
  let nativeId = `${record.type ?? 'record'}:${line}`;
  let correlationId: string | null = null;
  let relatedNativeItemId: string | undefined;

  if (record.type === 'response_item' && payloadType === 'message') {
    const messageRole = string(payload.role);
    if (!['user', 'assistant'].includes(messageRole)) return undefined;
    role = messageRole as 'user' | 'assistant';
    type = role === 'user' ? 'user_instruction' : 'assistant_message';
    summary = redact(extractMessage(payload.content)).slice(0, 20_000);
    content = { text: summary };
    nativeId = `message:${string(payload.id) || line}`;
  } else if (record.type === 'response_item' && payloadType === 'reasoning') {
    type = 'reasoning_summary'; role = 'assistant';
    summary = redact(extractMessage(payload.summary)).slice(0, 20_000);
    if (!summary) return undefined;
    content = { text: summary };
    nativeId = `reasoning:${string(payload.id) || line}`;
  } else if (record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(payloadType)) {
    type = 'tool_call'; role = 'assistant';
    const callId = string(payload.call_id) || string(payload.id) || String(line);
    const name = string(payload.name) || 'tool';
    const input = redact(compact(payload.arguments ?? payload.input));
    summary = `${name}${input ? `: ${input}` : ''}`.slice(0, 20_000);
    content = { name, input: input.slice(0, 20_000) };
    nativeId = `call:${callId}`; correlationId = callId; calls.set(callId, nativeId);
    status = payload.status === 'running' ? 'running' : 'complete';
  } else if (record.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(payloadType)) {
    type = 'tool_result'; role = 'tool';
    const callId = string(payload.call_id) || String(line);
    const output = redact(compact(payload.output)).slice(0, 20_000);
    summary = output;
    content = { output };
    nativeId = `output:${callId}:${line}`; correlationId = callId; relatedNativeItemId = calls.get(callId);
  } else if (record.type === 'event_msg' && payloadType === 'patch_apply_end') {
    type = 'patch'; role = 'tool';
    const changes = redact(compact(payload.changes)).slice(0, 20_000);
    summary = changes || `Patch application ${payload.success === false ? 'failed' : 'completed'}.`;
    content = { changes, success: payload.success !== false };
    nativeId = `patch:${string(payload.call_id) || line}`;
    status = payload.success === false ? 'failed' : 'complete';
  } else if (record.type === 'compacted' || record.type === 'event_msg' && payloadType === 'context_compacted') {
    type = 'compaction_marker'; role = 'system'; summary = 'Codex context compacted.';
    content = { windowId: string(payload.window_id) || null };
    nativeId = `compaction:${line}`;
  } else if (record.type === 'event_msg' && payloadType === 'turn_aborted') {
    type = 'interruption'; role = 'system'; summary = redact(string(payload.reason) || 'Codex turn aborted.');
    content = { reason: summary }; nativeId = `abort:${string(payload.turn_id) || line}`; status = 'interrupted';
  } else return undefined;

  const immutable = { type, role, status, summary, content, occurredAt, turnId, correlationId };
  return {
    nativeItemId: nativeId,
    nativeTurnId: turnId,
    sequence: 0,
    type,
    role,
    status,
    summary,
    redactedContent: content,
    contentHash: createHash('sha256').update(JSON.stringify(immutable)).digest('hex'),
    redactionStatus: 'redacted',
    correlationId,
    occurredAt,
    ...(relatedNativeItemId ? { relatedNativeItemId, relationshipType: 'tool_result_for' as const } : {}),
    metadata: { sourceRecordType: record.type ?? 'unknown', sourcePayloadType: payloadType || null, sourceLine: line },
  };
}

async function sessionMetadata(path: string): Promise<{ cwd: string }> {
  const first = (await readFile(path, { encoding: 'utf8' })).split('\n').find(Boolean);
  if (!first) throw new Error('Empty Codex session.');
  const parsed = JSON.parse(first) as JsonRecord;
  const cwd = string(parsed.payload?.cwd);
  if (!cwd) throw new Error('Codex session has no cwd.');
  return { cwd };
}

async function jsonlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map((entry) => join(entry.parentPath, entry.name));
}

async function sameRepository(cwd: string, root: string): Promise<boolean> {
  const [canonicalCwd, canonicalRoot] = await Promise.all([
    realpath(cwd).catch(() => resolve(cwd)),
    realpath(root).catch(() => resolve(root)),
  ]);
  const fromRoot = relative(canonicalRoot, canonicalCwd);
  return !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
}

function extractMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((entry) => typeof entry === 'object' && entry !== null && 'text' in entry ? string((entry as { text?: unknown }).text) : '').filter(Boolean).join('\n');
}

function compact(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function redact(value: string): string {
  return value
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\b(gh[opsu]_[A-Za-z0-9]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{16,}/gi, '$1[REDACTED_TOKEN]')
    .replace(/("(?:password|secret|token|api[_-]?key)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/('(?:password|secret|token|api[_-]?key)'\s*:\s*')[^']*(')/gi, '$1[REDACTED]$2')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]');
}

function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function date(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
