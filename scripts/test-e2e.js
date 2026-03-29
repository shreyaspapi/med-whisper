const fs = require("fs/promises");
const path = require("path");
const { _electron: electron } = require("playwright");

const repoRoot = path.resolve(__dirname, "..");
const testRoot = path.join(repoRoot, ".e2e");
const userDataDir = path.join(testRoot, "user-data");
const modelsDir = path.join(testRoot, "models");
const fakeBinDir = path.join(testRoot, "fake-bin");
const fakeWhisperScriptPath = path.join(fakeBinDir, "fake-whisper.js");
const fakeWhisperCmdPath = path.join(fakeBinDir, "fake-whisper.cmd");
const configPath = path.join(userDataDir, "med-whisper-config.json");
const expectedTranscript = "Patient reports mild headache for two days and denies chest pain.";

async function prepareFilesystem() {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(modelsDir, { recursive: true });
  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });

  await fs.writeFile(path.join(modelsDir, "ggml-base.en.bin"), "stub model", "utf8");

  await fs.writeFile(
    fakeWhisperScriptPath,
    [
      "const fs = require('fs/promises');",
      "const path = require('path');",
      "const args = process.argv.slice(2);",
      "let outputBase = null;",
      "for (let i = 0; i < args.length; i += 1) {",
      "  if (args[i] === '-of' || args[i] === '--output-file') {",
      "    outputBase = args[i + 1];",
      "  }",
      "}",
      "if (!outputBase) {",
      "  console.error('Missing output base');",
      "  process.exit(1);",
      "}",
      `fs.writeFile(path.resolve(outputBase + '.txt'), ${JSON.stringify(expectedTranscript)}, 'utf8')`,
      "  .then(() => process.exit(0))",
      "  .catch((error) => {",
      "    console.error(error.message);",
      "    process.exit(1);",
      "  });",
      "",
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    fakeWhisperCmdPath,
    `@echo off\r\nnode "${fakeWhisperScriptPath}" %*\r\n`,
    "utf8"
  );

  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        whisperCliPath: fakeWhisperCmdPath,
        modelsDir,
      },
      null,
      2
    ),
    "utf8"
  );
}

async function installFakeMicrophone(window) {
  await window.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      if (!window.__medWhisperFakeAudioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const sourceContext = new AudioContextClass();
        const destination = sourceContext.createMediaStreamDestination();
        const oscillator = sourceContext.createOscillator();
        const gain = sourceContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = 440;
        gain.gain.value = 0.08;

        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();

        window.__medWhisperFakeAudioContext = sourceContext;
        window.__medWhisperFakeDestination = destination;
        window.__medWhisperFakeOscillator = oscillator;
      }

      await window.__medWhisperFakeAudioContext.resume();
      return window.__medWhisperFakeDestination.stream;
    };
  });
}

async function runTest() {
  await prepareFilesystem();

  const electronApp = await electron.launch({
    args: ["."],
    cwd: repoRoot,
    env: {
      ...process.env,
      MED_WHISPER_USER_DATA_DIR: userDataDir,
    },
  });

  try {
    const window = await electronApp.firstWindow();
    await installFakeMicrophone(window);

    await window.waitForFunction(() => {
      return document.getElementById("status-chip").textContent.includes("Whisper ready");
    });

    await window.locator(".settings-panel summary").click();

    await window.waitForFunction(() => {
      return document.getElementById("dictation-summary").textContent.includes("base.en");
    });
    await window.waitForFunction(() => !document.getElementById("record-button").disabled);

    await window.click("#record-button");
    await window.waitForFunction(() => !document.getElementById("stop-button").disabled);
    await window.waitForTimeout(1200);
    await window.click("#stop-button");

    await window.waitForFunction((expected) => {
      return document.getElementById("transcript-output").value.trim() === expected;
    }, expectedTranscript);

    await window.click("#copy-button");

    const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    if (clipboardText.trim() !== expectedTranscript) {
      throw new Error("Clipboard text did not match the transcript.");
    }

    const transcriptStatus = await window.locator("#session-status").textContent();
    const historyItems = await window.locator(".history-item").count();
    if (historyItems < 1) {
      throw new Error("Expected at least one saved transcription in the sidebar.");
    }

    console.log("E2E test passed.");
    console.log(`Transcript status: ${transcriptStatus}`);
    console.log(`Transcript: ${expectedTranscript}`);
  } finally {
    await electronApp.close();
  }
}

runTest().catch((error) => {
  console.error("E2E test failed.");
  console.error(error);
  process.exitCode = 1;
});
