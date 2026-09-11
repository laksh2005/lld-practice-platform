# Design Note

## MVP scope

Three seeded problems, Parking Lot, Elevator System, and Vending Machine, each with an
explicit requirement list. One learner, no login. A learner can:

1. Pick a problem and read its requirements.
2. Start an attempt.
3. Write a design, a free-text write-up with optional code, and submit it.
4. Get feedback split into rubric dimensions, each labeled as rule-based or reasoned.
5. See every past attempt on that problem, and across all problems, with its score.
6. Retry evaluation if it failed, for example if the LLM call errored, without losing the
   submission.

Out of scope on purpose: multiple learners or login, instructor dashboards, real-time
collaboration, diagram-based submissions (the model supports adding this later, see
Extensibility below), and any horizontal-scaling concerns.

## User flow

```
 Problem list --> Problem detail (requirements) --> Start attempt
                                                          |
                                                          v
                                              Write design (write-up + code)
                                                          |
                                                       Submit
                                                          |
                                                          v
                                          Evaluating (rule pass, then LLM pass)
                                                     |            |
                                              (LLM fails)     (success)
                                                     |            |
                                                     v            v
                                          Rule-only feedback   Hybrid feedback
                                             + retry option    (scores, strengths,
                                                                improvements)
                                                          |
                                                          v
                                              Attempt appears in history
                                                          |
                                                          v
                                                  Start a new attempt
```

## Core classes and responsibilities

```
Problem                 static reference content plus rubric anchors: requirements,
                         expected entities, an extension hint

Attempt                 one learner's session against one Problem, owns zero or more
                         Submissions, status: in_progress -> submitted -> completed

Submission               one piece of submitted work, content is a discriminated union
                         (SubmissionContent: "text" or "code" today) so new formats can be
                         added without touching Attempt or the evaluators.
                         status: pending -> evaluating -> evaluated or failed

Evaluator (interface)    evaluate(problem, submission) returns EvaluationResult-shaped data
  - RuleBasedEvaluator   deterministic, synchronous, always runs
  - LLMEvaluator         calls the Gemini API for judgement-only dimensions
  - CompositeEvaluator   runs both, merges scores, falls back to rule-only if the LLM fails

EvaluationResult          rubric scores, each tagged with its source, an overall score,
                          strengths, and improvements. Same shape no matter which
                          evaluator produced it.

ProblemRepository /       persistence interfaces, with SQLite implementations underneath.
AttemptRepository         Routes and evaluators only depend on the interfaces.
```

This is a strategy pattern on `Evaluator`, so evaluation logic can change independently of the
HTTP layer and of Attempt/Submission, plus a repository pattern on persistence, so storage can
change independently of both. `SubmissionContent` is a small discriminated union, which is the
cheapest way to keep the shape of a submission open for extension.

## Evaluation approach: what is deterministic and what needs an LLM

The rubric has five dimensions. Two of them can be checked by pattern-matching against the
problem's own requirement list and a small vocabulary of design terms. These are deterministic
on purpose, so a learner can trust "you did not cover requirement X" as a fact, not a model's
possibly inconsistent read:

- `requirements_coverage`: does the text mention each stated requirement's key terms?
- `class_responsibility`: is there any explicit class, interface, or responsibility vocabulary?
- `relationships` (partly): is relationship vocabulary, like composition or inheritance,
  present at all?
- `clarity`: a length and detail proxy.

Two things are not safely deterministic, because there is more than one valid design and
judging quality, not just presence, needs actual reasoning about the specific design:

- `extensibility`: would this design absorb the stated follow-up requirement without a
  rewrite? This depends on understanding what the learner actually proposed, not just whether
  they used the word "extend."
- `relationships` (quality): the LLM evaluator re-scores this dimension for soundness, not
  just presence. "I used composition" and "I used composition correctly here" are different
  claims.

`CompositeEvaluator` always runs the rule-based pass first. It is cheap, instant, and has no
external dependency. The LLM pass is layered on top only for the judgement dimensions. If
`GEMINI_API_KEY` is unset, or the call fails or times out, the composite still returns a
complete result built from the rule-based pass. The learner is told which source produced
their feedback, `rule`, `llm`, or `hybrid`, instead of being left with a spinner or an error.

## Handling slow or failed evaluation

Each `Submission` carries its own status, `pending -> evaluating -> evaluated or failed`,
separate from the `Attempt`'s status. If evaluation throws, for example a network error or a
malformed LLM response, the submission is marked `failed` with the error message kept, and a
`POST /api/submissions/:id/retry` endpoint re-runs evaluation for that exact submission
without the learner retyping anything. This is fully synchronous for the MVP, since a 2-day
prototype does not need a job queue, but the status field and retry endpoint are the seam a
background-worker version would plug into later. Swap the synchronous `await runEvaluation(...)`
call in the route for a queued job, and the `evaluating` state plus a poll-for-status endpoint
already exist.

## Extensibility: new submission formats, new evaluation approaches

- New submission format, for example a diagram: add a new `SubmissionContent` variant, add a
  branch to whichever evaluator needs to read it, or keep using `RuleBasedEvaluator`'s
  plain-text extraction as a shared fallback. Nothing else, `Attempt`, repositories, history,
  needs to change, since none of them look inside `content` beyond its `kind` tag.
- New evaluation approach, for example real static analysis or a different LLM provider:
  implement `Evaluator` and add it to `CompositeEvaluator`, or swap it in directly. Nothing
  outside `evaluator.ts` depends on a specific evaluator class.
- New storage, for example moving off SQLite for multi-user scale: implement
  `ProblemRepository` and `AttemptRepository` against the new store. Routes and evaluators are
  unaffected, since they only see the interfaces.

## Key trade-offs

- Text and code write-ups over a diagramming UI. A canvas-based class-diagram editor would
  feel more "visual," but building and evaluating diagrams reliably is a project on its own.
  Text keeps both the submission format and the evaluator realistic inside two days, and the
  `SubmissionContent` union means diagrams are an additive change later, not a rewrite.
- Soft entity matching, not a strict checklist. The rule-based evaluator treats expected
  domain nouns as a weak signal, folded into `clarity`, not a hard gate. A learner who names
  their class `Automobile` instead of `Vehicle` has not necessarily designed worse. Matching
  exact vocabulary too strictly would punish equally valid designs.
- Synchronous evaluation, not a queue. Simpler to build and test in the time available, and
  named directly as the seam to revisit if evaluation latency becomes a real problem.
- SQLite over Mongo or Postgres. Zero setup for a grader running this locally, and the
  repository interfaces make the choice reversible later.
