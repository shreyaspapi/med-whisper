(function attachRecorderToWindow() {
  class WavRecorder {
    constructor() {
      this.audioContext = null;
      this.stream = null;
      this.processor = null;
      this.source = null;
      this.silenceNode = null;
      this.chunks = [];
      this.sampleRate = 16000;
      this.isRecording = false;
    }

    async start() {
      if (this.isRecording) {
        throw new Error("Recording is already in progress.");
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("AudioContext is not available in this Electron build.");
      }

      this.audioContext = new AudioContextClass();
      this.sampleRate = this.audioContext.sampleRate;
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.silenceNode = this.audioContext.createGain();
      this.silenceNode.gain.value = 0;
      this.chunks = [];

      this.processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        this.chunks.push(new Float32Array(input));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.silenceNode);
      this.silenceNode.connect(this.audioContext.destination);
      this.isRecording = true;
    }

    async stop() {
      if (!this.isRecording) {
        throw new Error("No recording is currently active.");
      }

      this.processor.disconnect();
      this.source.disconnect();
      this.silenceNode.disconnect();

      for (const track of this.stream.getTracks()) {
        track.stop();
      }

      await this.audioContext.close();

      this.isRecording = false;

      const merged = mergeFloat32Chunks(this.chunks);
      const normalized = this.sampleRate === 16000
        ? merged
        : downsampleTo16kHz(merged, this.sampleRate);
      const wavBuffer = encodeWav(normalized, 16000);

      this.audioContext = null;
      this.stream = null;
      this.processor = null;
      this.source = null;
      this.silenceNode = null;
      this.chunks = [];

      return wavBuffer;
    }
  }

  function mergeFloat32Chunks(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Float32Array(length);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  function downsampleTo16kHz(buffer, sampleRate) {
    if (sampleRate < 16000) {
      throw new Error("Input sample rate is lower than 16000 Hz.");
    }

    const sampleRateRatio = sampleRate / 16000;
    const outputLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(outputLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;

      for (let index = offsetBuffer; index < nextOffsetBuffer && index < buffer.length; index += 1) {
        accum += buffer[index];
        count += 1;
      }

      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }

    return result;
  }

  function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    writeAsciiString(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeAsciiString(view, 8, "WAVE");
    writeAsciiString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAsciiString(view, 36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);

    let offset = 44;

    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }

    return buffer;
  }

  function writeAsciiString(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  window.WavRecorder = WavRecorder;
})();
