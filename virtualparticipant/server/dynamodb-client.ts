import {
  AttributeValue,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { convertToAttr, unmarshall } from '@aws-sdk/util-dynamodb';

// Local types to match the shared typings
interface VpRecord {
  id: string;
  ttl?: number;
  running?: 'yes';
  participantId?: string;
  status: string;
  taskId: string;
  createdAt: string;
  updatedAt: string;
  stageArn: string;
  stageEndpoints: unknown;
}

interface StageRecord {
  id: string;
  hostParticipantId: string;
  ttl?: string;
  createdAt: string;
  updatedAt: string;
  stageArn: string;
  stageEndpoints: unknown;
}

enum VpStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  PROVISIONING = 'PROVISIONING',
  DEPROVISIONING = 'DEPROVISIONING',
  INVITED = 'INVITED',
  JOINED = 'JOINED',
  ERRORED = 'ERRORED',
  KICKED = 'KICKED',
  AVAILABLE = 'AVAILABLE'
}

export class DynamoDBVpClient {
  private ddbDocClient: DynamoDBDocumentClient;
  private tableName: string;
  private tasksIndexName: string;
  private stateIndexName: string;
  private stagesTableName: string;

  constructor() {
    const ddbClient = new DynamoDBClient({});
    this.ddbDocClient = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: {
        convertClassInstanceToMap: false,
        convertEmptyValues: false,
        removeUndefinedValues: true
      },
      unmarshallOptions: {
        wrapNumbers: false
      }
    });

    this.tableName = process.env.VP_TABLE_NAME ?? '';
    this.tasksIndexName = process.env.TASKS_INDEX_NAME ?? 'TasksIndex';
    this.stateIndexName = process.env.STATE_INDEX_NAME ?? 'Status';
    this.stagesTableName = process.env.STAGES_TABLE_NAME ?? '';

    if (!this.tableName) {
      throw new Error('VP_TABLE_NAME environment variable is required');
    }

    if (!this.stagesTableName) {
      throw new Error('STAGES_TABLE_NAME environment variable is required');
    }
  }

  /**
   * Get a VP record by ID
   */
  async getVpRecord(id: string): Promise<VpRecord | null> {
    try {
      const { Item } = await this.ddbDocClient.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: { id: convertToAttr(id) }
        })
      );

      if (Item) {
        return unmarshall(Item) as VpRecord;
      }

      return null;
    } catch (error) {
      console.error(`Error getting VP record ${id}:`, error);
      throw error;
    }
  }

  /**
   * Update VP record status and other attributes
   */
  async updateVpStatus(
    id: string,
    status: VpStatus,
    additionalAttrs: Partial<Omit<VpRecord, 'id' | 'updatedAt'>> = {}
  ): Promise<void> {
    try {
      const expressionAttributeValues: Record<string, AttributeValue> = {};
      const expressionAttributeNames: Record<string, string> = { '#id': 'id' };

      // Set status
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = convertToAttr(status);

      // Set updatedAt
      const now = new Date().toISOString();
      expressionAttributeNames['#updatedAt'] = 'updatedAt';
      expressionAttributeValues[':updatedAt'] = convertToAttr(now);

      // Set lastUpdateSource to identify VP server updates
      expressionAttributeNames['#lastUpdateSource'] = 'lastUpdateSource';
      expressionAttributeValues[':lastUpdateSource'] =
        convertToAttr('vp-server');

      const setActions = [
        '#status = :status',
        '#updatedAt = :updatedAt',
        '#lastUpdateSource = :lastUpdateSource'
      ];

      // Add any additional attributes
      Object.entries(additionalAttrs).forEach(([key, value]) => {
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = convertToAttr(value);
        setActions.push(`#${key} = :${key}`);
      });

      const updateExpression = `SET ${setActions.join(', ')}`;
      const conditionExpression = 'attribute_exists(#id)';

      await this.ddbDocClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: { id: convertToAttr(id) },
          UpdateExpression: updateExpression,
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues
        })
      );

      console.info(`Updated VP ${id} status to ${status} (source: vp-server)`);
    } catch (error) {
      console.error(`Error updating VP ${id} status to ${status}:`, error);
      throw error;
    }
  }

  /**
   * Query VP records by task ID
   */
  async queryVpRecordByTask(taskId: string): Promise<VpRecord | null> {
    try {
      const { Items = [] } = await this.ddbDocClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: this.tasksIndexName,
          Limit: 1,
          KeyConditionExpression: '#taskId = :taskId',
          ExpressionAttributeNames: { '#taskId': 'taskId' },
          ExpressionAttributeValues: { ':taskId': convertToAttr(taskId) }
        })
      );

      if (Items.length) {
        return unmarshall(Items[0]) as VpRecord;
      }

      return null;
    } catch (error) {
      console.error(`Error querying VP record by task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Query VP records by status
   */
  async queryVpRecordsByStatus(status: VpStatus): Promise<VpRecord[]> {
    try {
      const { Items = [] } = await this.ddbDocClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: this.stateIndexName,
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': convertToAttr(status) }
        })
      );

      return Items.map((item) => unmarshall(item) as VpRecord);
    } catch (error) {
      console.error(`Error querying VP records by status ${status}:`, error);
      throw error;
    }
  }

  /**
   * Get stage record by stage ARN by scanning the stages table
   * @param stageArn - The stage ARN to search for
   * @returns Promise containing the stage record or null if not found
   */
  async getStageRecordByArn(stageArn: string): Promise<StageRecord | null> {
    try {
      const { Items = [] } = await this.ddbDocClient.send(
        new ScanCommand({
          TableName: this.stagesTableName,
          FilterExpression: '#stageArn = :stageArn',
          ExpressionAttributeNames: { '#stageArn': 'stageArn' },
          ExpressionAttributeValues: { ':stageArn': convertToAttr(stageArn) }
        })
      );

      if (Items.length > 0) {
        return unmarshall(Items[0]) as StageRecord;
      }

      return null;
    } catch (error) {
      console.error(`Error getting stage record by ARN ${stageArn}:`, error);
      throw error;
    }
  }

  /**
   * Get the current VP ID from environment or task metadata
   * This assumes the VP ID is available as an environment variable or can be derived
   */
  getCurrentVpId(): string | null {
    // Try to get VP ID from environment variable
    const vpId = process.env.VP_ID;

    if (vpId) {
      return vpId;
    }

    // If not available, log a warning
    console.warn(
      'VP ID not found in environment variables. VP status updates may not work correctly.'
    );

    return null;
  }
}

export { VpStatus };
