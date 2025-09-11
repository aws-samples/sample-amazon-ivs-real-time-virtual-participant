import { ddbSdk } from '@lambda/sdk';
import { createErrorResponse, createSuccessResponse } from '@lambda/utils';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';

async function handler(event: APIGatewayProxyEventV2WithIAMAuthorizer) {
  console.info('[EVENT]', JSON.stringify(event));

  try {
    // Get all virtual participant records from the table
    const vpRecords = await ddbSdk.getAllVpRecords();

    console.info(`Found ${vpRecords.length} virtual participant records`);

    // Sort by update date (newest first)
    vpRecords.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    // Return success response with all VP records
    return createSuccessResponse({
      body: {
        message: `Successfully retrieved ${vpRecords.length} virtual participant records`,
        totalCount: vpRecords.length,
        virtualParticipants: vpRecords
      }
    });
  } catch (error) {
    console.error('Failed to list virtual participants:', error);

    return createErrorResponse({
      error: new Error('Failed to list virtual participants.', {
        cause: error
      })
    });
  }
}

export { handler };
