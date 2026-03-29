(function main() {
  const recorder = new window.WavRecorder();
  const state = {
    appState: null,
    isRecording: false,
    busy: false,
    timerStartedAt: 0,
    timerHandle: null,
    selectedHistoryId: null,
  };

  const elements = {
    historyList: document.getElementById("history-list"),
    historyEmpty: document.getElementById("history-empty"),
    newNoteButton: document.getElementById("new-note-button"),
    statusChip: document.getElementById("status-chip"),
    dictationSummary: document.getElementById("dictation-summary"),
    cleanupSummary: document.getElementById("cleanup-summary"),
    modelSelect: document.getElementById("model-select"),
    modelDescription: document.getElementById("model-description"),
    downloadModelButton: document.getElementById("download-model-button"),
    cleanupModelSelect: document.getElementById("cleanup-model-select"),
    cleanupModelDescription: document.getElementById("cleanup-model-description"),
    downloadCleanupModelButton: document.getElementById("download-cleanup-model-button"),
    toggleCleanupButton: document.getElementById("toggle-cleanup-button"),
    selectCliButton: document.getElementById("select-cli-button"),
    selectModelsButton: document.getElementById("select-models-button"),
    selectLlamaButton: document.getElementById("select-llama-button"),
    selectCleanupModelButton: document.getElementById("select-cleanup-model-button"),
    openModelsButton: document.getElementById("open-models-button"),
    cliPath: document.getElementById("cli-path"),
    modelsDir: document.getElementById("models-dir"),
    cleanupEnabled: document.getElementById("cleanup-enabled"),
    llamaCliPath: document.getElementById("llama-cli-path"),
    cleanupModelPath: document.getElementById("cleanup-model-path"),
    cleanupModelsDir: document.getElementById("cleanup-models-dir"),
    noteLabel: document.getElementById("note-label"),
    noteTitle: document.getElementById("note-title"),
    noteMeta: document.getElementById("note-meta"),
    timer: document.getElementById("timer"),
    recordButton: document.getElementById("record-button"),
    stopButton: document.getElementById("stop-button"),
    copyButton: document.getElementById("copy-button"),
    sessionStatus: document.getElementById("session-status"),
    transcriptOutput: document.getElementById("transcript-output"),
  };

  function getSelectedModel() {
    if (!state.appState) {
      return null;
    }

    return state.appState.modelOptions.find((model) => model.id === elements.modelSelect.value) || null;
  }

  function getSelectedCleanupModel() {
    if (!state.appState) {
      return null;
    }

    return state.appState.cleanupModelOptions.find((model) => model.id === elements.cleanupModelSelect.value) || null;
  }

  function getDictationModel() {
    if (!state.appState) {
      return null;
    }

    return state.appState.modelOptions.find((model) => model.recommended)
      || state.appState.modelOptions[0]
      || null;
  }

  function getRecommendedCleanupModel() {
    if (!state.appState) {
      return null;
    }

    return state.appState.cleanupModelOptions.find((model) => model.recommended)
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
    if (!state.appState || !state.appState.whisperConfigured) {
      return false;
    }

    const selectedModel = getDictationModel();
    return Boolean(selectedModel && selectedModel.installed);
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatTimestamp(isoString) {
    const date = new Date(isoString);

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function startTimer() {
    stopTimer();
    state.timerStartedAt = Date.now();
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
    }
  }

  function setBusy(isBusy) {
    state.busy = isBusy;

    elements.newNoteButton.disabled = isBusy || state.isRecording;
    elements.selectCliButton.disabled = isBusy || state.isRecording;
    elements.selectModelsButton.disabled = isBusy || state.isRecording;
    elements.selectLlamaButton.disabled = isBusy || state.isRecording;
    elements.selectCleanupModelButton.disabled = isBusy || state.isRecording;
    elements.openModelsButton.disabled = isBusy;
    elements.modelSelect.disabled = isBusy || state.isRecording;
    elements.cleanupModelSelect.disabled = isBusy || state.isRecording || !state.appState;
    elements.cleanupEnabled.disabled = isBusy || state.isRecording || !state.appState || !state.appState.cleanupAvailable;
    elements.downloadModelButton.disabled = isBusy || state.isRecording || !state.appState;
    elements.downloadCleanupModelButton.disabled = isBusy || state.isRecording || !state.appState;
    elements.toggleCleanupButton.disabled = isBusy || state.isRecording || !state.appState || !state.appState.cleanupAvailable;
    elements.recordButton.disabled = isBusy || state.isRecording || !canRecord();
    elements.stopButton.disabled = isBusy || !state.isRecording;
    elements.copyButton.disabled = isBusy || !hasCurrentTranscript();

    for (const button of elements.historyList.querySelectorAll("button")) {
      button.disabled = isBusy || state.isRecording;
    }

    if (state.appState) {
      renderDictationControls();
      renderCleanupControls();
    }
  }

  function setRecordingMode(isRecording) {
    state.isRecording = isRecording;

    if (isRecording) {
      startTimer();
    } else {
      stopTimer();
    }

    updateNoteHeader();
    updateSessionStatus();
    setBusy(state.busy);
  }

  function getPreferredModelId(models) {
    const installedRecommended = models.find((model) => model.recommended && model.installed);
    if (installedRecommended) {
      return installedRecommended.id;
    }

    const installedModel = models.find((model) => model.installed);
    if (installedModel) {
      return installedModel.id;
    }

    const recommended = models.find((model) => model.recommended);
    return recommended ? recommended.id : models[0].id;
  }

  function renderModelSelect() {
    if (!state.appState) {
      return;
    }

    const previousValue = elements.modelSelect.value;
    elements.modelSelect.innerHTML = "";

    for (const model of state.appState.modelOptions) {
      const option = document.createElement("option");
      const status = model.installed ? "installed" : "not installed";
      option.value = model.id;
      option.textContent = `${model.label} - ${model.sizeLabel} - ${status}`;
      elements.modelSelect.appendChild(option);
    }

    const nextValue = state.appState.modelOptions.some((model) => model.id === previousValue)
      ? previousValue
      : getPreferredModelId(state.appState.modelOptions);

    elements.modelSelect.value = nextValue;
    renderModelDetails();
  }

  function renderModelDetails() {
    const model = getSelectedModel();

    if (!model) {
      elements.modelDescription.textContent = "Select a model to see local install status.";
      return;
    }

    elements.modelDescription.textContent = `${model.description}. ${model.installed ? "Installed locally." : "Download required."}`;
    elements.downloadModelButton.textContent = model.installed
      ? "Model installed"
      : `Download ${model.label}`;
    elements.downloadModelButton.disabled = state.busy || state.isRecording || model.installed;
  }

  function renderDictationControls() {
    const model = getDictationModel();

    if (!model) {
      elements.dictationSummary.textContent = "Preparing local Whisper model...";
      return;
    }

    elements.modelSelect.value = model.id;
    if (!state.appState.whisperConfigured) {
      elements.dictationSummary.textContent = "Local dictation is not ready yet.";
      elements.downloadModelButton.textContent = "Download dictation model";
      elements.downloadModelButton.disabled = true;
      return;
    }

    elements.dictationSummary.textContent = model.installed
      ? `${model.label} is ready for local English dictation.`
      : `Download ${model.label} to enable local English dictation.`;
    elements.downloadModelButton.textContent = model.installed ? "Dictation ready" : "Download dictation model";
    elements.downloadModelButton.disabled = state.busy || state.isRecording || model.installed;
  }

  function getPreferredCleanupModelId(models) {
    const selectedInstalled = models.find((model) => model.id === state.appState.selectedCleanupModelId && model.installed);
    if (selectedInstalled) {
      return selectedInstalled.id;
    }

    const recommendedInstalled = models.find((model) => model.recommended && model.installed);
    if (recommendedInstalled) {
      return recommendedInstalled.id;
    }

    const recommended = models.find((model) => model.recommended);
    return recommended ? recommended.id : models[0].id;
  }

  function renderCleanupModelSelect() {
    if (!state.appState) {
      return;
    }

    const previousValue = elements.cleanupModelSelect.value;
    elements.cleanupModelSelect.innerHTML = "";

    for (const model of state.appState.cleanupModelOptions) {
      const option = document.createElement("option");
      const status = model.installed ? "installed" : "not installed";
      option.value = model.id;
      option.textContent = `${model.label} - ${model.variantLabel} - ${status}`;
      elements.cleanupModelSelect.appendChild(option);
    }

    const nextValue = state.appState.cleanupModelOptions.some((model) => model.id === previousValue)
      ? previousValue
      : getPreferredCleanupModelId(state.appState.cleanupModelOptions);

    elements.cleanupModelSelect.value = nextValue;
    renderCleanupModelDetails();
  }

  function renderCleanupModelDetails() {
    const model = getSelectedCleanupModel();

    if (!model) {
      elements.cleanupModelDescription.textContent = "Choose a cleanup model for grammar and medical-term correction.";
      return;
    }

    elements.cleanupModelDescription.textContent = `${model.description} ${model.installed ? "Installed locally." : "Download required."}`;
    elements.downloadCleanupModelButton.textContent = model.installed
      ? "Cleanup model installed"
      : `Download ${model.label}`;
    elements.downloadCleanupModelButton.disabled = state.busy || state.isRecording || model.installed;
  }

  function renderCleanupControls() {
    const model = getRecommendedCleanupModel();

    if (!model) {
      elements.cleanupSummary.textContent = "Preparing cleanup model options...";
      elements.downloadCleanupModelButton.disabled = true;
      elements.toggleCleanupButton.textContent = "Use cleanup";
      elements.toggleCleanupButton.disabled = true;
      return;
    }

    elements.cleanupModelSelect.value = model.id;

    if (!model.installed) {
      elements.cleanupSummary.textContent = `${model.label} improves grammar and medical terms after transcription.`;
      elements.downloadCleanupModelButton.textContent = "Download cleanup model";
      elements.downloadCleanupModelButton.disabled = state.busy || state.isRecording;
      elements.toggleCleanupButton.textContent = "Use cleanup";
      elements.toggleCleanupButton.disabled = true;
      return;
    }

    elements.downloadCleanupModelButton.textContent = "Cleanup model ready";
    elements.downloadCleanupModelButton.disabled = true;
    elements.toggleCleanupButton.textContent = state.appState.cleanupEnabled ? "Using cleanup" : "Use cleanup";
    elements.toggleCleanupButton.disabled = state.busy || state.isRecording || !state.appState.cleanupAvailable;
    elements.cleanupSummary.textContent = !state.appState.cleanupAvailable
      ? `${model.label} is installed. Cleanup will turn on automatically when the local engine is ready.`
      : state.appState.cleanupEnabled
      ? `${model.label} is cleaning transcripts automatically.`
      : `${model.label} is installed and ready when you want it.`;
  }

  function renderHistoryList() {
    const historyItems = getHistoryItems();
    elements.historyList.innerHTML = "";
    elements.historyEmpty.hidden = historyItems.length > 0;

    for (const item of historyItems) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `history-item${item.id === state.selectedHistoryId ? " active" : ""}`;
      button.dataset.id = item.id;

      const title = document.createElement("span");
      title.className = "history-item-title";
      title.textContent = formatTimestamp(item.createdAt);

      const meta = document.createElement("span");
      meta.className = "history-item-meta";
      meta.textContent = item.cleanupApplied && item.cleanupModelLabel
        ? `${item.modelId} + ${item.cleanupModelLabel}`
        : item.modelId;

      const preview = document.createElement("span");
      preview.className = "history-item-preview";
      preview.textContent = item.preview || item.transcript;

      button.appendChild(title);
      button.appendChild(meta);
      button.appendChild(preview);
      button.addEventListener("click", () => {
        openHistoryItem(item.id);
      });

      elements.historyList.appendChild(button);
    }
  }

  function updateNoteHeader() {
    if (state.isRecording) {
      elements.noteLabel.textContent = "Current note";
      elements.noteTitle.textContent = "Recording";
      elements.noteMeta.textContent = "Speak normally, then click stop when you are done.";
      return;
    }

    const historyItem = getActiveHistoryItem();

    if (historyItem) {
      elements.noteLabel.textContent = "Saved transcription";
      elements.noteTitle.textContent = "Transcription";
      elements.noteMeta.textContent = historyItem.cleanupApplied && historyItem.cleanupModelLabel
        ? `${formatTimestamp(historyItem.createdAt)} - ${historyItem.modelId} cleaned by ${historyItem.cleanupModelLabel}`
        : `${formatTimestamp(historyItem.createdAt)} - ${historyItem.modelId}`;
      return;
    }

    elements.noteLabel.textContent = "Current note";
    elements.noteTitle.textContent = hasCurrentTranscript() ? "Transcription" : "New transcription";
    elements.noteMeta.textContent = hasCurrentTranscript()
      ? "Latest local whisper.cpp result."
      : "Ready for a new dictation.";
  }

  function updateSessionStatus() {
    if (state.isRecording) {
      elements.sessionStatus.textContent = "Recording from the microphone.";
      return;
    }

    if (!state.appState || !state.appState.whisperConfigured) {
      elements.sessionStatus.textContent = "Local dictation is not ready yet.";
      return;
    }

    const selectedModel = getDictationModel();

    if (!selectedModel || !selectedModel.installed) {
      elements.sessionStatus.textContent = "Download the dictation model before recording.";
      return;
    }

    if (getActiveHistoryItem()) {
      elements.sessionStatus.textContent = "Viewing a saved transcription.";
      return;
    }

    if (hasCurrentTranscript()) {
      elements.sessionStatus.textContent = state.appState.cleanupReady
        ? "Ready for another transcription or copy this cleaned note."
        : "Ready for another transcription or copy this one.";
      return;
    }

    elements.sessionStatus.textContent = state.appState.cleanupReady
      ? "Ready to record a new dictation with local medical cleanup."
      : "Ready to record a new dictation.";
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
    elements.cliPath.textContent = appState.whisperCliPath || "Not configured yet";
    elements.modelsDir.textContent = appState.modelsDir;
    elements.llamaCliPath.textContent = appState.llamaCliPath || "Not configured yet";
    elements.cleanupModelPath.textContent = appState.cleanupModelPath || "No GGUF model selected.";
    elements.cleanupModelsDir.textContent = appState.cleanupModelsDir || "Preparing folder path...";
    elements.cleanupEnabled.checked = Boolean(appState.cleanupEnabled && appState.cleanupAvailable);
    elements.statusChip.textContent = appState.whisperConfigured ? "Whisper ready" : "Whisper setup needed";

    renderModelSelect();
    renderDictationControls();
    renderCleanupModelSelect();
    renderCleanupControls();

    if (state.selectedHistoryId && !getActiveHistoryItem()) {
      state.selectedHistoryId = null;
    }

    renderHistoryList();
    updateNoteHeader();
    updateSessionStatus();
    setBusy(state.busy);
  }

  async function refreshState() {
    const nextState = await window.medWhisper.getState();
    renderSetupState(nextState);
  }

  async function withBusyState(work) {
    setBusy(true);

    try {
      await work();
    } finally {
      setBusy(false);
      renderModelDetails();
      renderDictationControls();
      renderCleanupModelDetails();
      renderCleanupControls();
      updateNoteHeader();
      updateSessionStatus();
    }
  }

  async function handleSelectCli() {
    await withBusyState(async () => {
      const nextState = await window.medWhisper.selectWhisperCli();
      renderSetupState(nextState);
    });
  }

  async function handleSelectModelsDir() {
    await withBusyState(async () => {
      const nextState = await window.medWhisper.selectModelsDir();
      renderSetupState(nextState);
    });
  }

  async function handleSelectLlamaCli() {
    await withBusyState(async () => {
      const nextState = await window.medWhisper.selectLlamaCli();
      renderSetupState(nextState);
    });
  }

  async function handleSelectCleanupModel() {
    await withBusyState(async () => {
      const nextState = await window.medWhisper.selectCleanupModel();
      renderSetupState(nextState);
    });
  }

  async function handleToggleCleanup(enabled) {
    await withBusyState(async () => {
      const nextState = await window.medWhisper.setCleanupEnabled(enabled);
      renderSetupState(nextState);
    });
  }

  async function handleDownloadCleanupModel() {
    const model = getRecommendedCleanupModel();

    if (!model || model.installed) {
      return;
    }

    elements.sessionStatus.textContent = `Downloading ${model.label} cleanup model...`;

    await withBusyState(async () => {
      const nextState = await window.medWhisper.downloadCleanupModel(model.id);
      renderSetupState(nextState);
      elements.sessionStatus.textContent = `${model.label} cleanup model is ready.`;
    });
  }

  async function handleDownloadModel() {
    const model = getDictationModel();

    if (!model || model.installed) {
      return;
    }

    elements.sessionStatus.textContent = `Downloading ${model.label}...`;

    await withBusyState(async () => {
      const nextState = await window.medWhisper.downloadModel(model.id);
      renderSetupState(nextState);
      elements.sessionStatus.textContent = `${model.label} is ready for local transcription.`;
    });
  }

  async function handleStartRecording() {
    if (!canRecord()) {
      elements.sessionStatus.textContent = "Install the dictation model before recording.";
      return;
    }

    if (getActiveHistoryItem() || hasCurrentTranscript()) {
      clearCurrentNote();
    }

    elements.sessionStatus.textContent = "Requesting microphone access...";

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
      const wavBuffer = await recorder.stop();
      const audioBase64 = arrayBufferToBase64(wavBuffer);
      const selectedModel = getDictationModel();

      elements.sessionStatus.textContent = `Transcribing with ${selectedModel.label}...`;

      const result = await window.medWhisper.transcribe({
        audioBase64,
        language: selectedModel.id.endsWith(".en") ? "en" : "auto",
        modelId: selectedModel.id,
      });

      applyNewTranscript(result);
      if (!result.transcript) {
        elements.sessionStatus.textContent = "Transcription finished, but no speech was detected.";
      } else if (result.cleanupApplied && result.cleanupModelLabel) {
        elements.sessionStatus.textContent = `Transcription complete. Cleaned with ${result.cleanupModelLabel}.`;
      } else if (result.cleanupError) {
        elements.sessionStatus.textContent = "Transcription complete. Medical cleanup fell back to raw Whisper output.";
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
    elements.sessionStatus.textContent = "Transcript copied to the clipboard.";
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
    elements.sessionStatus.textContent = error.message || "Something went wrong during local transcription.";
  }

  elements.newNoteButton.addEventListener("click", () => {
    clearCurrentNote();
  });

  elements.selectCliButton.addEventListener("click", () => {
    handleSelectCli().catch(handleError);
  });

  elements.selectModelsButton.addEventListener("click", () => {
    handleSelectModelsDir().catch(handleError);
  });

  elements.selectLlamaButton.addEventListener("click", () => {
    handleSelectLlamaCli().catch(handleError);
  });

  elements.selectCleanupModelButton.addEventListener("click", () => {
    handleSelectCleanupModel().catch(handleError);
  });

  elements.openModelsButton.addEventListener("click", () => {
    window.medWhisper.openModelsDir().catch(handleError);
  });

  elements.cleanupEnabled.addEventListener("change", () => {
    handleToggleCleanup(elements.cleanupEnabled.checked).catch(handleError);
  });

  elements.downloadModelButton.addEventListener("click", () => {
    handleDownloadModel().catch(handleError);
  });

  elements.downloadCleanupModelButton.addEventListener("click", () => {
    handleDownloadCleanupModel().catch(handleError);
  });

  elements.toggleCleanupButton.addEventListener("click", () => {
    handleToggleCleanup(!elements.cleanupEnabled.checked).catch(handleError);
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

  window.medWhisper.onStateUpdated((nextState) => {
    renderSetupState(nextState);
  });

  refreshState().catch(handleError);
})();
