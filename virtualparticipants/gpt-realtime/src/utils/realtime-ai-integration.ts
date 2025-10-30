// Import audio worklets using Vite's worker syntax
import InputProcessorWorkletUrl from './audio-worklets/InputProcessor.worklet.ts?worker&url';
import OutputProcessorWorkletUrl from './audio-worklets/OutputProcessor.worklet.ts?worker&url';
import {
  realtimeAIClient,
  RealtimeAISessionConfig,
  RealtimeAISessionState
} from './realtime-ai-client';

// SEI transcript message interface
export interface TranscriptSEIMessage {
  type: 'transcript';
  role: 'assistant' | 'user';
  text: string;
  timestamp: number;
  partial?: boolean; // For streaming deltas
  messageId?: string; // For grouping related deltas
}

// Realtime AI response created message interface
interface ResponseCreatedMessage extends Record<string, unknown> {
  type: string;
  response?: {
    id?: string;
  };
}

// Callback type for SEI transcript sending
export type SEITranscriptSender = (
  message: TranscriptSEIMessage
) => Promise<void>;

export class RealtimeAIIntegration {
  private isInitialized = false;
  private audioOutputElem: HTMLAudioElement | null = null;

  // Separate audio contexts for input and output to prevent mixing
  private inputAudioContext: AudioContext | null = null; // For processing participant audio
  private outputAudioContext: AudioContext | null = null; // For playing AI responses
  private outputMediaStreamDestination: MediaStreamAudioDestinationNode | null =
    null;

  // Ready state management
  private audioOutputReady = false;
  private readyCallbacks: (() => void)[] = [];

  // Dynamic audio input management (using input context)
  private participantAudioSources = new Map<
    string,
    MediaStreamAudioSourceNode
  >();

  private mixerNode: GainNode | null = null;
  private isListening = false;

  // Audio worklet nodes for modern processing
  private inputWorkletNode: AudioWorkletNode | null = null;
  private outputWorkletNode: AudioWorkletNode | null = null;

  // Audio configuration
  private sampleRate = 24000; // Realtime AI expects 24kHz for PCM16
  private detectedSampleRate: number | null = null;

  // Initialization state tracking
  private isInitializing = false;
  private initializationPromise: Promise<void> | null = null;

  // SEI transcript functionality
  private seiTranscriptSender: SEITranscriptSender | null = null;

  // Assistant transcript tracking
  private currentTranscript = '';
  private currentMessageId: string | null = null;
  private transcriptWordCount = 0;
  private readonly TRANSCRIPT_WORD_THRESHOLD = 4; // Send partial transcripts every 4 words

  // User transcript tracking (for input audio transcription)
  private currentUserTranscript = '';
  private currentUserMessageId: string | null = null;

  async initialize(audioOutputElem: HTMLAudioElement): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Connect to WebSocket proxy
      await realtimeAIClient.connect();

      // Set up message handlers
      this.setupMessageHandlers();

