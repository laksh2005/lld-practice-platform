/**
 * Domain models for the LLD Practice Platform.
 *
 * See docs/DESIGN.md for the full reasoning. Short version:
 * - `Problem` is static reference content: a prompt plus a rubric the evaluators check against.
 * - `Attempt` is one learner's session against one Problem. A learner can attempt the same
 *   problem many times. That is what makes this a practice tool, not a one-shot quiz.
 * - `Submission` is one piece of work handed in during an attempt. Its content is a
 *   discriminated union (`SubmissionContent`) so a new format, like a diagram, can be added
 *   later without touching Attempt, Evaluator, or storage.
 * - `EvaluationResult` is the output of judging a Submission. It has the same shape no matter
 *   which evaluator produced it. That is what lets a `CompositeEvaluator` merge results.
 */

export type Difficulty = "easy" | "medium" | "hard";

/** A rubric dimension every evaluator, rule-based or LLM, reports a score against. */
export type RubricDimension =
  | "requirements_coverage" // did the design address the stated requirements?
  | "class_responsibility" // are responsibilities clearly separated?
  | "relationships" // composition, aggregation, and inheritance used sensibly?
  | "extensibility" // could this design handle a plausible follow-up requirement?
  | "clarity"; // is the write-up or code clear and easy to follow?

export interface Problem {
  id: string;
  title: string;
  difficulty: Difficulty;
  summary: string;
  /** The requirements a good design must address. Used directly by the rule-based evaluator. */
  requirements: string[];
  /**
   * Domain nouns and verbs a good design should mention, like "Elevator" or "Scheduler."
   * This is not a strict checklist. There is more than one valid design, so this is only
   * used as a weak signal, not a pass or fail gate.
   */
  expectedEntities: string[];
  /** A short hint at a follow-up requirement, used to check extensibility. */
  extensionHint: string;
}

/** A discriminated union so new submission formats can be added without breaking old code. */
export type SubmissionContent =
  | { kind: "text"; writeup: string }
  | { kind: "code"; writeup: string; code: string; language: string };

export type EvaluationSource = "rule" | "llm" | "hybrid";

export interface RubricScore {
  dimension: RubricDimension;
  score: number; // 0 to 5
  feedback: string;
  source: EvaluationSource;
}

export interface EvaluationResult {
  id: string;
  submissionId: string;
  overallScore: number; // 0 to 5, weighted average of RubricScore.score
  scores: RubricScore[];
  strengths: string[];
  improvements: string[];
  source: EvaluationSource;
  evaluatedAt: string; // ISO timestamp
}

export type SubmissionStatus =
  | "pending" // just created, evaluation not started yet
  | "evaluating" // evaluation in progress
  | "evaluated" // evaluation finished
  | "failed"; // evaluation failed, can be retried

export interface Submission {
  id: string;
  attemptId: string;
  content: SubmissionContent;
  status: SubmissionStatus;
  createdAt: string;
  evaluation?: EvaluationResult;
  error?: string;
}

export type AttemptStatus = "in_progress" | "submitted" | "completed";

export interface Attempt {
  id: string;
  problemId: string;
  status: AttemptStatus;
  createdAt: string;
  submissions: Submission[];
}

/** A summary row for the History screen: one attempt plus its latest score. */
export interface AttemptSummary {
  attemptId: string;
  problemId: string;
  problemTitle: string;
  status: AttemptStatus;
  createdAt: string;
  latestScore: number | null;
  submissionCount: number;
}
