// 狐朦桌宠主进程：管理透明窗口、专注计时、工时统计与右键菜单。
const { app, BrowserWindow, globalShortcut, ipcMain, Menu, powerMonitor, screen } = require("electron");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

let mainWindow = null;
let currentCorner = "bottom-right";
let behaviorTimer = null;
let sprintTimer = null;
let workStatsTimer = null;
let customFocusTimer = null;
let workStatsPath = "";
let workStatsDirty = false;
let workStats = {};
let workSchedulePath = "";
let petAgePath = "";
let dialoguesPath = "";
let customDialogues = [];
let restingBounds = null;
let dragState = null;

const BASE_PET_SIZE = { width: 260, height: 320 };
const PET_AGE_OPTIONS = Object.freeze([20, 40, 60, 80, 100, 200]);
const DEFAULT_WORK_SCHEDULE = Object.freeze({
  workMinutes: 40,
  followupMinutes: 10,
  breakMinutes: 5
});
const BEHAVIOR_CHECK_MS = 60 * 1000;
const WORK_STATS_SAMPLE_MS = 1000;
const WORK_STATS_SAVE_MS = 30 * 1000;

let isActive = true;
let hasQualifiedBreak = false;
let isWaitingForReturn = false;
let workSchedule = { ...DEFAULT_WORK_SCHEDULE };
let petAge = 100;
let nextFocusNudgeAt = Date.now() + DEFAULT_WORK_SCHEDULE.workMinutes * 60 * 1000;
let focusNudgeCount = 0;
let focusStartedAt = Date.now();
let customFocusDurationMs = null;

function getDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadWorkStats() {
  workStatsPath = path.join(app.getPath("userData"), "work-stats.json");

  try {
    const raw = fs.readFileSync(workStatsPath, "utf8");
    const parsed = JSON.parse(raw);
    workStats = parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load work stats:", error);
    }
    workStats = {};
  }
}

function getPetSize() {
  return {
    width: Math.max(BASE_PET_SIZE.width, Math.round(BASE_PET_SIZE.width * petAge / 100)),
    height: Math.max(BASE_PET_SIZE.height, Math.round(BASE_PET_SIZE.height * petAge / 100))
  };
}

function normalizePetAge(value) {
  if (!PET_AGE_OPTIONS.includes(value)) {
    throw new Error("请选择预设年龄大小。");
  }
  return value;
}

function loadPetAge() {
  petAgePath = path.join(app.getPath("userData"), "pet-age.json");

  try {
    const raw = fs.readFileSync(petAgePath, "utf8");
    petAge = normalizePetAge(JSON.parse(raw)?.percent);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load pet age:", error);
    }
    petAge = 100;
  }
}

function savePetAge() {
  try {
    fs.writeFileSync(petAgePath, JSON.stringify({ percent: petAge }, null, 2));
  } catch (error) {
    console.error("Failed to save pet age:", error);
    throw new Error("保存年龄设置失败，请稍后重试。");
  }
}

function normalizeWorkSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") {
    throw new Error("工作安排无效。");
  }

  const normalized = {};
  const labels = {
    workMinutes: "工作时间",
    followupMinutes: "再次提醒间隔",
    breakMinutes: "休息时间"
  };

  for (const key of Object.keys(DEFAULT_WORK_SCHEDULE)) {
    const value = schedule[key];
    if (!Number.isInteger(value) || value < 1 || value > 480) {
      throw new Error(`${labels[key]}请输入 1 到 480 之间的整数分钟。`);
    }
    normalized[key] = value;
  }

  return normalized;
}

function loadWorkSchedule() {
  workSchedulePath = path.join(app.getPath("userData"), "work-schedule.json");

  try {
    const raw = fs.readFileSync(workSchedulePath, "utf8");
    workSchedule = normalizeWorkSchedule(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load work schedule:", error);
    }
    workSchedule = { ...DEFAULT_WORK_SCHEDULE };
  }
}

function saveWorkSchedule() {
  try {
    fs.writeFileSync(workSchedulePath, JSON.stringify(workSchedule, null, 2));
  } catch (error) {
    console.error("Failed to save work schedule:", error);
    throw new Error("保存工作安排失败，请稍后重试。");
  }
}

function getBreakThresholdSeconds() {
  return workSchedule.breakMinutes * 60;
}

