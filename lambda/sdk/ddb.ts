import {
  AttributeValue,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ReturnValue,
  ScanCommand,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb';
import { Stage } from '@aws-sdk/client-ivs-realtime';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { convertToAttr, marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { StageRecord } from '@typings/stage';
import { VpRecord } from '@typings/virtualparticipant';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: {
    convertClassInstanceToMap: false, // Whether to convert typeof object to map attribute
    convertEmptyValues: false, // Whether to automatically convert empty strings, blobs, and sets to `null`
    removeUndefinedValues: true // Whether to remove undefined values while marshalling
  },
  unmarshallOptions: {
    wrapNumbers: false // Whether to return numbers as a string instead of converting them to native JavaScript numbers
  }
});

async function createStageRecord({
  id,
  hostParticipantId,
  stage
}: {
  id: string;
  hostParticipantId: string;
  stage: Stage;
}) {
  const now = new Date().toISOString();
  const stageRecord: StageRecord = {
    id,
    hostParticipantId,
    stageArn: stage.arn!,
    stageEndpoints: stage.endpoints!,
    createdAt: now,
    updatedAt: now
  };

  await ddbDocClient.send(
    new PutItemCommand({
      TableName: process.env.STAGES_TABLE_NAME,
      Item: marshall(stageRecord)
    })
  );

  return stageRecord;
}

async function deleteStageRecord(id: string) {
  await ddbDocClient.send(
    new DeleteItemCommand({
      TableName: process.env.STAGES_TABLE_NAME,
      Key: { id: convertToAttr(id) }
    })
  );
}

async function getStageRecord(id: string) {
  const { Item } = await ddbDocClient.send(
    new GetItemCommand({
      TableName: process.env.STAGES_TABLE_NAME,
      Key: { id: convertToAttr(id) }
    })
  );

  if (Item) {
    return unmarshall(Item) as StageRecord;
  }
}

async function queryVpRecordByStageId(stageArn: string) {
  const { Items = [] } = await ddbDocClient.send(
    new QueryCommand({
      TableName: process.env.VP_TABLE_NAME,
      IndexName: process.env.ASSIGNED_STAGE_ID_INDEX_NAME,
      Limit: 1,
      KeyConditionExpression: '#stageArn = :stageArn',
      ExpressionAttributeNames: { '#stageArn': 'stageArn' },
      ExpressionAttributeValues: { ':stageArn': convertToAttr(stageArn) }
    })
  );

  if (Items.length) {
    return unmarshall(Items[0]) as VpRecord;
  }
}

async function queryVpRecordByTask(taskId: string) {
  const { Items = [] } = await ddbDocClient.send(
    new QueryCommand({
      TableName: process.env.VP_TABLE_NAME,
      IndexName: process.env.TASKS_INDEX_NAME,
      Limit: 1,
      KeyConditionExpression: '#taskId = :taskId',
      ExpressionAttributeNames: { '#taskId': 'taskId' },
      ExpressionAttributeValues: { ':taskId': convertToAttr(taskId) }
    })
  );

  if (Items.length) {
    return unmarshall(Items[0]) as VpRecord;
  }
}

async function queryVpRecordByStatus(status: string) {
  const { Items = [] } = await ddbDocClient.send(
    new QueryCommand({
      TableName: process.env.VP_TABLE_NAME,
      IndexName: process.env.STATE_INDEX_NAME,
      Limit: 1,
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': convertToAttr(status) }
    })
  );

  if (Items.length) {
    return unmarshall(Items[0]) as VpRecord;
  }
}

async function getAllVpRecordsByStatus(statuses: string[]) {
  if (statuses.length === 0) {
    return [];
  }

  const expressionAttributeValues: Record<string, AttributeValue> = {};
  const statusPlaceholders: string[] = [];

  // Build dynamic expression attribute values for each status
  statuses.forEach((status, index) => {
    const placeholder = `:status${index}`;
    expressionAttributeValues[placeholder] = convertToAttr(status);
    statusPlaceholders.push(placeholder);
  });

  const filterExpression = `#status IN (${statusPlaceholders.join(', ')})`;

  const { Items = [] } = await ddbDocClient.send(
    new ScanCommand({
      TableName: process.env.VP_TABLE_NAME,
      IndexName: process.env.STATE_INDEX_NAME,
      FilterExpression: filterExpression,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: expressionAttributeValues
    })
  );

  return Items.map((item) => unmarshall(item) as VpRecord);
}

async function getAllVpRecords() {
  const { Items = [] } = await ddbDocClient.send(
    new ScanCommand({
      TableName: process.env.VP_TABLE_NAME
    })
  );

  return Items.map((item) => unmarshall(item) as VpRecord);
}

