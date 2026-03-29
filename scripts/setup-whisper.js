const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(repoRoot, "vendor");
const whisperRoot = path.join(vendorRoot, "whisper.cpp");
const cmakeCandidates = process.platform === "win32"
  ? ["cmake", "C:\\Program Files\\CMake\\bin\\cmake.exe"]
  : ["cmake"];

let gitCommand = "git";
let cmakeCommand = "cmake";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function commandExists(command, args = ["--version"]) {
  try {
    await run(command, args);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(candidates, args) {
  for (const candidate of candidates) {
    if (await commandExists(candidate, args)) {
      return candidate;
    }
  }

  return null;
}

async function ensurePrerequisites() {
  gitCommand = await resolveCommand(["git"], ["--version"]);
  cmakeCommand = await resolveCommand(cmakeCandidates, ["--version"]);

  if (!gitCommand) {
    throw new Error("git is required. Install Git first and run the setup script again.");
  }

  if (!cmakeCommand) {
    throw new Error("cmake is required. Install CMake first and run the setup script again.");
  }
}

async function ensureWhisperRepo() {
  try {
    await fs.access(whisperRoot);
    console.log("whisper.cpp already exists in vendor/whisper.cpp");
  } catch {
    await fs.mkdir(vendorRoot, { recursive: true });
    console.log("Cloning whisper.cpp into vendor/whisper.cpp");
    await run(gitCommand, ["clone", "--depth", "1", "https://github.com/ggml-org/whisper.cpp.git", whisperRoot]);
  }
}

async function buildWhisper() {
  console.log("Building whisper.cpp with CMake");
  await run(cmakeCommand, ["-B", "build"], { cwd: whisperRoot });
  await run(cmakeCommand, ["--build", "build", "-j", "--config", "Release"], { cwd: whisperRoot });
}

async function main() {
  console.log("Preparing local whisper.cpp for Med Whisper");
  await ensurePrerequisites();
  await ensureWhisperRepo();
  await buildWhisper();

  console.log("");
  console.log("Setup complete.");
  console.log("The Electron app will auto-detect the built whisper-cli binary.");
  console.log("Download a model from inside the app or place ggml model files in ./whisper-models.");
}

main().catch((error) => {
  console.error("");
  console.error("Setup failed.");
  console.error(error.message);
  process.exitCode = 1;
});
