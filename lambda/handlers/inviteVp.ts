// A lambda function that creates an IVS stage, saves it to the dynamodb table, and returns a participant token

import { API_EXCEPTION } from '@lambda/constants';
import { ddbSdk } from '@lambda/sdk';
import { getS3File } from '@lambda/sdk/s3';
import { createErrorResponse, createSuccessResponse } from '@lambda/utils';
import { InviteVpRequest, VpStatus } from '@typings/virtualparticipant';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';

async function handler(
  event: APIGatewayProxyEventV2WithIAMAuthorizer | InviteVpRequest
) {
  const req: InviteVpRequest =
    'body' in event ? JSON.parse(event.body ?? '{}') : event;
  const { id, assetName } = req;
  const { VIDEO_ASSETS_BUCKET_NAME } = process.env;

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

    if (assetName && !VIDEO_ASSETS_BUCKET_NAME) {
      return createErrorResponse({
        code: 404,
        name: API_EXCEPTION.BUCKET_NAME_MISSING,
        message: `Stage not found.`
      });
    }

    if (assetName) await getS3File(assetName, VIDEO_ASSETS_BUCKET_NAME!);

    const stageArn = stageRecord.stageArn;
    const existingVpRecord = await ddbSdk.queryVpRecordByStageId(stageArn);

    if (existingVpRecord) {
      return createErrorResponse({
        code: 404,
        name: API_EXCEPTION.VP_ALREADY_ASSIGNED,
        message: `A virtual participant has already been assigned to stage "${id}".`
      });
    }

    const availableVpRecord = await ddbSdk.queryVpRecordByStatus(
      VpStatus.AVAILABLE
    );

    if (!availableVpRecord) {
      return createErrorResponse({
        code: 404,
        name: API_EXCEPTION.VP_NOT_AVAILABLE,
        message: `No virtual participants are available.`
      });
    }

    // Update dynamodb to mark the participant as invited
    // Use conditional update to prevent race conditions
    try {
      const attrsToSet = {
        status: VpStatus.INVITED,
        stageArn,
        stageEndpoints: stageRecord.stageEndpoints,
        lastUpdateSource: 'invite-api',
        ...(assetName !== undefined && { assetName })
      };

      await ddbSdk.updateVpRecord({
        id: availableVpRecord.id,
        attrsToSet,
        customConditionExpression: '#currentStatus = :availableStatus',
        conditionExpressionAttributeNames: {
          '#currentStatus': 'status'
        },
        conditionExpressionAttributeValues: {
          ':availableStatus': { S: VpStatus.AVAILABLE }
        }
      });
    } catch (updateError) {
      // Handle the case where VP was already claimed by another request
      if (
        updateError &&
        typeof updateError === 'object' &&
        'name' in updateError &&
        updateError.name === 'ConditionalCheckFailedException'
      ) {
        return createErrorResponse({
          code: 409,
          name: API_EXCEPTION.VP_ALREADY_ASSIGNED,
          message: `Virtual participant was already claimed by another request.`
        });
      }

      throw updateError;
    }
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
