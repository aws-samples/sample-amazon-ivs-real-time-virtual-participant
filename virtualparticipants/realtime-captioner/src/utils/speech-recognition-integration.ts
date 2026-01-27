// SEI caption message interface
export interface CaptionSEIMessage {
  type: 'caption';
  participantId: string; // Which participant is speaking
  text: string;
  timestamp: number;
  partial: boolean; // interim vs final
  messageId: string;
}

// Callback type for SEI caption sending
export type SEICaptionSender = (message: CaptionSEIMessage) => Promise<void>;

// Extend the Window interface to include SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export class SpeechRecognitionIntegration {
  private isInitialized = false;
  private recognition: SpeechRecognition | null = null;
  private useLocalProcessing = false;
  private isListening = false;

  // SEI caption functionality
  private seiCaptionSender: SEICaptionSender | null = null;

  // Track audio tracks by participant ID
  private participantAudioTracks = new Map<string, MediaStreamTrack>();

  // Current caption tracking
  private currentTranscript = '';
  private currentMessageId: string | null = null;
  private currentParticipantId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  private currentAudioTrack: MediaStreamTrack | null = null;

  // Audio monitoring for debugging
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  private audioContext: AudioContext | undefined;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  private audioAnalyzer: AnalyserNode | undefined;
  private audioMonitorInterval: NodeJS.Timeout | null = null;

  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    try {
      // Check if SpeechRecognition is available
      const SpeechRecognitionAPI =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognitionAPI) {
        throw new Error('SpeechRecognition API not available in this browser');
      }

      this.recognition = new SpeechRecognitionAPI();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      // Using cloud-based speech recognition (not local processing)
      console.info(
        '[SpeechRecognition] Using cloud-based speech recognition (processLocally disabled for testing)'
      );
      this.useLocalProcessing = false;

      this.setupEventHandlers();
      this.isInitialized = true;

      console.info(
        `[SpeechRecognition] Initialized successfully (local: ${this.useLocalProcessing})`
      );
    } catch (error) {
      console.error('[SpeechRecognition] Failed to initialize:', error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.recognition) return;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      console.info(`[SpeechRecognition] Recognition result created"`);
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;

        console.info(
          `[SpeechRecognition] ${isFinal ? 'Final' : 'Interim'} result: "${transcript}"`
        );

        if (isFinal) {
          this.handleFinalTranscript(transcript);
        } else {
          this.handleInterimTranscript(transcript);
        }
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[SpeechRecognition] Error:', event.error, event.message);

      // Handle specific errors
      if (event.error === 'no-speech') {
        console.warn('[SpeechRecognition] No speech detected');
      } else if (event.error === 'audio-capture') {
        console.error('[SpeechRecognition] Audio capture failed');
      } else if (event.error === 'not-allowed') {
        console.error('[SpeechRecognition] Permission denied');
      }
    };

    this.recognition.onend = () => {
      console.info('[SpeechRecognition] Recognition ended');

      // Restart if we're supposed to be listening and we have an audio track
      if (
        this.isListening &&
        this.participantAudioTracks.size > 0 &&
        this.currentAudioTrack
      ) {
        console.info('[SpeechRecognition] Restarting recognition...');
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.recognition as any).start(this.currentAudioTrack);
        } catch (error) {
          console.error('[SpeechRecognition] Failed to restart:', error);
        }
      }
    };

    this.recognition.onstart = () => {
      console.info('[SpeechRecognition] Recognition started');
    };
  }

  /**
   * Add an audio input source from a remote participant
   */
  addAudioInput(participantId: string, audioTrack: MediaStreamTrack): void {
    if (!this.isInitialized) {
      console.warn(
        '[SpeechRecognition] Not initialized, cannot add audio input'
      );

      return;
    }

    try {
      // Store reference for cleanup
      this.participantAudioTracks.set(participantId, audioTrack);

      console.info(
        `[SpeechRecognition] Added audio track for participant: ${participantId} (kind: ${audioTrack.kind}, enabled: ${audioTrack.enabled}, readyState: ${audioTrack.readyState})`
      );

      // Set current participant for caption attribution
      this.currentParticipantId = participantId;
      this.currentAudioTrack = audioTrack;

      // Start listening if this is the first participant
      if (this.participantAudioTracks.size === 1 && !this.isListening) {
        console.info(
          '[SpeechRecognition] Starting listening for first participant'
        );
        this.startListening(audioTrack);
      }
    } catch (error) {
      console.error(
        `[SpeechRecognition] Failed to add audio input for participant ${participantId}:`,
        error
      );
    }
  }

  /**
   * Remove an audio input source when a participant leaves
   */
  removeAudioInput(participantId: string): void {
    const audioTrack = this.participantAudioTracks.get(participantId);

    if (audioTrack) {
      this.participantAudioTracks.delete(participantId);
      console.info(
        `[SpeechRecognition] Removed audio track for participant: ${participantId}`
      );

      // Clear current track if it was this participant's
      if (this.currentParticipantId === participantId) {
        this.currentParticipantId = null;
        this.currentAudioTrack = null;
      }

      // Stop listening if no more participants
      if (this.participantAudioTracks.size === 0 && this.isListening) {
        this.stopListening();
      }
    }
  }

  /**
   * Start audio level monitoring for debugging
   */
  private startAudioMonitoring(audioTrack: MediaStreamTrack): void {
    try {
      // Create AudioContext and analyzer
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(
        new MediaStream([audioTrack])
      );
      this.audioAnalyzer = this.audioContext.createAnalyser();
      this.audioAnalyzer.fftSize = 2048;
      source.connect(this.audioAnalyzer);

      // Monitor audio levels every second
      const dataArray = new Uint8Array(this.audioAnalyzer.frequencyBinCount);
      this.audioMonitorInterval = setInterval(() => {
        if (!this.audioAnalyzer) return;

        this.audioAnalyzer.getByteTimeDomainData(dataArray);

        // Calculate audio level statistics
        let sum = 0;
        let max = 0;
        let min = 255;

        for (const value of dataArray) {
          sum += value;
          if (value > max) max = value;
          if (value < min) min = value;
        }

        const avg = sum / dataArray.length;
        const amplitude = max - min;

        console.info(
          `[Audio Monitor] Avg: ${avg.toFixed(1)}, Min: ${min}, Max: ${max}, Amplitude: ${amplitude} (128 = silence)`
        );
      }, 1000);

      console.info('[Audio Monitor] Started audio level monitoring');
    } catch (error) {
      console.error('[Audio Monitor] Failed to start monitoring:', error);
    }
  }

  /**
   * Stop audio level monitoring
   */
  private stopAudioMonitoring(): void {
    if (this.audioMonitorInterval) {
      clearInterval(this.audioMonitorInterval);
      this.audioMonitorInterval = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch((error) => {
        console.error('[Audio Monitor] Failed to close AudioContext:', error);
      });
      this.audioContext = undefined;
    }

    this.audioAnalyzer = undefined;
    console.info('[Audio Monitor] Stopped audio level monitoring');
  }

  /**
   * Start listening to audio with the provided audio track
   */
  startListening(audioTrack: MediaStreamTrack): void {
    if (!this.isInitialized || !this.recognition) {
      console.warn(
        '[SpeechRecognition] Cannot start listening: not initialized'
      );

      return;
    }

    if (this.isListening) {
      return; // Already listening
    }

    try {
      console.info(
        `[SpeechRecognition] Starting recognition with audio track (kind: ${audioTrack.kind}, enabled: ${audioTrack.enabled}, readyState: ${audioTrack.readyState})`
      );

      // Start audio monitoring for debugging
      this.startAudioMonitoring(audioTrack);

      // Call start with the audio track parameter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.recognition as any).start(audioTrack);
      this.isListening = true;
      console.info('[SpeechRecognition] Started listening to audio track');
    } catch (error) {
      console.error('[SpeechRecognition] Failed to start listening:', error);
      this.isListening = false;
      throw error;
    }
  }

  /**
   * Stop listening to audio
   */
  stopListening(): void {
    if (!this.isListening || !this.recognition) {
      return;
    }

    try {
      // Stop audio monitoring
      this.stopAudioMonitoring();

      this.recognition.stop();
      this.isListening = false;
      console.info('[SpeechRecognition] Stopped listening');

      // Send any remaining transcript
      if (this.currentTranscript) {
        this.sendFinalCaption();
      }
    } catch (error) {
      console.error('[SpeechRecognition] Error stopping listening:', error);
      this.isListening = false;
    }
  }

  /**
   * Handle interim transcript
   */
  private handleInterimTranscript(transcript: string): void {
    if (!this.seiCaptionSender || !this.currentParticipantId) {
      return;
    }

    this.currentTranscript = transcript;

    // Generate message ID if needed
    if (!this.currentMessageId) {
      this.currentMessageId = `caption_${Date.now()}_${this.currentParticipantId}`;
    }

    this.sendPartialCaption();
  }

  /**
   * Handle final transcript
   */
  private handleFinalTranscript(transcript: string): void {
    if (!this.seiCaptionSender || !this.currentParticipantId) {
      return;
    }

    this.currentTranscript = transcript;

    // Generate message ID if needed
    if (!this.currentMessageId) {
      this.currentMessageId = `caption_${Date.now()}_${this.currentParticipantId}`;
    }

    this.sendFinalCaption();

    // Reset for next transcript
    this.currentTranscript = '';
    this.currentMessageId = null;
  }

  /**
   * Send partial caption via SEI
   */
  private sendPartialCaption(): void {
    if (
      !this.seiCaptionSender ||
      !this.currentTranscript ||
      !this.currentMessageId ||
      !this.currentParticipantId
    ) {
      return;
    }

    const message: CaptionSEIMessage = {
      type: 'caption',
      participantId: this.currentParticipantId,
      text: this.currentTranscript,
      timestamp: Date.now(),
      partial: true,
      messageId: this.currentMessageId
    };

    this.seiCaptionSender(message)
      .then(() => {
        console.info(
          `[SEI Caption] Sent partial caption (${this.currentTranscript.length} chars): "${this.currentTranscript}"`
        );

        return false;
      })
      .catch((error) => {
        console.error('[SEI Caption] Failed to send partial caption:', error);
      });
  }

  /**
   * Send final caption via SEI
   */
  private sendFinalCaption(): void {
    if (
      !this.seiCaptionSender ||
      !this.currentTranscript ||
      !this.currentMessageId ||
      !this.currentParticipantId
    ) {
      return;
    }

    const message: CaptionSEIMessage = {
      type: 'caption',
      participantId: this.currentParticipantId,
      text: this.currentTranscript,
      timestamp: Date.now(),
      partial: false,
      messageId: this.currentMessageId
    };

    this.seiCaptionSender(message).catch((error) => {
      console.error('[SEI Caption] Failed to send final caption:', error);
    });

    console.info(
      `[SEI Caption] Sent final caption (${this.currentTranscript.length} chars): "${this.currentTranscript}"`
    );
  }

  /**
   * Set the callback function for sending SEI caption messages
   */
  setSEICaptionSender(sender: SEICaptionSender): void {
    this.seiCaptionSender = sender;
    console.info('[SEI Caption] SEI caption sender registered');
  }

  disconnect(): void {
    this.stopListening();
    this.stopAudioMonitoring();
    this.participantAudioTracks.clear();
    this.currentParticipantId = null;
    this.currentAudioTrack = null;
    this.isInitialized = false;
    console.info('[SpeechRecognition] Disconnected');
  }

  get connected(): boolean {
    return this.isInitialized;
  }

  get isUsingLocalProcessing(): boolean {
    return this.useLocalProcessing;
  }
}

// Export singleton instance
export const speechRecognitionIntegration = new SpeechRecognitionIntegration();
