/**
 * Nova S2S Input Audio Processor Worklet
 * Handles participant audio input processing for Nova S2S
 * - Receives audio from participants via mixer
 * - Converts Float32 to PCM16 for Nova S2S
 * - Filters out silence to reduce bandwidth
 * - Sends audio to main thread for WebSocket transmission
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./audio-worklet-types.d.ts" />

interface NovaInputProcessorMessage {
  type: 'start-listening' | 'stop-listening';
}

class NovaInputWorkletProcessor extends AudioWorkletProcessor {
  private isListening = false;
  private processCount = 0;

  constructor() {
    super();

    this.port.onmessage = (event: MessageEvent<NovaInputProcessorMessage>) => {
      if (event.data.type === 'start-listening') {
        this.isListening = true;
        this.processCount = 0;
        console.info('[NovaInputProcessor] Started listening');
      } else if (event.data.type === 'stop-listening') {
        this.isListening = false;
        console.info('[NovaInputProcessor] Stopped listening');
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.isListening || inputs.length === 0 || inputs[0].length === 0) {
      return true;
    }

    const input = inputs[0];
    const channelData = input[0];

    if (!channelData || channelData.length === 0) {
      return true;
    }

    this.processCount++;

    // Calculate amplitude for silence detection
    let maxAmplitude = 0;
    for (const value of channelData) {
      const abs = Math.abs(value);
      if (abs > maxAmplitude) {
        maxAmplitude = abs;
      }
    }

    // Debug logging every 100 chunks
    if (this.processCount % 100 === 0) {
      this.port.postMessage({
        type: 'debug',
        message: `Process #${this.processCount}: maxAmplitude=${maxAmplitude.toFixed(6)}`
      });
    }

    // Only send audio data if it contains meaningful sound (not silence)
    const silenceThreshold = 0.001;
    const isSilent = maxAmplitude < silenceThreshold;

    if (isSilent && this.processCount > 10) {
      // Skip sending silent audio chunks after initial setup
      if (this.processCount % 100 === 0) {
        this.port.postMessage({
          type: 'debug',
          message: `Skipping silent audio at process #${this.processCount}`
        });
      }

      return true;
    }

    // If we reach here, audio is NOT silent
    if (this.processCount % 100 === 0) {
      this.port.postMessage({
        type: 'debug',
        message: `Sending NON-SILENT audio at process #${this.processCount}, maxAmplitude=${maxAmplitude.toFixed(6)}, isSilent=${isSilent}, processCount=${this.processCount}`
      });
    }

    // Convert Float32 to PCM16
    const pcm16 = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Send to main thread
    this.port.postMessage(
      {
        type: 'audio-data',
        data: pcm16.buffer
      },
      [pcm16.buffer]
    );

    return true;
  }
}

registerProcessor('nova-input-worklet-processor', NovaInputWorkletProcessor);
