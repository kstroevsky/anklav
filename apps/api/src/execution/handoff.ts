export function handoffBlockers(input: { checkpointPresent: boolean; gitSlice?: { dirtyState: string; patchArtifactId?: string | null } | null; patchEvidenceArtifactId?: string | null; activeWriteLeaseCount: number }): string[] {
  const slice = input.gitSlice;
  return [
    ...(!input.checkpointPresent ? ['No checkpoint has been captured.'] : []),
    ...(!slice ? ['No Git slice has been captured.'] : []),
    ...(slice?.dirtyState === 'dirty_missing' ? ['The latest Git slice has uncaptured changes.'] : []),
    ...(slice?.dirtyState === 'dirty_captured' && !slice.patchArtifactId && !input.patchEvidenceArtifactId ? ['The latest dirty Git slice has no exact patch evidence.'] : []),
    ...(input.activeWriteLeaseCount ? [`${input.activeWriteLeaseCount} active write lease${input.activeWriteLeaseCount === 1 ? '' : 's'} must be released or expire.`] : []),
  ];
}
