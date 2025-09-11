import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const STAGES_TABLE_NAME = process.env.STAGES_TABLE_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.info('Event:', JSON.stringify(event, null, 2));

  try {
    const command = new ScanCommand({
      TableName: STAGES_TABLE_NAME
    });

    const result = await docClient.send(command);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify({
        stages: result.Items ?? [],
        count: result.Count ?? 0,
        scannedCount: result.ScannedCount ?? 0
      })
    };
  } catch (error) {
    console.error('Error listing stages:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to list stages',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
