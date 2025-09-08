import { fromContainerMetadata } from '@aws-sdk/credential-providers';
import { AWSAppSyncClient } from 'aws-appsync';
import gql from 'graphql-tag';
import { WebSocket } from 'ws';

// Make WebSocket available globally for AppSync client
if (typeof global !== 'undefined' && !global.WebSocket) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.WebSocket = WebSocket as any;
  console.info('WebSocket polyfill installed for AppSync client');
}

// Also ensure it's available on globalThis for broader compatibility
if (typeof globalThis !== 'undefined' && !globalThis.WebSocket) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.WebSocket = WebSocket as any;
}

interface AppSyncSubscription {
  unsubscribe(): void;
}

export interface GraphQLSubscription {
  id: string;
  query: string;
  variables?: Record<string, unknown>;
}

export interface GraphQLMessage {
  id?: string;
  type: string;
  payload?: {
    data?: unknown;
    errors?: { message: string }[];
  };
}

export class AppSyncSubscriber {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: AWSAppSyncClient<any> | null = null;
  private subscriptions = new Map<string, AppSyncSubscription>();
  private messageHandlers = new Map<
    string,
    (message: GraphQLMessage) => void
  >();

  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private graphqlUrl: string;
  private region: string;

  constructor(
    graphqlUrl: string,
    region: string = process.env.AWS_REGION ?? 'us-east-1'
  ) {
    this.graphqlUrl = graphqlUrl;
    this.region = region;
  }

  connect(): void {
    if (this.isConnected && this.client) {
      console.info(
        'AppSync client already connected, skipping connection attempt'
      );

      return;
    }

    try {
      console.info(
        `Connecting to AppSync at ${this.graphqlUrl} in region ${this.region}`
      );
      console.info(
        `WebSocket available: ${typeof global.WebSocket !== 'undefined'}`
      );

      // Use fromContainerMetadata for ECS container authentication
      const credentials = fromContainerMetadata();

      this.client = new AWSAppSyncClient({
        url: this.graphqlUrl,
        region: this.region,
        auth: {
          type: 'AWS_IAM',
          credentials
        },
        disableOffline: true
      });

      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.info(
        'Connected to AppSync using AWSAppSyncClient with container metadata credentials'
      );
    } catch (error) {
      console.error('Failed to connect to AppSync:', error);
      this.isConnected = false;
      this.handleReconnect();
      throw error;
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.info(
        `Attempting to reconnect to AppSync (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );

      setTimeout(() => {
        try {
          this.connect();
        } catch (error) {
          console.error('AppSync reconnection failed:', error);
        }
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max AppSync reconnection attempts reached');
    }
  }

  subscribe(
    subscriptionId: string,
    query: string,
    variables: Record<string, unknown> = {},
    onMessage: (message: GraphQLMessage) => void
  ): void {
    if (!this.isConnected || !this.client) {
      console.error('Cannot subscribe: not connected to AppSync');

      return;
    }

    try {
      const subscription = this.client
        .subscribe({
          query: gql(query),
          variables
        })
        .subscribe({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          next: (result: any) => {
            console.info(
              `AppSync subscription ${subscriptionId} received data:`,
              result
            );

            // Transform the result to match the expected GraphQLMessage format
            const message: GraphQLMessage = {
              id: subscriptionId,
              type: 'data',
              payload: {
                data: result.data,
                errors: result.errors
              }
            };

            const handler = this.messageHandlers.get(subscriptionId);
            if (handler) {
              handler(message);
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          error: (error: any) => {
            console.error(
              `AppSync subscription ${subscriptionId} error:`,
              error
            );

            const errorMessage: GraphQLMessage = {
              id: subscriptionId,
              type: 'error',
              payload: {
                errors: [{ message: error.message || 'Subscription error' }]
              }
            };

            const handler = this.messageHandlers.get(subscriptionId);
            if (handler) {
              handler(errorMessage);
            }

            // Attempt reconnection on error
            this.isConnected = false;
            this.handleReconnect();
          },
          complete: () => {
            console.info(`AppSync subscription ${subscriptionId} completed`);

            const completeMessage: GraphQLMessage = {
              id: subscriptionId,
              type: 'complete'
            };

            const handler = this.messageHandlers.get(subscriptionId);
            if (handler) {
              handler(completeMessage);
            }

            this.subscriptions.delete(subscriptionId);
            this.messageHandlers.delete(subscriptionId);
          }
        });

      this.subscriptions.set(subscriptionId, subscription);
      this.messageHandlers.set(subscriptionId, onMessage);

      console.info(`Started AppSync subscription: ${subscriptionId}`);
    } catch (error) {
      console.error(
        `Failed to create AppSync subscription ${subscriptionId}:`,
        error
      );
      throw error;
    }
  }

  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      try {
        subscription.unsubscribe();
        this.subscriptions.delete(subscriptionId);
        this.messageHandlers.delete(subscriptionId);
        console.info(`Stopped AppSync subscription: ${subscriptionId}`);
      } catch (error) {
        console.error(`Error unsubscribing from ${subscriptionId}:`, error);
      }
    }
  }

  disconnect(): void {
    console.info('Disconnecting from AppSync...');

    // Unsubscribe from all active subscriptions
    this.subscriptions.forEach((subscription, subscriptionId) => {
      try {
        subscription.unsubscribe();
        console.info(`Unsubscribed from ${subscriptionId}`);
      } catch (error) {
        console.error(`Error unsubscribing from ${subscriptionId}:`, error);
      }
    });

    this.subscriptions.clear();
    this.messageHandlers.clear();
    this.isConnected = false;
    this.client = null;

    console.info('AppSync client disconnected');
  }

  get connected(): boolean {
    return this.isConnected && this.client !== null;
  }

  // Convenience methods for common subscriptions
  subscribeToVirtualParticipantChanges(
    vpId: string,
    onUpdate: (participant: unknown) => void
  ): void {
    const query = `
      subscription OnVirtualParticipantStateChanged($id: ID!) {
        onVirtualParticipantStateChanged(id: $id) {
          id
          status
          assetName
          lastUpdateSource
          stageArn
          stageEndpoints {
            whip
            events
          }
          taskId
          updatedAt
        }
      }
    `;

    console.info(`Setting up VP subscription for VP ID: ${vpId}`);

    this.subscribe(`vp-${vpId}`, query, { id: vpId }, (message) => {
      console.info(
        `VP subscription message received for VP ${vpId}:`,
        JSON.stringify(message)
      );

      if (message.payload?.data) {
        console.info(
          `Calling onUpdate with data:`,
          JSON.stringify(message.payload.data)
        );
        onUpdate(message.payload.data);
      } else {
        console.warn(
          `VP subscription message received but no data in payload:`,
          JSON.stringify(message)
        );
      }
    });
  }

  subscribeToStageChanges(
    stageId: string,
    onUpdate: (stage: unknown) => void
  ): void {
    const query = `
      subscription OnStageChanged($id: ID!) {
        onStageChanged(id: $id) {
          id
          name
          participants
          publicKey
        }
      }
    `;

    this.subscribe(`stage-${stageId}`, query, { id: stageId }, (message) => {
      if (message.payload?.data) {
        onUpdate(message.payload.data);
      }
    });
  }
}
