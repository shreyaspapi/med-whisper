const fs = require("fs/promises");
const path = require("path");

const CONFIG_FILENAME = "med-whisper-config.json";

function getConfigPath(context) {
  return path.join(context.userDataDir, CONFIG_FILENAME);
}

async function ensureUserDataDir(context) {
  await fs.mkdir(context.userDataDir, { recursive: true });
}

async function readAppConfig(context) {
  const configPath = getConfigPath(context);

  try {
    const file = await fs.readFile(configPath, "utf8");
    return JSON.parse(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeAppConfig(context, config) {
  await ensureUserDataDir(context);
  await fs.writeFile(getConfigPath(context), JSON.stringify(config, null, 2), "utf8");
}

module.exports = {
  readAppConfig,
  writeAppConfig,
};
