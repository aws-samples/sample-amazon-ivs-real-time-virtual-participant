export interface RealtimeAIMessage {
  type: string;
  // Using Record<string, unknown> instead of any for better type safety
  [key: string]: unknown;
}

export interface RealtimeAISessionConfig {
  session?: {
    type?: string;
    model?: string;
    output_modalities?: string[];
    instructions?: string;
    voice?: string;
    input_audio_format?: string;
    output_audio_format?: string;
    input_audio_transcription?: {
      model?: string;
    };
    audio?: {
      input?: {
        format?: {
          type?: string;
          rate?: number;
        };
        transcription?: {
          model?: string;
        };
        turn_detection?: {
          type?: string;
          eagerness?: string;
          threshold?: number;
          prefix_padding_ms?: number;
          silence_duration_ms?: number;
        };
      };
      output?: {
        format?: {
          type?: string;
        };
        voice?: string;
      };
    };
    turn_detection?: {
      type?: string;
      eagerness?: string;
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
    };
    prompt?: {
      id?: string;
      version?: string;
      variables?: Record<string, unknown>;
    };
    tools?: Record<string, unknown>[];
    tool_choice?: string;
    temperature?: number;
    max_response_output_tokens?: number;
  };
}

// Session state enumeration
export enum RealtimeAISessionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  SESSION_CREATING = 'session_creating',
  SESSION_READY = 'session_ready',
  ERROR = 'error'
}

// Audio buffer entry interface
interface QueuedAudioData {
  audioData: ArrayBuffer;
  timestamp: number;
}

