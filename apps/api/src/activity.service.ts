import { Injectable } from '@nestjs/common';
import { activityEvents } from './db/schema';

@Injectable()
export class ActivityService {
  async append(executor: any, input: {
    workspaceId: string;
    subjectType: typeof activityEvents.$inferInsert.subjectType;
    subjectId: string;
    action: string;
    actorUserId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await executor.insert(activityEvents).values({
      workspaceId: input.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.metadata ?? {},
    });
  }
}