async function createVpRecord(vpRecord: VpRecord) {
  await ddbDocClient.send(
    new PutItemCommand({
      TableName: process.env.VP_TABLE_NAME,
      Item: marshall(vpRecord)
    })
  );

  return vpRecord;
}

async function updateStageRecord({
  id,
  attrsToSet = {},
  attrsToRemove = []
}: {
  id: string;
  attrsToSet?: Partial<Omit<VpRecord, 'id'>>;
  attrsToRemove?: (keyof Partial<Omit<VpRecord, 'id'>>)[];
}) {
  const expressionAttributeValues: Record<string, AttributeValue> = {};
  const expressionAttributeNames: Record<string, string> = { '#id': 'id' };

  const setActions = Object.entries(attrsToSet).map(([key, value]) => {
    expressionAttributeNames[`#${key}`] = key;
    expressionAttributeValues[`:${key}`] = convertToAttr(value);

    return `#${key} = :${key}`;
  });

  const remActions = attrsToRemove.map((key) => {
    expressionAttributeNames[`#${key}`] = key;

    return `#${key}`;
  });

  const now = new Date().toISOString();
  expressionAttributeValues[':updatedAt'] = convertToAttr(now);
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  setActions.push('#updatedAt = :updatedAt');

  const setClause = setActions.length ? `SET ${setActions.join(',')}` : '';
  const remClause = remActions.length ? `REMOVE ${remActions.join(',')}` : '';
  const updateExpression = [setClause, remClause].join(' ').trim();
  const conditionExpression = 'attribute_exists(#id)';

  await ddbDocClient.send(
    new UpdateItemCommand({
      TableName: process.env.STAGES_TABLE_NAME,
      Key: { id: convertToAttr(id) },
      UpdateExpression: updateExpression,
      ConditionExpression: conditionExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,

      ReturnValues: ReturnValue.ALL_NEW
    })
  );
}

async function updateVpRecord({
  id,
  attrsToSet = {},
  attrsToRemove = [],
  customConditionExpression,
  conditionExpressionAttributeNames = {},
  conditionExpressionAttributeValues = {}
}: {
  id: string;
  attrsToSet?: Partial<Omit<VpRecord, 'id'>>;
  attrsToRemove?: (keyof Partial<Omit<VpRecord, 'id'>>)[];
  customConditionExpression?: string;
  conditionExpressionAttributeNames?: Record<string, string>;
  conditionExpressionAttributeValues?: Record<string, AttributeValue>;
}) {
  const expressionAttributeValues: Record<string, AttributeValue> = {};
  const expressionAttributeNames: Record<string, string> = { '#id': 'id' };

  const setActions = Object.entries(attrsToSet).map(([key, value]) => {
    expressionAttributeNames[`#${key}`] = key;
    expressionAttributeValues[`:${key}`] = convertToAttr(value);

    return `#${key} = :${key}`;
  });

  const remActions = attrsToRemove.map((key) => {
    expressionAttributeNames[`#${key}`] = key;

    return `#${key}`;
  });

  const now = new Date().toISOString();
  expressionAttributeValues[':updatedAt'] = convertToAttr(now);
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  setActions.push('#updatedAt = :updatedAt');

  const setClause = setActions.length ? `SET ${setActions.join(',')}` : '';
  const remClause = remActions.length ? `REMOVE ${remActions.join(',')}` : '';
  const updateExpression = [setClause, remClause].join(' ').trim();

  // Build condition expression
  let conditionExpression = 'attribute_exists(#id)';
  if (customConditionExpression) {
    conditionExpression += ` AND ${customConditionExpression}`;
  }

  // Merge condition expression attributes
  Object.assign(expressionAttributeNames, conditionExpressionAttributeNames);
  Object.assign(expressionAttributeValues, conditionExpressionAttributeValues);

  await ddbDocClient.send(
    new UpdateItemCommand({
      TableName: process.env.VP_TABLE_NAME,
      Key: { id: convertToAttr(id) },
      UpdateExpression: updateExpression,
      ConditionExpression: conditionExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,

      ReturnValues: ReturnValue.ALL_NEW
    })
  );
}

export {
  createStageRecord,
  createVpRecord,
  deleteStageRecord,
  getAllVpRecords,
  getAllVpRecordsByStatus,
  getStageRecord,
  queryVpRecordByStageId,
  queryVpRecordByStatus,
  queryVpRecordByTask,
  updateStageRecord,
  updateVpRecord
};
