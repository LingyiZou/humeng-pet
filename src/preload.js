// 狐朦桌宠安全桥接层：仅向页面暴露所需的 IPC 能力。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  moveCorner: (corner) => ipcRenderer.invoke("pet:move-corner", corner),
  getCorner: () => ipcRenderer.invoke("pet:get-corner"),
  showContextMenu: () => ipcRenderer.invoke("pet:show-context-menu"),
  getTodayWorkSummary: () => ipcRenderer.invoke("pet:get-today-work-summary"),
  setCustomFocusDuration: (minutes) => ipcRenderer.invoke("pet:set-custom-focus-duration", minutes),
  getWorkSchedule: () => ipcRenderer.invoke("pet:get-work-schedule"),
  setWorkSchedule: (schedule) => ipcRenderer.invoke("pet:set-work-schedule", schedule),
  getDialogues: () => ipcRenderer.invoke("pet:get-dialogues"),
  addDialogue: (text) => ipcRenderer.invoke("pet:add-dialogue", text),
  updateDialogue: (id, text) => ipcRenderer.invoke("pet:update-dialogue", id, text),
  deleteDialogue: (id) => ipcRenderer.invoke("pet:delete-dialogue", id),
  startDrag: (screenX, screenY) => ipcRenderer.invoke("pet:drag-start", screenX, screenY),
  dragTo: (screenX, screenY) => ipcRenderer.invoke("pet:drag-to", screenX, screenY),
  endDrag: () => ipcRenderer.invoke("pet:drag-end"),
  onSummon: (callback) => ipcRenderer.on("pet:summon", callback),
  onCornerChanged: (callback) => ipcRenderer.on("pet:corner-changed", (_, corner) => callback(corner)),
  onFocusNudge: (callback) => ipcRenderer.on("pet:focus-nudge", (_, kind) => callback(kind)),
  onFocusReset: (callback) => ipcRenderer.on("pet:focus-reset", callback),
  onBreakQualified: (callback) => ipcRenderer.on("pet:break-qualified", callback),
  onBreakEnded: (callback) => ipcRenderer.on("pet:break-ended", callback),
  onSprintStart: (callback) => ipcRenderer.on("pet:sprint-start", callback),
  onSprintEnd: (callback) => ipcRenderer.on("pet:sprint-end", callback),
  onManualSprint: (callback) => ipcRenderer.on("pet:manual-sprint", callback),
  onShowWorkSummary: (callback) => ipcRenderer.on("pet:show-work-summary", (_, summary) => callback(summary)),
  onOpenDialogueManager: (callback) => ipcRenderer.on("pet:open-dialogue-manager", callback),
  onOpenDurationSetup: (callback) => ipcRenderer.on("pet:open-duration-setup", callback),
  onOpenWorkSchedule: (callback) => ipcRenderer.on("pet:open-work-schedule", callback)
});
