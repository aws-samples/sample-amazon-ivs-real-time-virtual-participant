/**
 * TypeScript type declarations for Web Audio API AudioWorklet
 * These types are needed for AudioWorkletProcessor implementations
 */

declare global {
  /**
   * Base class for audio worklet processors
   */
  abstract class AudioWorkletProcessor {
    /**
     * Message port for communication with the main thread
     */
    readonly port: MessagePort;

    /**
     * Constructor for AudioWorkletProcessor
     */
    constructor();

    /**
     * Process audio data
     * @param inputs - Array of input audio data
     * @param outputs - Array of output audio data
     * @param parameters - Audio parameters
     * @returns true to keep processing, false to stop
     */
    abstract process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>
    ): boolean;
  }

  /**
   * Register an audio worklet processor
   * @param name - Name of the processor
   * @param processorClass - Processor class constructor
   */
  function registerProcessor(
    name: string,
    processorClass: new () => AudioWorkletProcessor
  ): void;

  /**
   * Global sample rate available in audio worklet context
   */
  declare const sampleRate: number;

  /**
   * Current frame number in audio worklet context
   */
  declare const currentFrame: number;

  /**
   * Current time in audio worklet context
   */
  declare const currentTime: number;
}

export {};
