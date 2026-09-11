import { RuleBasedEvaluator, CompositeEvaluator, Evaluator } from "../src/domain/evaluator";
import { Problem, Submission, EvaluationSource } from "../src/domain/models";

const problem: Problem = {
  id: "parking-lot",
  title: "Parking Lot",
  difficulty: "easy",
  summary: "Design a parking lot.",
  requirements: [
    "Support at least two vehicle types with different space needs",
    "Assign the smallest spot that fits a vehicle",
    "Compute a parking fee based on duration",
  ],
  expectedEntities: ["vehicle", "spot", "ticket"],
  extensionHint: "Add reserved/EV spots.",
};

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "sub-1",
    attemptId: "att-1",
    status: "pending",
    createdAt: new Date().toISOString(),
    content: { kind: "text", writeup: "" },
    ...overrides,
  };
}

describe("RuleBasedEvaluator", () => {
  const evaluator = new RuleBasedEvaluator();

  it("scores requirement coverage based on referenced terms", async () => {
    const sub = submission({
      content: {
        kind: "text",
        writeup:
          "I have a Vehicle class with subclasses for motorcycle, car and bus, each with different space needs. " +
          "The ParkingSpot has a size and the lot assigns the smallest spot that fits the vehicle. " +
          "A Ticket records entry time and computes the fee based on duration on exit.",
      },
    });

    const result = await evaluator.evaluate(problem, sub);
    const coverage = result.scores.find((s) => s.dimension === "requirements_coverage")!;
    expect(coverage.score).toBeGreaterThanOrEqual(4);
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it("penalizes a submission with no design vocabulary", async () => {
    const sub = submission({ content: { kind: "text", writeup: "park cars somewhere, charge money" } });
    const result = await evaluator.evaluate(problem, sub);
    const structure = result.scores.find((s) => s.dimension === "class_responsibility")!;
    expect(structure.score).toBe(0);
    expect(result.improvements).toContain("Name explicit classes and interfaces, and their responsibilities");
  });

  it("is deterministic, same input yields the same score", async () => {
    const sub = submission({
      content: { kind: "text", writeup: "class Vehicle has-a ParkingSpot, computes fee based on duration." },
    });
    const first = await evaluator.evaluate(problem, sub);
    const second = await evaluator.evaluate(problem, sub);
    expect(first.overallScore).toBe(second.overallScore);
  });

  it("never evaluates the extensibility dimension (reserved for the LLM evaluator)", async () => {
    const sub = submission({ content: { kind: "text", writeup: "class Vehicle {}" } });
    const result = await evaluator.evaluate(problem, sub);
    expect(result.scores.some((s) => s.dimension === "extensibility")).toBe(false);
  });
});

describe("CompositeEvaluator", () => {
  const ruleEvaluator = new RuleBasedEvaluator();

  it("falls back to rule-only feedback when the LLM evaluator throws", async () => {
    const failingLlm: Evaluator = {
      source: "llm" as EvaluationSource,
      evaluate: async () => {
        throw new Error("simulated network failure");
      },
    };
    const composite = new CompositeEvaluator(ruleEvaluator, failingLlm);
    const sub = submission({ content: { kind: "text", writeup: "class Vehicle has-a ParkingSpot." } });

    const result = await composite.evaluate(problem, sub);
    expect(result.source).toBe("rule");
    expect(result.improvements.some((i) => i.includes("LLM feedback unavailable"))).toBe(true);
  });

  it("merges rule and LLM scores when the LLM evaluator succeeds", async () => {
    const stubLlm: Evaluator = {
      source: "llm" as EvaluationSource,
      evaluate: async () => ({
        overallScore: 4,
        scores: [
          { dimension: "extensibility", score: 4, feedback: "Handles the follow-up reasonably.", source: "llm" },
        ],
        strengths: ["Good separation of concerns"],
        improvements: [],
        source: "llm" as EvaluationSource,
      }),
    };
    const composite = new CompositeEvaluator(ruleEvaluator, stubLlm);
    const sub = submission({ content: { kind: "text", writeup: "class Vehicle has-a ParkingSpot, computes fee." } });

    const result = await composite.evaluate(problem, sub);
    expect(result.source).toBe("hybrid");
    expect(result.scores.some((s) => s.dimension === "extensibility")).toBe(true);
    expect(result.strengths).toContain("Good separation of concerns");
  });

  it("returns rule-only results when no LLM evaluator is configured", async () => {
    const composite = new CompositeEvaluator(ruleEvaluator, undefined);
    const sub = submission({ content: { kind: "text", writeup: "class Vehicle {}" } });
    const result = await composite.evaluate(problem, sub);
    expect(result.source).toBe("rule");
  });
});
