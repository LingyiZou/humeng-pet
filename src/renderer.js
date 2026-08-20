// 狐朦桌宠渲染逻辑：控制站岗反馈、气泡、奔跑动画与菜单结果展示。
const pet = document.getElementById("pet");
const bubble = document.getElementById("bubble");
const shell = document.getElementById("pet-shell");
const dialogueModal = document.getElementById("dialogue-modal");
const dialogueForm = document.getElementById("dialogue-form");
const dialogueInput = document.getElementById("dialogue-input");
const dialogueList = document.getElementById("dialogue-list");
const dialogueError = document.getElementById("dialogue-error");
const dialogueClose = document.getElementById("dialogue-close");
const durationModal = document.getElementById("duration-modal");
const durationForm = document.getElementById("duration-form");
const durationInput = document.getElementById("duration-input");
const durationError = document.getElementById("duration-error");
const durationClose = document.getElementById("duration-close");
const scheduleModal = document.getElementById("schedule-modal");
const scheduleForm = document.getElementById("schedule-form");
const scheduleWorkInput = document.getElementById("schedule-work-input");
const scheduleFollowupInput = document.getElementById("schedule-followup-input");
const scheduleBreakInput = document.getElementById("schedule-break-input");
const scheduleError = document.getElementById("schedule-error");
const scheduleClose = document.getElementById("schedule-close");

const guardLines = [
  "狐朦已就位，正在认真站岗。",
  "你专心忙，我替你看着时间。",
  "站岗中。该休息时我会来找你。"
];

const interactiveLines = [
  "你找我呀，我在岗。",
  "有事可以点点我。",
  "我刚刚有在看你。"
];

let awakeTimer = null;
let hoverCooldown = 0;
let keepBubbleVisible = false;
let customDialogues = [];
let editingDialogueId = null;
let pointerPress = null;
let suppressNextClick = false;

const DRAG_THRESHOLD_PIXELS = 6;

function speak(text, duration = 3200) {
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  keepBubbleVisible = false;
  window.clearTimeout(speak.hideTimer);
  speak.hideTimer = window.setTimeout(() => {
    bubble.classList.add("hidden");
  }, duration);
}

function showPersistentBubble(text) {
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  keepBubbleVisible = true;
  window.clearTimeout(speak.hideTimer);
}

function hideBubble() {
  keepBubbleVisible = false;
  window.clearTimeout(speak.hideTimer);
  bubble.classList.add("hidden");
}

function setAwake(active) {
  pet.classList.toggle("is-awake", active);
  window.clearTimeout(awakeTimer);
  if (active) {
    awakeTimer = window.setTimeout(() => {
      pet.classList.remove("is-awake");
    }, 2600);
  }
}

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function describeWorkSummary(summary) {
  return `${summary.text}｜${summary.phase.label}：${summary.phase.detail}`;
}

function showDialogueError(message = "") {
  dialogueError.textContent = message;
  dialogueError.classList.toggle("hidden", !message);
}

function showDurationError(message = "") {
  durationError.textContent = message;
  durationError.classList.toggle("hidden", !message);
}

function showScheduleError(message = "") {
  scheduleError.textContent = message;
  scheduleError.classList.toggle("hidden", !message);
}

async function refreshDialogues() {
  customDialogues = await window.petAPI.getDialogues();
  renderDialogueList();
}

function closeDialogueManager() {
  dialogueModal.classList.add("hidden");
  editingDialogueId = null;
  showDialogueError();
}

function closeDurationSetup() {
  durationModal.classList.add("hidden");
  showDurationError();
}

function closeWorkSchedule() {
  scheduleModal.classList.add("hidden");
  showScheduleError();
}

async function openDialogueManager() {
  closeDurationSetup();
  closeWorkSchedule();
  showDialogueError();
  dialogueModal.classList.remove("hidden");
  await refreshDialogues();
  dialogueInput.focus();
}

function openDurationSetup() {
  closeDialogueManager();
  closeWorkSchedule();
  durationInput.value = "";
  showDurationError();
  durationModal.classList.remove("hidden");
  durationInput.focus();
}

async function openWorkSchedule() {
  closeDialogueManager();
  closeDurationSetup();
  showScheduleError();

  try {
    const schedule = await window.petAPI.getWorkSchedule();
    scheduleWorkInput.value = schedule.workMinutes;
    scheduleFollowupInput.value = schedule.followupMinutes;
    scheduleBreakInput.value = schedule.breakMinutes;
    scheduleModal.classList.remove("hidden");
    scheduleWorkInput.focus();
  } catch (error) {
    speak(error.message || "读取工作安排失败，请稍后重试。", 4200);
  }
}

