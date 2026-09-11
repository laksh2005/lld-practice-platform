import {
  Problem,
  Submission,
  SubmissionContent,
  EvaluationResult,
  RubricScore,
  RubricDimension,
  EvaluationSource,
} from "./models";

/**
 * Every evaluator takes a Problem and a Submission and returns the same shape of result.
 * This lets us:
 *  - run rule-based checks on every submission, fast and for free,
 *  - call an LLM only where real judgement is needed,
 *  - add or swap evaluators later without touching Attempt, Submission, or the routes.
 */
export interface Evaluator {
  readonly source: EvaluationSource;
  evaluate(problem: Problem, submission: Submission): Promise<Omit<EvaluationResult, "id" | "submissionId" | "evaluatedAt">>;
}

function textOf(content: SubmissionContent): string {
  return content.kind === "code" ? `${content.writeup}\n\n${content.code}` : content.writeup;
}

/**
 * Deterministic checks. These are cheap, instant, and give the same score every time for the
 * same input. They cover the parts of grading that do not need judgement: did the write-up
 * mention the stated requirements, is there any real structure (classes, interfaces), is it
 * long enough to be a real attempt, are the problem's core entities present.
 *
 * This evaluator does not try to judge design quality or trade-offs. That needs the LLM.
 */
export class RuleBasedEvaluator implements Evaluator {
  readonly source: EvaluationSource = "rule";

  async evaluate(problem: Problem, submission: Submission) {
    const text = textOf(submission.content).toLowerCase();
    const scores: RubricScore[] = [];

    // requirements_coverage: how many stated requirements have their key terms in the text
    const coveredRequirements = problem.requirements.filter((req) =>
      keyTerms(req).some((term) => text.includes(term))
    );
    const coverageRatio = problem.requirements.length
      ? coveredRequirements.length / problem.requirements.length
      : 1;
    scores.push({
      dimension: "requirements_coverage",
      score: round(coverageRatio * 5),
      feedback:
        coveredRequirements.length === problem.requirements.length
          ? "Every stated requirement is referenced somewhere in your write-up or code."
          : `${coveredRequirements.length}/${problem.requirements.length} requirements are clearly referenced. Missing: ${problem.requirements
              .filter((r) => !coveredRequirements.includes(r))
              .join("; ")}`,
      source: "rule",
    });

    // class_responsibility: a rough structural signal, presence of class or interface words
    const structureHits = countMatches(text, [
      "class ",
      "interface ",
      "responsibility",
      "responsible for",
      "abstract",
      "extends",
      "implements",
    ]);
    scores.push({
      dimension: "class_responsibility",
      score: clamp(structureHits, 0, 5),
      feedback:
        structureHits > 0
          ? "Design vocabulary (classes, interfaces, responsibilities) is present."
          : "No explicit classes, interfaces, or stated responsibilities were found. Name your abstractions directly.",
      source: "rule",
    });

    // relationships: look for relationship vocabulary
    const relationshipHits = countMatches(text, [
      "has-a",
      "has a",
      "is-a",
      "is a",
      "composition",
      "aggregation",
      "inherit",
      "association",
      "one-to-many",
      "many-to-many",
    ]);
    scores.push({
      dimension: "relationships",
      score: clamp(relationshipHits, 0, 5),
      feedback:
        relationshipHits > 0
          ? "You described relationships between entities, like composition, inheritance, or association."
          : "No relationship terms found. State how your classes relate, and their cardinality.",
      source: "rule",
    });

    // expected entities are a weak signal, not a gate
    const entityHits = problem.expectedEntities.filter((e) => text.includes(e.toLowerCase()));
    scores.push({
      dimension: "clarity",
      score: clamp(Math.round((text.length > 200 ? 2 : 1) + entityHits.length * 0.5), 0, 5),
      feedback:
        text.length > 200
          ? `Write-up has enough detail to review (${entityHits.length}/${problem.expectedEntities.length} expected domain terms present).`
          : "Write-up is short. Add more detail on your class design and reasoning.",
      source: "rule",
    });

    // extensibility needs judgement, so the rule-based evaluator leaves it to the LLM.

    return {
      overallScore: round(average(scores.map((s) => s.score))),
      scores,
      strengths: coveredRequirements.length > 0 ? ["Addresses the stated requirements"] : [],
      improvements: structureHits === 0 ? ["Name explicit classes and interfaces, and their responsibilities"] : [],
      source: "rule" as EvaluationSource,
    };
  }
}

