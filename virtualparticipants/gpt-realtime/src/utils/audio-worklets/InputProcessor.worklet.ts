/**
 * Realtime AI Input Audio Processor Worklet - DEBUG VERSION WITH LOGGING
 * Processes participant audio in real-time for Realtime AI streaming
 * - Resamples from AudioContext rate to 24kHz
 * - Converts Float32 to PCM16 format
 * - Sends processed data to main thread via message port
 * TIMESTAMP: 2025-09-23-19:06 - DEBUG LOGGING ENABLED
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./audio-worklet-types.d.ts" />

interface InputProcessorMessage {
  type:
    | 'audio-data'
    | 'set-sample-rate'
    | 'start-listening'
    | 'stop-listening'
    | 'debug';
  data?: ArrayBuffer;
  sampleRate?: number;
  message?: string;
  amplitude?: number;
  processCount?: number;
}

class InputProcessor extends AudioWorkletProcessor {
  private isListening = false;
  private targetSampleRate = 24000; // Realtime AI expects 24kHz
  private sourceSampleRate = 44100; // Default, will be updated
  private processCallCount = 0;

  constructor() {
    super();

    this.port.onmessage = (event: MessageEvent<InputProcessorMessage>) => {
      const { type, sampleRate } = event.data;

      switch (type) {
        case 'set-sample-rate':
          if (sampleRate) {
            this.sourceSampleRate = sampleRate;
            this.port.postMessage({
              type: 'debug',
              message: `Set source sample rate to ${sampleRate}Hz`
            } as InputProcessorMessage);
          }

          break;

        case 'start-listening':
          this.isListening = true;
          this.processCallCount = 0;
          this.port.postMessage({
            type: 'debug',
            message: 'Started listening'
          } as InputProcessorMessage);
          break;

        case 'stop-listening':
          this.isListening = false;
          this.port.postMessage({
            type: 'debug',
            message: 'Stopped listening'
          } as InputProcessorMessage);
          break;

        default:
          break;
      }
    };
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

  /**
   * Convert Float32Array audio data to PCM16 format
   */
  private convertToPCM16(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(i * 2, int16, true); // little-endian
    }

    return buffer;
  }

  process(inputs: Float32Array[][], _outputs: Float32Array[][]): boolean {
    if (!this.isListening || inputs.length === 0 || inputs[0].length === 0) {
      return true;
    }

    // Get audio data from the first input channel
    const inputBuffer = inputs[0][0];

    if (inputBuffer.length === 0) {
      return true;
    }

    this.processCallCount++;

    // Calculate amplitude statistics for debugging
    const amplitudes = Array.from(inputBuffer).map(Math.abs);
    const maxAmplitude = Math.max(...amplitudes);
    // const avgAmplitude = amplitudes.reduce((sum, val) => sum + val, 0) / amplitudes.length;
    // const rmsAmplitude = Math.sqrt(amplitudes.reduce((sum, val) => sum + val * val, 0) / amplitudes.length);

    // Send debug info occasionally
    if (this.processCallCount <= 10 || this.processCallCount % 500 === 0) {
      this.port.postMessage({
        type: 'debug',
        message: `Processing audio chunk #${this.processCallCount}, samples: ${inputBuffer.length}`,
        amplitude: maxAmplitude,
        processCount: this.processCallCount
      } as InputProcessorMessage);
    }

    // Only send audio data if it contains meaningful sound (not silence)
    const silenceThreshold = 0; // Adjust this threshold as needed - default 0.001
    const isSilent = maxAmplitude < silenceThreshold;

    if (isSilent && this.processCallCount > 10) {
      // Skip sending silent audio chunks after initial setup
      if (this.processCallCount % 1000 === 0) {
        this.port.postMessage({
          type: 'debug',
          message: `Skipping silent audio chunk`,
          amplitude: maxAmplitude,
          processCount: this.processCallCount
        } as InputProcessorMessage);
      }

      return true;
    }

    try {
      // Resample if necessary (most audio contexts run at 44.1kHz or 48kHz, we need 24kHz)
      const resampledData = this.resampleAudio(
        inputBuffer,
        this.sourceSampleRate,
        this.targetSampleRate
      );

      // Convert to PCM16
      const pcmBuffer = this.convertToPCM16(resampledData);

      // Send debug info when we send actual audio content
      if (!isSilent) {
        if (this.processCallCount % 1000 === 0) {
          this.port.postMessage({
            type: 'debug',
            message: `Sending non-silent audio chunk`,
            amplitude: maxAmplitude,
            processCount: this.processCallCount
          } as InputProcessorMessage);
        }
      }

      // Send processed audio data to main thread
      this.port.postMessage({
        type: 'audio-data',
        data: pcmBuffer
      } as InputProcessorMessage);
    } catch (error) {
      this.port.postMessage({
        type: 'debug',
        message: `Error processing audio: ${error instanceof Error ? error.message : String(error)}`
      } as InputProcessorMessage);
    }

    return true; // Keep processing
  }
}

registerProcessor('input-processor', InputProcessor);
