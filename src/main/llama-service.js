const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { readAppConfig, writeAppConfig } = require("./config-store");

const EXECUTABLE_NAME = process.platform === "win32" ? "llama-cli.exe" : "llama-cli";
const KNOWN_CLEANUP_MODELS = [
  {
    id: "qwen35-2b-q4km",
    label: "Qwen3.5-2B",
    variantLabel: "Q4_K_M GGUF",
    description: "Recommended laptop cleanup model for grammar and medical terms.",
    sourceUrl: "https://huggingface.co/AaryanK/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B.q4_k_m.gguf?download=true",
    fileName: "Qwen3.5-2B.q4_k_m.gguf",
    recommended: true,
  },
  {
    id: "qwen35-4b-q4km",
    label: "Qwen3.5-4B",
    variantLabel: "Q4_K_M GGUF",
    description: "Stronger cleanup model for machines with more RAM.",
    sourceUrl: "https://huggingface.co/AaryanK/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B.q4_k_m.gguf?download=true",
    fileName: "Qwen3.5-4B.q4_k_m.gguf",
  },
];

function getDefaultCleanupModelsDir(context) {
  if (context.isPackaged) {
    return path.join(context.userDataDir, "llm-models");
  }

  return path.join(context.appRoot, "llm-models");
}

function getCleanupModelPath(cleanupModelsDir, modelId) {
  const model = KNOWN_CLEANUP_MODELS.find((entry) => entry.id === modelId);

  if (!model) {
    throw new Error(`Unsupported cleanup model: ${modelId}`);
  }

  return path.join(cleanupModelsDir, model.fileName);
}

function fileExists(filePath) {
  if (!filePath || filePath === EXECUTABLE_NAME) {
    return false;
  }

  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getLlamaCliCandidates(context, configuredPath) {
  const candidates = [];

  if (configuredPath) {
    candidates.push(configuredPath);
  }

  candidates.push(
    path.join(context.appRoot, "vendor", "llama.cpp", "build", "bin", EXECUTABLE_NAME),
    path.join(context.appRoot, "vendor", "llama.cpp", "build", "bin", "Release", EXECUTABLE_NAME),
    path.join(context.appRoot, "build", "bin", EXECUTABLE_NAME),
    path.join(context.appRoot, "build", "bin", "Release", EXECUTABLE_NAME),
    path.join(context.resourcesPath, "llama", "bin", EXECUTABLE_NAME),
    path.join(context.resourcesPath, "llama", EXECUTABLE_NAME),
    EXECUTABLE_NAME
  );

  return Array.from(new Set(candidates));
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
      resolve({ code, stdout, stderr });
    });
  });
}

async function detectLlamaCliPath(context, configuredPath) {
  for (const candidate of getLlamaCliCandidates(context, configuredPath)) {
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

function getCleanupModelLabel(modelPath) {
  if (!modelPath) {
    return null;
  }

  return path.basename(modelPath, path.extname(modelPath));
}

function getSelectedCleanupModelId(cleanupModelPath, cleanupModelsDir) {
  if (!cleanupModelPath) {
    return null;
  }

  for (const model of KNOWN_CLEANUP_MODELS) {
    if (path.resolve(cleanupModelPath) === path.resolve(path.join(cleanupModelsDir, model.fileName))) {
      return model.id;
    }
  }

  return null;
}

async function listInstalledCleanupModels(cleanupModelsDir) {
  await fsPromises.mkdir(cleanupModelsDir, { recursive: true });
  const installed = [];

  for (const model of KNOWN_CLEANUP_MODELS) {
    if (fileExists(path.join(cleanupModelsDir, model.fileName))) {
      installed.push(model.id);
    }
  }

  return installed;
}

async function resolveLlamaState(context) {
  const config = await readAppConfig(context);
  const llamaCliPath = await detectLlamaCliPath(context, config.llamaCliPath);
  const cleanupModelsDir = config.cleanupModelsDir || getDefaultCleanupModelsDir(context);
  const cleanupModelPath = config.cleanupModelPath || null;
  const cleanupModelExists = fileExists(cleanupModelPath);
  const installedCleanupModels = await listInstalledCleanupModels(cleanupModelsDir);
  const installedCleanupSet = new Set(installedCleanupModels);
  const selectedCleanupModelId = getSelectedCleanupModelId(cleanupModelPath, cleanupModelsDir);

  return {
    llamaCliPath,
    cleanupEnabled: Boolean(config.cleanupEnabled),
    cleanupModelsDir,
    cleanupModelPath,
    cleanupModelLabel: cleanupModelExists ? getCleanupModelLabel(cleanupModelPath) : null,
    selectedCleanupModelId,
    cleanupModelOptions: KNOWN_CLEANUP_MODELS.map((model) => ({
      ...model,
      installed: installedCleanupSet.has(model.id),
      path: path.join(cleanupModelsDir, model.fileName),
    })),
    cleanupAvailable: Boolean(llamaCliPath && cleanupModelExists),
    cleanupReady: Boolean(config.cleanupEnabled && llamaCliPath && cleanupModelExists),
  };
}

async function saveLlamaCliPath(context, llamaCliPath) {
  const config = await readAppConfig(context);
  config.llamaCliPath = llamaCliPath;
  await writeAppConfig(context, config);
}

async function saveCleanupModelPath(context, cleanupModelPath) {
  const config = await readAppConfig(context);
  config.cleanupModelPath = cleanupModelPath;
  await writeAppConfig(context, config);
}

async function saveCleanupModelsDir(context, cleanupModelsDir) {
  const config = await readAppConfig(context);
  config.cleanupModelsDir = cleanupModelsDir;
  await writeAppConfig(context, config);
}

async function saveCleanupEnabled(context, cleanupEnabled) {
  const config = await readAppConfig(context);
  config.cleanupEnabled = Boolean(cleanupEnabled);
  await writeAppConfig(context, config);
}

async function downloadToFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "med-whisper",
    },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const tempPath = `${destinationPath}.${crypto.randomBytes(4).toString("hex")}.download`;
  const readable = Readable.fromWeb(response.body);

  await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });

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

    readable.on("error", handleError);
    writable.on("error", handleError);
    writable.on("finish", resolve);
    readable.pipe(writable);
  });

  await fsPromises.rename(tempPath, destinationPath);
}

