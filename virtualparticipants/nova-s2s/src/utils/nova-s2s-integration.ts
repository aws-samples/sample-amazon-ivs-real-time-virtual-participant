// Import audio worklets using Vite's worker syntax
import NovaInputProcessorWorkletUrl from './audio-worklets/NovaInputProcessor.worklet.ts?worker&url';
import NovaOutputProcessorWorkletUrl from './audio-worklets/NovaOutputProcessor.worklet.ts?worker&url';

export interface TranscriptSEIMessage {
  type: 'transcript';
  role: 'assistant' | 'user';
  text: string;
  timestamp: number;
  partial?: boolean;
  messageId?: string;
  participantId: string;
  participantName: string;
}

export type SEITranscriptSender = (
  message: TranscriptSEIMessage
) => Promise<void>;

class NovaS2SIntegration {
  private websocket: WebSocket | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private outputMediaStreamDestination: MediaStreamAudioDestinationNode | null =
    null;

  private sourceNode: MediaElementAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isInitialized = false;
  private isSessionActive = false;
  private seiTranscriptSender: SEITranscriptSender | null = null;
  private participantAudioElements = new Map<string, HTMLAudioElement>();
  private participantAudioSources = new Map<
    string,
    MediaStreamAudioSourceNode
  >();

  private mixerNode: GainNode | null = null;
  private inputWorkletNode: AudioWorkletNode | null = null;
  private outputWorkletNode: AudioWorkletNode | null = null;
  private isListening = false;

  // Transcript tracking for Nova S2S responses
  private currentTranscript = '';
  private currentMessageId: string | null = null;
  private currentRole: 'assistant' | 'user' = 'assistant';
  private transcriptWordCount = 0;
  private readonly TRANSCRIPT_WORD_THRESHOLD = 4; // Send partial transcripts every 4 words

  // Virtual Participant information for SEI messages
  private vpParticipantId = '';
  private vpParticipantName = '';

