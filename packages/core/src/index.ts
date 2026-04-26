// shared types — the entire interface between orchestrator, wall, plugin, bench

export type SessionId = string;
export type AgentId =
  | 'scheduler'
  | 'indexer'
  | 'builder'
  | 'debugger'
  | 'designer';

export type Event =
  | { t: 'session.start';   sid: SessionId; from: string; subject: string; body: string; ts: number }
  | { t: 'place.reset';     sid: SessionId }
  | { t: 'agent.thinking';  sid: SessionId; agent: AgentId; tokens: string }
  | { t: 'agent.tool_call'; sid: SessionId; agent: AgentId; tool: string; args: unknown }
  | { t: 'agent.result';    sid: SessionId; agent: AgentId; ok: boolean; summary: string }
  | { t: 'patch.applied';   sid: SessionId; lines: number; files: string[] }
  | { t: 'studio.error';    sid: SessionId; trace: string }
  | { t: 'critique';        sid: SessionId; text: string; patch_lines: number }
  | { t: 'session.end';     sid: SessionId; ok: boolean; share_url?: string; iters: number; ms: number }
  | { t: 'nia.indexed';     sid: SessionId; title: string; source_id: string; gist_url?: string };

export interface Job {
  sid: SessionId;
  from: string;
  subject: string;
  body: string;
  receivedAt: number;
}

export interface BenchRow {
  prompt: string;
  ours: { score: number; ms: number; ok: boolean };
  opus: { score: number; ms: number; ok: boolean };
  winner: 'ours' | 'opus' | 'tie';
}