      // Create Realtime AI session with default configuration
      const sessionConfig: RealtimeAISessionConfig = {
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['audio'],
          instructions: `You are a Live AI Storyteller performing on stream. Speak like a charismatic radio-play narrator. Your goals: 1) Build world + stakes in 30-90s bursts. 2) Offer 2-3 crisp choices after each burst; always end with a direct question to the streamer. 3) React to streamer words immediately, weaving their ideas into canon. 4) Keep it PG-13, playful, and cinematic; no numbers or rules text. 5) If the streamer stalls, provide a friendly hint or a fun default action. 6) At major beats, recap in one sentence before continuing. Use vivid, sensory language; vary pacing; deliver mini-cliffhangers; and celebrate the streamer's creativity. Opening line: "Bells toll over the misty harbor. A shadow coils beneath the waves, and someone whispers your name… Do you board the skyferry, investigate the glowing runes on the pier, or call back to the whisper?"`,
          audio: {
            input: {
              transcription: {
                model: 'whisper-1'
              },
              turn_detection: {
                type: 'semantic_vad'
              }
            },
            output: {
              voice: 'ballad'
            }
          }
        }
      };

      realtimeAIClient.createSession(sessionConfig);

      this.audioOutputElem = audioOutputElem;

      // Set up output stream destination for routing AI audio to the output element
      await this.setupAudioOutput();

      this.isInitialized = true;
      console.info('Realtime AI integration initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Realtime AI integration:', error);
      this.audioOutputElem = null;
      throw error;
    }
  }

  private async setupAudioOutput(): Promise<void> {
    if (!this.audioOutputElem) {
      console.warn('No audio output element provided');

      return;
    }

    try {
      // Detect environment for container-specific handling
      const isHeadless = navigator.userAgent.includes('HeadlessChrome');
      // const isContainer = false; // Browser code never runs in ECS containers
      const environment = isHeadless ? 'Headless' : 'Browser';

      console.info(`Setting up audio output for environment: ${environment}`);

      // Create separate audio contexts for input and output to prevent mixing
      // Output context for AI responses only
      if (!this.outputAudioContext) {
        // Container-specific AudioContext options
        const contextOptions: AudioContextOptions = { sampleRate: 44100 };

        this.outputAudioContext = new AudioContext(contextOptions);
        this.detectedSampleRate = this.outputAudioContext.sampleRate;

        console.info(
          `Output AudioContext created: ${this.detectedSampleRate}Hz (requested: ${contextOptions.sampleRate ?? 'auto'})`
        );

        // Validate sample rate is reasonable
        if (
          this.detectedSampleRate < 22050 ||
          this.detectedSampleRate > 192000
        ) {
          console.warn(
            `Unusual sample rate detected: ${this.detectedSampleRate}Hz - may cause audio issues`
          );
        }
      }

      // Input context for participant audio processing only
      if (!this.inputAudioContext) {
        const contextOptions: AudioContextOptions = { sampleRate: 44100 };

        this.inputAudioContext = new AudioContext(contextOptions);
        console.info(
          `Input AudioContext created: ${this.inputAudioContext.sampleRate}Hz (requested: ${contextOptions.sampleRate ?? 'auto'})`
        );

        // Validate input/output sample rates match for optimal performance
        if (
          Math.abs(
            this.inputAudioContext.sampleRate - this.detectedSampleRate!
          ) > 100
        ) {
          console.warn(
            `Sample rate mismatch between contexts: input=${this.inputAudioContext.sampleRate}Hz, output=${this.detectedSampleRate}Hz`
          );
        }
      }

      // Create mixer node for input mixing (using input context)
      if (!this.mixerNode) {
        this.mixerNode = this.inputAudioContext.createGain();
      }

      // Load audio worklets
      await this.loadAudioWorklets();

      // Create a MediaStreamDestination to route AI audio to the output element (using output context)
      this.outputMediaStreamDestination =
        this.outputAudioContext.createMediaStreamDestination();

      // Connect output worklet directly to destination (bypassing gain node)
      if (this.outputWorkletNode) {
        this.outputWorkletNode.connect(this.outputMediaStreamDestination);
        console.info(
          'Connected output worklet directly to MediaStreamDestination'
        );
      }

      // Set the output element's source to our destination stream
      this.audioOutputElem.srcObject = this.outputMediaStreamDestination.stream;
      this.audioOutputElem.autoplay = true;

      // Verify srcObject was set correctly with retry logic
      await this.verifySrcObjectReady();

      // Container-specific logging and validation
      console.info(
        `Audio contexts summary:`,
        JSON.stringify({
          environment,
          outputSampleRate: this.detectedSampleRate,
          inputSampleRate: this.inputAudioContext.sampleRate,
          realtimeAISampleRate: this.sampleRate,
          outputState: this.outputAudioContext.state,
          inputState: this.inputAudioContext.state,
          userAgent: navigator.userAgent.substring(0, 100)
        })
      );

      // Mark audio output as ready and notify callbacks
      this.audioOutputReady = true;
      console.info(
        '[setupAudioOutput] Audio output setup complete - notifying callbacks'
      );
      this.notifyReadyCallbacks();
    } catch (error) {
      console.error('Failed to set up audio output:', error);
      throw error; // Re-throw to prevent initialization with broken audio
    }
  }

  /**
   * Verify that srcObject is properly set with minimal validation for speed
   */
  private async verifySrcObjectReady(): Promise<void> {
    if (!this.audioOutputElem) {
      throw new Error(
        '[verifySrcObjectReady] No audio output element available'
      );
    }

    const maxRetries = 3;
    const retryDelayMs = 50;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.info(
        `[verifySrcObjectReady] Verifying srcObject (attempt ${attempt}/${maxRetries})`
      );

      // Check if srcObject is set
      if (this.audioOutputElem.srcObject) {
        const stream = this.audioOutputElem.srcObject as MediaStream;

        // Basic validation - check if stream has tracks
        const tracks = stream.getTracks();
        if (tracks.length > 0) {
          console.info(
            `[verifySrcObjectReady] srcObject verified successfully with ${tracks.length} tracks`
          );

          return; // Success
        } else {
          console.warn(
            `[verifySrcObjectReady] Stream has no tracks (attempt ${attempt})`
          );
        }
      } else {
        console.warn(
          `[verifySrcObjectReady] srcObject not set (attempt ${attempt})`
        );
      }

      // Wait before retry (except on last attempt)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    // All retries failed
    const error = new Error(
      `[verifySrcObjectReady] Failed to verify srcObject after ${maxRetries} attempts`
    );

    console.error(error.message, {
      hasSrcObject: !!this.audioOutputElem.srcObject,
      audioElementId: this.audioOutputElem.id
    });
    throw error;
  }

  /**
   * Register a callback to be called when audio output is ready
   */
  onAudioOutputReady(callback: () => void): void {
    if (this.audioOutputReady) {
      // Already ready, call immediately
      callback();
    } else {
      // Not ready yet, add to queue
      this.readyCallbacks.push(callback);
    }
  }

  /**
   * Check if audio output is ready
   */
  isAudioOutputReady(): boolean {
    return this.audioOutputReady;
  }

  /**
   * Notify all registered callbacks that audio output is ready
   */
  private notifyReadyCallbacks(): void {
    const callbacks = [...this.readyCallbacks];
    this.readyCallbacks = [];

    callbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error('Error in audio output ready callback:', error);
      }
    });

    console.info(
      `[notifyReadyCallbacks] Notified ${callbacks.length} callbacks`
    );
  }

  /**
   * Load audio worklet modules with retry logic for container environments
   */
  private async loadAudioWorklets(): Promise<void> {
    // Type guard to ensure audio contexts are initialized
    if (!this.inputAudioContext || !this.outputAudioContext) {
      throw new Error('Audio contexts not initialized before loading worklets');
    }

    const maxRetries = 3;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.info(
          `Loading audio worklets (attempt ${attempt}/${maxRetries})`
        );

        // Load input processor worklet using imported URL
        console.info(`Loading input worklet from: ${InputProcessorWorkletUrl}`);
        await this.inputAudioContext.audioWorklet.addModule(
          InputProcessorWorkletUrl
        );
        console.info('Input audio worklet loaded successfully');

        // Load output processor worklet using imported URL
        console.info(
          `Loading output worklet from: ${OutputProcessorWorkletUrl}`
        );
        await this.outputAudioContext.audioWorklet.addModule(
          OutputProcessorWorkletUrl
        );
        console.info('Output audio worklet loaded successfully');

        // Create worklet nodes
        this.inputWorkletNode = new AudioWorkletNode(
          this.inputAudioContext,
          'input-processor'
        );

        this.outputWorkletNode = new AudioWorkletNode(
          this.outputAudioContext,
          'output-processor'
        );

        // Set up worklet message handlers
        this.setupWorkletMessageHandlers();

        // Configure worklets with sample rates
        this.inputWorkletNode.port.postMessage({
          type: 'set-sample-rate',
          sampleRate: this.inputAudioContext.sampleRate
        });

        // Configure output worklet with detected sample rate
        this.outputWorkletNode.port.postMessage({
          type: 'set-sample-rate',
          sampleRate: this.outputAudioContext.sampleRate
        });

        console.info('Audio worklets initialized successfully');
        console.info(
          `Configured output worklet with sample rate: ${this.outputAudioContext.sampleRate}Hz`
        );

        return; // Success, exit retry loop
      } catch (error) {
        console.warn(
          `Failed to load audio worklets (attempt ${attempt}/${maxRetries}):`,
          error
        );

        if (attempt === maxRetries) {
          console.error('All attempts to load audio worklets failed');
          throw error;
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Set up message handlers for worklet communication
   */
  private setupWorkletMessageHandlers(): void {
    if (!this.inputWorkletNode || !this.outputWorkletNode) {
      return;
    }

    // Handle processed audio data from input worklet
    this.inputWorkletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio-data' && event.data.data) {
        // console.info(`[worklet->realtime-ai] Received audio chunk: ${event.data.data.byteLength} bytes`);
        // Send processed PCM16 data to Realtime AI
        realtimeAIClient.sendAudioBuffer(event.data.data);
      } else if (event.data.type === 'debug') {
        const amplitude =
          event.data.amplitude !== undefined
            ? `, amplitude: ${event.data.amplitude.toFixed(6)}`
            : '';
        const processCount = event.data.processCount
          ? ` (#${event.data.processCount})`
          : '';
        console.info(
          `[InputWorklet]${processCount} ${event.data.message}${amplitude}`
        );
      }
    };

    // Output worklet doesn't need to send messages back to main thread for now
    this.outputWorkletNode.port.onmessage = (event) => {
      console.info('Output worklet message:', event.data);
    };
  }

  private setupMessageHandlers(): void {
    // Handle session updates
    realtimeAIClient.onMessage('session.updated', (message) => {
      console.info('Session updated:', message);
    });

    // Handle audio responses
    realtimeAIClient.onMessage('response.output_audio.delta', (message) => {
      if (message.delta && typeof message.delta === 'string') {
        this.playAudioDelta(message.delta);
      }
    });

    // Handle response started - reset timing for new responses and transcript accumulation
    realtimeAIClient.onMessage(
      'response.created',
      (message: ResponseCreatedMessage) => {
        console.info('New response started:', message);
        this.resetAudioTiming();
        this.resetTranscriptAccumulation(message.response?.id);
      }
    );

    // Handle transcript deltas - this is where real-time transcripts come from
    realtimeAIClient.onMessage(
      'response.output_audio_transcript.delta',
      (message) => {
        if (message.delta && typeof message.delta === 'string') {
          console.info('AI Transcript Delta:', message.delta);
          this.handleTextDelta(message.delta);
        }
      }
    );

    // Handle complete transcripts
    realtimeAIClient.onMessage(
      'response.output_audio_transcript.done',
      (message) => {
        if (message.transcript && typeof message.transcript === 'string') {
          console.info('AI Transcript Complete:', message.transcript);
          // Ensure we send the final complete transcript
          this.handleResponseComplete();
        }
      }
    );

    // Handle conversation item added (when items are added to the conversation)
    realtimeAIClient.onMessage('conversation.item.added', (message) => {
      console.info('Conversation item added:', message.item);

      // Check if this is a user message item to reset user transcript tracking
      if (message.item && typeof message.item === 'object') {
        const item = message.item as Record<string, unknown>;
        if (item.type === 'message' && item.role === 'user') {
          this.currentUserMessageId =
            (item.id as string) ?? `user_msg_${Date.now()}`;
          this.currentUserTranscript = '';
          console.info(
            `[SEI Transcript] New user message created: ${this.currentUserMessageId}`
          );
        }
      }
    });

    // Handle input audio transcription delta - user speech transcripts in real-time
    realtimeAIClient.onMessage(
      'conversation.item.input_audio_transcription.delta',
      (message) => {
        if (message.delta && typeof message.delta === 'string') {
          console.info('User Transcript Delta:', message.delta);
          this.handleUserTextDelta(
            message.delta,
            message.item_id as string | undefined
          );
        }
      }
    );

    // Handle input audio transcription completed - final user speech transcript
    realtimeAIClient.onMessage(
      'conversation.item.input_audio_transcription.completed',
      (message) => {
        if (message.transcript && typeof message.transcript === 'string') {
          console.info('User Transcript Complete:', message.transcript);
          this.handleUserTranscriptComplete(
            message.transcript,
            message.item_id as string | undefined
          );
        }
      }
    );

    // Handle input audio transcription failed
    realtimeAIClient.onMessage(
      'conversation.item.input_audio_transcription.failed',
      (message) => {
        console.error('User audio transcription failed:', message.error);
      }
    );

    // Handle response completion - send final transcript
    realtimeAIClient.onMessage('response.done', (message) => {
      console.info('Response completed:', message);
      this.handleResponseComplete();
    });

    // Handle errors
    realtimeAIClient.onMessage('error', (message) => {
      console.error('Realtime AI error:', message.error);
    });
  }

  /**
   * Add an audio input source from a remote participant
   */
  async addAudioInput(
    participantId: string,
    audioElement: HTMLAudioElement
  ): Promise<void> {
    if (!this.isInitialized) {
      console.warn(
        'Realtime AI integration not initialized, cannot add audio input'
      );

      return;
    }

    try {
      // Ensure input audio context and mixer are set up with proper async handling
      if (
        !this.inputAudioContext ||
        !this.mixerNode ||
        !this.inputWorkletNode
      ) {
        console.warn(
          'Input audio context not properly initialized, setting up audio output first'
        );

        // Prevent concurrent initialization attempts
        if (this.isInitializing) {
          console.info(
            'Audio setup already in progress, waiting for completion...'
          );
          if (this.initializationPromise) {
            await this.initializationPromise;
          }
        } else {
          this.isInitializing = true;
          this.initializationPromise = this.setupAudioOutput().finally(() => {
            this.isInitializing = false;
            this.initializationPromise = null;
          });

          await this.initializationPromise;
        }

        // Verify all components are now initialized
        if (
          !this.inputAudioContext ||
          !this.mixerNode ||
          !this.inputWorkletNode
        ) {
          console.error(
            'Failed to initialize input audio context for audio input'
          );

          return;
        }
      }

      // Create audio source from the participant's audio element using input context
      const stream = audioElement.captureStream();
      const source = this.inputAudioContext.createMediaStreamSource(stream);

      // Connect to mixer
      source.connect(this.mixerNode);
      console.info(
        `[addAudioInput] Connected audio source to mixer for participant: ${participantId}`
      );

      // Store reference for cleanup
      this.participantAudioSources.set(participantId, source);

      console.info(
        `[addAudioInput] Added audio input for participant: ${participantId}`
      );

      // Start listening if this is the first participant
      if (this.participantAudioSources.size === 1 && !this.isListening) {
        console.info('Starting listening for first participant');
        try {
          await this.startListening();
        } catch (error) {
          console.error(
            `[addAudioInput] Failed to start listening for participant ${participantId}:`,
            error
          );
          throw error;
        }
      }
    } catch (error) {
      console.error(
        `[addAudioInput] Failed to add audio input for participant ${participantId}:`,
        error
      );
    }
  }

  /**
   * Remove an audio input source when a participant leaves
   */
  removeAudioInput(participantId: string): void {
    const source = this.participantAudioSources.get(participantId);
    if (source) {
      try {
        source.disconnect();
        this.participantAudioSources.delete(participantId);
        console.info(`Removed audio input for participant: ${participantId}`);

        // Stop listening if no more participants
        if (this.participantAudioSources.size === 0 && this.isListening) {
          this.stopListening();
        }
      } catch (error) {
        console.error(
          `Failed to remove audio input for participant ${participantId}:`,
          error
        );
      }
    }
  }

  /**
   * Start listening to mixed audio from all participants using worklets
   * Now includes Realtime AI session readiness check to prevent race conditions
   */
  async startListening(): Promise<void> {
    if (
      !this.isInitialized ||
      !this.inputAudioContext ||
      !this.mixerNode ||
      !this.inputWorkletNode
    ) {
      console.warn(
        'Cannot start listening: Realtime AI integration not properly initialized'
      );

      return;
    }

    if (this.isListening) {
      return; // Already listening
    }

    try {
      // Resume input audio context if suspended and wait for it to be running
      if (this.inputAudioContext.state === 'suspended') {
        console.info('[startListening] Audio context suspended, resuming...');
        await this.inputAudioContext.resume();
        console.info(
          `[startListening] Audio context resumed, state: ${this.inputAudioContext.state}`
        );
      }

      // Validate audio context is actually running
      if (this.inputAudioContext.state !== 'running') {
        const error = new Error(
          `Audio context not running after resume attempt. State: ${this.inputAudioContext.state}`
        );
        console.error('[startListening]', error.message);
        throw error;
      }

      console.info(
        `[startListening] Audio context confirmed running at ${this.inputAudioContext.sampleRate}Hz`
      );

      // Wait for Realtime AI session to be ready before starting audio processing
      const sessionState = realtimeAIClient.getSessionState();
      console.info(
        `[startListening] Current Realtime AI session state: ${sessionState}`
      );

      if (sessionState !== RealtimeAISessionState.SESSION_READY) {
        console.info(
          '[startListening] Realtime AI session not ready, waiting for session...'
        );

        // Wait for session to be ready with a timeout
        await new Promise<void>((resolve, reject) => {
          const timeoutMs = 30000; // 30 second timeout
          const timeout = setTimeout(() => {
            reject(
              new Error(
                `Realtime AI session not ready after ${timeoutMs}ms timeout`
              )
            );
          }, timeoutMs);

          realtimeAIClient.onSessionReady(() => {
            clearTimeout(timeout);
            console.info(
              '[startListening] Realtime AI session is now ready, proceeding with audio setup'
            );
            resolve();
          });
        });
      } else {
        console.info(
          '[startListening] Realtime AI session already ready, proceeding immediately'
        );
      }

      // Connect mixer to input worklet for processing
      this.mixerNode.connect(this.inputWorkletNode);

      // Tell the worklet to start listening
      this.inputWorkletNode.port.postMessage({
        type: 'start-listening'
      });

      this.isListening = true;
      console.info(
        `[startListening] Started listening to mixed participant audio using input worklet (context: ${this.inputAudioContext.state})`
      );
    } catch (error) {
      console.error('[startListening] Failed to start listening:', error);
      this.isListening = false;
      throw error;
    }
  }

  /**
   * Stop listening to participant audio
   */
  stopListening(): void {
    if (!this.isListening) {
      return;
    }

    try {
      // Tell the worklet to stop listening
      if (this.inputWorkletNode) {
        this.inputWorkletNode.port.postMessage({
          type: 'stop-listening'
        });

        // Disconnect the mixer from the worklet
        if (this.mixerNode) {
          this.mixerNode.disconnect(this.inputWorkletNode);
        }
      }

      // Commit any remaining audio buffer to Realtime AI
      realtimeAIClient.commitAudioBuffer();

      this.isListening = false;
      console.info('Stopped listening to participant audio');
    } catch (error) {
      console.error('Error stopping audio listening:', error);
      this.isListening = false;
    }
  }

  sendTextMessage(text: string): void {
    if (!this.isInitialized) {
      console.error('Realtime AI integration not initialized');

      return;
    }

    realtimeAIClient.addConversationItem({
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text
        }
      ]
    });

    // Reset audio timing for new response
    this.resetAudioTiming();

    // Trigger response generation
    realtimeAIClient.createResponse();
  }

  /**
   * Reset audio timing state for new responses or error recovery (worklet-based)
   */
  private resetAudioTiming(): void {
    if (this.outputWorkletNode) {
      this.outputWorkletNode.port.postMessage({
        type: 'barge-in'
      });
    }
  }

  /**
   * Play audio delta using output worklet
   */
  private async playAudioDelta(audioData: string): Promise<void> {
    if (!this.outputWorkletNode || !this.outputAudioContext) {
      console.warn(
        'Audio output worklet not properly set up, cannot play audio delta'
      );

      return;
    }

    try {
      // Ensure audio context is running
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }

      // Decode base64 to binary data in main thread (atob is not available in AudioWorklet)
      const binaryString = atob(audioData);
      const pcmBytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        pcmBytes[i] = binaryString.charCodeAt(i);
      }

      console.info(
        `Sending audio chunk to worklet: ${audioData.length} chars (base64) -> ${pcmBytes.length} bytes (binary)`
      );

      // Send decoded binary data to the output worklet
      this.outputWorkletNode.port.postMessage({
        type: 'audio',
        audioData: pcmBytes.buffer
      });
    } catch (error) {
      console.error('Error processing audio delta:', error, {
        audioDataLength: audioData.length,
        contextState: this.outputAudioContext.state,
        contextSampleRate: this.detectedSampleRate
      });
    }
  }

  /**
   * Set the callback function for sending SEI transcript messages
   */
  setSEITranscriptSender(sender: SEITranscriptSender): void {
    this.seiTranscriptSender = sender;
    console.info('[SEI Transcript] SEI transcript sender registered');
  }

  /**
   * Reset transcript accumulation for new responses
   */
  private resetTranscriptAccumulation(messageId?: string): void {
    if (this.currentTranscript) {
      // Send any remaining transcript before resetting
      this.sendCompleteTranscript();
    }

    this.currentTranscript = '';
    this.transcriptWordCount = 0;
    this.currentMessageId = messageId ?? `msg_${Date.now()}`;
    console.info(
      `[SEI Transcript] Reset accumulation for message: ${this.currentMessageId}`
    );
  }

  /**
   * Handle incoming text delta from Realtime AI
   */
  private handleTextDelta(delta: string): void {
    if (!delta || !this.seiTranscriptSender) {
      return;
    }

    this.currentTranscript += delta;

    // Count words (approximate)
    const words = this.currentTranscript.trim().split(/\s+/);
    const currentWordCount = words.length;

    // Send partial transcript if we've hit the word threshold or at sentence boundaries
    const shouldSendPartial =
      currentWordCount >=
        this.transcriptWordCount + this.TRANSCRIPT_WORD_THRESHOLD ||
      delta.includes('.') ||
      delta.includes('!') ||
      delta.includes('?');

    if (shouldSendPartial) {
      this.sendPartialTranscript();
      this.transcriptWordCount = currentWordCount;
    }
  }

  /**
   * Handle response completion - send final transcript
   */
  private handleResponseComplete(): void {
    if (this.currentTranscript) {
      this.sendCompleteTranscript();
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

    const message: TranscriptSEIMessage = {
      type: 'transcript',
      role: 'assistant',
      text: this.currentTranscript,
      timestamp: Date.now(),
      partial: true,
      messageId: this.currentMessageId
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

    const message: TranscriptSEIMessage = {
      type: 'transcript',
      role: 'assistant',
      text: this.currentTranscript,
      timestamp: Date.now(),
      partial: false,
      messageId: this.currentMessageId
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
  }

  /**
   * Handle incoming user text delta from input audio transcription
   */
  private handleUserTextDelta(delta: string, itemId?: string): void {
    if (!delta || !this.seiTranscriptSender) {
      return;
    }

    // Update message ID if provided
    if (itemId && itemId !== this.currentUserMessageId) {
      this.currentUserMessageId = itemId;
      this.currentUserTranscript = '';
    }

    this.currentUserTranscript += delta;

    // Send immediately for user transcripts to provide real-time feedback
    this.sendUserPartialTranscript();
  }

  /**
   * Handle user transcript completion from input audio transcription
   */
  private handleUserTranscriptComplete(
    transcript: string,
    itemId?: string
  ): void {
    if (!transcript || !this.seiTranscriptSender) {
      return;
    }

    // Update message ID if provided
    if (itemId) {
      this.currentUserMessageId = itemId;
    }

    // Use the complete transcript from the event
    this.currentUserTranscript = transcript;

    // Send final user transcript
    this.sendUserCompleteTranscript();
  }

  /**
   * Send partial user transcript via SEI
   */
  private sendUserPartialTranscript(): void {
    if (
      !this.seiTranscriptSender ||
      !this.currentUserTranscript ||
      !this.currentUserMessageId
    ) {
      return;
    }

    const message: TranscriptSEIMessage = {
      type: 'transcript',
      role: 'user',
      text: this.currentUserTranscript,
      timestamp: Date.now(),
      partial: true,
      messageId: this.currentUserMessageId
    };

    this.seiTranscriptSender(message)
      .then(() => {
        console.info(
          `[SEI Transcript] Sent partial user transcript (${this.currentUserTranscript.length} chars): "${this.currentUserTranscript}"`
        );

        return false;
      })
      .catch((error) => {
        console.error(
          '[SEI Transcript] Failed to send partial user transcript:',
          error
        );
      });
  }

  /**
   * Send complete user transcript via SEI
   */
  private sendUserCompleteTranscript(): void {
    if (
      !this.seiTranscriptSender ||
      !this.currentUserTranscript ||
      !this.currentUserMessageId
    ) {
      return;
    }

    const message: TranscriptSEIMessage = {
      type: 'transcript',
      role: 'user',
      text: this.currentUserTranscript,
      timestamp: Date.now(),
      partial: false,
      messageId: this.currentUserMessageId
    };

    this.seiTranscriptSender(message).catch((error) => {
      console.error(
        '[SEI Transcript] Failed to send complete user transcript:',
        error
      );
    });

    console.info(
      `[SEI Transcript] Sent complete user transcript (${this.currentUserTranscript.length} chars): "${this.currentUserTranscript}"`
    );

    // Reset after sending complete transcript
    this.currentUserTranscript = '';
  }

  disconnect(): void {
    this.stopListening();
    realtimeAIClient.disconnect();
    this.isInitialized = false;
    console.info('Realtime AI integration disconnected');
  }

  get connected(): boolean {
    return this.isInitialized && realtimeAIClient.connected;
  }
}

// Export singleton instance
export const realtimeAIIntegration = new RealtimeAIIntegration();
