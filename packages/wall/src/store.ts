import { signal, computed } from "@preact/signals";
import type { Event, AgentId, SessionId } from "../../core/src/index.ts";

export interface ThreadState {
  agent: AgentId;
  active: boolean;
  body: string;
  done: boolean;
}

export interface SessionView {
  sid: SessionId;
  from: string;
  subject: string;
  body: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  shareUrl?: string;
  threads: Record<AgentId, ThreadState>;
}

const blankThreads = (): Record<AgentId, ThreadState> => ({
  scheduler: { agent: "scheduler", active: false, body: "", done: false },
  indexer: { agent: "indexer", active: false, body: "", done: false },
  builder: { agent: "builder", active: false, body: "", done: false },
  debugger: { agent: "debugger", active: false, body: "", done: false },
  designer: { agent: "designer", active: false, body: "", done: false },
});

export const currentSession = signal<SessionView | null>(null);
export const completed = signal<SessionView[]>([]);
export const benchScore = signal<{ ours: number; opus: number; tie: number }>({ ours: 0, opus: 0, tie: 0 });

export const completedSorted = computed(() => [...completed.value].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)));

function ensureCurrent(sid: SessionId, init?: Partial<SessionView>): SessionView {
  if (currentSession.value?.sid === sid) return currentSession.value;
  const fresh: SessionView = {
    sid,
    from: init?.from ?? "",
    subject: init?.subject ?? "(building)",
    body: init?.body ?? "",
    startedAt: init?.startedAt ?? Date.now(),
    threads: blankThreads(),
  };
  currentSession.value = fresh;
  return fresh;
}

function activate(s: SessionView, agent: AgentId, body: string) {
  for (const k of Object.keys(s.threads) as AgentId[]) s.threads[k].active = false;
  s.threads[agent] = { agent, active: true, body, done: false };
  currentSession.value = { ...s };
}

export function applyEvent(e: Event) {
  if (e.t === "session.start") {
    ensureCurrent(e.sid, { from: e.from, subject: e.subject, body: e.body, startedAt: e.ts });
    return;
  }

  if (e.t === "session.end") {
    const cur = currentSession.value;
    if (!cur || cur.sid !== e.sid) return;
    cur.endedAt = Date.now();
    cur.ok = e.ok;
    cur.shareUrl = e.share_url;
    completed.value = [...completed.value, cur];
    currentSession.value = null;
    return;
  }

  const s = ensureCurrent(e.sid);
  if (e.t === "place.reset") {
    activate(s, "scheduler", "baseplate restored");
  } else if (e.t === "agent.thinking") {
    activate(s, e.agent, e.tokens);
  } else if (e.t === "agent.tool_call") {
    activate(s, e.agent, `tool: ${e.tool}(${JSON.stringify(e.args).slice(0, 60)})`);
  } else if (e.t === "agent.result") {
    s.threads[e.agent] = { agent: e.agent, active: false, done: true, body: (e.ok ? "ok: " : "fail: ") + e.summary };
    currentSession.value = { ...s };
  } else if (e.t === "patch.applied") {
    s.threads.builder = { agent: "builder", active: false, done: true, body: `patched ${e.lines} ops` };
    currentSession.value = { ...s };
  } else if (e.t === "studio.error") {
    s.threads.debugger = { agent: "debugger", active: true, done: false, body: `error: ${e.trace.slice(0, 80)}` };
    currentSession.value = { ...s };
  } else if (e.t === "critique") {
    s.threads.designer = { agent: "designer", active: false, done: true, body: e.text.slice(0, 100) };
    currentSession.value = { ...s };
  }
}
