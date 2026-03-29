const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { readAppConfig, writeAppConfig } = require("./config-store");

const HISTORY_FILENAME = "med-whisper-history.json";
const OFFICIAL_MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const EXECUTABLE_NAME = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
const MAX_HISTORY_ITEMS = 50;

const KNOWN_MODELS = [
  {
    id: "tiny.en",
    label: "tiny.en",
    description: "Fastest English-only model for quick notes",
    sizeLabel: "75 MiB",
    sha1: "c78c86eb1a8faa21b369bcd33207cc90d64ae9df",
  },
  {
    id: "base.en",
    label: "base.en",
    description: "Best starting point for English dictation",
    sizeLabel: "142 MiB",
    sha1: "137c40403d78fd54d454da0f9bd998f78703390c",
    recommended: true,
  },
  {
    id: "small.en",
    label: "small.en",
    description: "Higher accuracy for English with moderate RAM use",
    sizeLabel: "466 MiB",
    sha1: "db8a495a91d927739e50b3fc1cc4c6b8f6c2d022",
  },
  {
    id: "medium.en",
    label: "medium.en",
    description: "Strong English accuracy for longer dictation",
    sizeLabel: "1.5 GiB",
    sha1: "8c30f0e44ce9560643ebd10bbe50cd20eafd3723",
  },
  {
    id: "base",
    label: "base",
    description: "Multilingual base model",
    sizeLabel: "142 MiB",
    sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
  },
  {
    id: "small",
    label: "small",
    description: "Multilingual small model",
    sizeLabel: "466 MiB",
    sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
  },
  {
    id: "medium",
    label: "medium",
    description: "Multilingual medium model",
    sizeLabel: "1.5 GiB",
    sha1: "fd9727b6e1217c2f614f9b698455c4ffd82463b4",
  },
  {
    id: "large-v3-turbo",
    label: "large-v3-turbo",
    description: "Fast large model with excellent accuracy",
    sizeLabel: "1.5 GiB",
    sha1: "4af2b29d7ec73d781377bfd1758ca957a807e941",
  },
];

function getDefaultModelsDir(context) {
  if (context.isPackaged) {
    return path.join(context.userDataDir, "models");
  }

  return path.join(context.appRoot, "whisper-models");
}

function getTempDir(context) {
  return path.join(context.userDataDir, "temp");
}

function getHistoryPath(context) {
  return path.join(context.userDataDir, HISTORY_FILENAME);
}

async function ensureDirectory(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true });
}

