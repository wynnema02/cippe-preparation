const questions = window.CIPPE_QUESTIONS || [];
const WRONG_STORE_KEY = "cippeWrongBook:v1";
const PROGRESS_STORE_KEY = "cippeProgress:v1";

const state = {
  mode: "quiz",
  requestedCount: 20,
  currentGroups: [],
  currentQuestions: [],
  submitted: false,
  onlyWrong: false,
  answers: {},
  wrongBook: loadWrongBook(),
  progressBook: loadProgressBook(),
};

const byId = (id) => document.getElementById(id);

const bankCount = byId("bankCount");
const groupCount = byId("groupCount");
const progressCount = byId("progressCount");
const attemptTotal = byId("attemptTotal");
const wrongCount = byId("wrongCount");
const modulePanel = byId("modulePanel");
const setupPanel = byId("setupPanel");
const quizPanel = byId("quizPanel");
const resultPanel = byId("resultPanel");
const quizSetup = byId("quizSetup");
const questionCount = byId("questionCount");
const questionList = byId("questionList");
const sessionTitle = byId("sessionTitle");
const submitButton = byId("submitButton");
const reshuffleButton = byId("reshuffleButton");
const newRoundButton = byId("newRoundButton");
const reviewWrongButton = byId("reviewWrongButton");
const scoreText = byId("scoreText");
const scoreDetail = byId("scoreDetail");
const modeEyebrow = byId("modeEyebrow");
const setupTitle = byId("setupTitle");
const setupHint = byId("setupHint");
const emptyWrongHint = byId("emptyWrongHint");
const homeButton = byId("homeButton");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function englishOnly(text) {
  const lines = String(text ?? "").split("\n");
  return lines
    .map((line) => {
      const cleaned = line
        .replace(/[\u3400-\u9fff，。；：？！、“”‘’（）【】《》—…·]+/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!hasChinese(line)) return cleaned;
      return /^[A-Za-z][A-Za-z0-9'’()/-]*[\s,.:;]/.test(line) ? cleaned : "";
    })
    .filter(Boolean)
    .join("\n");
}

function examText(text) {
  return state.mode === "study" ? text : englishOnly(text);
}

function noOptionsHint() {
  return state.mode === "study"
    ? "本题原文未提供 A-D 选项，可直接对照答案。"
    : "No A-D options are provided in the source. Check the answer after submitting.";
}

function loadWrongBook() {
  try {
    return JSON.parse(localStorage.getItem(WRONG_STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function loadProgressBook() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveWrongBook() {
  localStorage.setItem(WRONG_STORE_KEY, JSON.stringify(state.wrongBook));
  updateStats();
}

function saveProgressBook() {
  localStorage.setItem(PROGRESS_STORE_KEY, JSON.stringify(state.progressBook));
  updateStats();
}

function groupQuestions(source) {
  const groups = new Map();
  source.forEach((question) => {
    if (!groups.has(question.groupId)) {
      groups.set(question.groupId, {
        id: question.groupId,
        title: question.scenarioTitle,
        scenario: question.scenario,
        questions: [],
      });
    }
    groups.get(question.groupId).questions.push(question);
  });
  return Array.from(groups.values());
}

const allGroups = groupQuestions(questions);

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function wrongIds() {
  return Object.keys(state.wrongBook).map(Number).filter((id) => questions.some((question) => question.id === id));
}

function wrongGroups() {
  const ids = new Set(wrongIds());
  return allGroups.filter((group) => group.questions.some((question) => ids.has(question.id)));
}

function pickGroups(targetCount, sourceGroups = allGroups) {
  const groups = shuffle(sourceGroups);
  const selected = [];
  let total = 0;

  groups.forEach((group) => {
    const size = group.questions.length;
    if (total + size <= targetCount) {
      selected.push(group);
      total += size;
    }
  });

  if (selected.length === 0 && groups.length > 0) {
    selected.push(groups.reduce((smallest, group) => (group.questions.length < smallest.questions.length ? group : smallest), groups[0]));
  }

  if (total < targetCount) {
    const selectedIds = new Set(selected.map((group) => group.id));
    const remaining = groups.filter((group) => !selectedIds.has(group.id)).sort((a, b) => a.questions.length - b.questions.length);
    const next = remaining[0];
    if (next && Math.abs(targetCount - total) > Math.abs(targetCount - (total + next.questions.length))) {
      selected.push(next);
    }
  }

  return selected.sort((a, b) => a.questions[0].id - b.questions[0].id);
}

function pickSequentialGroups(targetCount) {
  const orderedGroups = [...allGroups].sort((a, b) => a.questions[0].id - b.questions[0].id);
  const firstUnfinishedIndex = orderedGroups.findIndex((group) => group.questions.some((question) => !state.progressBook[question.id]?.attempts));
  const startIndex = firstUnfinishedIndex >= 0 ? firstUnfinishedIndex : 0;
  const selected = [];
  let total = 0;

  for (let offset = 0; offset < orderedGroups.length; offset += 1) {
    const group = orderedGroups[(startIndex + offset) % orderedGroups.length];
    selected.push(group);
    total += group.questions.length;
    if (total >= targetCount) break;
  }

  return selected.sort((a, b) => a.questions[0].id - b.questions[0].id);
}

function answerName(question) {
  return `answer-${question.id}`;
}

function getSelectedAnswer(question) {
  const selected = document.querySelector(`input[name="${answerName(question)}"]:checked`);
  return selected ? selected.value : state.answers[question.id] || "";
}

function isAnswerVisible() {
  return state.submitted || state.mode === "study" || state.mode === "wrong-review";
}

function isGradable(question) {
  return question.options.length && question.correct;
}

function modeText() {
  const copy = {
    quiz: {
      eyebrow: "刷题模式",
      title: "设置本轮刷题",
      hint: "按题号顺序从未刷过的题开始推进，交卷后统计正确率。材料题会作为一个整体出现，因此最终题数可能略多于设置数量。",
      action: "开始刷题",
    },
    study: {
      eyebrow: "背题模式",
      title: "设置背题数量",
      hint: "答案和解析会直接展开，适合快速过知识点。材料题仍会整组展示。",
      action: "开始背题",
    },
    "wrong-review": {
      eyebrow: "错题回顾",
      title: "复盘错题本",
      hint: "查看错题、正确答案和解析。错题来自刷题模式或错题重刷中的错误记录。",
      action: "查看错题",
    },
    "wrong-retry": {
      eyebrow: "错题重刷",
      title: "设置错题重刷数量",
      hint: "从错题本中抽题重做。答对的题会自动移出错题本，材料题会整组出现。",
      action: "开始重刷",
    },
  };
  return copy[state.mode];
}

function setMode(mode) {
  state.mode = mode;
  state.submitted = false;
  state.onlyWrong = false;
  state.answers = {};
  modulePanel.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  const text = modeText();
  modeEyebrow.textContent = text.eyebrow;
  setupTitle.textContent = text.title;
  setupHint.textContent = text.hint;
  quizSetup.querySelector('button[type="submit"]').textContent = text.action;

  const wrongMode = mode === "wrong-review" || mode === "wrong-retry";
  questionCount.disabled = mode === "wrong-review";
  emptyWrongHint.classList.toggle("hidden", !wrongMode || wrongIds().length > 0);
  updateStats();
}

function updateStats() {
  const covered = questions.filter((question) => state.progressBook[question.id]?.attempts > 0).length;
  const totalAttempts = questions.reduce((sum, question) => sum + (state.progressBook[question.id]?.attempts || 0), 0);
  bankCount.textContent = `${questions.length} 题`;
  groupCount.textContent = `${allGroups.length} 个抽题单元`;
  progressCount.textContent = `已刷 ${covered}/${questions.length}`;
  attemptTotal.textContent = `累计 ${totalAttempts} 题次`;
  wrongCount.textContent = `错题 ${wrongIds().length}`;
  const wrongMode = state.mode === "wrong-review" || state.mode === "wrong-retry";
  emptyWrongHint.classList.toggle("hidden", !wrongMode || wrongIds().length > 0);
}

function rememberWrong(question, selected) {
  const previous = state.wrongBook[question.id] || { wrongTimes: 0 };
  state.wrongBook[question.id] = {
    wrongTimes: previous.wrongTimes + 1,
    lastAnswer: selected || "未作答",
    updatedAt: new Date().toISOString(),
  };
}

function removeWrong(questionId) {
  delete state.wrongBook[questionId];
  saveWrongBook();
}

function attemptCount(question) {
  return state.progressBook[question.id]?.attempts || 0;
}

function recordProgressForRound() {
  const now = new Date().toISOString();
  state.currentQuestions.forEach((question) => {
    const previous = state.progressBook[question.id] || { attempts: 0 };
    state.progressBook[question.id] = {
      attempts: previous.attempts + 1,
      lastPracticedAt: now,
    };
  });
  saveProgressBook();
}

function refreshWrongSession() {
  if (state.mode !== "wrong-review" && state.mode !== "wrong-retry") return;
  const sourceGroups = wrongGroups();
  state.currentGroups = state.mode === "wrong-review" ? sourceGroups : pickGroups(state.requestedCount, sourceGroups);
  state.currentQuestions = state.currentGroups.flatMap((group) => group.questions);
}

function removeGroupWrong(group) {
  group.questions.forEach((question) => {
    delete state.wrongBook[question.id];
  });
  saveWrongBook();
  refreshWrongSession();
  renderQuiz();
}

function renderOption(question, option) {
  const isChecked = getSelectedAnswer(question) === option.key;
  return `
    <label class="option">
      <input type="radio" name="${answerName(question)}" value="${escapeHtml(option.key)}" ${isChecked ? "checked" : ""} ${isAnswerVisible() ? "disabled" : ""} />
      <span class="option-key">${escapeHtml(option.key)}</span>
      <span class="option-text">${escapeHtml(examText(option.text))}</span>
    </label>
  `;
}

function renderQuestion(question) {
  const selected = getSelectedAnswer(question);
  const selfCheck = !isGradable(question);
  const visible = isAnswerVisible();
  const wrongRecord = state.wrongBook[question.id];
  let resultClass = "self";
  let resultText = state.mode === "study" ? "答案解析" : "自测题";

  if (!selfCheck && visible && state.mode !== "study" && state.mode !== "wrong-review") {
    resultClass = selected === question.correct ? "right" : "wrong";
    resultText = selected === question.correct ? "回答正确" : "回答错误";
  }

  if (!selfCheck && (state.mode === "study" || state.mode === "wrong-review")) {
    resultClass = "self";
    resultText = state.mode === "study" ? "背题解析" : "错题解析";
  }

  const wrongMeta = wrongRecord
    ? `<span class="tag danger">错 ${wrongRecord.wrongTimes || 1} 次</span>`
    : "";
  const attemptsMeta = `<span class="tag neutral">已刷 ${attemptCount(question)} 遍</span>`;
  const removeButton = wrongRecord
    ? `<button class="mini-button" type="button" data-remove-wrong="${question.id}">移出错题</button>`
    : "";

  const answerPanel = `
    <div class="answer-panel ${visible ? "visible" : ""} ${resultClass}" data-result-for="${question.id}">
      <p><strong>${resultText}</strong></p>
      ${state.mode !== "study" && state.mode !== "wrong-review" ? `<p><strong>你的答案：</strong>${escapeHtml(selected || (selfCheck ? "请自行对照" : "未作答"))}</p>` : ""}
      <p><strong>正确答案：</strong>${escapeHtml(question.answer)}</p>
      ${question.explanation ? `<p><strong>解析：</strong></p><p>${escapeHtml(question.explanation)}</p>` : ""}
      ${removeButton ? `<div class="answer-actions">${removeButton}</div>` : ""}
    </div>
  `;

  return `
    <article class="question-card" data-question-id="${question.id}">
      <div class="question-head">
        <span class="question-number">第 ${question.id} 题</span>
        <span class="head-tags">${attemptsMeta}${wrongMeta}${selfCheck ? '<span class="tag">自测</span>' : ""}</span>
      </div>
      <p class="prompt">${escapeHtml(examText(question.prompt))}</p>
      ${
        question.options.length
          ? `<div class="options">${question.options.map((option) => renderOption(question, option)).join("")}</div>`
          : `<p class="prompt">${escapeHtml(noOptionsHint())}</p>`
      }
      ${answerPanel}
    </article>
  `;
}

function renderGroup(group) {
  const removeGroupButton = group.questions.some((question) => state.wrongBook[question.id])
    ? `<button class="mini-button" type="button" data-remove-group="${escapeHtml(group.id)}">整组移出错题</button>`
    : "";

  if (!group.scenario) {
    return group.questions.map(renderQuestion).join("");
  }

  return `
    <section class="scenario-card" data-group-id="${escapeHtml(group.id)}">
      <div class="scenario-header">
        <h3>${escapeHtml(group.title)}</h3>
        <div class="scenario-actions">
          <span class="tag">${group.questions.length} 题同材料</span>
          ${removeGroupButton}
        </div>
      </div>
      <div class="scenario-body">${escapeHtml(examText(group.scenario))}</div>
      <div class="scenario-questions">
        ${group.questions.map(renderQuestion).join("")}
      </div>
    </section>
  `;
}

function renderQuiz() {
  sessionTitle.textContent = `${modeText().eyebrow} · ${state.currentQuestions.length} 题 · ${state.currentGroups.length} 组`;
  questionList.innerHTML = state.currentGroups.length
    ? state.currentGroups.map(renderGroup).join("")
    : '<div class="empty-state">错题本已经清空了。</div>';
  resultPanel.classList.toggle("hidden", !state.submitted);
  submitButton.disabled = state.submitted || state.mode === "study" || state.mode === "wrong-review";
  submitButton.classList.toggle("hidden", state.mode === "study" || state.mode === "wrong-review");
  reshuffleButton.textContent = state.mode === "quiz" ? "继续顺序刷题" : state.mode === "wrong-review" ? "刷新错题" : "重新抽题";
  bindInlineActions();
}

function bindInlineActions() {
  document.querySelectorAll("[data-remove-wrong]").forEach((button) => {
    button.addEventListener("click", () => {
      removeWrong(Number(button.dataset.removeWrong));
      refreshWrongSession();
      renderQuiz();
    });
  });
  document.querySelectorAll("[data-remove-group]").forEach((button) => {
    const group = state.currentGroups.find((item) => item.id === button.dataset.removeGroup);
    if (group) {
      button.addEventListener("click", () => removeGroupWrong(group));
    }
  });
}

function showWorkspace() {
  setupPanel.classList.add("hidden");
  quizPanel.classList.remove("hidden");
  resultPanel.classList.add("hidden");
  reviewWrongButton.textContent = "只看错题";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startRound(count) {
  const target = Math.max(1, Math.min(Number(count) || 20, questions.length));
  const sourceGroups = state.mode === "wrong-review" || state.mode === "wrong-retry" ? wrongGroups() : allGroups;

  if (sourceGroups.length === 0) {
    emptyWrongHint.classList.remove("hidden");
    return;
  }

  state.requestedCount = target;
  state.currentGroups = state.mode === "quiz" ? pickSequentialGroups(target) : state.mode === "wrong-review" ? sourceGroups : pickGroups(target, sourceGroups);
  state.currentQuestions = state.currentGroups.flatMap((group) => group.questions);
  state.submitted = state.mode === "study" || state.mode === "wrong-review";
  state.onlyWrong = false;
  state.answers = {};

  showWorkspace();
  renderQuiz();
}

function grade() {
  let gradable = 0;
  let correct = 0;
  const wrongIdsThisRound = [];

  state.answers = {};
  state.currentQuestions.forEach((question) => {
    state.answers[question.id] = getSelectedAnswer(question);
  });

  state.currentQuestions.forEach((question) => {
    if (!isGradable(question)) return;
    gradable += 1;
    const selected = getSelectedAnswer(question);
    if (selected === question.correct) {
      correct += 1;
      if (state.mode === "wrong-retry") removeWrong(question.id);
    } else {
      wrongIdsThisRound.push(question.id);
      rememberWrong(question, selected);
    }
  });

  recordProgressForRound();
  saveWrongBook();
  state.submitted = true;
  renderQuiz();

  const percent = gradable ? Math.round((correct / gradable) * 100) : 0;
  scoreText.textContent = `${percent}%`;
  const retryText = state.mode === "wrong-retry" ? "答对的错题已自动移出错题本。" : "答错或未答的题已自动加入错题本。";
  scoreDetail.textContent = `共 ${state.currentQuestions.length} 题，其中 ${gradable} 题可自动判分，答对 ${correct} 题，答错或未答 ${wrongIdsThisRound.length} 题。${retryText}`;
  resultPanel.classList.remove("hidden");
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleWrongOnly() {
  state.onlyWrong = !state.onlyWrong;
  reviewWrongButton.textContent = state.onlyWrong ? "显示全部" : "只看错题";
  document.querySelectorAll("[data-question-id]").forEach((card) => {
    const id = Number(card.dataset.questionId);
    const question = state.currentQuestions.find((item) => item.id === id);
    const isWrong = question && isGradable(question) && getSelectedAnswer(question) !== question.correct;
    card.classList.toggle("hidden", state.onlyWrong && !isWrong);
  });
}

function returnHome() {
  quizPanel.classList.add("hidden");
  resultPanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
  setMode(state.mode);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initialize() {
  updateStats();
  questionCount.max = String(questions.length);
  setMode("quiz");

  modulePanel.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  quizSetup.addEventListener("submit", (event) => {
    event.preventDefault();
    startRound(questionCount.value);
  });

  document.querySelectorAll("[data-count]").forEach((button) => {
    button.addEventListener("click", () => {
      questionCount.value = button.dataset.count;
    });
  });

  submitButton.addEventListener("click", grade);
  reshuffleButton.addEventListener("click", () => startRound(state.requestedCount));
  newRoundButton.addEventListener("click", returnHome);
  homeButton.addEventListener("click", returnHome);
  reviewWrongButton.addEventListener("click", toggleWrongOnly);
}

initialize();
