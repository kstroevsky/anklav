export function warningsMatch(warnings: string[], acknowledged: string[]): boolean {
  return warnings.length === acknowledged.length && warnings.every((warning, index) => warning === acknowledged[index]);
}

export function variable(name: string, values: Record<string, string | string[]>): string {
  const value = values[name];
  if (typeof value !== 'string') throw new Error('INVALID_ARGUMENT: Resource URI is invalid.');
  return value;
}
export function resource(uri: URL, value: unknown) { return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }] }; }
export function success(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: { result: value } }; }
export function failure(error: unknown) {
  const mapped = mapError(error);
  return { isError: true, content: [{ type: 'text' as const, text: `${mapped.code}: ${mapped.message}` }], structuredContent: mapped };
}
function mapError(error: unknown): { code: string; message: string; latest?: unknown } {
  if (error instanceof Error && error.message.includes(': ')) {
    const [code, ...rest] = error.message.split(': ');
    if (['INVALID_ARGUMENT', 'FORBIDDEN', 'NOT_FOUND', 'VERSION_CONFLICT'].includes(code!)) return { code: code!, message: rest.join(': ') };
  }
  if (typeof error === 'object' && error && 'getStatus' in error && typeof (error as { getStatus: () => number }).getStatus === 'function') {
    const status = (error as { getStatus: () => number }).getStatus();
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    const latest = typeof response === 'object' && response && 'current' in response ? (response as { current: unknown }).current : undefined;
    if (status === 412) return { code: 'VERSION_CONFLICT', message: 'The record changed; fetch the latest record and retry.', latest };
    if (status === 404) return { code: 'NOT_FOUND', message: 'The requested record was not found.' };
    if (status === 403) return { code: 'FORBIDDEN', message: 'You are not allowed to perform this operation.' };
    return { code: 'INVALID_ARGUMENT', message: typeof response === 'string' ? response : 'The request is invalid.' };
  }
  return { code: 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : 'The request is invalid.' };
}

