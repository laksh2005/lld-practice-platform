import path from "path";
import { randomUUID } from "crypto";
import express, { Request, Response } from "express";
import Database from "better-sqlite3";
import { SqliteProblemRepository, SqliteAttemptRepository } from "./domain/repository";
import { RuleBasedEvaluator, LLMEvaluator, CompositeEvaluator, Evaluator } from "./domain/evaluator";
import { SubmissionContent } from "./domain/models";
import { seedProblems } from "./seed/problems";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");

const db = new Database(DB_PATH);
const problemRepo = new SqliteProblemRepository(db, seedProblems);
const attemptRepo = new SqliteAttemptRepository(db, problemRepo);

const ruleEvaluator = new RuleBasedEvaluator();
const llmEvaluator: Evaluator | undefined = process.env.GEMINI_API_KEY
  ? new LLMEvaluator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || "gemini-2.5-flash")
  : undefined;
const evaluator = new CompositeEvaluator(ruleEvaluator, llmEvaluator);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// --- Problems -----------------------------------------------------------

app.get("/api/problems", (_req: Request, res: Response) => {
  res.json(problemRepo.all());
});

app.get("/api/problems/:id", (req: Request, res: Response) => {
  const problem = problemRepo.byId(req.params.id);
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  res.json(problem);
});

// --- Attempts -------------------------------------------------------------

app.post("/api/problems/:id/attempts", (req: Request, res: Response) => {
  const problem = problemRepo.byId(req.params.id);
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  const attempt = attemptRepo.create(problem.id);
  res.status(201).json(attempt);
});

app.get("/api/attempts/:id", (req: Request, res: Response) => {
  const attempt = attemptRepo.byId(req.params.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  res.json(attempt);
});

// --- Submissions ------------------------------------------------------------

app.post("/api/attempts/:id/submissions", async (req: Request, res: Response) => {
  const attempt = attemptRepo.byId(req.params.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });

  const content = req.body as SubmissionContent;
  if (!content || (content.kind !== "text" && content.kind !== "code") || !content.writeup?.trim()) {
    return res.status(400).json({ error: "Submission must include a non-empty writeup and a valid kind" });
  }

  const submission = attemptRepo.addSubmission(attempt.id, content);
  await runEvaluation(attempt.problemId, submission.id);

  const refreshed = attemptRepo.submissionById(submission.id);
  res.status(201).json(refreshed?.submission);
});

app.post("/api/submissions/:id/retry", async (req: Request, res: Response) => {
  const found = attemptRepo.submissionById(req.params.id);
  if (!found) return res.status(404).json({ error: "Submission not found" });
  if (found.submission.status !== "failed") {
    return res.status(400).json({ error: "Only failed submissions can be retried" });
  }
  await runEvaluation(found.problemId, req.params.id);
  const refreshed = attemptRepo.submissionById(req.params.id);
  res.json(refreshed?.submission);
});

async function runEvaluation(problemId: string, submissionId: string) {
  const problem = problemRepo.byId(problemId)!;
  attemptRepo.updateSubmissionStatus(submissionId, "evaluating");
  const found = attemptRepo.submissionById(submissionId)!;

  try {
    const partial = await evaluator.evaluate(problem, found.submission);
    attemptRepo.attachEvaluation(submissionId, {
      id: randomUUID(),
      submissionId,
      evaluatedAt: new Date().toISOString(),
      ...partial,
    });
    attemptRepo.setAttemptStatus(found.attemptId, "completed");
  } catch (err) {
    attemptRepo.updateSubmissionStatus(submissionId, "failed", (err as Error).message);
  }
}

// --- History -----------------------------------------------------------

app.get("/api/history", (_req: Request, res: Response) => {
  res.json(attemptRepo.allHistory());
});

app.get("/api/problems/:id/history", (req: Request, res: Response) => {
  res.json(attemptRepo.historyForProblem(req.params.id));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LLD Practice Platform listening on http://localhost:${PORT}`);
    console.log(llmEvaluator ? "LLM evaluation: enabled" : "LLM evaluation: disabled, no GEMINI_API_KEY set. Rule-based feedback only.");
  });
}

export { app };
