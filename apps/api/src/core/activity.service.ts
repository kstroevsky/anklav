import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth';
import { activityEvents } from '../db/schema';

@Injectable()
export class ActivityService {
  async append(executor: any, input: {
    workspaceId: string;
    subjectType: typeof activityEvents.$inferInsert.subjectType;
    subjectId: string;
    action: string;
    actorUserId?: string | null;
    actor?: AuthUser;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await executor.insert(activityEvents).values({
      workspaceId: input.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      action: input.action,
      actorUserId: input.actor?.id ?? input.actorUserId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.actor?.mcpClient
        ? { ...(input.metadata ?? {}), source: { type: 'mcp', clientId: input.actor.mcpClient.id, clientName: input.actor.mcpClient.name } }
        : input.metadata ?? {},
    });
  }
}

