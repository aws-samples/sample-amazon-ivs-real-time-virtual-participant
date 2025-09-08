// A lambda function that creates an IVS stage, saves it to the dynamodb table, and returns a participant token

import { Stage } from '@aws-sdk/client-ivs-realtime';
import { ddbSdk, realTimeSdk } from '@lambda/sdk';
import { createErrorResponse, createSuccessResponse } from '@lambda/utils';
import {
  CreateStageRequest as ApiGwCreateStageRequest,
  CreateStageResponse
} from '@typings/stage';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';
import { randomUUID } from 'crypto';

async function handler(
  event: APIGatewayProxyEventV2WithIAMAuthorizer | ApiGwCreateStageRequest
) {
  const req: ApiGwCreateStageRequest =
    'body' in event ? JSON.parse(event.body ?? '{}') : event;
  const { userId = 'HOST_USER', attributes = {} } = req;

  console.info('[EVENT]', JSON.stringify(event));

  // Create stage, and write to dynamo
  let stage: Stage | undefined;
  try {
    stage = await realTimeSdk.createStage();
    console.info('Stage', JSON.stringify(stage));

    if (!stage.arn) throw new Error('Stage arn is empty');
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to create Stage.', { cause: error })
    });
  }

  let token: string;
  const stageId: string = randomUUID();
  let hostParticipantId: string;
  try {
    const { token: _token, participantId } = await realTimeSdk.createToken({
      userId,
      attributes,
      allowPublish: true,
      allowSubscribe: true,
      stageArn: stage.arn,
      stageEndpoints: stage.endpoints!
    });

    console.info(`Participant Token "${userId}" (${participantId})`, _token);
    token = _token;
    hostParticipantId = participantId;
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to create participant token(s).', {
        cause: error
      })
    });
  }

  try {
    await ddbSdk.createStageRecord({ id: stageId, hostParticipantId, stage });
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to create stage record.', { cause: error })
    });
  }

  const response: CreateStageResponse = {
    id: stageId,
    participantId: hostParticipantId,
    token
  };
  console.info('[RESPONSE]', JSON.stringify(response));

  return createSuccessResponse({ body: response });
}

export { handler };
