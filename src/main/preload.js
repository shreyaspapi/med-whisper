const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("medWhisper", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  selectWhisperCli: () => ipcRenderer.invoke("app:select-whisper-cli"),
  selectModelsDir: () => ipcRenderer.invoke("app:select-models-dir"),
  selectLlamaCli: () => ipcRenderer.invoke("app:select-llama-cli"),
  selectCleanupModel: () => ipcRenderer.invoke("app:select-cleanup-model"),
  setCleanupEnabled: (enabled) => ipcRenderer.invoke("app:set-cleanup-enabled", enabled),
  downloadCleanupModel: (modelId) => ipcRenderer.invoke("app:download-cleanup-model", modelId),
  openModelsDir: () => ipcRenderer.invoke("app:open-models-dir"),
  downloadModel: (modelId) => ipcRenderer.invoke("app:download-model", modelId),
  transcribe: (payload) => ipcRenderer.invoke("app:transcribe", payload),
  copyText: (text) => ipcRenderer.invoke("app:copy-text", text),
  onStateUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("app:state-updated", listener);
    return () => ipcRenderer.removeListener("app:state-updated", listener);
  },
});
