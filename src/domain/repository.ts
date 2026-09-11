import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  Problem,
  Attempt,
  Submission,
  SubmissionContent,
  EvaluationResult,
  AttemptSummary,
  AttemptStatus,
  SubmissionStatus,
} from "./models";

/**
 * Repository interfaces are kept separate from the SQLite implementation so storage can be
 * swapped later, for example Mongo or Postgres for multi-user scale, without touching routes
 * or evaluators. Both only depend on these interfaces.
 */
export interface ProblemRepository {
  all(): Problem[];
  byId(id: string): Problem | undefined;
}

export interface AttemptRepository {
  create(problemId: string): Attempt;
  byId(id: string): Attempt | undefined;
  addSubmission(attemptId: string, content: SubmissionContent): Submission;
  updateSubmissionStatus(submissionId: string, status: SubmissionStatus, error?: string): void;
  attachEvaluation(submissionId: string, evaluation: EvaluationResult): void;
  setAttemptStatus(attemptId: string, status: AttemptStatus): void;
  submissionById(submissionId: string): { submission: Submission; attemptId: string; problemId: string } | undefined;
  historyForProblem(problemId: string): AttemptSummary[];
  allHistory(): AttemptSummary[];
}

export class SqliteProblemRepository implements ProblemRepository {
  constructor(private readonly db: Database.Database, private readonly seed: Problem[]) {
    this.migrate();
    this.ensureSeeded();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS problems (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
  }

  private ensureSeeded() {
    const count = (this.db.prepare("SELECT COUNT(*) as c FROM problems").get() as { c: number }).c;
    if (count > 0) return;
    const insert = this.db.prepare("INSERT INTO problems (id, data) VALUES (?, ?)");
    const tx = this.db.transaction((problems: Problem[]) => {
      for (const p of problems) insert.run(p.id, JSON.stringify(p));
    });
    tx(this.seed);
  }

  all(): Problem[] {
    const rows = this.db.prepare("SELECT data FROM problems").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data));
  }

  byId(id: string): Problem | undefined {
    const row = this.db.prepare("SELECT data FROM problems WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
}

export class SqliteAttemptRepository implements AttemptRepository {
  constructor(private readonly db: Database.Database, private readonly problems: ProblemRepository) {
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        problem_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        evaluation TEXT,
        error TEXT
      );
    `);
  }

  create(problemId: string): Attempt {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare("INSERT INTO attempts (id, problem_id, status, created_at) VALUES (?, ?, 'in_progress', ?)").run(
      id,
      problemId,
      createdAt
    );
    return { id, problemId, status: "in_progress", createdAt, submissions: [] };
  }

  byId(id: string): Attempt | undefined {
    const row = this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    const submissions = this.submissionsFor(id);
    return {
      id: row.id,
      problemId: row.problem_id,
      status: row.status,
      createdAt: row.created_at,
      submissions,
    };
  }

  private submissionsFor(attemptId: string): Submission[] {
    const rows = this.db
      .prepare("SELECT * FROM submissions WHERE attempt_id = ? ORDER BY created_at ASC")
      .all(attemptId) as any[];
    return rows.map(rowToSubmission);
  }

  addSubmission(attemptId: string, content: SubmissionContent): Submission {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO submissions (id, attempt_id, content, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(id, attemptId, JSON.stringify(content), createdAt);
    this.db.prepare("UPDATE attempts SET status = 'submitted' WHERE id = ?").run(attemptId);
    return { id, attemptId, content, status: "pending", createdAt };
  }

  updateSubmissionStatus(submissionId: string, status: SubmissionStatus, error?: string): void {
    this.db.prepare("UPDATE submissions SET status = ?, error = ? WHERE id = ?").run(status, error ?? null, submissionId);
  }

  attachEvaluation(submissionId: string, evaluation: EvaluationResult): void {
    this.db
      .prepare("UPDATE submissions SET evaluation = ?, status = 'evaluated', error = NULL WHERE id = ?")
      .run(JSON.stringify(evaluation), submissionId);
  }

  setAttemptStatus(attemptId: string, status: AttemptStatus): void {
    this.db.prepare("UPDATE attempts SET status = ? WHERE id = ?").run(status, attemptId);
  }

  submissionById(submissionId: string) {
    const row = this.db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as any;
    if (!row) return undefined;
    const attempt = this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(row.attempt_id) as any;
    return { submission: rowToSubmission(row), attemptId: row.attempt_id, problemId: attempt.problem_id };
  }

  historyForProblem(problemId: string): AttemptSummary[] {
    return this.allHistory().filter((h) => h.problemId === problemId);
  }

  allHistory(): AttemptSummary[] {
    const attempts = this.db
      .prepare("SELECT * FROM attempts ORDER BY created_at DESC")
      .all() as any[];
    return attempts.map((a) => {
      const submissions = this.submissionsFor(a.id);
      const evaluated = submissions.filter((s) => s.evaluation);
      const latest = evaluated[evaluated.length - 1];
      const problem = this.problems.byId(a.problem_id);
      return {
        attemptId: a.id,
        problemId: a.problem_id,
        problemTitle: problem?.title ?? "Unknown problem",
        status: a.status,
        createdAt: a.created_at,
        latestScore: latest?.evaluation?.overallScore ?? null,
        submissionCount: submissions.length,
      };
    });
  }
}

function rowToSubmission(row: any): Submission {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    content: JSON.parse(row.content),
    status: row.status,
    createdAt: row.created_at,
    evaluation: row.evaluation ? JSON.parse(row.evaluation) : undefined,
    error: row.error ?? undefined,
  };
}
