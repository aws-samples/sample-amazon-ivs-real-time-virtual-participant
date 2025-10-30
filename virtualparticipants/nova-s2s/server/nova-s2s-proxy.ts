import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  InvokeModelWithBidirectionalStreamCommandOutput
} from '@aws-sdk/client-bedrock-runtime';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

interface NovaS2SConfig {
  modelId: string;
  region: string;
  voiceId: string;
  systemPrompt: string;
}

interface AudioCallbackData {
  type: 'text-output' | 'audio-output';
  text?: string;
  role?: string;
  isFinal?: boolean;
  audio?: string;
}

interface QueueEvent {
  chunk: {
    bytes: Uint8Array;
  };
}

export class NovaS2SProxy {
  private client: BedrockRuntimeClient;
  private config: NovaS2SConfig;

  private stream: InvokeModelWithBidirectionalStreamCommandOutput | null = null;
  private isActive = false;
  private promptName: string;
  private contentName: string;
  private audioContentName: string;
  private onAudioCallback?: (data: AudioCallbackData) => void;
  private hasActivePrompt = false;
  private eventQueue: QueueEvent[] = [];
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private readonly KEEPALIVE_INTERVAL_MS = 30000; // 30 seconds
  private readonly SESSION_TIMEOUT_MS = 300000; // 5 minutes
  private isRecreating = false;

  // Track generation stage to determine if text output is final
  private currentGenerationStage: string | null = null;

  constructor() {
    this.config = {
      modelId: process.env.NOVA_MODEL_ID ?? 'amazon.nova-sonic-v1:0',
      region: process.env.BEDROCK_REGION ?? 'us-east-1',
      voiceId: process.env.NOVA_VOICE_ID ?? 'matthew',
      systemPrompt:
        process.env.NOVA_SYSTEM_PROMPT ??
        'You are a friendly assistant in a live video conversation. Keep responses brief and natural, typically 1-2 sentences.'
    };

    this.client = new BedrockRuntimeClient({
      region: this.config.region,
      credentials: fromNodeProviderChain()
    });

    this.promptName = this.generateId();
    this.contentName = this.generateId();
    this.audioContentName = this.generateId();

    console.info('Nova S2S Proxy initialized with config:', {
      modelId: this.config.modelId,
      region: this.config.region,
      voiceId: this.config.voiceId
    });
  }

  public setAudioCallback(callback: (data: AudioCallbackData) => void): void {
    this.onAudioCallback = callback;
  }

  public async startSession(): Promise<void> {
    console.info(
      '[NovaS2SProxy] startSession called, isActive:',
      this.isActive
    );

    if (this.isActive) {
      console.warn('Session already active');

      return;
    }

    try {
      // Queue initialization events BEFORE starting stream
      this.queueInitializationEvents();

      // Set active BEFORE creating iterator so it doesn't exit early
      this.isActive = true;

      // Create async iterable that yields from queue
      const asyncIterable = this.createAsyncIterable();

      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: this.config.modelId,
        body: asyncIterable
      });

      console.info('[NovaS2SProxy] Sending command to Bedrock...');
      this.stream = await this.client.send(command);
      console.info('[NovaS2SProxy] Command sent, stream received');

      // Update last activity time
      this.lastActivityTime = Date.now();

      // Start processing responses
      this.processResponses();

      // Start keepalive timer
      this.startKeepalive();

      console.info('Nova S2S session started successfully');
    } catch (error) {
      console.error('Failed to start Nova S2S session:', error);
      this.isActive = false;
      throw error;
    }
  }

  private queueInitializationEvents(): void {
    const textEncoder = new TextEncoder();

    // Session start
    this.eventQueue.push({
      chunk: {
        bytes: textEncoder.encode(
          JSON.stringify({
            event: {
              sessionStart: {
                inferenceConfiguration: {
                  maxTokens: 1024,
                  topP: 0.9,
                  temperature: 0.7
                }
              }
            }
          })
        )
      }
    });

    // Prompt start
    this.eventQueue.push({
      chunk: {
        bytes: textEncoder.encode(
          JSON.stringify({
            event: {
              promptStart: {
                promptName: this.promptName,
                textOutputConfiguration: {
                  mediaType: 'text/plain'
                },
                audioOutputConfiguration: {
                  mediaType: 'audio/lpcm',
                  sampleRateHertz: 24000,
                  sampleSizeBits: 16,
                  channelCount: 1,
                  voiceId: this.config.voiceId,
                  encoding: 'base64',
                  audioType: 'SPEECH'
                }
              }
            }
          })
        )
      }
    });

    // System prompt content start
    this.eventQueue.push({
      chunk: {
        bytes: textEncoder.encode(
          JSON.stringify({
            event: {
              contentStart: {
                promptName: this.promptName,
                contentName: this.contentName,
                type: 'TEXT',
                interactive: false,
                role: 'SYSTEM',
                textInputConfiguration: {
                  mediaType: 'text/plain'
                }
              }
            }
          })
        )
      }
    });

    // System prompt text
    this.eventQueue.push({
      chunk: {
        bytes: textEncoder.encode(
          JSON.stringify({
            event: {
              textInput: {
                promptName: this.promptName,
                contentName: this.contentName,
                content: this.config.systemPrompt
              }
            }
          })
        )
      }
    });

    // System prompt content end
    this.eventQueue.push({
      chunk: {
        bytes: textEncoder.encode(
          JSON.stringify({
            event: {
              contentEnd: {
                promptName: this.promptName,
                contentName: this.contentName
              }
            }
          })
        )
      }
    });

    // Audio content start (open before any audio is sent)
    this.eventQueue.push({
      chunk: {
        bytes: textEncoder.encode(
          JSON.stringify({
            event: {
              contentStart: {
                promptName: this.promptName,
                contentName: this.audioContentName,
                type: 'AUDIO',
                interactive: true,
                role: 'USER',
                audioInputConfiguration: {
                  mediaType: 'audio/lpcm',
                  sampleRateHertz: 16000,
                  sampleSizeBits: 16,
                  channelCount: 1,
                  audioType: 'SPEECH',
                  encoding: 'base64'
                }
              }
            }
          })
        )
      }
    });

    this.hasActivePrompt = true;
    console.info(
      '[NovaS2SProxy] Queued',
      this.eventQueue.length,
      'initialization events'
    );
  }

  private createAsyncIterable(): AsyncIterable<QueueEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<QueueEvent>> => {
          // Wait for events if queue is empty
          while (this.eventQueue.length === 0) {
            // If session is explicitly stopped, close the iterator
            if (!this.isActive) {
              return { value: undefined, done: true };
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          // Yield queued event
          const event = this.eventQueue.shift();

          if (!event) {
            return { value: undefined, done: true };
          }

          return { value: event, done: false };
        }
      })
    };
  }

  public stopSession(): void {
    if (!this.isActive) return;

    // Stop keepalive timer
    this.stopKeepalive();

    try {
      const textEncoder = new TextEncoder();

      // Close audio content
      if (this.hasActivePrompt) {
        this.eventQueue.push({
          chunk: {
            bytes: textEncoder.encode(
              JSON.stringify({
                event: {
                  contentEnd: {
                    promptName: this.promptName,
                    contentName: this.audioContentName
                  }
                }
              })
            )
          }
        });

        // Close prompt
        this.eventQueue.push({
          chunk: {
            bytes: textEncoder.encode(
              JSON.stringify({
                event: {
                  promptEnd: {
                    promptName: this.promptName
                  }
                }
              })
            )
          }
        });

        // End session
        this.eventQueue.push({
          chunk: {
            bytes: textEncoder.encode(
              JSON.stringify({
                event: {
                  sessionEnd: {}
                }
              })
            )
          }
        });
      }

      this.isActive = false;
      this.hasActivePrompt = false;
      console.info('Nova S2S session stopped');
    } catch (error) {
      console.error('Error stopping session:', error);
    }
  }

  public async sendAudio(audioBase64: string): Promise<void> {
    // Check session health and recover if needed
    if (!this.isSessionHealthy()) {
      console.warn(
        '[NovaS2SProxy] Session not healthy, attempting recovery...'
      );
      try {
        await this.ensureSessionActive();
      } catch (error) {
        console.error('[NovaS2SProxy] Failed to recover session:', error);

        return;
      }
    }

    if (!this.isActive) {
      console.warn('Cannot send audio: session not active');

      return;
    }

    try {
      const textEncoder = new TextEncoder();

      // Update last activity time
      this.lastActivityTime = Date.now();

      // Log audio being sent
      // console.info(
      //   `[Nova S2S] Sending audio chunk: ${audioBase64.length} bytes (base64)`
      // );

      // Just send audio data - content was already opened during initialization
      this.eventQueue.push({
        chunk: {
          bytes: textEncoder.encode(
            JSON.stringify({
              event: {
                audioInput: {
                  promptName: this.promptName,
                  contentName: this.audioContentName,
                  content: audioBase64
                }
              }
            })
          )
        }
      });
    } catch (error) {
      console.error('Error sending audio:', error);
    }
  }

  /**
   * Check if the session is healthy and active
   */
  private isSessionHealthy(): boolean {
    if (!this.isActive) {
      return false;
    }

    // Check if session has timed out due to inactivity
    const timeSinceLastActivity = Date.now() - this.lastActivityTime;
    if (timeSinceLastActivity > this.SESSION_TIMEOUT_MS) {
      console.warn(
        `[NovaS2SProxy] Session timeout detected: ${timeSinceLastActivity}ms since last activity`
      );

      return false;
    }

    return true;
  }

  /**
   * Ensure session is active, recreating if necessary
   */
  private async ensureSessionActive(): Promise<void> {
    if (this.isSessionHealthy()) {
      return;
    }

    // Prevent concurrent recreation attempts
    if (this.isRecreating) {
      console.info(
        '[NovaS2SProxy] Session recreation already in progress, waiting...'
      );
      // Wait for recreation to complete
      while (this.isRecreating) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return;
    }

    try {
      this.isRecreating = true;
      console.info('[NovaS2SProxy] Recreating inactive session...');

      // Stop existing session if any
      if (this.isActive) {
        this.stopSession();
        // Wait a bit for cleanup
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Generate new IDs for the new session
      this.promptName = this.generateId();
      this.contentName = this.generateId();
      this.audioContentName = this.generateId();

      // Clear event queue
      this.eventQueue = [];

      // Start new session
      await this.startSession();

      // Start keepalive timer
      this.startKeepalive();

      console.info('[NovaS2SProxy] Session recreated successfully');
    } catch (error) {
      console.error('[NovaS2SProxy] Failed to recreate session:', error);
      throw error;
    } finally {
      this.isRecreating = false;
    }
  }

  /**
   * Start keepalive timer to maintain session health
   */
  private startKeepalive(): void {
    this.stopKeepalive();

    this.keepaliveTimer = setInterval(() => {
      if (!this.isActive) {
        this.stopKeepalive();

        return;
      }

      const timeSinceLastActivity = Date.now() - this.lastActivityTime;

      // If approaching timeout, log warning
      if (timeSinceLastActivity > this.SESSION_TIMEOUT_MS * 0.8) {
        console.warn(
          `[NovaS2SProxy] Session approaching timeout: ${timeSinceLastActivity}ms since last activity`
        );
      }

      console.info(
        `[NovaS2SProxy] Keepalive check: session active, ${timeSinceLastActivity}ms since last activity`
      );
    }, this.KEEPALIVE_INTERVAL_MS);

    console.info(
      `[NovaS2SProxy] Keepalive timer started (interval: ${this.KEEPALIVE_INTERVAL_MS}ms)`
    );
  }

  /**
   * Stop keepalive timer
   */
  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      console.info('[NovaS2SProxy] Keepalive timer stopped');
    }
  }

  /**
   * Get session status information
   */
  public getSessionStatus(): {
    isActive: boolean;
    timeSinceLastActivity: number;
    isHealthy: boolean;
  } {
    return {
      isActive: this.isActive,
      timeSinceLastActivity: Date.now() - this.lastActivityTime,
      isHealthy: this.isSessionHealthy()
    };
  }

  private async processResponses(): Promise<void> {
    if (!this.stream?.body) {
      console.error('[Nova S2S] No stream body available');

      return;
    }

    try {
      console.info('[Nova S2S] Starting response processing...');
      // AWS SDK returns response.body as the output stream
      for await (const event of this.stream.body) {
        console.info('[Nova S2S] Received event from stream');

        if (!this.isActive) {
          console.info(
            '[Nova S2S] Session no longer active, stopping response processing'
          );
          break;
        }

        if (event.chunk?.bytes) {
          try {
            const textDecoder = new TextDecoder();
            const textResponse = textDecoder.decode(event.chunk.bytes);
            console.info(
              '[Nova S2S] Decoded response:',
              textResponse.substring(0, 500)
            );

            try {
              const jsonResponse = JSON.parse(textResponse);

              // Handle different event types
              if (jsonResponse.event?.contentStart) {
                console.info(
                  '[Nova S2S] Content start:',
                  jsonResponse.event.contentStart.role
                );

                // Track generation stage from additionalModelFields
                if (jsonResponse.event.contentStart.additionalModelFields) {
                  try {
                    const fields = JSON.parse(
                      jsonResponse.event.contentStart.additionalModelFields
                    );
                    this.currentGenerationStage =
                      fields.generationStage || null;
                    console.info(
                      '[Nova S2S] Generation stage:',
                      this.currentGenerationStage
                    );
                  } catch (_e) {
                    this.currentGenerationStage = null;
                  }
                }
              } else if (jsonResponse.event?.textOutput) {
                const text = jsonResponse.event.textOutput.content;
                const role = jsonResponse.event.textOutput.role || 'UNKNOWN';
                console.info(`[Nova S2S] Text output [${role}]: "${text}"`);

                // Forward to callback
                // Only mark as final if generationStage is FINAL (not SPECULATIVE)
                const isFinal = this.currentGenerationStage === 'FINAL';

                if (this.onAudioCallback) {
                  this.onAudioCallback({
                    type: 'text-output',
                    text,
                    role,
                    isFinal
                  });
                }
              } else if (jsonResponse.event?.audioOutput) {
                const audioContent = jsonResponse.event.audioOutput.content;
                console.info('[Nova S2S] Audio output received');

                // Forward audio to callback
                if (this.onAudioCallback) {
                  this.onAudioCallback({
                    type: 'audio-output',
                    audio: audioContent
                  });
                }
              } else if (jsonResponse.event?.contentEnd) {
                console.info('[Nova S2S] Content end');
              } else if (jsonResponse.event?.completionEnd) {
                console.info('[Nova S2S] Completion end');
              }
            } catch (_parseError) {
              console.info(
                '[Nova S2S] Could not parse response:',
                textResponse.substring(0, 100)
              );
            }
          } catch (decodeError) {
            console.error('[Nova S2S] Error decoding response:', decodeError);
          }
        } else if (event.modelStreamErrorException) {
          console.error(
            '[Nova S2S] Model stream error:',
            event.modelStreamErrorException
          );
        } else if (event.internalServerException) {
          console.error(
            '[Nova S2S] Internal server error:',
            event.internalServerException
          );
        }
      }
    } catch (error) {
      console.error('[Nova S2S] Error processing responses:', error);
    } finally {
      this.isActive = false;
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
