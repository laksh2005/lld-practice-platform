# AI Usage

This prototype was built with Claude doing most of the implementation from the assignment
brief. Below are the decisions worth flagging, where a first instinct got changed, and why.

## 1. Submission format: text and code, not a diagram editor

**First instinct:** since LLD is often taught visually with UML class diagrams, the
submission format should include a diagram canvas.

**Rejected, kept as text plus optional code.** Building a diagram editor that produces
structured, gradeable data, not just an image, is a project on its own. It is closer to a
multi-week effort than something that fits inside two days alongside the rest of the loop.
Text write-ups can be graded today, both by rules and by an LLM, with no separate parsing
layer. To keep the door open, `SubmissionContent` is a discriminated union, `kind: "text" |
"code"`, so a `kind: "diagram"` variant is an additive change later, not a rewrite. This
shaped the model from the start instead of being bolted on afterward.

## 2. Where to draw the line between rule-based and LLM scoring

**First instinct, from the model:** score all five rubric dimensions with the LLM, since it
can plausibly judge all of them and that is simpler to build.

**Rejected in favor of a split.** For a grading product, "did you mention the fee computation
requirement" should be a checkable fact the learner can trust and reproduce, not something
that might come back differently on a re-run of the same submission. Requirements coverage,
structural vocabulary, and clarity are cheap to check with rules and do not need judgement, so
those became rule-based. Extensibility and relationship quality genuinely need reading and
reasoning about the specific design, so those stayed with the LLM. This split is argued out
directly in `docs/DESIGN.md`, since it answers one of the assignment's core design questions.

## 3. Failure handling for the LLM call

**First instinct:** if the LLM call fails, mark the whole submission failed and require a
full resubmission.

**Changed.** That throws away the rule-based feedback that had already been computed, along
with the failed LLM call, and forces the learner to retype a design that was not the problem.
`CompositeEvaluator` now runs the rule pass first, and only lets an LLM failure lower the
hybrid result down to a rule-only one, with the failure reason shown in `improvements` instead
of hidden. A separate `failed` status only exists for the case where evaluation never got a
usable result at all, and retry re-runs evaluation on the stored submission in place.

## 4. Which LLM provider

**Considered:** the user's usual AI tooling is fairly light and provider-agnostic, so this
was a real choice, not a default.

**Chose the Gemini API** as requested, called directly over HTTPS with no SDK dependency, so
swapping providers later means changing one class, `LLMEvaluator`, not the rest of the system.
The rest of the evaluation pipeline, `RuleBasedEvaluator` and `CompositeEvaluator`, does not
know or care which provider is behind the `Evaluator` interface.

## 5. Persistence choice

**Considered:** the user's other projects lean on MongoDB and Supabase, which was worth
checking, since a grader running this locally should not need to stand up an external
database.

**Chose SQLite**, through `better-sqlite3`, specifically because it needs zero setup for
whoever runs this prototype, while `ProblemRepository` and `AttemptRepository` are defined as
interfaces so a Mongo or Postgres version is a drop-in swap later, not a rewrite of routes or
evaluators.

## 6. Frontend approach

**First instinct:** scaffold a React or Next.js frontend to match the primary stack used
elsewhere.

**Rejected in favor of a static HTML, CSS, and JS frontend.** A build step adds real setup
time, bundler config, dev server, production build, for a UI whose entire job is one page with
a sidebar, a text and code workspace, and a feedback panel. There is no client-side routing
and no state beyond "which problem is selected" and "what did the last submission return."
Plain `fetch` calls against the same JSON API a React app would use kept the surface area
small enough to finish and test inside the time budget, without giving up anything the brief
asked for.
