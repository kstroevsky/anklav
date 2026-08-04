import type { Lease, Run } from '../tasks/taskRunsTypes';

export type MachineAlias = { id: string; repositoryId: string; machineIdentity: string; localPath: string; updatedAt: string; repository: { id: string; fullName: string } };
export type Machine = { machineIdentity: string; lastSeenAt: string | null; lastSyncAt: string | null; activeRun: Run | null; activeTask: { id: string; identifier: string; title: string } | null; leases: Array<Lease & { task: { id: string; identifier: string; title: string } }>; aliases: MachineAlias[] };