async function readHistory(context) {
  const historyPath = getHistoryPath(context);

  try {
    const file = await fsPromises.readFile(historyPath, "utf8");
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeHistory(context, historyItems) {
  await ensureDirectory(context.userDataDir);
  await fsPromises.writeFile(getHistoryPath(context), JSON.stringify(historyItems, null, 2), "utf8");
}

async function saveWhisperCliPath(context, whisperCliPath) {
  const config = await readAppConfig(context);
  config.whisperCliPath = whisperCliPath;
  await writeAppConfig(context, config);
}

async function saveModelsDir(context, modelsDir) {
  const config = await readAppConfig(context);
  config.modelsDir = modelsDir;
  await writeAppConfig(context, config);
}

async function saveSelectedModelId(context, selectedModelId) {
  const config = await readAppConfig(context);
  config.selectedModelId = selectedModelId;
  await writeAppConfig(context, config);
}

function getWhisperCliCandidates(context, configuredPath) {
  const candidates = [];

  if (configuredPath) {
    candidates.push(configuredPath);
  }

  candidates.push(
    path.join(context.appRoot, "vendor", "whisper.cpp", "build", "bin", EXECUTABLE_NAME),
    path.join(context.appRoot, "vendor", "whisper.cpp", "build", "bin", "Release", EXECUTABLE_NAME),
    path.join(context.resourcesPath, "whisper", "bin", EXECUTABLE_NAME),
    path.join(context.resourcesPath, "whisper", EXECUTABLE_NAME),
    EXECUTABLE_NAME
  );

  return Array.from(new Set(candidates));
}

function fileExists(filePath) {
  if (filePath === EXECUTABLE_NAME) {
    return false;
  }

  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const shouldUseShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      windowsHide: true,
      shell: shouldUseShell,
    });
    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

async function detectWhisperCliPath(context, configuredPath) {
  for (const candidate of getWhisperCliCandidates(context, configuredPath)) {
    if (candidate === EXECUTABLE_NAME) {
      try {
        const result = await runCommand(candidate, ["-h"]);
        if (result.code === 0 || result.stdout || result.stderr) {
          return candidate;
        }
      } catch {
        continue;
      }
    } else if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getModelPath(modelsDir, modelId) {
  return path.join(modelsDir, `ggml-${modelId}.bin`);
}

async function listInstalledModels(modelsDir) {
  try {
    await ensureDirectory(modelsDir);
  } catch {
    return [];
  }

  const installed = [];

  for (const model of KNOWN_MODELS) {
    try {
      await fsPromises.access(getModelPath(modelsDir, model.id));
      installed.push(model.id);
    } catch {
      continue;
    }
  }

  return installed;
}

async function resolveWhisperState(context) {
  const config = await readAppConfig(context);
  const modelsDir = config.modelsDir || getDefaultModelsDir(context);
  const whisperCliPath = await detectWhisperCliPath(context, config.whisperCliPath);
  const installedModels = await listInstalledModels(modelsDir);
  const installedSet = new Set(installedModels);
  const recentTranscriptions = await readHistory(context);

  return {
    whisperCliPath,
    whisperConfigured: Boolean(whisperCliPath),
    modelsDir,
    selectedModelId: config.selectedModelId || null,
    modelOptions: KNOWN_MODELS.map((model) => ({
      ...model,
      installed: installedSet.has(model.id),
      path: getModelPath(modelsDir, model.id),
    })),
    recentTranscriptions,
  };
}

async function downloadToFile(url, destinationPath, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const response = await fetch(url, {
    headers: {
      "user-agent": "med-whisper",
    },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const tempPath = `${destinationPath}.download`;
  const hash = crypto.createHash("sha1");
  const readable = Readable.fromWeb(response.body);
  const totalBytesHeader = response.headers.get("content-length");
  const totalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : null;
  let receivedBytes = 0;
  let lastReportedPercent = -1;

  await ensureDirectory(path.dirname(destinationPath));

  await new Promise((resolve, reject) => {
    const writable = fs.createWriteStream(tempPath);

    const handleError = async (error) => {
      readable.destroy();
      writable.destroy();
      try {
        await fsPromises.rm(tempPath, { force: true });
      } catch {
        // Ignore cleanup errors.
      }
      reject(error);
    };

    readable.on("data", (chunk) => {
      hash.update(chunk);
      receivedBytes += chunk.length;

      if (!onProgress) {
        return;
      }

      const percent = totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null;
      if (percent !== null && percent === lastReportedPercent && receivedBytes < totalBytes) {
        return;
      }

      lastReportedPercent = percent ?? lastReportedPercent;
      onProgress({
        receivedBytes,
        totalBytes,
        percent,
      });
    });

    readable.on("error", handleError);
    writable.on("error", handleError);
    writable.on("finish", resolve);
    readable.pipe(writable);
  });

  if (onProgress) {
    onProgress({
      receivedBytes,
      totalBytes,
      percent: totalBytes ? 100 : null,
    });
  }

  return {
    sha1: hash.digest("hex"),
    tempPath,
  };
}

async function downloadModel(context, modelId, options = {}) {
  const model = KNOWN_MODELS.find((entry) => entry.id === modelId);

  if (!model) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  const config = await readAppConfig(context);
  const modelsDir = config.modelsDir || getDefaultModelsDir(context);
  const destinationPath = getModelPath(modelsDir, modelId);

  try {
    await fsPromises.access(destinationPath);
    return destinationPath;
  } catch {
    // Continue with download when the file is missing.
  }

  const url = `${OFFICIAL_MODEL_BASE_URL}/ggml-${modelId}.bin`;
  const result = await downloadToFile(url, destinationPath, options);

  if (result.sha1 !== model.sha1) {
    await fsPromises.rm(result.tempPath, { force: true });
    throw new Error(`Checksum mismatch for ${modelId}. Expected ${model.sha1} but received ${result.sha1}.`);
  }

  await fsPromises.rename(result.tempPath, destinationPath);
  return destinationPath;
}

function createJobId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function buildPreview(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 110);
}

function buildTitle(text) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Untitled dictation";
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

async function cleanupFiles(...filePaths) {
  await Promise.all(
    filePaths.filter(Boolean).map(async (filePath) => {
      try {
        await fsPromises.rm(filePath, { force: true });
      } catch {
        // Ignore cleanup errors.
      }
    })
  );
}

async function transcribeAudio(context, payload) {
  const state = await resolveWhisperState(context);

  if (!state.whisperCliPath) {
    throw new Error("whisper-cli is not configured yet. Run the setup script or select the binary in the app.");
  }

  const modelId = payload.modelId || "base.en";
  const modelPath = getModelPath(state.modelsDir, modelId);

  try {
    await fsPromises.access(modelPath);
  } catch {
    throw new Error(`Model ${modelId} is not installed yet. Download it before transcribing.`);
  }

  const language = payload.language || "en";
  const audioBase64 = payload.audioBase64;

  if (!audioBase64) {
    throw new Error("Missing recorded audio.");
  }

  const wavBuffer = Buffer.from(audioBase64, "base64");
  const tempDir = getTempDir(context);
  const jobId = createJobId();
  const audioPath = path.join(tempDir, `recording-${jobId}.wav`);
  const outputBase = path.join(tempDir, `transcript-${jobId}`);
  const outputTextPath = `${outputBase}.txt`;
  const threadCount = Math.max(2, Math.min(8, os.cpus().length || 4));

  await ensureDirectory(tempDir);
  await fsPromises.writeFile(audioPath, wavBuffer);

  const args = [
    "-m",
    modelPath,
    "-f",
    audioPath,
    "-nt",
    "-np",
    "-otxt",
    "-of",
    outputBase,
    "-t",
    String(threadCount),
  ];

  if (language === "auto") {
    args.push("-dl");
  } else {
    args.push("-l", language);
  }

  let commandResult;

  try {
    commandResult = await runCommand(state.whisperCliPath, args);
  } catch (error) {
    await cleanupFiles(audioPath, outputTextPath);
    throw new Error(`Failed to start whisper-cli: ${error.message}`);
  }

  let transcript = "";

  try {
    transcript = await fsPromises.readFile(outputTextPath, "utf8");
  } catch {
    transcript = "";
  }

  await cleanupFiles(audioPath, outputTextPath);

  if (commandResult.code !== 0) {
    const details = commandResult.stderr || commandResult.stdout || "Unknown whisper.cpp error";
    throw new Error(details.trim());
  }

  return {
    transcript: transcript.trim(),
    modelId,
  };
}

async function saveTranscriptionEntry(context, payload) {
  const cleanedTranscript = (payload.transcript || "").trim();

  if (!cleanedTranscript) {
    return null;
  }

  const entry = {
    id: createJobId(),
    createdAt: new Date().toISOString(),
    modelId: payload.modelId,
    title: buildTitle(cleanedTranscript),
    preview: buildPreview(cleanedTranscript),
    transcript: cleanedTranscript,
    rawTranscript: (payload.rawTranscript || cleanedTranscript).trim(),
    cleanupApplied: Boolean(payload.cleanupApplied),
    cleanupModelLabel: payload.cleanupModelLabel || null,
  };

  const history = await readHistory(context);
  const nextHistory = [entry, ...history].slice(0, MAX_HISTORY_ITEMS);
  await writeHistory(context, nextHistory);
  return entry;
}

module.exports = {
  KNOWN_MODELS,
  downloadModel,
  resolveWhisperState,
  saveModelsDir,
  saveSelectedModelId,
  saveTranscriptionEntry,
  saveWhisperCliPath,
  transcribeAudio,
};
