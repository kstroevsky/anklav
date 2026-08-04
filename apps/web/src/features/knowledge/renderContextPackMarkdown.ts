export function renderContextPackMarkdown(pack: any): string {
  const manifest = pack.manifest; const lines = [`# Anklav task context`, '', `Adapter: ${manifest.target.adapter}`, `Projection: ${manifest.target.projection}`, `Content hash: ${pack.contentHash}`, ''];
  for (const source of manifest.includedSourceIds as string[]) lines.push(`## ${source}`, '', '```json', JSON.stringify(pack[source], null, 2), '```', '');
  if (pack.blockers?.length) lines.push('## Blockers', '', ...pack.blockers.map((entry: unknown) => `- ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`), '');
  if (manifest.omittedSources.length) lines.push('## Omissions', '', ...manifest.omittedSources.map((entry: any) => `- ${entry.sourceId}: ${entry.reason}`), '');
  if (manifest.staleSourceWarnings.length) lines.push('## Stale inputs', '', ...manifest.staleSourceWarnings.map((entry: unknown) => `- ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`), '');
  return lines.join('\n');
}
