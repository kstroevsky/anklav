import { describe, expect, it } from 'vitest';
import { MCP_TOOL_NAMES, warningsMatch } from '../src/mcp';
import { isAllowedRedirectUri } from '../src/oauth';

describe('MCP public contract', () => {
  it('exposes only core work operations', () => {
    expect(MCP_TOOL_NAMES).toContain('get_workspace_context');
    expect(MCP_TOOL_NAMES).toContain('preview_transition');
    expect(MCP_TOOL_NAMES).not.toContain('update_review');
    expect(MCP_TOOL_NAMES).toContain('get_task_context_pack');
    expect(MCP_TOOL_NAMES).toContain('list_milestones');
    expect(MCP_TOOL_NAMES).toContain('start_run');
    expect(MCP_TOOL_NAMES).toContain('create_run_checkpoint');
    expect(MCP_TOOL_NAMES.every((name) => !/(delete_|restore|workspace|member|workflow|account)/.test(name) || ['list_workspaces', 'get_workspace_context'].includes(name))).toBe(true);
  });

  it('requires the exact warning list before a transition proceeds', () => {
    expect(warningsMatch(['Missing acceptance criteria.', 'Needs verification.'], ['Missing acceptance criteria.', 'Needs verification.'])).toBe(true);
    expect(warningsMatch(['Missing acceptance criteria.'], [])).toBe(false);
    expect(warningsMatch(['A', 'B'], ['B', 'A'])).toBe(false);
  });
});

describe('OAuth dynamic client registration redirects', () => {
  it('allows HTTPS and loopback HTTP only', () => {
    expect(isAllowedRedirectUri('https://client.example/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:4567/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://client.example/callback')).toBe(false);
    expect(isAllowedRedirectUri('https://client.example/callback#token')).toBe(false);
    expect(isAllowedRedirectUri('https://user@client.example/callback')).toBe(false);
  });
});