function getFocusIntervalMilliseconds() {
  return (focusNudgeCount === 0 ? workSchedule.workMinutes : workSchedule.followupMinutes) * 60 * 1000;
}

function loadCustomDialogues() {
  dialoguesPath = path.join(app.getPath("userData"), "custom-dialogues.json");

  try {
    const raw = fs.readFileSync(dialoguesPath, "utf8");
    const parsed = JSON.parse(raw);
    customDialogues = Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
      : [];
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load custom dialogues:", error);
    }
    customDialogues = [];
  }
}

function saveCustomDialogues() {
  try {
    fs.writeFileSync(dialoguesPath, JSON.stringify(customDialogues, null, 2));
  } catch (error) {
    console.error("Failed to save custom dialogues:", error);
    throw new Error("保存对话失败，请稍后重试。");
  }
}

function normalizeDialogueText(text) {
  if (typeof text !== "string") {
    throw new Error("对话内容无效。");
  }

  const normalized = text.trim();

  if (!normalized) {
    throw new Error("对话内容不能为空。");
  }

  if (normalized.length > 160) {
    throw new Error("每条对话最多 160 个字符。");
  }

  return normalized;
}

function saveWorkStats() {
  if (!workStatsDirty || !workStatsPath) {
    return;
  }

  try {
    fs.writeFileSync(workStatsPath, JSON.stringify(workStats, null, 2));
    workStatsDirty = false;
  } catch (error) {
    console.error("Failed to save work stats:", error);
  }
}

function addWorkedTime(milliseconds) {
  if (milliseconds <= 0) {
    return;
  }

  const todayKey = getDateKey();
  workStats[todayKey] = (workStats[todayKey] || 0) + milliseconds;
  workStatsDirty = true;
}

function getTodayWorkedMilliseconds() {
  return workStats[getDateKey()] || 0;
}

function formatWorkedTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `今天已经工作 ${hours} 小时 ${minutes} 分钟`;
  }

  return `今天已经工作 ${minutes} 分钟`;
}

function formatDuration(milliseconds) {
  const safeMilliseconds = Math.max(0, milliseconds);
  const totalSeconds = Math.floor(safeMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }

  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }

  return `${seconds} 秒`;
}

function getWorkPhase(now = Date.now()) {
  const idleSeconds = powerMonitor.getSystemIdleTime();

  if (idleSeconds >= getBreakThresholdSeconds()) {
    return {
      key: "resting",
      label: "有效休息中",
      detail: `已休息 ${formatDuration(idleSeconds * 1000)}`
    };
  }

  if (customFocusDurationMs !== null) {
    return {
      key: "custom-focus",
      label: "自定义倒计时",
      detail: `本阶段 ${formatDuration(now - focusStartedAt)}，距奔跑 ${formatDuration(nextFocusNudgeAt - now)}`,
      durationMilliseconds: customFocusDurationMs,
      elapsedMilliseconds: Math.max(0, now - focusStartedAt),
      remainingMilliseconds: Math.max(0, nextFocusNudgeAt - now)
    };
  }

  const intervalMilliseconds = getFocusIntervalMilliseconds();
  const intervalLabel = focusNudgeCount === 0 ? "首轮专注" : "加时专注";

  return {
    key: focusNudgeCount === 0 ? "initial-focus" : "followup-focus",
    label: intervalLabel,
    detail: `本阶段 ${formatDuration(now - focusStartedAt)}，距提醒 ${formatDuration(nextFocusNudgeAt - now)}`,
    durationMilliseconds: intervalMilliseconds,
    elapsedMilliseconds: Math.max(0, now - focusStartedAt),
    remainingMilliseconds: Math.max(0, nextFocusNudgeAt - now)
  };
}

function getWorkSummary() {
  const milliseconds = getTodayWorkedMilliseconds();
  return {
    milliseconds,
    text: formatWorkedTime(milliseconds),
    phase: getWorkPhase()
  };
}

function resetFocusTimer() {
  stopCustomFocusTimer();
  const now = Date.now();
  isActive = true;
  hasQualifiedBreak = false;
  isWaitingForReturn = false;
  focusNudgeCount = 0;
  focusStartedAt = now;
  nextFocusNudgeAt = now + getFocusIntervalMilliseconds();
  customFocusDurationMs = null;
}

