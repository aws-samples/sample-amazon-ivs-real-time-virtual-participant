import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';

import {
  VirtualParticipantStatus,
  VirtualParticipantSubscriptionData
} from '../src/types/virtual-participant.types';
import { AppSyncSubscriber } from './appsync-subscriber';
import { DynamoDBVpClient, VpStatus } from './dynamodb-client';
import { VirtualParticipantLambdaClient } from './lambda-client';
import { downloadFileFromS3 } from './s3';

// Types
interface ClientConnection {
  ws: WebSocket;
  id: string;
  subscriptions: Set<string>;
}

export class VirtualParticipantWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Map<string, ClientConnection>();
  private appSyncSubscriber: AppSyncSubscriber | null = null;
  private dynamoDbClient: DynamoDBVpClient | null = null;
  private lambdaClient: VirtualParticipantLambdaClient;

  constructor(port = 3001) {
    // Create WebSocket server
    this.wss = new WebSocketServer({
      port,
      perMessageDeflate: false // Disable compression for real-time performance
    });

    // Initialize Lambda client for token creation
    this.lambdaClient = new VirtualParticipantLambdaClient();

    // Initialize DynamoDB client if VP_TABLE_NAME is available
    console.info(
      'DynamoDB VirtualParticipant Table name: ',
      process.env.VP_TABLE_NAME
    );
    if (process.env.VP_TABLE_NAME) {
      try {
        this.dynamoDbClient = new DynamoDBVpClient();
        console.info('DynamoDB VP client initialized successfully');
      } catch (error) {
        console.error('Failed to initialize DynamoDB VP client:', error);
      }
    }

    // Initialize AppSync subscriber if GraphQL URL is available
    console.info('GraphQL API URL: ', process.env.GRAPHQL_API_URL);
    if (process.env.GRAPHQL_API_URL) {
      this.appSyncSubscriber = new AppSyncSubscriber(
        process.env.GRAPHQL_API_URL,
        process.env.AWS_REGION
      );
      this.initializeAppSync();
    }

    this.setupServer();
    console.info(
      `Virtual Participant WebSocket server started on port ${port}`
    );
  }

  private initializeAppSync(): void {
    if (!this.appSyncSubscriber) {
      return;
    }

    try {
      this.appSyncSubscriber.connect();
      console.info('AppSync subscriber connected successfully');
    } catch (error) {
      console.error('Failed to connect to AppSync:', error);
    }
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = this.generateClientId();
      const client: ClientConnection = {
        ws,
        id: clientId,
        subscriptions: new Set()
      };

      this.clients.set(clientId, client);
      console.info(`Client ${clientId} connected`);

      // Handle messages from client
      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(client, message);
        } catch (error) {
          console.error(
            `Error handling message from client ${clientId}:`,
            error
          );
          this.sendError(ws, 'Invalid message format');
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        console.info(`Client ${clientId} disconnected`);
        this.cleanup(client);
      });

      // Handle client errors
      ws.on('error', (error) => {
        console.error(`Client ${clientId} error:`, error);
        this.cleanup(client);
      });

      // Send welcome message
      this.sendMessage(ws, {
        type: 'connection',
        status: 'connected',
        clientId,
        capabilities: {
          appsync: !!this.appSyncSubscriber
        }
      });
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  private handleClientMessage(
    client: ClientConnection,
    message: unknown
  ): void {
    // Type guard to check if message has a type property
    const isValidMessage = (
      msg: unknown
    ): msg is { type: string; [key: string]: unknown } =>
      msg !== null &&
      typeof msg === 'object' &&
      msg !== undefined &&
      'type' in msg;

    if (!isValidMessage(message)) {
      this.sendError(client.ws, 'Invalid message format');

      return;
    }

    switch (message.type) {
      case 'vp.subscribe_vp':
        this.handleVirtualParticipantSubscription(
          client,
          message as { vpId?: string }
        );

        break;

      case 'vp.subscribe_stage':
        this.handleStageSubscription(client, message as { stageId?: string });

        break;

      case 'vp.unsubscribe':
        this.handleUnsubscribe(client, message as { subscriptionId?: string });

        break;

      // VP status update messages
      case 'vp.ready':
        this.handleVpReady(
          client,
          message as { vpId?: string; metadata?: unknown }
        );
        break;

      case 'vp.status_update':
        this.handleVpStatusUpdate(
          client,
          message as {
            vpId?: string;
            status?: string;
            metadata?: unknown;
          }
        );
        break;

      case 'vp.joined_stage':
        this.handleVpJoinedStage(client);
        break;

      case 'vp.left_stage':
        this.handleVpLeftStage(client);
        break;

      case 'vp.error':
        this.handleVpError(
          client,
          message as {
            error?: string;
          }
        );
        break;

      default:
        this.sendError(client.ws, `Unknown message type: ${message.type}`);
    }
  }

  private handleVirtualParticipantSubscription(
    client: ClientConnection,
    message: { vpId?: string }
  ): void {
    if (!this.appSyncSubscriber) {
      console.error('AppSync not available for VP subscription');
      this.sendError(client.ws, 'AppSync not available');

      return;
    }

    const vpId = message.vpId ?? process.env.VP_ID;

    if (!vpId) {
      this.sendError(client.ws, 'VP ID is required for subscription');

      return;
    }

    console.info(
      `Creating VP subscription for client ${client.id}, VP ID: ${vpId}`
    );

    const subscriptionId = `vp-${vpId}`;

    this.appSyncSubscriber.subscribeToVirtualParticipantChanges(
      vpId,
      async (subscriptionData: unknown) => {
        console.info(
          `VP subscription callback triggered for VP ${vpId}:`,
          JSON.stringify(subscriptionData)
        );

        const vpData = subscriptionData as VirtualParticipantSubscriptionData;
        const vpInfo = vpData.onVirtualParticipantStateChanged;

        // Skip if this update was triggered by this VP server to prevent feedback loops
        if (
          vpInfo &&
          vpInfo.lastUpdateSource === 'vp-server' &&
          vpInfo.taskId === process.env.ECS_TASK_ID
        ) {
          console.info(
            `Skipping self-triggered update for VP ${vpId} - preventing feedback loop`
          );

          return;
        }

        // Skip if this is just a routine update without meaningful changes
        if (vpInfo && vpInfo.lastUpdateSource === 'vp-server') {
          console.info(
            `Skipping VP server update for VP ${vpId} - likely from another VP instance`
          );

          return;
        }

        let dataToReturn = subscriptionData;

        // Check if VP was invited and create participant token
        try {
          if (
            vpInfo &&
            vpInfo.status === VirtualParticipantStatus.INVITED &&
            vpInfo.stageArn &&
            vpInfo.stageEndpoints
          ) {
            console.info(
              `VP ${vpId} was invited to stage ${vpInfo.stageArn}, creating participant token`
            );

            // Get the stage record to find the correct stage ID for the lambda
            if (!this.dynamoDbClient) {
              throw new Error('DynamoDB client not available for stage lookup');
            }

            console.info(`Looking up stage record for ARN: ${vpInfo.stageArn}`);
            const stageRecord = await this.dynamoDbClient.getStageRecordByArn(
              vpInfo.stageArn
            );

            if (!stageRecord) {
              throw new Error(
                `No stage record found for ARN: ${vpInfo.stageArn}`
              );
            }

            console.info(
              `Found stage record with ID: ${stageRecord.id} for ARN: ${vpInfo.stageArn}`
            );

            // Invoke createPlayerToken lambda function with proper stage ID
            const { token, participantId } =
              await this.lambdaClient.createParticipantToken(
                stageRecord.id,
                vpId
              );

            if (vpInfo.assetName) {
              const { assetName } = vpInfo;
              // download the asset to the build folder using absolute path
              const buildPath = path.join(process.cwd(), 'build', assetName);
              await downloadFileFromS3(assetName, buildPath);
            }

            // Add token and participantId to the returned data
            dataToReturn = {
              ...vpData,
              onVirtualParticipantStateChanged: {
                ...vpInfo,
                participantToken: token,
                participantId
              }
            };

            console.info(
              `Participant token created for VP ${vpId}, participantId: ${participantId}`
            );
          }
        } catch (error) {
          console.error(
            `Failed to create participant token for VP ${vpId}:`,
            error
          );
          // Continue with original data if token creation fails
        }

        if (client.ws.readyState === WebSocket.OPEN) {
          console.info(
            `Sending VP update to client ${client.id} for VP ${vpId}`
          );
          this.sendMessage(client.ws, {
            type: 'vp.update',
            data: dataToReturn
          });
        } else {
          console.warn(
            `Client ${client.id} websocket not open, cannot send VP update for VP ${vpId}`
          );
        }
      }
    );

    client.subscriptions.add(subscriptionId);

    this.sendMessage(client.ws, {
      type: 'subscription.created',
      subscriptionId,
      target: 'virtualParticipant',
      vpId: message.vpId
    });

    console.info(
      `VP subscription created for client ${client.id}, subscription ID: ${subscriptionId}`
    );
  }

  private handleStageSubscription(
    client: ClientConnection,
    message: { stageId?: string }
  ): void {
    if (!this.appSyncSubscriber || !message.stageId) {
      this.sendError(client.ws, 'AppSync not available or missing stageId');

      return;
    }

    const subscriptionId = `stage-${message.stageId}`;

    this.appSyncSubscriber.subscribeToStageChanges(
      message.stageId,
      (stage: unknown) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          this.sendMessage(client.ws, {
            type: 'stage.update',
            data: stage
          });
        }
      }
    );

    client.subscriptions.add(subscriptionId);

    this.sendMessage(client.ws, {
      type: 'subscription.created',
      subscriptionId,
      target: 'stage',
      stageId: message.stageId
    });
  }

  private handleUnsubscribe(
    client: ClientConnection,
    message: { subscriptionId?: string }
  ): void {
    if (!this.appSyncSubscriber || !message.subscriptionId) {
      this.sendError(
        client.ws,
        'AppSync not available or missing subscriptionId'
      );

      return;
    }

    this.appSyncSubscriber.unsubscribe(message.subscriptionId);
    client.subscriptions.delete(message.subscriptionId);

    this.sendMessage(client.ws, {
      type: 'subscription.removed',
      subscriptionId: message.subscriptionId
    });
  }

  /**
   * Handle VP ready message - when the page loads and VP is ready to join a stage
   */
  private async handleVpReady(
    client: ClientConnection,
    message: { vpId?: string; metadata?: unknown }
  ): Promise<void> {
    if (!this.dynamoDbClient) {
      this.sendError(client.ws, 'DynamoDB client not available');

      return;
    }

    const vpId = message.vpId ?? this.dynamoDbClient.getCurrentVpId();
    if (!vpId) {
      this.sendError(client.ws, 'VP ID is required for status updates');

      return;
    }

    try {
      const additionalAttrs: Record<string, unknown> = {};
      if (message.metadata) {
        additionalAttrs.metadata = message.metadata;
      }

      await this.dynamoDbClient.updateVpStatus(
        vpId,
        VpStatus.AVAILABLE,
        additionalAttrs
      );

      console.info(`VP ${vpId} marked as AVAILABLE`);
    } catch (error) {
      console.error(`Error updating VP ${vpId} to AVAILABLE:`, error);
      this.sendError(client.ws, 'Failed to update VP status');
    }
  }

  /**
   * Handle generic VP status update message
   */
  private async handleVpStatusUpdate(
    client: ClientConnection,
    message: { vpId?: string; status?: string; metadata?: unknown }
  ): Promise<void> {
    if (!this.dynamoDbClient) {
      this.sendError(client.ws, 'DynamoDB client not available');

      return;
    }

    const vpId = message.vpId ?? this.dynamoDbClient.getCurrentVpId();
    if (!vpId || !message.status) {
      this.sendError(
        client.ws,
        'VP ID and status are required for status updates'
      );

      return;
    }

    // Validate status is a valid VpStatus
    if (!Object.values(VpStatus).includes(message.status as VpStatus)) {
      this.sendError(client.ws, `Invalid status: ${message.status}`);

      return;
    }

    try {
      const additionalAttrs: Record<string, unknown> = {};
      if (message.metadata) {
        additionalAttrs.metadata = message.metadata;
      }

      await this.dynamoDbClient.updateVpStatus(
        vpId,
        message.status as VpStatus,
        additionalAttrs
      );

      console.info(`VP ${vpId} status updated to ${message.status}`);
    } catch (error) {
      console.error(
        `Error updating VP ${vpId} status to ${message.status}:`,
        error
      );
      this.sendError(client.ws, 'Failed to update VP status');
    }
  }

  /**
   * Handle VP joined stage message
   */
  private async handleVpJoinedStage(client: ClientConnection): Promise<void> {
    if (!this.dynamoDbClient) {
      this.sendError(client.ws, 'DynamoDB client not available');

      return;
    }

    const vpId = this.dynamoDbClient.getCurrentVpId();
    if (!vpId) {
      this.sendError(client.ws, 'VP ID is required for status updates');

      return;
    }

    try {
      await this.dynamoDbClient.updateVpStatus(vpId, VpStatus.JOINED);

      console.info(`VP ${vpId} joined stage and is now JOINED`);
    } catch (error) {
      console.error(`Error updating VP ${vpId} to JOINED:`, error);
      this.sendError(client.ws, 'Failed to update VP status');
    }
  }

  /**
   * Handle VP left stage message
   */
  private async handleVpLeftStage(client: ClientConnection): Promise<void> {
    if (!this.dynamoDbClient) {
      this.sendError(client.ws, 'DynamoDB client not available');

      return;
    }

    const vpId = this.dynamoDbClient.getCurrentVpId();
    if (!vpId) {
      this.sendError(client.ws, 'VP ID is required for status updates');

      return;
    }

    try {
      await this.dynamoDbClient.updateVpStatus(vpId, VpStatus.AVAILABLE, {
        stageArn: 'unassigned',
        stageEndpoints: {}
      });

      console.info(`VP ${vpId} left stage and is now AVAILABLE`);
    } catch (error) {
      console.error(
        `Error updating VP ${vpId} to AVAILABLE after leaving stage:`,
        error
      );
      this.sendError(client.ws, 'Failed to update VP status');
    }
  }

  /**
   * Handle VP error message
   */
  private async handleVpError(
    client: ClientConnection,
    message: { error?: string }
  ): Promise<void> {
    if (!this.dynamoDbClient) {
      this.sendError(client.ws, 'DynamoDB client not available');

      return;
    }

    const vpId = this.dynamoDbClient.getCurrentVpId();
    if (!vpId) {
      this.sendError(client.ws, 'VP ID is required for error reporting');

      return;
    }

    try {
      const additionalAttrs: Record<string, unknown> = {};
      if (message.error) {
        additionalAttrs.lastError = message.error;
      }

      await this.dynamoDbClient.updateVpStatus(
        vpId,
        VpStatus.ERRORED,
        additionalAttrs
      );

      console.error(
        `VP ${vpId} encountered error and is now ERRORED: ${message.error}`
      );
    } catch (error) {
      console.error(`Error updating VP ${vpId} to ERRORED after error:`, error);
      this.sendError(client.ws, 'Failed to update VP status');
    }
  }

  private sendMessage(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      console.info('Sending websocket message: ', JSON.stringify(message));
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.sendMessage(ws, {
      type: 'error',
      error
    });
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanup(client: ClientConnection): void {
    // Unsubscribe from all AppSync subscriptions
    if (this.appSyncSubscriber) {
      client.subscriptions.forEach((subscriptionId) => {
        this.appSyncSubscriber!.unsubscribe(subscriptionId);
      });
    }

    // Remove from clients map
    this.clients.delete(client.id);
  }

  public close(): void {
    console.info('Shutting down Virtual Participant WebSocket server...');

    // Close all client connections
    this.clients.forEach((client) => {
      this.cleanup(client);
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close();
      }
    });

    // Close AppSync subscriber
    if (this.appSyncSubscriber) {
      this.appSyncSubscriber.disconnect();
    }

    // Close server
    this.wss.close();
  }

  // Health check method
  public getServerStatus(): {
    clients: number;
    appSyncActive: boolean;
  } {
    return {
      clients: this.clients.size,
      appSyncActive: this.appSyncSubscriber?.connected ?? false
    };
  }
}

// Start the server
const server = new VirtualParticipantWebSocketServer(3001);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.info('Received SIGTERM, shutting down gracefully...');
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.info('Received SIGINT, shutting down gracefully...');
  server.close();
  process.exit(0);
});

export default VirtualParticipantWebSocketServer;
