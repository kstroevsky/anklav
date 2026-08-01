import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActivityService } from '../activity.service';
import { DEFAULT_FLOW_STATES, DEFAULT_TASK_STATES } from '../common/domain';
import { slugify } from '../common/ids';
import type { AuthUser } from '../auth';
import { DatabaseService } from '../db/database.service';
import { activityEvents, users, workflowStates, workspaceMemberships, workspaces } from '../db/schema';

export const workspaceInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(20_000).optional().default('') });
export const workflowInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  semantic: z.string(),
  position: z.number().int().min(0).optional(),
  isInitial: z.boolean().optional().default(false),
});

type Membership = typeof workspaceMemberships.$inferSelect;

@Injectable()
export class WorkspaceService {
  constructor(private readonly database: DatabaseService, private readonly activity: ActivityService) {}

  async requireMembership(workspaceId: string, user: AuthUser, minimum: 'member' | 'admin' | 'owner' = 'member', includeDeleted = false): Promise<Membership> {
    const [row] = await this.database.db.select({ membership: workspaceMemberships }).from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, user.id), eq(workspaceMemberships.active, true), includeDeleted ? undefined : isNull(workspaces.deletedAt))).limit(1);
    const membership = row?.membership;
    if (!membership) throw new ForbiddenException('You are not an active member of this workspace.');
    const rank = { member: 0, admin: 1, owner: 2 } as const;
    if (rank[membership.role] < rank[minimum]) throw new ForbiddenException('Your workspace role does not allow this action.');
    return membership;
  }

  private async availableSlug(base: string): Promise<string> {
    const normalized = slugify(base) || 'workspace';
    let candidate = normalized;
    let suffix = 2;
    while (true) {
      const [existing] = await this.database.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, candidate)).limit(1);
      if (!existing) return candidate;
      candidate = `${normalized.slice(0, 48)}-${suffix++}`;
    }
  }

  async listForUser(user: AuthUser) {
    return this.database.db.select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      description: workspaces.description,
      role: workspaceMemberships.role,
      version: workspaces.version,
      createdAt: workspaces.createdAt,
    }).from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
      .where(and(eq(workspaceMemberships.userId, user.id), eq(workspaceMemberships.active, true), isNull(workspaces.deletedAt)))
      .orderBy(asc(workspaces.name));
  }

  async create(user: AuthUser, input: z.infer<typeof workspaceInput>) {
    const slug = await this.availableSlug(input.name);
    return this.database.db.transaction(async (tx) => {
      const [workspace] = await tx.insert(workspaces).values({ name: input.name, description: input.description, slug }).returning();
      await tx.insert(workspaceMemberships).values({ workspaceId: workspace!.id, userId: user.id, role: 'owner' });
      await tx.insert(workflowStates).values([
        ...DEFAULT_TASK_STATES.map(([name, semantic, color], position) => ({ workspaceId: workspace!.id, entityType: 'task' as const, name, color, taskSemantic: semantic, position, isInitial: position === 0 })),
        ...DEFAULT_FLOW_STATES.map(([name, semantic, color], position) => ({ workspaceId: workspace!.id, entityType: 'flow' as const, name, color, flowSemantic: semantic, position, isInitial: position === 0 })),
      ]);
      await this.activity.append(tx, { workspaceId: workspace!.id, subjectType: 'workspace', subjectId: workspace!.id, action: 'created', actor: user, after: { name: workspace!.name } });
      return workspace;
    });
  }

  async update(workspaceId: string, user: AuthUser, version: number, input: Partial<z.infer<typeof workspaceInput>>) {
    await this.requireMembership(workspaceId, user, 'owner');
    const [before] = await this.database.db.select().from(workspaces).where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt))).limit(1);
    if (!before) throw new NotFoundException('Workspace not found.');
    const [updated] = await this.database.db.update(workspaces).set({ ...input, version: sql`${workspaces.version} + 1`, updatedAt: new Date() })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.version, version), isNull(workspaces.deletedAt))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Workspace was updated elsewhere', current: before });
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'workspace', subjectId: workspaceId, action: 'updated', actor: user, before: pick(before, input), after: pick(updated, input) });
    return updated;
  }

  async softDelete(workspaceId: string, user: AuthUser, version: number) {
    await this.requireMembership(workspaceId, user, 'owner');
    const [before] = await this.database.db.select().from(workspaces).where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt))).limit(1);
    if (!before) throw new NotFoundException('Workspace not found.');
    const [deleted] = await this.database.db.update(workspaces).set({ deletedAt: new Date(), deletedByUserId: user.id, version: sql`${workspaces.version} + 1`, updatedAt: new Date() })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.version, version), isNull(workspaces.deletedAt))).returning();
    if (!deleted) throw new PreconditionFailedException({ title: 'Workspace was updated elsewhere', current: before });
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'workspace', subjectId: workspaceId, action: 'soft_deleted', actor: user, before: { deletedAt: before.deletedAt }, after: { deletedAt: deleted.deletedAt } });
    return deleted;
  }

  async restore(workspaceId: string, user: AuthUser, version: number) {
    await this.requireMembership(workspaceId, user, 'owner', true);
    const [before] = await this.database.db.select().from(workspaces).where(and(eq(workspaces.id, workspaceId), sql`${workspaces.deletedAt} IS NOT NULL`)).limit(1);
    if (!before) throw new NotFoundException('Deleted workspace not found.');
    const [restored] = await this.database.db.update(workspaces).set({ deletedAt: null, deletedByUserId: null, version: sql`${workspaces.version} + 1`, updatedAt: new Date() })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.version, version), sql`${workspaces.deletedAt} IS NOT NULL`)).returning();
    if (!restored) throw new PreconditionFailedException({ title: 'Workspace was updated elsewhere', current: before });
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'workspace', subjectId: workspaceId, action: 'restored', actor: user, before: { deletedAt: before.deletedAt }, after: { deletedAt: null } });
    return restored;
  }

  async listMembers(workspaceId: string, user: AuthUser) {
    await this.requireMembership(workspaceId, user);
    return this.database.db.select({
      id: workspaceMemberships.id,
      role: workspaceMemberships.role,
      active: workspaceMemberships.active,
      createdAt: workspaceMemberships.createdAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    }).from(workspaceMemberships).innerJoin(users, eq(workspaceMemberships.userId, users.id))
      .where(eq(workspaceMemberships.workspaceId, workspaceId)).orderBy(asc(users.displayName));
  }

  async listAvailableUsers(workspaceId: string, user: AuthUser) {
    await this.requireMembership(workspaceId, user, 'admin');
    return this.database.db.select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users).where(eq(users.active, true)).orderBy(asc(users.displayName));
  }

  async addMember(workspaceId: string, actor: AuthUser, userId: string, role: 'owner' | 'admin' | 'member') {
    await this.requireMembership(workspaceId, actor, 'admin');
    const [target] = await this.database.db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.active, true))).limit(1);
    if (!target) throw new NotFoundException('User not found.');
    const [membership] = await this.database.db.insert(workspaceMemberships).values({ workspaceId, userId, role, active: true })
      .onConflictDoUpdate({ target: [workspaceMemberships.workspaceId, workspaceMemberships.userId], set: { role, active: true, updatedAt: new Date() } }).returning();
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'membership', subjectId: membership!.id, action: 'member_added', actor, after: { userId, role } });
    return membership;
  }

  async updateMember(workspaceId: string, actor: AuthUser, membershipId: string, versionless: { role?: 'owner' | 'admin' | 'member'; active?: boolean }) {
    const caller = await this.requireMembership(workspaceId, actor, 'admin');
    const [membership] = await this.database.db.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.id, membershipId), eq(workspaceMemberships.workspaceId, workspaceId))).limit(1);
    if (!membership) throw new NotFoundException('Membership not found.');
    if (membership.role === 'owner' && (versionless.active === false || versionless.role !== undefined && versionless.role !== 'owner')) {
      const [owners] = await this.database.db.select({ value: count() }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.role, 'owner'), eq(workspaceMemberships.active, true)));
      if ((owners?.value ?? 0) <= 1) throw new ConflictException('A workspace must retain at least one active owner.');
    }
    if (caller.role !== 'owner' && membership.role === 'owner') throw new ForbiddenException('Only an owner may change another owner.');
    const [updated] = await this.database.db.update(workspaceMemberships).set({ ...versionless, updatedAt: new Date() }).where(eq(workspaceMemberships.id, membershipId)).returning();
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'membership', subjectId: membershipId, action: 'member_updated', actor, before: { role: membership.role, active: membership.active }, after: { role: updated!.role, active: updated!.active } });
    return updated;
  }

  async listWorkflowStates(workspaceId: string, user: AuthUser, entity?: 'task' | 'flow') {
    await this.requireMembership(workspaceId, user);
    return this.database.db.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, workspaceId), entity ? eq(workflowStates.entityType, entity) : undefined)).orderBy(asc(workflowStates.entityType), asc(workflowStates.position));
  }

  async createWorkflowState(workspaceId: string, user: AuthUser, entityType: 'task' | 'flow', input: z.infer<typeof workflowInput>) {
    await this.requireMembership(workspaceId, user, 'admin');
    validateSemantic(entityType, input.semantic);
    const [max] = await this.database.db.select({ value: sql<number>`coalesce(max(${workflowStates.position}), -1)` }).from(workflowStates).where(and(eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, entityType)));
    const [state] = await this.database.db.insert(workflowStates).values({
      workspaceId, entityType, name: input.name, color: input.color, position: input.position ?? (max?.value ?? -1) + 1,
      isInitial: input.isInitial,
      taskSemantic: entityType === 'task' ? input.semantic as any : null,
      flowSemantic: entityType === 'flow' ? input.semantic as any : null,
    }).returning();
    if (input.isInitial) await this.database.db.update(workflowStates).set({ isInitial: false }).where(and(eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, entityType), sql`${workflowStates.id} <> ${state!.id}`));
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'workflow_state', subjectId: state!.id, action: 'created', actor: user, after: { name: state!.name, semantic: input.semantic } });
    return state;
  }

  async updateWorkflowState(workspaceId: string, user: AuthUser, stateId: string, version: number, input: Partial<Pick<z.infer<typeof workflowInput>, 'name' | 'color' | 'position' | 'isInitial'>>) {
    await this.requireMembership(workspaceId, user, 'admin');
    return this.database.db.transaction(async (tx) => {
      const [before] = await tx.select().from(workflowStates).where(and(eq(workflowStates.id, stateId), eq(workflowStates.workspaceId, workspaceId))).limit(1);
      if (!before) throw new NotFoundException('Workflow state not found.');
      if (before.version !== version) throw new PreconditionFailedException({ title: 'Workflow state was updated elsewhere', current: before });
      const values = { ...input };
      if (input.position !== undefined && input.position !== before.position) {
        const [maximum] = await tx.select({ value: sql<number>`coalesce(max(${workflowStates.position}), 0)` }).from(workflowStates)
          .where(and(eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, before.entityType), isNull(workflowStates.archivedAt)));
        const position = Math.max(0, Math.min(input.position, maximum?.value ?? 0));
        if (position < before.position) {
          await tx.update(workflowStates).set({ position: sql`${workflowStates.position} + 1`, updatedAt: new Date() })
            .where(and(eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, before.entityType), isNull(workflowStates.archivedAt), sql`${workflowStates.id} <> ${stateId}`, sql`${workflowStates.position} >= ${position}`, sql`${workflowStates.position} < ${before.position}`));
        } else {
          await tx.update(workflowStates).set({ position: sql`${workflowStates.position} - 1`, updatedAt: new Date() })
            .where(and(eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, before.entityType), isNull(workflowStates.archivedAt), sql`${workflowStates.id} <> ${stateId}`, sql`${workflowStates.position} > ${before.position}`, sql`${workflowStates.position} <= ${position}`));
        }
        values.position = position;
      }
      const [state] = await tx.update(workflowStates).set({ ...values, version: sql`${workflowStates.version} + 1`, updatedAt: new Date() }).where(and(eq(workflowStates.id, stateId), eq(workflowStates.version, version))).returning();
      if (!state) throw new PreconditionFailedException({ title: 'Workflow state was updated elsewhere', current: before });
      if (input.isInitial) await tx.update(workflowStates).set({ isInitial: false }).where(and(eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, state.entityType), sql`${workflowStates.id} <> ${state.id}`));
      await this.activity.append(tx, { workspaceId, subjectType: 'workflow_state', subjectId: stateId, action: 'updated', actor: user, before: pick(before, input), after: pick(state, input) });
      return state;
    });
  }

  async archiveWorkflowState(workspaceId: string, user: AuthUser, stateId: string, version: number, replacementStateId: string) {
    await this.requireMembership(workspaceId, user, 'admin');
    return this.database.db.transaction(async (tx) => {
      const [state] = await tx.select().from(workflowStates).where(and(eq(workflowStates.id, stateId), eq(workflowStates.workspaceId, workspaceId))).limit(1);
      const [replacement] = await tx.select().from(workflowStates).where(and(eq(workflowStates.id, replacementStateId), eq(workflowStates.workspaceId, workspaceId))).limit(1);
      if (!state || !replacement || state.archivedAt || replacement.archivedAt || replacement.id === state.id || replacement.entityType !== state.entityType) throw new BadRequestException('An active replacement state of the same entity type is required.');
      if (state.version !== version) throw new PreconditionFailedException('Workflow state was updated elsewhere.');
      const table = state.entityType === 'task' ? (await import('../db/schema')).tasks : (await import('../db/schema')).flows;
      await (tx as any).update(table).set({ workflowStateId: replacement.id, updatedAt: new Date(), version: sql`${table.version} + 1` }).where(and(eq(table.workspaceId, workspaceId), eq(table.workflowStateId, state.id)));
      const [archived] = await tx.update(workflowStates).set({ archivedAt: new Date(), isInitial: false, version: sql`${workflowStates.version} + 1`, updatedAt: new Date() }).where(eq(workflowStates.id, state.id)).returning();
      await this.activity.append(tx, { workspaceId, subjectType: 'workflow_state', subjectId: state.id, action: 'archived_and_reassigned', actor: user, metadata: { replacementStateId } });
      return archived;
    });
  }
}

export function requireVersion(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new HttpException('If-Match is required for this mutation.', 428);
  const value = Number(raw.replaceAll('"', ''));
  if (!Number.isInteger(value) || value < 1) throw new BadRequestException('If-Match must contain a positive record version.');
  return value;
}

function validateSemantic(entityType: 'task' | 'flow', semantic: string): void {
  const task = ['inbox', 'planned', 'ready', 'in_progress', 'human_review', 'blocked', 'done', 'cancelled'];
  const flow = ['proposed', 'active', 'paused', 'converged', 'closed'];
  if (!(entityType === 'task' ? task : flow).includes(semantic)) throw new BadRequestException('The semantic category is not valid for this workflow type.');
}

function pick(record: Record<string, unknown>, requested: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(requested).map((key) => [key, record[key]]));
}