function setWorkSchedule(schedule) {
  const nextSchedule = normalizeWorkSchedule(schedule);
  const now = Date.now();
  const keepsCustomCountdown = customFocusDurationMs !== null;

  workSchedule = nextSchedule;
  saveWorkSchedule();

  if (!keepsCustomCountdown) {
    nextFocusNudgeAt = focusStartedAt + getFocusIntervalMilliseconds();
  }

  const idleSeconds = powerMonitor.getSystemIdleTime();
  if (idleSeconds >= getBreakThresholdSeconds()) {
    if (!hasQualifiedBreak) {
      hasQualifiedBreak = true;
      isWaitingForReturn = true;
      mainWindow?.webContents.send("pet:break-qualified");
    }
    isActive = false;
  } else if (!keepsCustomCountdown && now >= nextFocusNudgeAt) {
    triggerFocusNudge(now);
  }

  return {
    schedule: { ...workSchedule },
    summary: getWorkSummary(),
    keepsCustomCountdown
  };
}

function setCustomFocusDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
    throw new Error("请输入 1 到 480 之间的整数分钟。");
  }

  const now = Date.now();
  isActive = true;
  hasQualifiedBreak = false;
  isWaitingForReturn = false;
  focusNudgeCount = 0;
  focusStartedAt = now;
  customFocusDurationMs = minutes * 60 * 1000;
  nextFocusNudgeAt = now + customFocusDurationMs;
  scheduleCustomFocusNudge();
  return getWorkSummary();
}

function runAndResetFocusTimer() {
  resetFocusTimer();
  runSprint();
  mainWindow?.webContents.send("pet:manual-sprint");
}

function showContextMenu() {
  if (!mainWindow) {
    return;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: "奔跑吧狐朦",
      click: runAndResetFocusTimer
    },
    {
      label: "工作时间",
      click: () => mainWindow?.webContents.send("pet:show-work-summary", getWorkSummary())
    },
    {
      label: "录入剩余工作时长",
      click: () => mainWindow?.webContents.send("pet:open-duration-setup")
    },
    {
      label: "工作安排",
      click: () => mainWindow?.webContents.send("pet:open-work-schedule")
    },
    {
      label: "年龄",
      submenu: PET_AGE_OPTIONS.map((age) => ({
        label: `${age}%`,
        type: "radio",
        checked: petAge === age,
        click: () => setPetAge(age)
      }))
    },
    { type: "separator" },
    {
      label: "添加对话",
      click: () => mainWindow?.webContents.send("pet:open-dialogue-manager")
    },
    { type: "separator" },
    {
      label: "退出狐朦",
      click: () => app.quit()
    }
  ]);

  menu.popup({ window: mainWindow });
}

function getCornerBounds(corner) {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const margin = 18;
  const petSize = getPetSize();

  const positions = {
    "top-left": {
      x: area.x + margin,
      y: area.y + margin
    },
    "top-right": {
      x: area.x + area.width - petSize.width - margin,
      y: area.y + margin
    },
    "bottom-left": {
      x: area.x + margin,
      y: area.y + area.height - petSize.height - margin
    },
    "bottom-right": {
      x: area.x + area.width - petSize.width - margin,
      y: area.y + area.height - petSize.height - margin
    }
  };

  return positions[corner] || positions["bottom-right"];
}

function moveToCorner(corner) {
  if (!mainWindow) {
    return;
  }

  currentCorner = corner;
  const target = getCornerBounds(corner);
  restingBounds = { ...target, ...getPetSize() };
  mainWindow.setBounds(restingBounds, true);
  mainWindow.webContents.send("pet:corner-changed", corner);
}

function getRestingBounds() {
  return restingBounds || { ...getCornerBounds(currentCorner), ...getPetSize() };
}

function clampBoundsToDisplay(bounds, display) {
  const area = display.workArea;
  const maximumX = Math.max(area.x, area.x + area.width - bounds.width);
  const maximumY = Math.max(area.y, area.y + area.height - bounds.height);

  return {
    ...bounds,
    x: Math.round(Math.min(maximumX, Math.max(area.x, bounds.x))),
    y: Math.round(Math.min(maximumY, Math.max(area.y, bounds.y)))
  };
}