async function downloadCleanupModel(context, modelId) {
  const config = await readAppConfig(context);
  const cleanupModelsDir = config.cleanupModelsDir || getDefaultCleanupModelsDir(context);
  const model = KNOWN_CLEANUP_MODELS.find((entry) => entry.id === modelId);

  if (!model) {
    throw new Error(`Unsupported cleanup model: ${modelId}`);
  }

  const destinationPath = getCleanupModelPath(cleanupModelsDir, modelId);

  if (!fileExists(destinationPath)) {
    await downloadToFile(model.sourceUrl, destinationPath);
  }

  config.cleanupModelsDir = cleanupModelsDir;
  config.cleanupModelPath = destinationPath;

  if (config.cleanupEnabled == null) {
    config.cleanupEnabled = true;
  }

  await writeAppConfig(context, config);
  return destinationPath;
}

function extractJsonObject(text) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to substring extraction.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Cleanup model did not return JSON.");
  }

  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

async function cleanupTranscript(context, rawTranscript) {
  const state = await resolveLlamaState(context);

  if (!state.cleanupReady) {
    return {
      transcript: rawTranscript,
      cleanupApplied: false,
      cleanupModelLabel: null,
    };
  }

  const schema = JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["corrected_text"],
    properties: {
      corrected_text: {
        type: "string",
      },
    },
  });

  const prompt = [
    "You are cleaning a raw medical dictation transcript.",
    "Correct punctuation, capitalization, grammar, and obvious misspellings of medical terms only when highly confident.",
    "Do not add or remove clinical facts, diagnoses, medications, negations, dosages, dates, or durations.",
    "If a term is uncertain, preserve the original wording rather than inventing a correction.",
    "Return only JSON matching the requested schema.",
    "",
    "Transcript:",
    rawTranscript,
  ].join("\n");

  const args = [
    "-m",
    state.cleanupModelPath,
    "-p",
    prompt,
    "-st",
    "--reasoning",
    "off",
    "--json-schema",
    schema,
    "--skip-chat-parsing",
    "--simple-io",
    "--no-display-prompt",
    "--no-show-timings",
    "--log-disable",
    "--temp",
    "0.1",
    "-c",
    "8192",
    "-n",
    "2048",
  ];

  let result;

  try {
    result = await runCommand(state.llamaCliPath, args);
  } catch (error) {
    return {
      transcript: rawTranscript,
      cleanupApplied: false,
      cleanupModelLabel: null,
      cleanupError: `Failed to start llama.cpp cleanup: ${error.message}`,
    };
  }

  if (result.code !== 0) {
    return {
      transcript: rawTranscript,
      cleanupApplied: false,
      cleanupModelLabel: null,
      cleanupError: (result.stderr || result.stdout || "Unknown llama.cpp error").trim(),
    };
  }

  try {
    const parsed = extractJsonObject(result.stdout);
    const cleaned = typeof parsed.corrected_text === "string"
      ? parsed.corrected_text.trim()
      : "";

    return {
      transcript: cleaned || rawTranscript,
      cleanupApplied: Boolean(cleaned),
      cleanupModelLabel: state.cleanupModelLabel,
    };
  } catch (error) {
    return {
      transcript: rawTranscript,
      cleanupApplied: false,
      cleanupModelLabel: null,
      cleanupError: error.message,
    };
  }
}

module.exports = {
  cleanupTranscript,
  downloadCleanupModel,
  KNOWN_CLEANUP_MODELS,
  resolveLlamaState,
  saveCleanupEnabled,
  saveCleanupModelPath,
  saveCleanupModelsDir,
  saveLlamaCliPath,
};
