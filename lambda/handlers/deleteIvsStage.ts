// A lambda function that deletes an IVS stage, removes it from the dynamodb table, and returns the delete status

import { API_EXCEPTION } from '@lambda/constants';
import { ddbSdk } from '@lambda/sdk';
import { deleteStage } from '@lambda/sdk/realTime';
import { createErrorResponse, createSuccessResponse } from '@lambda/utils';
import { DeleteStageRequest as ApiGwDeleteStageRequest } from '@typings/stage';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';

async function handler(
  event: APIGatewayProxyEventV2WithIAMAuthorizer | ApiGwDeleteStageRequest
) {
  const req: ApiGwDeleteStageRequest =
    'body' in event ? JSON.parse(event.body ?? '{}') : event;
  const { participantId, id } = req;

  console.info('[EVENT]', JSON.stringify(event));

  // Get the stage from the given id
  let stageArn: string;
  try {
    const stageRecord = await ddbSdk.getStageRecord(id);

    if (!stageRecord) {
      return createErrorResponse({
        code: 404,
        name: API_EXCEPTION.STAGE_NOT_FOUND,
        message: `No stage exists with ID "${id}".`
      });
    }

    if (stageRecord.hostParticipantId !== participantId) {
      throw new Error(
        `Participant with ${participantId} is not able to delete the stage.`
      );
    }

    stageArn = stageRecord.stageArn;
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to create Stage.', { cause: error })
    });
  }

  try {
    await deleteStage(stageArn);
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to create participant token(s).', {
        cause: error
      })
    });
  }

  try {
    await ddbSdk.deleteStageRecord(id);
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to delete stage record.', { cause: error })
    });
  }

  console.info('[RESPONSE]', 'DELETE SUCCEEDED');

  return createSuccessResponse();
}

export { handler };