  async initialize(
    audioElem: HTMLAudioElement,
    vpParticipantId = 'virtual-participant',
    vpParticipantName = 'Virtual Participant'
  ): Promise<void> {
    // Store VP participant info
    this.vpParticipantId = vpParticipantId;
    this.vpParticipantName = vpParticipantName;

    if (this.isInitialized) {
      console.warn('[NovaS2SIntegration] Already initialized');

      return;
    }

    try {
      this.audioElement = audioElem;

      this.websocket = new WebSocket('ws://localhost:3001');

      await new Promise<void>((resolve, reject) => {
        if (!this.websocket) {
          reject(new Error('WebSocket not created'));

          return;
        }

        this.websocket.onopen = () => {
          console.info('[NovaS2SIntegration] WebSocket connected');
          resolve();
        };

        this.websocket.onerror = (error) => {
          console.error('[NovaS2SIntegration] WebSocket error:', error);
          reject(new Error('WebSocket connection failed'));
        };
      });

      this.setupWebSocketHandlers();
      await this.setupAudioCapture();
      this.startSession();

      this.isInitialized = true;
      console.info('[NovaS2SIntegration] Initialization complete');
    } catch (error) {
      console.error('[NovaS2SIntegration] Initialization failed:', error);
      this.cleanup();
      throw error;
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.websocket) return;

    this.websocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'audio-output') {
          await this.playAudioOutput(message.audio);
        } else if (message.type === 'text-output') {
          console.info('[Nova Response: event.data:]', event.data);

          console.info(
            '[Nova Response]:',
            message.text,
            'isFinal:',
            message.isFinal,
            'role:',
            message.role
          );

          // Handle text output from Nova S2S
          if (message.text) {
            // Map Nova's role format to SEI format
            const role = this.mapNovaRoleToSEIRole(message.role);
            this.handleTextDelta(message.text, message.isFinal, role);
          }
        } else if (message.type === 'nova-audio') {
          // Legacy support
          await this.playAudioOutput(message.audio);
        }
      } catch (error) {
        console.error('[NovaS2SIntegration] Error handling message:', error);
      }
    };

    this.websocket.onclose = () => {
      console.warn('[NovaS2SIntegration] WebSocket closed');
      this.isSessionActive = false;
    };
  }

  /**
   * Map Nova S2S role format to SEI role format
   */
  private mapNovaRoleToSEIRole(novaRole?: string): 'assistant' | 'user' {
    if (!novaRole) return 'assistant';

    // Nova uses uppercase: "USER", "ASSISTANT"
    // SEI uses lowercase: "user", "assistant"
    const normalizedRole = novaRole.toLowerCase();

    if (normalizedRole === 'user') {
      return 'user';
    } else if (normalizedRole === 'assistant') {
      return 'assistant';
    }

    // Default to assistant if unknown
    console.warn(
      `[NovaS2SIntegration] Unknown role: ${novaRole}, defaulting to 'assistant'`
    );

    return 'assistant';
  }

  private async setupAudioCapture(): Promise<void> {
    if (!this.audioElement) {
      throw new Error('Audio element not set');
    }

    // Create input context for participant audio processing (16kHz for Nova S2S)
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Create output context for Nova S2S audio playback (24kHz for Nova S2S output)
    this.outputAudioContext = new AudioContext({ sampleRate: 24000 });

    // Create MediaStreamDestination for Nova S2S output audio to be captured by the stage
    this.outputMediaStreamDestination =
      this.outputAudioContext.createMediaStreamDestination();

    // Load output audio worklet for buffered playback
    await this.loadOutputAudioWorklet();

    // Set the audio element's srcObject to the OUTPUT stream (for stage capture)
    // This ensures Nova S2S audio is routed to the IVS stage
    this.audioElement.srcObject = this.outputMediaStreamDestination.stream;
    this.audioElement.autoplay = true;

    // Create mixer node for combining participant audio (using input context)
    this.mixerNode = this.audioContext.createGain();
    this.mixerNode.gain.value = 1.0;

    // Load input audio worklet for participant audio processing
    await this.loadInputAudioWorklet();

    console.info(
      '[NovaS2SIntegration] Set audio element srcObject to output stream'
    );
    console.info(
      '[NovaS2SIntegration] Audio capture setup complete with AudioWorklet'
    );

    console.info(
      `[NovaS2SIntegration] Output AudioContext created: ${this.outputAudioContext.sampleRate}Hz`
    );
  }

  private async loadInputAudioWorklet(): Promise<void> {
    if (!this.audioContext || !this.mixerNode) {
      throw new Error(
        'Input audio context not initialized before loading worklet'
      );
    }

    try {
      console.info(
        `[NovaS2SIntegration] Loading input worklet from: ${NovaInputProcessorWorkletUrl}`
      );
      await this.audioContext.audioWorklet.addModule(
        NovaInputProcessorWorkletUrl
      );
      console.info(
        '[NovaS2SIntegration] Input audio worklet loaded successfully'
      );

      // Create input worklet node
      this.inputWorkletNode = new AudioWorkletNode(
        this.audioContext,
        'nova-input-worklet-processor'
      );

      // Handle audio data from worklet
      this.inputWorkletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio-data' && event.data.data) {
          const base64Audio = this.arrayBufferToBase64(event.data.data);
          this.sendAudioToServer(base64Audio);
        } else if (event.data.type === 'debug') {
          console.info(`[NovaInputWorklet] ${event.data.message}`);
        }
      };

      console.info('[NovaS2SIntegration] Input worklet initialized and ready');
    } catch (error) {
      console.error(
        '[NovaS2SIntegration] Failed to load input audio worklet:',
        error
      );
      throw error;
    }
  }

  private async loadOutputAudioWorklet(): Promise<void> {
    if (!this.outputAudioContext || !this.outputMediaStreamDestination) {
      throw new Error(
        'Output audio context not initialized before loading worklet'
      );
    }

    try {
      console.info(
        `[NovaS2SIntegration] Loading output worklet from: ${NovaOutputProcessorWorkletUrl}`
      );
      await this.outputAudioContext.audioWorklet.addModule(
        NovaOutputProcessorWorkletUrl
      );
      console.info(
        '[NovaS2SIntegration] Output audio worklet loaded successfully'
      );

      // Create output worklet node
      this.outputWorkletNode = new AudioWorkletNode(
        this.outputAudioContext,
        'nova-output-processor'
      );

      // Connect output worklet to destination
      this.outputWorkletNode.connect(this.outputMediaStreamDestination);

      // Configure worklet with sample rate
      this.outputWorkletNode.port.postMessage({
        type: 'set-sample-rate',
        sampleRate: this.outputAudioContext.sampleRate
      });

      console.info(
        '[NovaS2SIntegration] Output worklet initialized and connected to MediaStreamDestination'
      );
    } catch (error) {
      console.error(
        '[NovaS2SIntegration] Failed to load output audio worklet:',
        error
      );
      throw error;
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  }

  private async playAudioOutput(audioBase64: string): Promise<void> {
    if (
      !this.audioElement ||
      !this.outputAudioContext ||
      !this.outputWorkletNode
    ) {
      console.warn(
        '[NovaS2SIntegration] Cannot play audio: audio element, output context, or worklet not initialized'
      );

      return;
    }

    try {
      // Resume audio context if suspended
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }

      // Decode base64 to binary PCM16 data
      const binaryString = atob(audioBase64);
      const pcmBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        pcmBytes[i] = binaryString.charCodeAt(i);
      }

      console.info(
        `[NovaS2SIntegration] Sending audio chunk to worklet: ${audioBase64.length} chars (base64) -> ${pcmBytes.length} bytes (binary)`
      );

      // Send decoded binary data to the output worklet for buffered playback
      this.outputWorkletNode.port.postMessage({
        type: 'audio',
        audioData: pcmBytes.buffer
      });
    } catch (error) {
      console.error('[NovaS2SIntegration] Error playing audio output:', error);
    }
  }

  private startSession(): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    this.websocket.send(
      JSON.stringify({
        type: 'nova-start'
      })
    );

    this.isSessionActive = true;
    console.info('[NovaS2SIntegration] Session started');
  }

  private stopSession(): void {
    if (!this.websocket || !this.isSessionActive) return;

    this.websocket.send(
      JSON.stringify({
        type: 'nova-stop'
      })
    );

    this.isSessionActive = false;
    console.info('[NovaS2SIntegration] Session stopped');
  }

  cleanup(): void {
    console.info('[NovaS2SIntegration] Cleaning up');

    if (this.isSessionActive) {
      this.stopSession();
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Disconnect and cleanup output worklet
    if (this.outputWorkletNode) {
      this.outputWorkletNode.disconnect();
      this.outputWorkletNode = null;
    }

    // Close output AudioContext to prevent resource leaks
    if (this.outputAudioContext) {
      this.outputAudioContext.close();
      this.outputAudioContext = null;
    }

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    this.audioElement = null;
    this.isInitialized = false;
    this.isSessionActive = false;
    this.seiTranscriptSender = null;
    this.participantAudioElements.clear();
  }

  async addAudioInput(
    participantId: string,
    audioElement: HTMLAudioElement
  ): Promise<void> {
    console.info(
      `[NovaS2SIntegration] Adding audio input for participant ${participantId}`
    );
    this.participantAudioElements.set(participantId, audioElement);

    if (!this.audioContext || !this.mixerNode) {
      console.warn('[NovaS2SIntegration] Audio context not initialized');

      return;
    }

    try {
      // Create media stream from audio element
      const captureStream =
        (
          audioElement as HTMLMediaElement & {
            captureStream?: () => MediaStream;
            mozCaptureStream?: () => MediaStream;
          }
        ).captureStream?.() ||
        (
          audioElement as HTMLMediaElement & {
            captureStream?: () => MediaStream;
            mozCaptureStream?: () => MediaStream;
          }
        ).mozCaptureStream?.();

      if (!captureStream) {
        console.warn(
          '[NovaS2SIntegration] Cannot capture stream from audio element'
        );

        return;
      }

      // Create source and connect to mixer
      const source = this.audioContext.createMediaStreamSource(captureStream);
      source.connect(this.mixerNode);

      // Store for cleanup
      this.participantAudioSources.set(participantId, source);

      console.info(
        `[NovaS2SIntegration] Connected audio source to mixer for participant: ${participantId}`
      );

      // Start listening if this is the first participant
      if (this.participantAudioSources.size === 1 && !this.isListening) {
        await this.startListening();
      }
    } catch (error) {
      console.error(
        `[NovaS2SIntegration] Error adding audio input for ${participantId}:`,
        error
      );
    }
  }

  private async startListening(): Promise<void> {
    if (!this.audioContext || !this.mixerNode || !this.inputWorkletNode) {
      console.warn(
        '[NovaS2SIntegration] Cannot start listening: not initialized'
      );

      return;
    }

    if (this.isListening) {
      return;
    }

    try {
      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Connect mixer to worklet
      this.mixerNode.connect(this.inputWorkletNode);

      // Tell worklet to start processing
      this.inputWorkletNode.port.postMessage({ type: 'start-listening' });

      this.isListening = true;
      console.info(
        '[NovaS2SIntegration] Started listening to mixed participant audio'
      );
    } catch (error) {
      console.error('[NovaS2SIntegration] Failed to start listening:', error);
      this.isListening = false;
    }
  }

  private sendAudioToServer(audioBase64: string): void {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(
        JSON.stringify({
          type: 'audio-input',
          audio: audioBase64
        })
      );
    }
  }

  removeAudioInput(participantId: string): void {
    console.info(
      `[NovaS2SIntegration] Removing audio input for participant ${participantId}`
    );

    const source = this.participantAudioSources.get(participantId);
    if (source) {
      source.disconnect();
      this.participantAudioSources.delete(participantId);
    }

    this.participantAudioElements.delete(participantId);

    // Stop listening if no more participants
    if (this.participantAudioSources.size === 0 && this.isListening) {
      this.stopListening();
    }
  }

  private stopListening(): void {
    if (!this.isListening || !this.inputWorkletNode) {
      return;
    }

    this.inputWorkletNode.port.postMessage({ type: 'stop-listening' });

    if (this.mixerNode && this.inputWorkletNode) {
      this.mixerNode.disconnect(this.inputWorkletNode);
    }

    this.isListening = false;
    console.info('[NovaS2SIntegration] Stopped listening');
  }

  setSEITranscriptSender(sender: SEITranscriptSender): void {
    this.seiTranscriptSender = sender;
    console.info('[NovaS2SIntegration] SEI transcript sender configured');
  }

  get hasTranscriptSender(): boolean {
    return this.seiTranscriptSender !== null;
  }

  /**
   * Reset transcript accumulation for new responses
   */
  private resetTranscriptAccumulation(): void {
    // Simply reset state without re-sending the previous transcript
    // The complete transcript is already sent when isFinal is true in handleTextDelta
    this.currentTranscript = '';
    this.transcriptWordCount = 0;
    this.currentMessageId = `msg_${Date.now()}`;
    console.info(
      `[SEI Transcript] Reset accumulation for message: ${this.currentMessageId}`
    );
  }

  /**
   * Handle incoming text delta from Nova S2S
   */
  private handleTextDelta(
    text: string,
    isFinal: boolean,
    role: 'assistant' | 'user'
  ): void {
    if (!text || !this.seiTranscriptSender) {
      return;
    }

    // Store the role for this transcript
    this.currentRole = role;

    // If this is a new message (first text of response), reset accumulation
    if (!this.currentMessageId) {
      this.resetTranscriptAccumulation();
    }

    // For Nova S2S, we receive complete text chunks, not deltas
    // So we treat each text output as either partial or final
    if (isFinal) {
      // This is the complete transcript - send it immediately
      this.currentTranscript = text;
      this.sendCompleteTranscript();
    } else {
      // This is a partial transcript - accumulate and send
      this.currentTranscript += text;

      // Count words (approximate)
      const words = this.currentTranscript.trim().split(/\s+/);
      const currentWordCount = words.length;

      // Send partial transcript if we've hit the word threshold
      const shouldSendPartial =
        currentWordCount >=
        this.transcriptWordCount + this.TRANSCRIPT_WORD_THRESHOLD;

      if (shouldSendPartial) {
        this.sendPartialTranscript();
        this.transcriptWordCount = currentWordCount;
      }
    }
  }

  /**
   * Send partial transcript via SEI
   */
  private sendPartialTranscript(): void {
    if (
      !this.seiTranscriptSender ||
      !this.currentTranscript ||
      !this.currentMessageId
    ) {
      return;
    }

    // Use generic participant info for user transcripts, VP info for assistant transcripts
    const participantId =
      this.currentRole === 'user' ? 'user' : this.vpParticipantId;
    const participantName =
      this.currentRole === 'user' ? 'User' : this.vpParticipantName;

    const message: TranscriptSEIMessage = {
      type: 'transcript',
      role: this.currentRole,
      text: this.currentTranscript,
      timestamp: Date.now(),
      partial: true,
      messageId: this.currentMessageId,
      participantId,
      participantName
    };

    this.seiTranscriptSender(message)
      .then(() => {
        console.info(
          `[SEI Transcript] Sent partial transcript (${this.currentTranscript.length} chars): "${this.currentTranscript}"`
        );

        return false;
      })
      .catch((error) => {
        console.error(
          '[SEI Transcript] Failed to send partial transcript:',
          error
        );
      });
  }

  /**
   * Send complete transcript via SEI
   */
  private sendCompleteTranscript(): void {
    if (
      !this.seiTranscriptSender ||
      !this.currentTranscript ||
      !this.currentMessageId
    ) {
      return;
    }

    // Use generic participant info for user transcripts, VP info for assistant transcripts
    const participantId =
      this.currentRole === 'user' ? 'user' : this.vpParticipantId;
    const participantName =
      this.currentRole === 'user' ? 'User' : this.vpParticipantName;

    const message: TranscriptSEIMessage = {
      type: 'transcript',
      role: this.currentRole,
      text: this.currentTranscript,
      timestamp: Date.now(),
      partial: false,
      messageId: this.currentMessageId,
      participantId,
      participantName
    };

    this.seiTranscriptSender(message).catch((error) => {
      console.error(
        '[SEI Transcript] Failed to send complete transcript:',
        error
      );
    });

    console.info(
      `[SEI Transcript] Sent complete transcript (${this.currentTranscript.length} chars): "${this.currentTranscript}"`
    );

    // Reset after sending complete transcript
    this.currentTranscript = '';
    this.transcriptWordCount = 0;
    this.currentMessageId = null;
  }
}

export const novaS2SIntegration = new NovaS2SIntegration();
