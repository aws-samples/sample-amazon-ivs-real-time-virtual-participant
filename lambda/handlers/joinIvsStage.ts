import { API_EXCEPTION } from '@lambda/constants';
import { ddbSdk, realTimeSdk } from '@lambda/sdk';
import { createErrorResponse, createSuccessResponse } from '@lambda/utils';
import { JoinStageRequest, JoinStageResponse } from '@typings/stage';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const {
    id,
    attributes,
    userId = 'guest'
  }: JoinStageRequest = JSON.parse(event.body ?? '{}');
  let response: JoinStageResponse;

  console.info('[EVENT]', JSON.stringify(event));

  try {
    const stageRecord = await ddbSdk.getStageRecord(id);

    if (!stageRecord) {
      return createErrorResponse({
        code: 404,
        name: API_EXCEPTION.STAGE_NOT_FOUND,
        message: `No stage exists with ID "${id}".`
      });
    }

    response = await realTimeSdk.createToken({
      userId,
      attributes,
      allowPublish: false,
      allowSubscribe: true,
      stageArn: stageRecord.stageArn,
      stageEndpoints: stageRecord.stageEndpoints
    });
  } catch (error) {
    return createErrorResponse({
      error: new Error('Failed to create token.', { cause: error })
    });
  }

  console.info('[RESPONSE]', response);

  return createSuccessResponse({ body: response });
}

export { handler };
