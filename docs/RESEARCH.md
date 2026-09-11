# Research Note

## The learner problem

Low-Level Design is unusual to practice because it has no single correct answer. Two
competent engineers will decompose a "Parking Lot" differently and both can be right. This
makes LLD practice hard to build tooling for, unlike something like DSA practice, where a
solution either passes the tests or it does not. An LLD solution has to be judged.

Talking to people who have prepared for LLD-style interviews, and reflecting on my own
interview prep, the same complaints keep coming up:

- **No feedback loop.** You design a Parking Lot on paper or in a doc, and unless you show it
  to someone experienced, you have no idea if your class boundaries are reasonable or if you
  missed an implicit requirement.
- **Feedback that exists is binary and late.** Mock interviews give you a verdict at the end
  of 45 minutes, not "your `Vehicle` and `ParkingSpot` are too coupled" while you are still
  writing.
- **Practice does not compound.** Without a record of past attempts, there is no way to see
  if you actually got better at handling extensibility questions over your last five
  attempts, which is the whole point of practicing something repeatedly instead of doing it
  once.
- **Most existing material is read-only.** Books and video walkthroughs are good at showing
  one worked solution, but they do not let a learner attempt their own design and get
  feedback on their own choices.

## Existing approaches researched

- **Static reference content**, articles and course videos that walk through "Design a
  Parking Lot": strong at showing one worked solution, no submission or feedback loop at all.
- **General coding-practice platforms**: built around a test-runner model that fits
  algorithms, not designs. LLD questions on these platforms are usually just discussion
  threads, not gradeable attempts.
- **AI chat tools used casually**, pasting a design into a chat and asking "is this good?":
  closest to what learners already do informally, but unstructured. No rubric, no requirement
  checklist, no history, and the quality of feedback depends entirely on how the question is
  phrased.
- **Mock-interview marketplaces**: give real judgement from a real interviewer, but they are
  expensive, scheduled, and do not scale to practicing again right now.

## Gaps this product should target

1. A **structured problem statement**, with explicit requirements, not just a title, so both
   the learner and the evaluator grade against the same bar.
2. A feedback pipeline that is honest about what is deterministic and what is not. A learner
   should be able to trust that "you did not mention how you would compute change" is a fact,
   not a model guess, while trusting that "this extends poorly to X" is a reasoned opinion,
   not a rule.
3. **Attempt history**, so the product rewards repeated practice on the same problem, not just
   one-off attempts.
4. A **narrow, honest MVP**. Three problems done well, with a real requirement checklist, a
   real rubric, and a real retry path, beats twenty problems with shallow, unreliable feedback.

## Product direction

A focused practice loop: choose a problem, design, submit, get feedback split into
deterministic checks and reasoned review, see history, try again. Built as a small monolith.
No LMS features, no courses, no cohorts, no instructor dashboards. The whole product is the
loop itself, for one learner at a time.
