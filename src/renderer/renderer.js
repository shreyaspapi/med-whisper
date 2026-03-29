(function main() {
  const recorder = new window.WavRecorder();
  const VISIBLE_DICTATION_MODEL_IDS = ["tiny.en", "base.en", "medium.en"];
  const MODEL_COPY = {
    "tiny.en": {
      label: "Fastest",
      detail: "Best for short notes and slower laptops.",
    },
    "base.en": {
      label: "Balanced",
      detail: "Best starting point for everyday English dictation.",
    },
    "medium.en": {
      label: "Most accurate",
      detail: "Best for harder wording and more detailed dictation.",
    },
  };

  const state = {
    appState: null,
    isRecording: false,
    busy: false,
    timerStartedAt: 0,
    timerHandle: null,
    selectedHistoryId: null,
    progress: null,
  };

  const elements = {
    activityDetail: document.getElementById("activity-detail"),
    activityLabel: document.getElementById("activity-label"),
    activityPanel: document.getElementById("activity-panel"),
    activityProgressBar: document.getElementById("activity-progress-bar"),
    activityValue: document.getElementById("activity-value"),
    cleanupSummary: document.getElementById("cleanup-summary"),
    closeSettingsButton: document.getElementById("close-settings-button"),
    copyButton: document.getElementById("copy-button"),
    dictationSummary: document.getElementById("dictation-summary"),
    downloadCleanupModelButton: document.getElementById("download-cleanup-model-button"),
    downloadModelButton: document.getElementById("download-model-button"),
    historyEmpty: document.getElementById("history-empty"),
    historyList: document.getElementById("history-list"),
    modelSelect: document.getElementById("model-select"),
    newNoteButton: document.getElementById("new-note-button"),
    noteMeta: document.getElementById("note-meta"),
    noteTitle: document.getElementById("note-title"),
    openSettingsButton: document.getElementById("open-settings-button"),
    recordButton: document.getElementById("record-button"),
    sessionStatus: document.getElementById("session-status"),
    settingsDialog: document.getElementById("settings-dialog"),
    statusChip: document.getElementById("status-chip"),
    stopButton: document.getElementById("stop-button"),
    timer: document.getElementById("timer"),
    toggleCleanupButton: document.getElementById("toggle-cleanup-button"),
    transcriptOutput: document.getElementById("transcript-output"),
  };

  function getVisibleDictationModels() {
    if (!state.appState) {
      return [];
    }

    const modelsById = new Map(state.appState.modelOptions.map((model) => [model.id, model]));
    return VISIBLE_DICTATION_MODEL_IDS.map((modelId) => modelsById.get(modelId)).filter(Boolean);
  }

  function getModelCopy(model) {
    return MODEL_COPY[model.id] || {
      label: model.label,
      detail: model.description,
    };
  }

  function getSelectedModel() {
    const models = getVisibleDictationModels();

    if (models.length === 0) {
      return null;
    }

    return models.find((model) => model.id === state.appState.selectedModelId)
      || models.find((model) => model.recommended && model.installed)
      || models.find((model) => model.installed)
      || models.find((model) => model.recommended)
      || models[0];
  }

  function getCleanupModel() {
    if (!state.appState) {
      return null;
    }

    return state.appState.cleanupModelOptions.find(
      (model) => model.id === state.appState.selectedCleanupModelId && model.installed
    ) || state.appState.cleanupModelOptions.find((model) => model.recommended)
      || state.appState.cleanupModelOptions[0]
      || null;
  }

  function getHistoryItems() {
    return state.appState ? state.appState.recentTranscriptions || [] : [];
  }

  function getActiveHistoryItem() {
    return getHistoryItems().find((item) => item.id === state.selectedHistoryId) || null;
  }

  function hasCurrentTranscript() {
    return Boolean(elements.transcriptOutput.value.trim());
  }

  function canRecord() {
    const selectedModel = getSelectedModel();
    return Boolean(state.appState && state.appState.whisperConfigured && selectedModel && selectedModel.installed);
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatTimestamp(isoString) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoString));
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "";
    }

    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const decimals = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
  }

  function buildHistoryTitle(text) {
    const normalized = (text || "").replace(/\s+/g, " ").trim();

    if (!normalized) {
      return "Untitled note";
    }

    const firstSentence = normalized.split(/(?<=[.!?])\s+/u)[0] || normalized;
    const sentenceTitle = firstSentence.replace(/[.!?]+$/u, "").trim();

    if (sentenceTitle.length >= 8 && sentenceTitle.length <= 64) {
      return sentenceTitle;
    }

    const words = normalized.split(" ");
    const shortTitle = words.slice(0, 7).join(" ");
    return words.length > 7 ? `${shortTitle}...` : shortTitle;
  }

  function startTimer() {
    stopTimer();
    state.timerStartedAt = Date.now();
    elements.timer.hidden = false;
    elements.timer.textContent = "00:00";
    state.timerHandle = window.setInterval(() => {
      elements.timer.textContent = formatElapsed(Date.now() - state.timerStartedAt);
    }, 250);
  }

  function stopTimer() {
    if (state.timerHandle) {
      window.clearInterval(state.timerHandle);
      state.timerHandle = null;
    }

    if (!state.isRecording) {
      elements.timer.textContent = "00:00";
      elements.timer.hidden = true;
    }
  }

  function updateStatusChip() {
    const selectedModel = getSelectedModel();

    if (state.progress) {
      elements.statusChip.textContent = "Downloading";
      return;
    }

    if (state.isRecording) {
      elements.statusChip.textContent = "Recording";
      return;
    }

    if (state.busy) {
      elements.statusChip.textContent = "Working";
      return;
    }

    if (!state.appState || !state.appState.whisperConfigured) {
      elements.statusChip.textContent = "Setup needed";
      return;
    }

    if (!selectedModel || !selectedModel.installed) {
      elements.statusChip.textContent = "Model needed";
      return;
    }

    elements.statusChip.textContent = state.appState.cleanupReady ? "Ready + cleanup" : "Ready";
  }

  function setBusy(isBusy) {
    state.busy = isBusy;

    elements.newNoteButton.disabled = isBusy || state.isRecording;
    elements.modelSelect.disabled = isBusy || state.isRecording || !state.appState;
    elements.downloadModelButton.disabled = isBusy || state.isRecording || !state.appState;
    elements.downloadCleanupModelButton.disabled = isBusy || state.isRecording || !state.appState;
    elements.toggleCleanupButton.disabled = isBusy || state.isRecording || !state.appState;
    elements.recordButton.disabled = isBusy || state.isRecording || !canRecord();
    elements.stopButton.disabled = isBusy || !state.isRecording;
    elements.copyButton.disabled = isBusy || !hasCurrentTranscript();

    for (const button of elements.historyList.querySelectorAll("button")) {
      button.disabled = isBusy || state.isRecording;
    }

    renderDictationControls();
    renderCleanupControls();
    updateStatusChip();
  }

  function setRecordingMode(isRecording) {
    state.isRecording = isRecording;

    if (isRecording) {
      startTimer();
      elements.recordButton.hidden = true;
      elements.stopButton.hidden = false;
    } else {
      stopTimer();
      elements.recordButton.hidden = false;
      elements.stopButton.hidden = true;
    }

    updateNoteHeader();
    updateSessionStatus();
    setBusy(state.busy);
  }

  function renderModelSelect() {
    const models = getVisibleDictationModels();
    const previousValue = elements.modelSelect.value;

    elements.modelSelect.innerHTML = "";

    for (const model of models) {
      const option = document.createElement("option");
      const copy = getModelCopy(model);
      const status = model.installed ? "ready" : "download needed";
      option.value = model.id;
      option.textContent = `${copy.label} (${model.label}) - ${status}`;
      elements.modelSelect.appendChild(option);
    }

    const selectedModel = models.find((model) => model.id === previousValue)
      || getSelectedModel()
      || models[0];

    if (selectedModel) {
      elements.modelSelect.value = selectedModel.id;
    }
  }

  function renderDictationControls() {
    const model = getSelectedModel();

    if (!model) {
      elements.dictationSummary.textContent = "Preparing local Whisper model options.";
      elements.downloadModelButton.textContent = "Download selected model";
      elements.downloadModelButton.disabled = true;
      return;
    }

    const copy = getModelCopy(model);

    if (!state.appState || !state.appState.whisperConfigured) {
      elements.dictationSummary.textContent = "The local dictation engine is not ready yet on this device.";
      elements.downloadModelButton.textContent = "Download selected model";
      elements.downloadModelButton.disabled = true;
      return;
    }

    elements.dictationSummary.textContent = model.installed
      ? `${copy.label}. ${copy.detail} Installed locally and ready.`
      : `${copy.label}. ${copy.detail} Download ${model.sizeLabel} to use it.`;

    elements.downloadModelButton.textContent = model.installed
      ? `${copy.label} ready`
      : `Download ${copy.label}`;
    elements.downloadModelButton.disabled = state.busy || state.isRecording || model.installed;
  }

  function renderCleanupControls() {
    const cleanupModel = getCleanupModel();

    if (!cleanupModel) {
      elements.cleanupSummary.textContent = "Preparing cleanup options.";
      elements.downloadCleanupModelButton.disabled = true;
      elements.toggleCleanupButton.disabled = true;
      elements.toggleCleanupButton.textContent = "Use cleanup";
      return;
    }

    if (!cleanupModel.installed) {
      elements.cleanupSummary.textContent = `${cleanupModel.label} improves grammar and common medical spelling after transcription.`;
      elements.downloadCleanupModelButton.textContent = "Download cleanup model";
      elements.downloadCleanupModelButton.disabled = state.busy || state.isRecording;
      elements.toggleCleanupButton.textContent = "Use cleanup";
      elements.toggleCleanupButton.disabled = true;
      return;
    }

    elements.downloadCleanupModelButton.textContent = "Cleanup ready";
    elements.downloadCleanupModelButton.disabled = true;

    if (!state.appState.cleanupAvailable) {
      elements.cleanupSummary.textContent = `${cleanupModel.label} is installed. Cleanup will turn on automatically once the local cleanup engine is ready.`;
      elements.toggleCleanupButton.textContent = "Use cleanup";
      elements.toggleCleanupButton.disabled = true;
      return;
    }

    elements.cleanupSummary.textContent = state.appState.cleanupEnabled
      ? `${cleanupModel.label} will polish each note automatically after transcription.`
      : `${cleanupModel.label} is installed and ready when you want it.`;
    elements.toggleCleanupButton.textContent = state.appState.cleanupEnabled ? "Cleanup on" : "Use cleanup";
    elements.toggleCleanupButton.disabled = state.busy || state.isRecording;
  }

  function renderHistoryList() {
    const historyItems = getHistoryItems();
    elements.historyList.innerHTML = "";
    elements.historyEmpty.hidden = historyItems.length > 0;

    for (const item of historyItems) {
      const button = document.createElement("button");
      const title = document.createElement("span");
      const meta = document.createElement("span");
      const preview = document.createElement("span");

      button.type = "button";
      button.className = `history-item${item.id === state.selectedHistoryId ? " active" : ""}`;
      button.dataset.id = item.id;

      title.className = "history-item-title";
      title.textContent = item.title || buildHistoryTitle(item.transcript);

      meta.className = "history-item-meta";
      meta.textContent = item.cleanupApplied
        ? `${formatTimestamp(item.createdAt)} • Cleaned`
        : `${formatTimestamp(item.createdAt)} • Direct transcript`;

      preview.className = "history-item-preview";
      preview.textContent = item.preview || item.transcript || "";

      button.append(title, meta, preview);
      button.addEventListener("click", () => {
        openHistoryItem(item.id);
      });

      elements.historyList.appendChild(button);
    }
  }

  function updateNoteHeader() {
    if (state.isRecording) {
      elements.noteTitle.textContent = "Recording in progress";
      elements.noteMeta.textContent = "Speak normally, then stop when the dictation is complete.";
      return;
    }

    const historyItem = getActiveHistoryItem();

    if (historyItem) {
      elements.noteTitle.textContent = historyItem.title || buildHistoryTitle(historyItem.transcript);
      elements.noteMeta.textContent = historyItem.cleanupApplied
        ? `${formatTimestamp(historyItem.createdAt)} • Cleaned for readability`
        : `${formatTimestamp(historyItem.createdAt)} • Direct transcript`;
      return;
    }

    if (hasCurrentTranscript()) {
      elements.noteTitle.textContent = "Draft note";
      elements.noteMeta.textContent = "Review the note, then copy it where you need it.";
      return;
    }

    elements.noteTitle.textContent = "New note";
    elements.noteMeta.textContent = "Local dictation stays on this device.";
  }

  function updateSessionStatus() {
    const selectedModel = getSelectedModel();

    if (state.progress) {
      elements.sessionStatus.textContent = "Downloading in the background. Keep this window open until it finishes.";
      updateStatusChip();
      return;
    }

    if (state.isRecording) {
      elements.sessionStatus.textContent = "Speak for 1-3 minutes, then click Stop and transcribe.";
      updateStatusChip();
      return;
    }

    if (!state.appState || !state.appState.whisperConfigured) {
      elements.sessionStatus.textContent = "Local dictation is not ready yet on this device.";
      updateStatusChip();
      return;
    }

    if (!selectedModel || !selectedModel.installed) {
      elements.sessionStatus.textContent = "Choose a dictation quality in Settings, then download it before recording.";
      updateStatusChip();
      return;
    }

    if (getActiveHistoryItem()) {
      elements.sessionStatus.textContent = "Saved note open. You can review it, edit it, or copy it.";
      updateStatusChip();
      return;
    }

    if (hasCurrentTranscript()) {
      elements.sessionStatus.textContent = "Note ready. You can edit it here or copy it.";
      updateStatusChip();
      return;
    }

    elements.sessionStatus.textContent = state.appState.cleanupReady
      ? "Press Start dictation. Cleanup will run automatically after transcription."
      : "Press Start dictation to capture a new local note.";
    updateStatusChip();
  }

  function renderProgress(progress) {
    state.progress = progress;

    if (!progress) {
      elements.activityPanel.hidden = true;
      elements.activityLabel.textContent = "Preparing download";
      elements.activityDetail.textContent = "Please wait";
      elements.activityValue.textContent = "0%";
      elements.activityProgressBar.style.width = "0%";
      updateStatusChip();
      return;
    }

    const hasPercent = Number.isFinite(progress.percent);
    const bytesDetail = progress.totalBytes
      ? `${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.totalBytes)}`
      : progress.receivedBytes
      ? `${formatBytes(progress.receivedBytes)} downloaded`
      : progress.detail || "Preparing download";

    elements.activityPanel.hidden = false;
    elements.activityLabel.textContent = progress.label || "Downloading";
    elements.activityDetail.textContent = bytesDetail;
    elements.activityValue.textContent = hasPercent ? `${progress.percent}%` : "Working";
    elements.activityProgressBar.style.width = hasPercent ? `${progress.percent}%` : "18%";
    updateStatusChip();
  }

  function clearCurrentNote() {
    state.selectedHistoryId = null;
    elements.transcriptOutput.value = "";
    updateNoteHeader();
    updateSessionStatus();
    renderHistoryList();
    setBusy(state.busy);
  }

  function openHistoryItem(historyId) {
    const item = getHistoryItems().find((entry) => entry.id === historyId);

    if (!item) {
      return;
    }

    state.selectedHistoryId = historyId;
    elements.transcriptOutput.value = item.transcript || "";
    updateNoteHeader();
    updateSessionStatus();
    renderHistoryList();
    setBusy(state.busy);
  }

  function applyNewTranscript(result) {
    if (result.historyEntry && result.historyEntry.id) {
      state.selectedHistoryId = result.historyEntry.id;
      elements.transcriptOutput.value = result.historyEntry.transcript;
    } else {
      state.selectedHistoryId = null;
      elements.transcriptOutput.value = result.transcript || "";
    }

    updateNoteHeader();
    updateSessionStatus();
    renderHistoryList();
    setBusy(state.busy);
  }

  function renderSetupState(appState) {
    state.appState = appState;

    if (state.selectedHistoryId && !getActiveHistoryItem()) {
      state.selectedHistoryId = null;
    }

    renderModelSelect();
    renderDictationControls();
    renderCleanupControls();
    renderHistoryList();
    updateNoteHeader();
    updateSessionStatus();
    setBusy(state.busy);
  }

  async function refreshState() {
    renderSetupState(await window.medWhisper.getState());
  }

  async function withBusyState(work) {
    setBusy(true);

    try {
      await work();
    } finally {
      setBusy(false);
      updateNoteHeader();
      updateSessionStatus();
    }
  }

  async function handleModelChange() {
    await withBusyState(async () => {
      renderSetupState(await window.medWhisper.setSelectedModel(elements.modelSelect.value));
    });
  }

  async function handleToggleCleanup(enabled) {
    await withBusyState(async () => {
      renderSetupState(await window.medWhisper.setCleanupEnabled(enabled));
    });
  }

  async function handleDownloadModel() {
    const model = getSelectedModel();

    if (!model || model.installed) {
      return;
    }

    await withBusyState(async () => {
      renderSetupState(await window.medWhisper.downloadModel(model.id));
    });
  }

  async function handleDownloadCleanupModel() {
    const cleanupModel = getCleanupModel();

    if (!cleanupModel || cleanupModel.installed) {
      return;
    }

    await withBusyState(async () => {
      renderSetupState(await window.medWhisper.downloadCleanupModel(cleanupModel.id));
    });
  }

  async function handleStartRecording() {
    if (!canRecord()) {
      elements.sessionStatus.textContent = "Download the selected dictation model before recording.";
      updateStatusChip();
      return;
    }

    if (getActiveHistoryItem() || hasCurrentTranscript()) {
      clearCurrentNote();
    }

    elements.sessionStatus.textContent = "Requesting microphone access...";
    updateStatusChip();

    await withBusyState(async () => {
      await recorder.start();
      setRecordingMode(true);
    });
  }

  async function handleStopRecording() {
    if (!state.isRecording) {
      return;
    }

    await withBusyState(async () => {
      setRecordingMode(false);
      elements.sessionStatus.textContent = "Preparing local audio...";
      updateStatusChip();

      const wavBuffer = await recorder.stop();
      const audioBase64 = arrayBufferToBase64(wavBuffer);
      const selectedModel = getSelectedModel();

      elements.sessionStatus.textContent = `Transcribing with ${selectedModel.label}...`;
      updateStatusChip();

      const result = await window.medWhisper.transcribe({
        audioBase64,
        language: "en",
        modelId: selectedModel.id,
      });

      applyNewTranscript(result);

      if (!result.transcript) {
        elements.sessionStatus.textContent = "Transcription finished, but no speech was detected.";
      } else if (result.cleanupApplied && result.cleanupModelLabel) {
        elements.sessionStatus.textContent = `Transcription complete. Cleaned with ${result.cleanupModelLabel}.`;
      } else if (result.cleanupError) {
        elements.sessionStatus.textContent = "Transcription complete. Cleanup was skipped, so this is the direct transcript.";
      } else {
        elements.sessionStatus.textContent = "Transcription complete.";
      }
    });
  }

  async function handleCopyTranscript() {
    const transcript = elements.transcriptOutput.value.trim();

    if (!transcript) {
      return;
    }

    await window.medWhisper.copyText(transcript);
    elements.sessionStatus.textContent = "Text copied to the clipboard.";
    updateStatusChip();
  }

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);

    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return window.btoa(binary);
  }

  function handleError(error) {
    console.error(error);
    setRecordingMode(false);
    setBusy(false);
    renderProgress(null);
    elements.sessionStatus.textContent = error.message || "Something went wrong during local transcription.";
    updateStatusChip();
  }

  elements.newNoteButton.addEventListener("click", () => {
    clearCurrentNote();
  });

  elements.modelSelect.addEventListener("change", () => {
    handleModelChange().catch(handleError);
  });

  elements.downloadModelButton.addEventListener("click", () => {
    handleDownloadModel().catch(handleError);
  });

  elements.downloadCleanupModelButton.addEventListener("click", () => {
    handleDownloadCleanupModel().catch(handleError);
  });

  elements.toggleCleanupButton.addEventListener("click", () => {
    handleToggleCleanup(!state.appState?.cleanupEnabled).catch(handleError);
  });

  elements.recordButton.addEventListener("click", () => {
    handleStartRecording().catch(handleError);
  });

  elements.stopButton.addEventListener("click", () => {
    handleStopRecording().catch(handleError);
  });

  elements.copyButton.addEventListener("click", () => {
    handleCopyTranscript().catch(handleError);
  });

  elements.openSettingsButton.addEventListener("click", () => {
    elements.settingsDialog.showModal();
  });

  elements.closeSettingsButton.addEventListener("click", () => {
    elements.settingsDialog.close();
  });

  elements.transcriptOutput.addEventListener("input", () => {
    updateNoteHeader();
    updateSessionStatus();
    setBusy(state.busy);
  });

  elements.stopButton.hidden = true;
  elements.timer.hidden = true;

  window.medWhisper.onStateUpdated((nextState) => {
    renderSetupState(nextState);
  });

  window.medWhisper.onProgressUpdated((progress) => {
    renderProgress(progress);
    updateSessionStatus();
  });

  refreshState().catch(handleError);
})();