export class RealtimeAIWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers = new Map<
    string,
    (message: RealtimeAIMessage) => void
  >();

  private isConnected = false;

  // Session state management
  private sessionState: RealtimeAISessionState =
    RealtimeAISessionState.DISCONNECTED;

  private sessionReadyCallbacks: (() => void)[] = [];

  // Audio buffering for race condition handling
  private audioBuffer: QueuedAudioData[] = [];
  private maxBufferSize = 100; // Maximum number of audio chunks to buffer
  private bufferTimeoutMs = 10000; // Clear buffer after 10 seconds if session never becomes ready

  constructor(url = 'ws://localhost:3001') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.sessionState = RealtimeAISessionState.CONNECTING;
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.info('Connected to Realtime AI WebSocket proxy');
          this.isConnected = true;
          this.sessionState = RealtimeAISessionState.CONNECTED;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            console.info(
              'Message from Realtime AI Websocket: ',
              JSON.stringify(event)
            );
            const message: RealtimeAIMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error(
              'Error parsing WebSocket message:',
              JSON.stringify(error)
            );
          }
        };

        this.ws.onclose = (event) => {
          console.info(
            'WebSocket connection closed:',
            event.code,
            event.reason
          );
          this.isConnected = false;
          this.sessionState = RealtimeAISessionState.DISCONNECTED;
          this.clearAudioBufferInternal();
          this.handleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.isConnected = false;
          this.sessionState = RealtimeAISessionState.ERROR;
          this.clearAudioBufferInternal();
          reject(
            error instanceof Error
              ? error
              : new Error('WebSocket error occurred')
          );
        };
      } catch (error) {
        this.sessionState = RealtimeAISessionState.ERROR;
        reject(
          error instanceof Error
            ? error
            : new Error('Error connecting to WebSocket')
        );
      }
    });
  }

  private handleMessage(message: RealtimeAIMessage): void {
    // Handle specific message types
    switch (message.type) {
      case 'connection':
        console.info('WebSocket proxy connection established:', message);
        break;
      case 'session.created':
        console.info('Realtime AI session created successfully');
        this.sessionState = RealtimeAISessionState.SESSION_READY;
        console.info(
          `[Realtime AI Session] State changed to: ${this.sessionState}`
        );
        this.notifySessionReady();
        this.flushAudioBuffer();
        break;
      case 'session.closed':
        console.info('Realtime AI session closed:', message);
        this.sessionState = RealtimeAISessionState.CONNECTED;
        this.clearAudioBufferInternal();
        break;
      case 'error':
        console.error('Realtime AI proxy error:', message.error);
        if (this.sessionState === RealtimeAISessionState.SESSION_CREATING) {
          this.sessionState = RealtimeAISessionState.ERROR;
          this.clearAudioBufferInternal();
        }

        break;
      default: {
        // Forward to registered handlers
        const handler = this.messageHandlers.get(message.type);
        if (typeof handler === 'function') {
          handler(message);
        } else {
          console.info('Unhandled message type:', message.type, message);
        }
      }
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.info(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );

      setTimeout(() => {
        this.connect().catch((error) => {
          console.error('Reconnection failed:', error);
        });
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  createSession(config?: RealtimeAISessionConfig): void {
    if (!this.isConnected || !this.ws) {
      console.error('WebSocket not connected');

      return;
    }

    this.sessionState = RealtimeAISessionState.SESSION_CREATING;
    console.info(
      `[Realtime AI Session] State changed to: ${this.sessionState}`
    );

    const sessionMessage: RealtimeAIMessage = {
      type: 'session.update',
      ...config
    };

    this.send(sessionMessage);
  }

  updateSession(sessionUpdate: Record<string, unknown>): void {
    this.send({
      type: 'session.update',
      session: sessionUpdate
    });
  }

  sendAudioBuffer(audioData: ArrayBuffer): void {
    // If session is not ready, buffer the audio data
    if (this.sessionState !== RealtimeAISessionState.SESSION_READY) {
      this.bufferAudioData(audioData);

      return;
    }

    // Convert ArrayBuffer to base64 for JSON transmission
    const base64Audio = this.arrayBufferToBase64(audioData);

    // console.info(`[realtime-ai-client] Sending audio buffer: ${audioData.byteLength} bytes -> ${base64Audio.length} chars (base64)`);

    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    });
  }

  commitAudioBuffer(): void {
    this.send({
      type: 'input_audio_buffer.commit'
    });
  }

  clearAudioBuffer(): void {
    this.send({
      type: 'input_audio_buffer.clear'
    });
  }

  createResponse(responseConfig?: Record<string, unknown>): void {
    this.send({
      type: 'response.create',
      response: responseConfig ?? {}
    });
  }

  cancelResponse(): void {
    this.send({
      type: 'response.cancel'
    });
  }

  addConversationItem(item: Record<string, unknown>): void {
    this.send({
      type: 'conversation.item.create',
      item
    });
  }

  private send(message: RealtimeAIMessage): void {
    if (!this.isConnected || !this.ws) {
      console.error('Cannot send message: WebSocket not connected');

      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
    }
  }

  onMessage(
    messageType: string,
    handler: (message: RealtimeAIMessage) => void
  ): void {
    this.messageHandlers.set(messageType, handler);
  }

  removeMessageHandler(messageType: string): void {
    this.messageHandlers.delete(messageType);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  }

  // Session state management methods
  onSessionReady(callback: () => void): void {
    if (this.sessionState === RealtimeAISessionState.SESSION_READY) {
      // Already ready, call immediately
      callback();
    } else {
      // Not ready yet, add to callback queue
      this.sessionReadyCallbacks.push(callback);
    }
  }

  getSessionState(): RealtimeAISessionState {
    return this.sessionState;
  }

  isSessionReady(): boolean {
    return this.sessionState === RealtimeAISessionState.SESSION_READY;
  }

  private notifySessionReady(): void {
    const callbacks = [...this.sessionReadyCallbacks];
    this.sessionReadyCallbacks = [];

    callbacks.forEach((callback) => {
      if (typeof callback === 'function') {
        try {
          callback();
        } catch (error) {
          console.error('Error in session ready callback:', error);
        }
      } else {
        console.error(
          'Invalid callback type in sessionReadyCallbacks:',
          typeof callback
        );
      }
    });

    console.info(`[Session Ready] Notified ${callbacks.length} callbacks`);
  }

  // Audio buffering methods
  private bufferAudioData(audioData: ArrayBuffer): void {
    // Remove old entries if buffer is full
    if (this.audioBuffer.length >= this.maxBufferSize) {
      this.audioBuffer.shift(); // Remove oldest entry
      console.warn(
        `[Audio Buffer] Buffer full, dropped oldest audio chunk. Buffer size: ${this.audioBuffer.length}`
      );
    }

    // Add new audio data to buffer
    this.audioBuffer.push({
      audioData: audioData.slice(0), // Clone the ArrayBuffer
      timestamp: Date.now()
    });

    console.info(
      `[Audio Buffer] Buffered audio chunk (${audioData.byteLength} bytes). Buffer size: ${this.audioBuffer.length}/${this.maxBufferSize}`
    );

    // Set timeout to clear buffer if session never becomes ready
    if (this.audioBuffer.length === 1) {
      setTimeout(() => {
        if (
          this.sessionState !== RealtimeAISessionState.SESSION_READY &&
          this.audioBuffer.length > 0
        ) {
          console.warn(
            `[Audio Buffer] Session not ready after ${this.bufferTimeoutMs}ms, clearing buffer`
          );
          this.clearAudioBufferInternal();
        }
      }, this.bufferTimeoutMs);
    }
  }

  private flushAudioBuffer(): void {
    if (this.audioBuffer.length === 0) {
      return;
    }

    console.info(
      `[Audio Buffer] Flushing ${this.audioBuffer.length} buffered audio chunks`
    );

    // Send all buffered audio data
    for (const bufferedData of this.audioBuffer) {
      const base64Audio = this.arrayBufferToBase64(bufferedData.audioData);
      this.send({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      });
    }

    // Clear the buffer
    this.audioBuffer = [];
    console.info('[Audio Buffer] Buffer flushed and cleared');
  }

  private clearAudioBufferInternal(): void {
    if (this.audioBuffer.length > 0) {
      console.info(
        `[Audio Buffer] Clearing ${this.audioBuffer.length} buffered audio chunks`
      );
      this.audioBuffer = [];
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.isConnected = false;
      this.sessionState = RealtimeAISessionState.DISCONNECTED;
      this.clearAudioBufferInternal();
      this.sessionReadyCallbacks = [];
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

// Export a singleton instance for easy use
export const realtimeAIClient = new RealtimeAIWebSocketClient();
