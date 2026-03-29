# Med Whisper

An Electron desktop app for local clinical dictation. The workflow is simple:

- choose a Whisper model such as `base.en` or `medium.en`
- record 1 to 3 minutes from the laptop microphone
- click stop
- wait for `whisper.cpp` to generate the transcript locally
- copy the transcript into the chart

## What this project uses

- [Electron](https://www.electronjs.org/) for the desktop shell
- [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) for fully local Whisper inference
- browser microphone APIs plus local WAV encoding in the renderer

## Quick start

1. Install Node.js.
2. Install `git`.
3. Install `cmake`.
4. Install the native toolchain for your OS:
   - Windows: Visual Studio Build Tools with C++ workload
   - macOS: Xcode Command Line Tools
5. Install project dependencies:

   ```bash
   npm install
   ```

6. Build `whisper.cpp` into `vendor/whisper.cpp`:

   ```bash
   npm run whisper:setup
   ```

7. Start the Electron app:

   ```bash
   npm start
   ```

## How setup works

- The app auto-detects a local `whisper.cpp` build in `vendor/whisper.cpp/build/bin`.
- In development, models default to `./whisper-models`.
- You can also point the app to a different `whisper-cli` binary or model folder from the UI.
- Models are downloaded from the official `whisper.cpp` Hugging Face repository when you click the download button.

## Suggested model choices for a doctor

- `base.en`: best default for fast English dictation on ordinary laptops
- `small.en`: better accuracy if the machine has more RAM
- `medium.en`: stronger accuracy, but heavier
- `base` or `medium`: use these if multilingual dictation matters

## Current app flow

- `Start recording` captures mono microphone audio locally.
- `Stop and transcribe` writes a 16 kHz WAV and runs `whisper-cli`.
- The transcript is shown in the app and can be copied with one click.
- Optional local cleanup can be enabled in-app with `llama.cpp` plus a downloadable Qwen3.5 GGUF cleanup model.

## Notes

- This project is local-first. No cloud API is required.
- `whisper.cpp` itself still needs to exist on the machine, either through `npm run whisper:setup` or by manually selecting a built `whisper-cli`.
- For production packaging, the next step would be bundling the correct platform-specific `whisper-cli` binary and optionally preloading a default model.