function setPetAge(value) {
  const nextAge = normalizePetAge(value);
  const previousBounds = getRestingBounds();
  const bottomCenter = {
    x: previousBounds.x + previousBounds.width / 2,
    y: previousBounds.y + previousBounds.height
  };

  petAge = nextAge;
  savePetAge();

  if (mainWindow) {
    const petSize = getPetSize();
    const display = screen.getDisplayNearestPoint(bottomCenter);
    restingBounds = clampBoundsToDisplay({
      x: bottomCenter.x - petSize.width / 2,
      y: bottomCenter.y - petSize.height,
      ...petSize
    }, display);
    mainWindow.setBounds(restingBounds, true);
    mainWindow.webContents.send("pet:age-changed", petAge);
  }

  return petAge;
}

function moveWindowToPointer(screenX, screenY) {
  if (!mainWindow || !dragState || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return;
  }

  const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY });
  const area = display.workArea;
  const petSize = getPetSize();
  const maximumX = Math.max(area.x, area.x + area.width - petSize.width);
  const maximumY = Math.max(area.y, area.y + area.height - petSize.height);
  const x = Math.round(Math.min(maximumX, Math.max(area.x, screenX - dragState.offsetX)));
  const y = Math.round(Math.min(maximumY, Math.max(area.y, screenY - dragState.offsetY)));

  restingBounds = { x, y, ...petSize };
  mainWindow.setBounds(restingBounds, true);
}

function stopSprint() {
  if (sprintTimer) {
    clearInterval(sprintTimer);
    sprintTimer = null;
  }
}

function stopCustomFocusTimer() {
  if (customFocusTimer) {
    clearTimeout(customFocusTimer);
    customFocusTimer = null;
  }
}

function triggerFocusNudge(now = Date.now()) {
  if (!mainWindow || now < nextFocusNudgeAt) {
    return false;
  }

  const nudgeKind = customFocusDurationMs !== null
    ? "custom"
    : focusNudgeCount === 0 ? "initial" : "followup";
  focusNudgeCount += 1;
  focusStartedAt = now;
  nextFocusNudgeAt = now + getFocusIntervalMilliseconds();
  customFocusDurationMs = null;
  stopCustomFocusTimer();
  runSprint();
  mainWindow.webContents.send("pet:focus-nudge", nudgeKind);
  return true;
}

function scheduleCustomFocusNudge() {
  stopCustomFocusTimer();
  const scheduledAt = nextFocusNudgeAt;
  const delay = Math.max(0, scheduledAt - Date.now());

  customFocusTimer = setTimeout(() => {
    customFocusTimer = null;

    if (!mainWindow || customFocusDurationMs === null || nextFocusNudgeAt !== scheduledAt) {
      return;
    }

    if (powerMonitor.getSystemIdleTime() < getBreakThresholdSeconds()) {
      triggerFocusNudge();
    }
  }, delay);
}

function getRandomBounds() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const padding = 22;
  const petSize = getPetSize();

  return {
    x: Math.round(area.x + padding + Math.random() * Math.max(1, area.width - petSize.width - padding * 2)),
    y: Math.round(area.y + padding + Math.random() * Math.max(1, area.height - petSize.height - padding * 2))
  };
}

