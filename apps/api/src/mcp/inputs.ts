import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const id = z.string().uuid();
export const version = z.number().int().positive();
export const workspaceId = z.object({ workspaceId: id });
export const page = z.object({ cursor: z.string().min(1).max(500).optional(), limit: z.number().int().min(1).max(100).optional() });
export const anyOutput = z.object({ result: z.unknown() });

export const MCP_TOOL_NAMES = [
  'list_workspaces', 'get_workspace_context', 'search_work', 'list_projects', 'get_project', 'list_flows', 'get_flow', 'list_tasks', 'get_task', 'get_activity', 'preview_transition',
  'list_milestones', 'get_milestone', 'get_task_context_pack',
  'create_project', 'update_project', 'create_flow', 'update_flow', 'create_task', 'update_task',
  'add_comment', 'update_comment', 'create_label', 'update_label', 'assign_label', 'unassign_label',
  'add_checklist_item', 'update_checklist_item', 'add_convergence_criterion', 'update_convergence_criterion', 'create_relation', 'unlink_relation',
] as const;

export const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const UNLINK: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };


