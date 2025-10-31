import { WebSocket } from 'ws';

export interface RealtimeAIMessage {
  type: string;
  [key: string]: unknown;
}

export interface RealtimeAISession {
  realtimeAIWs?: WebSocket;
  isConnected: boolean;
}

export class RealtimeAIProxy {
  private sessions = new Map<string, RealtimeAISession>();

  createSession(
    clientId: string,
    sessionConfig: unknown,
    onMessage: (message: RealtimeAIMessage) => void,
    onError: (error: string) => void,
    onSessionClosed: (code: number, reason: string) => void
  ): void {
    try {
      // Validate session configuration
      const validatedConfig = this.validateSessionConfig(sessionConfig);

      // Create connection to Realtime AI API
      const realtimeAIWs = new WebSocket(
        'wss://api.openai.com/v1/realtime?model=gpt-realtime',
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
          }
        }
      );

      const session: RealtimeAISession = {
        realtimeAIWs,
        isConnected: false
      };

      this.sessions.set(clientId, session);

      realtimeAIWs.on('open', () => {
        console.info(`Realtime AI session created for client ${clientId}`);
        session.isConnected = true;

        // Send session configuration to Realtime AI service
        realtimeAIWs.send(JSON.stringify(validatedConfig));

        // Notify client that session is ready
        onMessage({
          type: 'session.created',
          status: 'connected'
        });
      });

      realtimeAIWs.on('message', (data: Buffer) => {
        try {
          const message: RealtimeAIMessage = JSON.parse(data.toString());
          onMessage(message);
        } catch (error) {
          console.error(
            `Error parsing Realtime AI message for client ${clientId}:`,
            error
          );
          onError('Error parsing Realtime AI response');
        }
      });

      realtimeAIWs.on('close', (code, reason) => {
        console.info(
          `Realtime AI session closed for client ${clientId}:`,
          code,
          reason.toString()
        );
        session.isConnected = false;
        onSessionClosed(code, reason.toString());
      });

      realtimeAIWs.on('error', (error) => {
        console.error(
          `Realtime AI session error for client ${clientId}:`,
          error
        );
        session.isConnected = false;
        onError(`Realtime AI session error: ${error.message}`);
      });
    } catch (error) {
      console.error(
        `Failed to create Realtime AI session for client ${clientId}:`,
        error
      );
      onError(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  forwardMessage(clientId: string, message: RealtimeAIMessage): boolean {
    const session = this.sessions.get(clientId);

    if (!session?.realtimeAIWs || !session.isConnected) {
      return false;
    }

    try {
      session.realtimeAIWs.send(JSON.stringify(message));

      return true;
    } catch (error) {
      console.error(
        `Error forwarding message to Realtime AI for client ${clientId}:`,
        error
      );

      return false;
    }
  }

  closeSession(clientId: string): void {
    const session = this.sessions.get(clientId);

    if (session?.realtimeAIWs) {
      session.realtimeAIWs.close();
      session.isConnected = false;
    }

    this.sessions.delete(clientId);
  }

  isSessionActive(clientId: string): boolean {
    const session = this.sessions.get(clientId);

    return session?.isConnected ?? false;
  }

  private validateSessionConfig(config: unknown): unknown {
    // Basic validation and sanitization of session configuration
    return config;
  }

  cleanup(): void {
    // Close all Realtime AI sessions
    this.sessions.forEach((_session, clientId) => {
      this.closeSession(clientId);
    });

    this.sessions.clear();
  }
}