function runSprint() {
  if (!mainWindow) {
    return;
  }

  stopSprint();

  const start = mainWindow.getBounds();
  const route = [start];
  const hopCount = 5 + Math.floor(Math.random() * 3);

  for (let index = 0; index < hopCount; index += 1) {
    route.push({ ...getRandomBounds(), ...getPetSize() });
  }

  route.push(getRestingBounds());

  let routeIndex = 0;
  mainWindow.webContents.send("pet:sprint-start");

  sprintTimer = setInterval(() => {
    if (!mainWindow) {
      stopSprint();
      return;
    }

    const nextBounds = route[routeIndex];
    mainWindow.setBounds(nextBounds, true);
    routeIndex += 1;

    if (routeIndex >= route.length) {
      stopSprint();
      mainWindow.setBounds(getRestingBounds(), true);
      mainWindow.webContents.send("pet:sprint-end");
    }
  }, 180);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...getPetSize(),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
  moveToCorner(currentCorner);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startBehaviorLoop() {
  clearInterval(behaviorTimer);
  behaviorTimer = setInterval(() => {
    if (!mainWindow) {
      return;
    }

    const now = Date.now();
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const nowActive = idleSeconds < getBreakThresholdSeconds();
    const nowOnBreak = idleSeconds >= getBreakThresholdSeconds();

    if (nowOnBreak && !hasQualifiedBreak) {
      hasQualifiedBreak = true;
      isWaitingForReturn = true;
      mainWindow.webContents.send("pet:break-qualified");
    }

    if (!nowActive) {
      isActive = false;
      return;
    }

    if (!isActive) {
      isActive = true;

      if (hasQualifiedBreak) {
        if (isWaitingForReturn) {
          isWaitingForReturn = false;
          mainWindow.webContents.send("pet:break-ended");
        }
        resetFocusTimer();
        mainWindow.webContents.send("pet:focus-reset");
        return;
      }
    }

    triggerFocusNudge(now);
  }, BEHAVIOR_CHECK_MS);
}

function startWorkStatsLoop() {
  clearInterval(workStatsTimer);

  workStatsTimer = setInterval(() => {
    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (idleSeconds < getBreakThresholdSeconds()) {
      addWorkedTime(WORK_STATS_SAMPLE_MS);
    }

    if (workStatsDirty && getTodayWorkedMilliseconds() % WORK_STATS_SAVE_MS < WORK_STATS_SAMPLE_MS) {
      saveWorkStats();
    }
  }, WORK_STATS_SAMPLE_MS);
}

app.whenReady().then(() => {
  loadWorkStats();
  loadWorkSchedule();
  loadPetAge();
  loadCustomDialogues();
  resetFocusTimer();
  createWindow();
  startBehaviorLoop();
  startWorkStatsLoop();
  globalShortcut.register("CommandOrControl+Shift+F", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.webContents.send("pet:summon");
    moveToCorner("bottom-right");
    mainWindow.showInactive();
  });

  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  clearInterval(behaviorTimer);
  clearInterval(workStatsTimer);
  stopSprint();
  stopCustomFocusTimer();
  saveWorkStats();
  globalShortcut.unregisterAll();
});

ipcMain.handle("pet:move-corner", (_, corner) => {
  moveToCorner(corner);
});

ipcMain.handle("pet:get-corner", () => currentCorner);
ipcMain.handle("pet:show-context-menu", showContextMenu);
ipcMain.handle("pet:get-today-work-summary", getWorkSummary);
ipcMain.handle("pet:set-custom-focus-duration", (_, minutes) => setCustomFocusDuration(minutes));
ipcMain.handle("pet:get-work-schedule", () => ({ ...workSchedule }));
ipcMain.handle("pet:set-work-schedule", (_, schedule) => setWorkSchedule(schedule));
ipcMain.handle("pet:get-age", () => petAge);
ipcMain.handle("pet:set-age", (_, age) => setPetAge(age));
ipcMain.handle("pet:get-dialogues", () => customDialogues);
ipcMain.handle("pet:add-dialogue", (_, text) => {
  const dialogue = {
    id: randomUUID(),
    text: normalizeDialogueText(text)
  };
  customDialogues.push(dialogue);
  saveCustomDialogues();
  return dialogue;
});
ipcMain.handle("pet:update-dialogue", (_, id, text) => {
  const dialogue = customDialogues.find((item) => item.id === id);

  if (!dialogue) {
    throw new Error("这条对话已经不存在了。");
  }

  dialogue.text = normalizeDialogueText(text);
  saveCustomDialogues();
  return dialogue;
});
ipcMain.handle("pet:delete-dialogue", (_, id) => {
  const previousLength = customDialogues.length;
  customDialogues = customDialogues.filter((item) => item.id !== id);

  if (customDialogues.length === previousLength) {
    throw new Error("这条对话已经不存在了。");
  }

  saveCustomDialogues();
});
ipcMain.handle("pet:drag-start", (_, screenX, screenY) => {
  if (!mainWindow || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return;
  }

  const bounds = mainWindow.getBounds();
  dragState = {
    offsetX: screenX - bounds.x,
    offsetY: screenY - bounds.y
  };
});
ipcMain.handle("pet:drag-to", (_, screenX, screenY) => {
  moveWindowToPointer(screenX, screenY);
});
ipcMain.handle("pet:drag-end", () => {
  dragState = null;
});
