# LLD Practice Platform

A small practice loop for Low-Level Design problems. Pick a problem, design a solution,
submit it, get feedback split between rule-based checks and Gemini-reasoned review, then see
your attempt history.

See [`docs/RESEARCH.md`](docs/RESEARCH.md) for the problem research and product direction, and
[`docs/DESIGN.md`](docs/DESIGN.md) for the class design, evaluation approach, and trade-offs.

## Requirements

- Node.js 18 or newer
- Optional: a `GEMINI_API_KEY` for the reasoned half of the feedback. Without it, the app
  still runs fully and gives rule-based feedback only.

## Running it

```bash
npm install
npm run build
npm start
```

Then open **http://localhost:3000**.

For development without a build step, `npm run dev` runs the server directly with `ts-node`.

To turn on reasoned feedback, set a Gemini API key before starting the server:

```bash
export GEMINI_API_KEY=your-key-here
npm start
```

You can get a key from Google AI Studio. The model defaults to `gemini-2.5-flash`, and can be
changed with `GEMINI_MODEL`.

Data is stored in a local SQLite file, `data.sqlite` in the project root by default,
configurable with `DB_PATH`. Delete that file to reset all problems, attempts, and history.

## Running the tests

```bash
npm test
```

13 tests cover:
- the rule-based evaluator's scoring logic: coverage, structure detection, determinism, and
  that it correctly skips the judgement-only `extensibility` dimension,
- the composite evaluator's merge and fallback behavior when the LLM call fails or is not set
  up,
- the full HTTP practice loop, create attempt, submit, evaluated, history, plus edge cases:
  unknown problem, empty write-up, submitting to a missing attempt, and retrying a submission
  that has not actually failed.

## Project layout

```
src/
  domain/
    models.ts        Problem, Attempt, Submission, EvaluationResult, and related types
    evaluator.ts      Evaluator strategy: RuleBasedEvaluator, LLMEvaluator, CompositeEvaluator
    repository.ts     ProblemRepository / AttemptRepository interfaces, plus SQLite versions
  seed/
    problems.ts       Seed content: Parking Lot, Elevator System, Vending Machine
  server.ts           Express routes wiring the above together
public/                Static frontend, no build step: index.html, styles.css, app.js
tests/                 Jest test suites: evaluator logic and full API flow
docs/
  RESEARCH.md          Research note
  DESIGN.md            Design note
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/problems` | List all problems |
| GET | `/api/problems/:id` | Get one problem |
| POST | `/api/problems/:id/attempts` | Start a new attempt |
| GET | `/api/attempts/:id` | Get an attempt with its submissions |
| POST | `/api/attempts/:id/submissions` | Submit a design: `{ kind: "text"|"code", writeup, code?, language? }`. Evaluates and returns the submission. |
| POST | `/api/submissions/:id/retry` | Re-run evaluation on a failed submission |
| GET | `/api/problems/:id/history` | Attempt history for one problem |
| GET | `/api/history` | Attempt history across all problems |

## Known limitations

- One implicit learner, no login. Fine for a personal practice tool, not for a multi-user
  product as it stands. See `docs/DESIGN.md` for the extension path.
- The rule-based evaluator matches keywords and vocabulary. It does not run real static
  analysis on the `code` field. That is on purpose: a cheap, fast, honest signal, not a
  compiler.
- Evaluation runs inside the request, not in a background job. Fine at this scale, and called
  out in `docs/DESIGN.md` as the place to change for a background-worker version.
