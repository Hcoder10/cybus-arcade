import { Database } from "bun:sqlite";
import type { Event, SessionId, Job } from "../../core/src/index.ts";

const path = process.env.DB_PATH ?? "cybus.sqlite";
export const db = new Database(path);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY, sender TEXT, subject TEXT, body TEXT,
  started_at INTEGER, ended_at INTEGER, ok INTEGER, share_url TEXT
);
CREATE TABLE IF NOT EXISTS events (
  sid TEXT, t TEXT, agent TEXT, payload TEXT, ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_sid ON events(sid);
CREATE TABLE IF NOT EXISTS queue (
  sid TEXT PRIMARY KEY, sender TEXT, subject TEXT, body TEXT, received_at INTEGER, status TEXT
);
`);

const stmts = {
  insertJob: db.prepare(`INSERT OR IGNORE INTO queue(sid,sender,subject,body,received_at,status) VALUES (?,?,?,?,?, 'pending')`),
  pullJob:   db.prepare(`UPDATE queue SET status='running' WHERE sid=(SELECT sid FROM queue WHERE status='pending' ORDER BY received_at LIMIT 1) RETURNING *`),
  finishJob: db.prepare(`UPDATE queue SET status='done' WHERE sid=?`),
  insertEvent: db.prepare(`INSERT INTO events(sid,t,agent,payload,ts) VALUES (?,?,?,?,?)`),
  startSession: db.prepare(`INSERT OR IGNORE INTO sessions(sid,sender,subject,body,started_at) VALUES (?,?,?,?,?)`),
  endSession: db.prepare(`UPDATE sessions SET ended_at=?, ok=?, share_url=? WHERE sid=?`),
  listEvents: db.prepare(`SELECT * FROM events WHERE sid=? ORDER BY ts ASC`),
};

export function enqueue(j: Job) {
  stmts.insertJob.run(j.sid, j.from, j.subject, j.body, j.receivedAt);
}

export function pullPending(): Job | null {
  const r = stmts.pullJob.get() as any;
  if (!r) return null;
  return { sid: r.sid, from: r.sender, subject: r.subject, body: r.body, receivedAt: r.received_at };
}

export function finishJob(sid: SessionId) { stmts.finishJob.run(sid); }

export function recordEvent(e: Event) {
  const agent = "agent" in e ? (e as any).agent : null;
  stmts.insertEvent.run((e as any).sid, e.t, agent, JSON.stringify(e), Date.now());
  if (e.t === "session.start") {
    stmts.startSession.run(e.sid, e.from, e.subject, e.body, e.ts);
  } else if (e.t === "session.end") {
    stmts.endSession.run(Date.now(), e.ok ? 1 : 0, e.share_url ?? null, e.sid);
  }
}