function createDialogueButton(label, action, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderDialogueList() {
  dialogueList.replaceChildren();

  if (customDialogues.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dialogue-empty";
    empty.textContent = "还没有自定义语录。";
    dialogueList.append(empty);
    return;
  }

  customDialogues.forEach((dialogue) => {
    const row = document.createElement("article");
    row.className = "dialogue-row";

    if (editingDialogueId === dialogue.id) {
      const editInput = document.createElement("textarea");
      editInput.className = "dialogue-edit-input";
      editInput.maxLength = 160;
      editInput.value = dialogue.text;
      editInput.dataset.id = dialogue.id;
      row.append(editInput);

      const actions = document.createElement("div");
      actions.className = "dialogue-row-actions";
      actions.append(
        createDialogueButton("保存", "save", dialogue.id),
        createDialogueButton("取消", "cancel", dialogue.id)
      );
      row.append(actions);
    } else {
      const text = document.createElement("p");
      text.textContent = dialogue.text;
      row.append(text);

      const actions = document.createElement("div");
      actions.className = "dialogue-row-actions";
      actions.append(
        createDialogueButton("编辑", "edit", dialogue.id),
        createDialogueButton("删除", "delete", dialogue.id)
      );
      row.append(actions);
    }

    dialogueList.append(row);
  });
}

function getPetClickHalf(event) {
  const bounds = pet.getBoundingClientRect();
  return event.clientY - bounds.top < bounds.height / 2 ? "upper" : "lower";
}

function repositionShell(corner) {
  shell.style.left = "";
  shell.style.right = "";
  shell.style.top = "";
  shell.style.bottom = "";

  if (corner.includes("left")) {
    shell.style.left = "18px";
  } else {
    shell.style.right = "18px";
  }

  if (corner.includes("top")) {
    shell.style.top = "18px";
  } else {
    shell.style.bottom = "18px";
  }
}

function doNudge(text, duration = 4200) {
  pet.classList.add("is-searching");
  setAwake(true);
  speak(text, duration);
  window.setTimeout(() => {
    pet.classList.remove("is-searching");
  }, 1500);
}

pet.addEventListener("click", async (event) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  setAwake(true);

  if (getPetClickHalf(event) === "lower") {
    const summary = await window.petAPI.getTodayWorkSummary();
    speak(describeWorkSummary(summary), 7000);
    return;
  }

  speak(randomPick([...interactiveLines, ...customDialogues.map((dialogue) => dialogue.text)]));
});

pet.addEventListener("contextmenu", async (event) => {
  event.preventDefault();
  await window.petAPI.showContextMenu();
});

pet.addEventListener("mouseenter", () => {
  if (Date.now() - hoverCooldown < 5000) {
    return;
  }
  hoverCooldown = Date.now();
  setAwake(true);
  speak("狐朦发现你靠近了。", 1800);
});

pet.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !dialogueModal.classList.contains("hidden") || !durationModal.classList.contains("hidden") || !scheduleModal.classList.contains("hidden")) {
    return;
  }

  pointerPress = {
    clientX: event.clientX,
    clientY: event.clientY,
    isDragging: false
  };
  pet.setPointerCapture(event.pointerId);
  window.petAPI.startDrag(event.screenX, event.screenY);
});

pet.addEventListener("pointermove", (event) => {
  if (!pointerPress) {
    return;
  }

  const movement = Math.hypot(event.clientX - pointerPress.clientX, event.clientY - pointerPress.clientY);

  if (!pointerPress.isDragging && movement >= DRAG_THRESHOLD_PIXELS) {
    pointerPress.isDragging = true;
    pet.classList.add("is-dragging");
  }

  if (pointerPress.isDragging) {
    window.petAPI.dragTo(event.screenX, event.screenY);
  }
});

function finishPointerInteraction(event) {
  if (!pointerPress) {
    return;
  }

  const wasDragging = pointerPress.isDragging;
  pointerPress = null;
  pet.classList.remove("is-dragging");
  window.petAPI.endDrag();

  if (wasDragging) {
    suppressNextClick = true;
  }

  if (pet.hasPointerCapture(event.pointerId)) {
    pet.releasePointerCapture(event.pointerId);
  }
}

pet.addEventListener("pointerup", finishPointerInteraction);
pet.addEventListener("pointercancel", finishPointerInteraction);

dialogueForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await window.petAPI.addDialogue(dialogueInput.value);
    dialogueInput.value = "";
    showDialogueError();
    await refreshDialogues();
  } catch (error) {
    showDialogueError(error.message);
  }
});

dialogueList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "edit") {
    editingDialogueId = id;
    showDialogueError();
    renderDialogueList();
    dialogueList.querySelector("textarea")?.focus();
    return;
  }

  if (action === "cancel") {
    editingDialogueId = null;
    renderDialogueList();
    return;
  }

  try {
    if (action === "save") {
      const input = dialogueList.querySelector(`textarea[data-id="${id}"]`);
      await window.petAPI.updateDialogue(id, input.value);
      editingDialogueId = null;
    }

    if (action === "delete") {
      const dialogue = customDialogues.find((item) => item.id === id);
      if (!window.confirm(`删除这条对话吗？\n\n${dialogue?.text || ""}`)) {
        return;
      }
      await window.petAPI.deleteDialogue(id);
    }

    showDialogueError();
    await refreshDialogues();
  } catch (error) {
    showDialogueError(error.message);
  }
});

