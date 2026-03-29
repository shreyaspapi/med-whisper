const fs = require("fs/promises");
const path = require("path");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const {
  downloadModel,
  saveTranscriptionEntry,
  resolveWhisperState,
  saveModelsDir,
  saveWhisperCliPath,
  transcribeAudio,
} = require("./whisper-service");
const {
  cleanupTranscript,
  downloadCleanupModel,
  resolveLlamaState,
  saveCleanupEnabled,
  saveCleanupModelPath,
  saveLlamaCliPath,
} = require("./llama-service");

let mainWindow = null;

function buildRuntimeContext() {
  return {
    appRoot: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataDir: process.env.MED_WHISPER_USER_DATA_DIR || app.getPath("userData"),
  };
}

async function sendStateToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const state = await resolveAppState();
  mainWindow.webContents.send("app:state-updated", state);
}

async function resolveAppState() {
  const context = buildRuntimeContext();
  const [whisperState, llamaState] = await Promise.all([
    resolveWhisperState(context),
    resolveLlamaState(context),
  ]);

  return {
    ...whisperState,
    ...llamaState,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#f3eee4",
    title: "Med Whisper",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("app:get-state", async () => {
    return resolveAppState();
  });

  ipcMain.handle("app:select-whisper-cli", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select whisper-cli",
      properties: ["openFile"],
      filters: process.platform === "win32"
        ? [{ name: "Executable", extensions: ["exe", "cmd", "bat"] }, { name: "All files", extensions: ["*"] }]
        : [{ name: "All files", extensions: ["*"] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return resolveAppState();
    }

    await saveWhisperCliPath(buildRuntimeContext(), result.filePaths[0]);
    return resolveAppState();
  });

  ipcMain.handle("app:select-models-dir", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select models folder",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return resolveAppState();
    }

    await saveModelsDir(buildRuntimeContext(), result.filePaths[0]);
    return resolveAppState();
  });

  ipcMain.handle("app:select-llama-cli", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select llama-cli",
      properties: ["openFile"],
      filters: process.platform === "win32"
        ? [{ name: "Executable", extensions: ["exe", "cmd", "bat"] }, { name: "All files", extensions: ["*"] }]
        : [{ name: "All files", extensions: ["*"] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return resolveAppState();
    }

    await saveLlamaCliPath(buildRuntimeContext(), result.filePaths[0]);
    return resolveAppState();
  });

  ipcMain.handle("app:select-cleanup-model", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select cleanup model",
      properties: ["openFile"],
      filters: [{ name: "GGUF models", extensions: ["gguf"] }, { name: "All files", extensions: ["*"] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return resolveAppState();
    }

    await saveCleanupModelPath(buildRuntimeContext(), result.filePaths[0]);
    return resolveAppState();
  });

  ipcMain.handle("app:set-cleanup-enabled", async (_event, enabled) => {
    await saveCleanupEnabled(buildRuntimeContext(), enabled);
    return resolveAppState();
  });

  ipcMain.handle("app:download-cleanup-model", async (_event, modelId) => {
    await downloadCleanupModel(buildRuntimeContext(), modelId);
    const state = await resolveAppState();
    await sendStateToRenderer();
    return state;
  });

  ipcMain.handle("app:open-models-dir", async () => {
    const state = await resolveAppState();
    await fs.mkdir(state.modelsDir, { recursive: true });
    await shell.openPath(state.modelsDir);
    return state;
  });

  ipcMain.handle("app:download-model", async (_event, modelId) => {
    await downloadModel(buildRuntimeContext(), modelId);
    const state = await resolveAppState();
    await sendStateToRenderer();
    return state;
  });

  ipcMain.handle("app:transcribe", async (_event, payload) => {
    const context = buildRuntimeContext();
    const rawResult = await transcribeAudio(context, payload);
    const cleanupResult = await cleanupTranscript(context, rawResult.transcript);
    const historyEntry = await saveTranscriptionEntry(context, {
      modelId: rawResult.modelId,
      rawTranscript: rawResult.transcript,
      transcript: cleanupResult.transcript,
      cleanupApplied: cleanupResult.cleanupApplied,
      cleanupModelLabel: cleanupResult.cleanupModelLabel,
    });

    await sendStateToRenderer();
    return {
      transcript: cleanupResult.transcript,
      rawTranscript: rawResult.transcript,
      modelId: rawResult.modelId,
      historyEntry,
      cleanupApplied: cleanupResult.cleanupApplied,
      cleanupModelLabel: cleanupResult.cleanupModelLabel,
      cleanupError: cleanupResult.cleanupError || null,
    };
  });

  ipcMain.handle("app:copy-text", async (_event, text) => {
    clipboard.writeText(text || "");
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createWindow();
  await sendStateToRenderer();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void sendStateToRenderer();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
