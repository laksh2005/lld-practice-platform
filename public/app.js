const state = {
  problems: [],
  selectedProblemId: null,
  currentAttempt: null,
};

const el = (id) => document.getElementById(id);

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// --- Tabs -----------------------------------------------------------------

const tabIndicator = el("tab-indicator");

function moveTabIndicator(tabEl) {
  if (!tabEl) return;
  tabIndicator.style.width = `${tabEl.offsetWidth}px`;
  tabIndicator.style.transform = `translateX(${tabEl.offsetLeft - 3}px)`;
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    el(`view-${tab.dataset.view}`).classList.add("active");
    moveTabIndicator(tab);
    if (tab.dataset.view === "history") loadHistory();
  });
});

window.addEventListener("resize", () => moveTabIndicator(document.querySelector(".tab.active")));

// --- Problems ---------------------------------------------------------------

async function loadProblems() {
  state.problems = await api("/api/problems");
  const container = el("problems");
  container.innerHTML = "";
  state.problems.forEach((p) => {
    const item = document.createElement("div");
    item.className = "problem-item";
    item.dataset.id = p.id;
    item.innerHTML = `<div class="p-title">${escapeHtml(p.title)}</div><div class="p-meta">${p.difficulty}</div>`;
    item.addEventListener("click", () => selectProblem(p.id));
    container.appendChild(item);
  });
}

async function selectProblem(id) {
  state.selectedProblemId = id;
  state.currentAttempt = null;

  document.querySelectorAll(".problem-item").forEach((it) => it.classList.toggle("selected", it.dataset.id === id));

  const problem = state.problems.find((p) => p.id === id);
  el("empty-state").classList.add("hidden");
  el("problem-view").classList.remove("hidden");
  el("problem-view").style.animation = "none";
  void el("problem-view").offsetWidth;
  el("problem-view").style.animation = "";

  el("problem-title").textContent = problem.title;
  el("problem-difficulty").textContent = problem.difficulty;
  el("problem-summary").textContent = problem.summary;
  el("problem-requirements").innerHTML = problem.requirements.map((r) => `<li>${escapeHtml(r)}</li>`).join("");

  el("writeup").value = "";
  el("code").value = "";
  el("feedback-panel").innerHTML = `<p class="muted">Feedback for your latest submission will appear here.</p>`;
  el("attempt-status").textContent = "No attempt started";
  el("submit-btn").disabled = true;

  await refreshAttemptHistory(id);
}

el("new-attempt-btn").addEventListener("click", async () => {
  if (!state.selectedProblemId) return;
  const attempt = await api(`/api/problems/${state.selectedProblemId}/attempts`, { method: "POST" });
  state.currentAttempt = attempt;
  el("attempt-status").textContent = `Attempt started at ${formatTime(attempt.createdAt)}`;
  el("submit-btn").disabled = false;
  el("writeup").value = "";
  el("code").value = "";
  el("feedback-panel").innerHTML = `<p class="muted">Write your design, then submit for feedback.</p>`;
  el("writeup").focus();
});

const submitBtn = el("submit-btn");