dialogueClose.addEventListener("click", closeDialogueManager);
dialogueModal.addEventListener("click", (event) => {
  if (event.target === dialogueModal) {
    closeDialogueManager();
  }
});

durationForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const minutes = Number(durationInput.value);
    await window.petAPI.setCustomFocusDuration(minutes);
    closeDurationSetup();
    setAwake(true);
    speak(`好，狐朦将在 ${minutes} 分钟后奔跑提醒你。`, 4200);
  } catch (error) {
    showDurationError(error.message);
  }
});

durationClose.addEventListener("click", closeDurationSetup);
durationModal.addEventListener("click", (event) => {
  if (event.target === durationModal) {
    closeDurationSetup();
  }
});

scheduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const result = await window.petAPI.setWorkSchedule({
      workMinutes: Number(scheduleWorkInput.value),
      followupMinutes: Number(scheduleFollowupInput.value),
      breakMinutes: Number(scheduleBreakInput.value)
    });
    closeWorkSchedule();
    setAwake(true);
    const { workMinutes, followupMinutes, breakMinutes } = result.schedule;
    const customNotice = result.keepsCustomCountdown ? "当前一次性倒计时保持不变；" : "";
    speak(`${customNotice}工作 ${workMinutes} 分钟、未休息时每 ${followupMinutes} 分钟提醒、休息 ${breakMinutes} 分钟后继续。`, 6200);
  } catch (error) {
    showScheduleError(error.message);
  }
});

scheduleClose.addEventListener("click", closeWorkSchedule);
scheduleModal.addEventListener("click", (event) => {
  if (event.target === scheduleModal) {
    closeWorkSchedule();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!dialogueModal.classList.contains("hidden")) {
    closeDialogueManager();
  }

  if (!durationModal.classList.contains("hidden")) {
    closeDurationSetup();
  }

  if (!scheduleModal.classList.contains("hidden")) {
    closeWorkSchedule();
  }
});

window.petAPI.onSummon(() => {
  setAwake(true);
  speak("你一叫我，我就来了。", 3600);
});

window.petAPI.onCornerChanged((corner) => {
  repositionShell(corner);
});

window.petAPI.onFocusNudge(async (kind) => {
  if (kind === "custom") {
    doNudge("约定的工作时长到了，狐朦来提醒你活动一下。", 4200);
    return;
  }
  const schedule = await window.petAPI.getWorkSchedule();
  if (kind === "followup") {
    doNudge(`你还在继续忙，我会在 ${schedule.followupMinutes} 分钟后再来提醒。`);
    return;
  }
  doNudge(randomPick([
    "狐朦从角落窜出来了，该歇一会了。",
    `你已经连续忙了 ${schedule.workMinutes} 分钟，起来动一下。`,
    "先别硬撑，狐朦催你休息。"
  ]));
});

window.petAPI.onFocusReset(async () => {
  setAwake(false);
  if (keepBubbleVisible) {
    hideBubble();
    return;
  }
  const schedule = await window.petAPI.getWorkSchedule();
  speak(randomPick([
    `这次休息够了，狐朦把专注计时重新拨回 ${schedule.workMinutes} 分钟。`,
    `你已经休息满 ${schedule.breakMinutes} 分钟，下一次提醒从现在重新算。`,
    "休息有效，狐朦回角落继续陪你专注。"
  ]), 3800);
});

window.petAPI.onBreakQualified(() => {
  setAwake(false);
  showPersistentBubble("我们继续吧");
});

window.petAPI.onBreakEnded(() => {
  hideBubble();
});

window.petAPI.onSprintStart(() => {
  pet.classList.add("is-sprinting");
  setAwake(true);
});

window.petAPI.onSprintEnd(() => {
  pet.classList.remove("is-sprinting");
});

window.petAPI.onManualSprint(async () => {
  const schedule = await window.petAPI.getWorkSchedule();
  doNudge(`出发！狐朦重新为你计时 ${schedule.workMinutes} 分钟。`, 4200);
});

window.petAPI.onShowWorkSummary((summary) => {
  setAwake(true);
  speak(describeWorkSummary(summary), 7000);
});

window.petAPI.onOpenDialogueManager(() => {
  openDialogueManager();
});

window.petAPI.onOpenDurationSetup(() => {
  openDurationSetup();
});

window.petAPI.onOpenWorkSchedule(() => {
  openWorkSchedule();
});

window.addEventListener("DOMContentLoaded", async () => {
  const corner = await window.petAPI.getCorner();
  repositionShell(corner);
  await refreshDialogues();
  speak(randomPick(guardLines), 2600);
});
