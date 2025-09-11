// A lambda function that creates an IVS stage, saves it to the dynamodb table, and returns a participant token

import { API_EXCEPTION } from '@lambda/constants';
import { ddbSdk } from '@lambda/sdk';
import { createErrorResponse, createSuccessResponse } from '@lambda/utils';
import { KickVpRequest, VpStatus } from '@typings/virtualparticipant';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';

async function handler(
  event: APIGatewayProxyEventV2WithIAMAuthorizer | KickVpRequest
) {
  const req: KickVpRequest =
    'body' in event ? JSON.parse(event.body ?? '{}') : event;
  const { id } = req;

  console.info('[EVENT]', JSON.stringify(event));

  // Get VP by Stage ARN
  try {
    const stageRecord = await ddbSdk.getStageRecord(id);

    if (!stageRecord) {
      return createErrorResponse({
        code: 404,
        name: API_EXCEPTION.STAGE_NOT_FOUND,
        message: `Stage not found.`
      });
    }

    const stageArn = stageRecord.stageArn;
    const existingVpRecord = await ddbSdk.queryVpRecordByStageId(stageArn);

    if (!existingVpRecord) {
      return createErrorResponse({
        code: 404,
        name: API_EXCEPTION.VP_NOT_FOUND,
        message: `No virtual participant was found for stage "${id}".`
      });
    }

    // Update dynamodb to mark the participant as kicked with TTL for cleanup
    const ttl = Math.floor((Date.now() + 1 * 60 * 60 * 1000) / 1000); // 1 hour from now
    await ddbSdk.updateVpRecord({
      id: existingVpRecord.id,
      attrsToSet: {
        status: VpStatus.KICKED,
        stageArn: 'unassigned',
        stageEndpoints: {},
        assetName: '',
        ttl,
        lastUpdateSource: 'kick-api'
      }
    });

    console.info(
      `Successfully kicked VP: ${existingVpRecord.id} with TTL: ${ttl} (source: kick-api)`
    );
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to invite virtual participant.', {
        cause: error
      })
    });
  }

  return createSuccessResponse();
}

export { handler };