submitBtn.addEventListener("click", async () => {
  if (!state.currentAttempt) return;
  const writeup = el("writeup").value.trim();
  const code = el("code").value.trim();
  if (!writeup) {
    el("feedback-panel").innerHTML = `<p class="muted">Add a write-up before you submit. That is what gets reviewed.</p>`;
    return;
  }

  const content = code ? { kind: "code", writeup, code, language: "text" } : { kind: "text", writeup };

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  el("attempt-status").textContent = "Evaluating";

  try {
    const submission = await api(`/api/attempts/${state.currentAttempt.id}/submissions`, {
      method: "POST",
      body: JSON.stringify(content),
    });
    renderFeedback(submission);
    el("attempt-status").textContent = submission.status === "evaluated" ? "Evaluated" : `Status: ${submission.status}`;
    await refreshAttemptHistory(state.selectedProblemId);
  } catch (err) {
    el("feedback-panel").innerHTML = `<p class="muted">Something went wrong: ${escapeHtml(err.message)}</p>`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
});

function renderFeedback(submission) {
  const panel = el("feedback-panel");

  if (submission.status === "failed") {
    panel.innerHTML = `
      <p class="muted">Evaluation failed: ${escapeHtml(submission.error || "unknown error")}</p>
      <button class="btn btn-ghost" id="retry-btn">Retry evaluation</button>
    `;
    el("retry-btn").addEventListener("click", async () => {
      const retried = await api(`/api/submissions/${submission.id}/retry`, { method: "POST" });
      renderFeedback(retried);
    });
    return;
  }

  const ev = submission.evaluation;
  if (!ev) {
    panel.innerHTML = `<p class="muted">Evaluating</p>`;
    return;
  }

  const scoreClass = (s) => (s >= 3.5 ? "good" : "warn");
  const rows = ev.scores
    .map(
      (s) => `
      <div class="score-block">
        <div class="score-row">
          <span class="score-dim">${s.dimension.replace(/_/g, " ")}${s.source === "llm" ? " (reasoned)" : ""}</span>
          <span class="score-value ${scoreClass(s.score)}">${s.score.toFixed(1)} / 5</span>
        </div>
        <div class="score-bar-track">
          <div class="score-bar-fill ${scoreClass(s.score) === "warn" ? "warn" : ""}" data-target="${(s.score / 5) * 100}"></div>
        </div>
        <p class="score-feedback">${escapeHtml(s.feedback)}</p>
      </div>`
    )
    .join("");

  const list = (items, label) =>
    items && items.length
      ? `<div class="feedback-list-title">${label}</div><ul class="feedback-list">${items
          .map((i) => `<li>${escapeHtml(i)}</li>`)
          .join("")}</ul>`
      : "";

  const sourceLabel = ev.source === "hybrid" ? "rule + reasoned" : ev.source === "llm" ? "reasoned only" : "rule-based only";

  panel.innerHTML = `
    <div class="overall-score">
      <span class="num" id="overall-num">0.0</span>
      <span class="src">${sourceLabel}</span>
    </div>
    ${rows}
    ${list(ev.strengths, "Strengths")}
    ${list(ev.improvements, "To improve")}
  `;

  animateScoreBars(panel);
  animateNumber(el("overall-num"), ev.overallScore);
}

function animateScoreBars(panel) {
  requestAnimationFrame(() => {
    panel.querySelectorAll(".score-bar-fill").forEach((bar) => {
      const target = bar.dataset.target;
      requestAnimationFrame(() => {
        bar.style.width = `${target}%`;
      });
    });
  });
}

function animateNumber(target, endValue, duration = 500) {
  if (!target) return;
  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    target.textContent = (endValue * eased).toFixed(1);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function refreshAttemptHistory(problemId) {
  const history = await api(`/api/problems/${problemId}/history`);
  const container = el("attempt-history-list");
  if (!history.length) {
    container.innerHTML = `<p class="muted">No attempts yet.</p>`;
    return;
  }
  container.innerHTML = history
    .map(
      (h) => `
      <div class="attempt-row">
        <span class="a-left">
          <span>${formatTime(h.createdAt)}</span>
          <span>${h.status}</span>
          <span>${h.submissionCount} submission${h.submissionCount === 1 ? "" : "s"}</span>
        </span>
        <span class="score-value ${h.latestScore != null && h.latestScore >= 3.5 ? "good" : "warn"}">
          ${h.latestScore != null ? h.latestScore.toFixed(1) + " / 5" : "not yet scored"}
        </span>
      </div>`
    )
    .join("");
}

// --- History tab -----------------------------------------------------------

async function loadHistory() {
  const history = await api("/api/history");
  const body = el("history-body");
  if (!history.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No attempts yet. Go practice something.</td></tr>`;
    return;
  }
  body.innerHTML = history
    .map(
      (h) => `
      <tr>
        <td>${escapeHtml(h.problemTitle)}</td>
        <td class="mono">${formatTime(h.createdAt)}</td>
        <td>${h.status}</td>
        <td class="mono">${h.submissionCount}</td>
        <td class="mono">${h.latestScore != null ? h.latestScore.toFixed(1) + " / 5" : "not yet scored"}</td>
      </tr>`
    )
    .join("");
}

// --- utils ---------------------------------------------------------------

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadProblems();
moveTabIndicator(document.querySelector(".tab.active"));
