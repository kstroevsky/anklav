import { z } from 'zod';

export const stateInput = z.object({ organizationLogin: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9-]+$/) });
export const mappingInput = z.object({
  repositoryId: z.string().uuid(), projectId: z.string().uuid(), syncMode: z.enum(['none', 'inbound', 'bidirectional']).default('none'),
  defaultInbound: z.boolean().default(false), defaultOutbound: z.boolean().default(false), openStateId: z.string().uuid().nullable().optional(), closedStateId: z.string().uuid().nullable().optional(),
});
export const issueInput = z.object({ repositoryId: z.string().uuid(), syncMode: z.enum(['manual', 'inbound', 'bidirectional']).default('manual') });
export const reviewInput = z.object({ event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']), body: z.string().max(65_000).optional().default(''), comments: z.array(z.object({ path: z.string().min(1), line: z.number().int().positive(), side: z.enum(['LEFT', 'RIGHT']), body: z.string().min(1).max(65_000) })).max(100).default([]) });
export const mergeInput = z.object({ method: z.enum(['merge', 'squash', 'rebase']).default('squash'), commitTitle: z.string().max(300).optional(), commitMessage: z.string().max(65_000).optional() });
export const pullRequestCommentInput = z.object({ body: z.string().trim().min(1).max(65_000), path: z.string().min(1).optional(), line: z.number().int().positive().optional(), side: z.enum(['LEFT', 'RIGHT']).optional() });

export type GitHubCredentials = { appId: number; clientId: string; clientSecret: string; privateKey: string; webhookSecret: string };
export type GitHubPayload = Record<string, any>;