/**
 * LLM-backed evaluator for the two dimensions that need judgement, not pattern matching:
 * whether the chosen abstractions are good ones, and whether the design would survive a
 * plausible follow-up requirement.
 *
 * Calls the Gemini API directly over HTTPS, no SDK needed. Requires GEMINI_API_KEY. If it is
 * not set, `CompositeEvaluator` falls back to rule-only feedback instead of failing the whole
 * submission.
 */
export class LLMEvaluator implements Evaluator {
  readonly source: EvaluationSource = "llm";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = "gemini-2.5-flash",
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async evaluate(problem: Problem, submission: Submission) {
    const prompt = buildPrompt(problem, submission.content);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM evaluation failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const textBlock = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = parseLLMJson(textBlock);

    const scores: RubricScore[] = (parsed.scores ?? []).map((s: any) => ({
      dimension: s.dimension as RubricDimension,
      score: clamp(Number(s.score) || 0, 0, 5),
      feedback: String(s.feedback ?? ""),
      source: "llm" as EvaluationSource,
    }));

    return {
      overallScore: round(average(scores.map((s) => s.score))),
      scores,
      strengths: parsed.strengths ?? [],
      improvements: parsed.improvements ?? [],
      source: "llm" as EvaluationSource,
    };
  }
}

function buildPrompt(problem: Problem, content: SubmissionContent): string {
  const submissionText =
    content.kind === "code"
      ? `Write-up:\n${content.writeup}\n\nCode (${content.language}):\n${content.code}`
      : `Write-up:\n${content.writeup}`;

  return `You are reviewing a learner's Low-Level Design (LLD) solution. There is more than one valid design here. Do not penalize a reasonable design just because it differs from what you would have written.

Problem: ${problem.title}
Summary: ${problem.summary}
Requirements:
${problem.requirements.map((r) => `- ${r}`).join("\n")}

A plausible follow-up requirement to check extensibility against: ${problem.extensionHint}

Learner's submission:
${submissionText}

Score only these two dimensions. Deterministic checks already cover requirement coverage and basic structure.
1. "extensibility": would this design handle the follow-up requirement above without a rewrite?
2. "relationships": are the relationships between entities sound and well justified, not just present?

Reply with only valid JSON, no markdown fences, no text outside the JSON, in this exact shape:
{"scores":[{"dimension":"extensibility","score":0-5,"feedback":"..."},{"dimension":"relationships","score":0-5,"feedback":"..."}],"strengths":["..."],"improvements":["..."]}`;
}

function parseLLMJson(text: string): any {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return { scores: [], strengths: [], improvements: [`Could not parse model output: ${cleaned.slice(0, 200)}`] };
  }
}

/**
 * Combines RuleBasedEvaluator (fast, always runs) with LLMEvaluator (judgement dimensions
 * only). If the LLM call fails or is not set up, this still returns a usable result built
 * from the rule-based pass alone. Evaluation degrades gracefully instead of blocking the
 * learner, and the caller is told which source produced the result.
 */
export class CompositeEvaluator implements Evaluator {
  readonly source: EvaluationSource = "hybrid";

  constructor(private readonly ruleEvaluator: Evaluator, private readonly llmEvaluator?: Evaluator) {}

  async evaluate(problem: Problem, submission: Submission) {
    const ruleResult = await this.ruleEvaluator.evaluate(problem, submission);

    if (!this.llmEvaluator) {
      return { ...ruleResult, source: "rule" as EvaluationSource };
    }

    try {
      const llmResult = await this.llmEvaluator.evaluate(problem, submission);
      const scores = [...ruleResult.scores, ...llmResult.scores];
      return {
        overallScore: round(average(scores.map((s) => s.score))),
        scores,
        strengths: [...ruleResult.strengths, ...llmResult.strengths],
        improvements: [...ruleResult.improvements, ...llmResult.improvements],
        source: "hybrid" as EvaluationSource,
      };
    } catch (err) {
      // Rule-based feedback still ships even when the LLM call fails or times out.
      return {
        ...ruleResult,
        source: "rule" as EvaluationSource,
        improvements: [...ruleResult.improvements, `(LLM feedback unavailable: ${(err as Error).message})`],
      };
    }
  }
}

// --- small helpers -----------------------------------------------------

function keyTerms(requirement: string): string[] {
  return requirement
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4);
}

function countMatches(text: string, needles: string[]): number {
  return needles.reduce((acc, n) => acc + (text.includes(n) ? 1 : 0), 0);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function average(nums: number[]): number {
  const valid = nums.filter((n) => !Number.isNaN(n));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}
