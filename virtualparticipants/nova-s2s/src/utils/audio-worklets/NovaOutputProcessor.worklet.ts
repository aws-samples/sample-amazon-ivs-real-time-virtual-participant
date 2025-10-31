/**
 * Nova S2S Output Audio Processor Worklet
 * Handles Nova S2S audio response playback with buffering
 * - Receives PCM16 audio chunks from Nova S2S
 * - Converts PCM16 to Float32 for Web Audio
 * - Manages buffering and smooth playback
 * - Supports barge-in/interruption
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./audio-worklet-types.d.ts" />

// Import ExpandableBuffer inline to avoid module issues in worklet
class ExpandableBuffer {
  private buffer: Float32Array;
  private readIndex = 0;
  private writeIndex = 0;
  private underflowedSamples = 0;
  private isInitialBuffering = true;
  private initialBufferLength: number;
  private lastWriteTime = 0;

  constructor(initialBufferLength = 24000) {
    this.buffer = new Float32Array(initialBufferLength);
    this.initialBufferLength = initialBufferLength;
  }

  setInitialBufferLength(length: number): void {
    this.initialBufferLength = length;
  }

  private logTimeElapsedSinceLastWrite(): void {
    const now = Date.now();
    if (this.lastWriteTime !== 0) {
      // Uncomment for debugging:
      // const elapsed = now - this.lastWriteTime;
      // console.info(`Elapsed time since last audio buffer write: ${elapsed} ms`);
    }

    this.lastWriteTime = now;
  }

  write(samples: Float32Array): void {
    this.logTimeElapsedSinceLastWrite();

    if (this.writeIndex + samples.length <= this.buffer.length) {
      this.buffer.set(samples, this.writeIndex);
    } else {
      if (samples.length <= this.readIndex) {
        const subarray = this.buffer.subarray(this.readIndex, this.writeIndex);
        this.buffer.set(subarray);
        this.writeIndex -= this.readIndex;
        this.readIndex = 0;
        this.buffer.set(samples, this.writeIndex);
      } else {
        const newLength =
          (samples.length + this.writeIndex - this.readIndex) * 2;
        const newBuffer = new Float32Array(newLength);
        newBuffer.set(this.buffer.subarray(this.readIndex, this.writeIndex));
        this.buffer = newBuffer;
        this.writeIndex -= this.readIndex;
        this.readIndex = 0;
        this.buffer.set(samples, this.writeIndex);
      }
    }

    this.writeIndex += samples.length;

    if (this.writeIndex - this.readIndex >= this.initialBufferLength) {
      this.isInitialBuffering = false;
    }
  }

  read(destination: Float32Array): void {
    let copyLength = 0;

    if (!this.isInitialBuffering) {
      copyLength = Math.min(
        destination.length,
        this.writeIndex - this.readIndex
      );
    }

    if (copyLength > 0) {
      destination.set(
        this.buffer.subarray(this.readIndex, this.readIndex + copyLength)
      );
      this.readIndex += copyLength;

      if (this.underflowedSamples > 0) {
        this.underflowedSamples = 0;
      }
    }

    if (copyLength < destination.length) {
      destination.fill(0, copyLength);
      this.underflowedSamples += destination.length - copyLength;
    }

    if (copyLength === 0) {
      this.isInitialBuffering = true;
    }
  }

  clearBuffer(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.isInitialBuffering = true;
    this.underflowedSamples = 0;
  }

  getStatus() {
    return {
      bufferLength: this.buffer.length,
      readIndex: this.readIndex,
      writeIndex: this.writeIndex,
      available: this.writeIndex - this.readIndex,
      isInitialBuffering: this.isInitialBuffering,
      underflowedSamples: this.underflowedSamples
    };
  }
}

interface NovaOutputProcessorMessage {
  type: 'audio' | 'barge-in' | 'initial-buffer-length' | 'set-sample-rate';
  audioData?: ArrayBuffer; // binary PCM16 data
  bufferLength?: number;
  sampleRate?: number;
}

class NovaOutputProcessor extends AudioWorkletProcessor {
  private playbackBuffer: ExpandableBuffer;
  private sourceSampleRate = 24000; // Nova S2S outputs 24kHz
  private targetSampleRate: number; // Will be set from AudioWorkletGlobalScope

  constructor() {
    super();
    this.playbackBuffer = new ExpandableBuffer();

    // Use the actual sample rate from the AudioWorkletGlobalScope
    // This is critical for container environments where it may differ from AudioContext
    this.targetSampleRate = sampleRate;

    console.info(
      `Nova output processor: Initialized with worklet sample rate: ${this.targetSampleRate}Hz`
    );
    console.info(
      `Nova output processor: Source sample rate (Nova S2S): ${this.sourceSampleRate}Hz`
    );

    this.port.onmessage = (event: MessageEvent<NovaOutputProcessorMessage>) => {
      const { type } = event.data;

      switch (type) {
        case 'audio':
          if (event.data.audioData) {
            this.processAudioData(event.data.audioData);
          }

          break;

        case 'initial-buffer-length':
          if (event.data.bufferLength) {
            this.playbackBuffer.setInitialBufferLength(event.data.bufferLength);
            console.info(
              `Nova output processor: Changed initial buffer length to ${event.data.bufferLength}`
            );
          }

          break;

        case 'set-sample-rate':
          if (event.data.sampleRate) {
            const oldRate = this.targetSampleRate;
            this.targetSampleRate = event.data.sampleRate;
            console.info(
              `Nova output processor: Sample rate updated from ${oldRate}Hz to ${this.targetSampleRate}Hz`
            );
          }

          break;

        case 'barge-in':
          this.playbackBuffer.clearBuffer();
          console.info('Nova output processor: Buffer cleared for barge-in');
          break;

        default:
          console.warn(
            `Nova output processor: Unknown message type: ${event.data.type}`
          );
          break;
      }
    };
  }

  /**
   * Convert binary PCM16 data to Float32Array with resampling
   */
  private processAudioData(audioBuffer: ArrayBuffer): void {
    try {
      // Convert ArrayBuffer to Uint8Array for PCM16 processing
      const pcmBytes = new Uint8Array(audioBuffer);

      // Convert PCM16 to Float32
      const sampleCount = pcmBytes.length / 2; // 16-bit samples
      const tempFloat = new Float32Array(sampleCount);

      for (let i = 0; i < sampleCount; i++) {
        const sample16 = pcmBytes[i * 2] | (pcmBytes[i * 2 + 1] << 8);
        const sample16Signed = sample16 > 32767 ? sample16 - 65536 : sample16;
        tempFloat[i] = sample16Signed / 32768.0;
      }

      // Resample if necessary
      const resampledData = this.resampleAudio(
        tempFloat,
        this.sourceSampleRate,
        this.targetSampleRate
      );

      // Write to playback buffer
      this.playbackBuffer.write(resampledData);
    } catch (error) {
      console.error(
        'Nova output processor: Error processing audio data:',
        error
      );
    }
  }

  /**
   * Simple linear resampling from source rate to target rate
   */
  private resampleAudio(
    audioData: Float32Array,
    sourceRate: number,
    targetRate: number
  ): Float32Array {
    if (sourceRate === targetRate) {
      return audioData;
    }

    const ratio = sourceRate / targetRate;
    const length = Math.floor(audioData.length / ratio);
    const result = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const index = i * ratio;
      const indexFloor = Math.floor(index);
      const indexCeil = Math.min(indexFloor + 1, audioData.length - 1);
      const fraction = index - indexFloor;

      // Linear interpolation
      result[i] =
        audioData[indexFloor] * (1 - fraction) +
        audioData[indexCeil] * fraction;
    }

    return result;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0][0]; // Assume one output with one channel

    if (output) {
      this.playbackBuffer.read(output);
    }

    return true; // Continue processing
  }
}

registerProcessor('nova-output-processor', NovaOutputProcessor);
