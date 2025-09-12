import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

export interface TokenCreationResult {
  token: string;
  participantId: string;
}

/**
 * Service for creating participant tokens via Lambda invocation
 */
export class VirtualParticipantLambdaClient {
  private lambdaClient: LambdaClient;

  constructor() {
    this.lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION ?? 'us-east-1'
    });
  }

  /**
   * Create a participant token by invoking the createIvsParticipantToken lambda
   * @param stageId - The ID of the stage from the stages table
   * @param userId - The user ID for the participant
   * @returns Promise containing the token and participant ID
   */
  async createParticipantToken(
    stageId: string,
    userId: string
  ): Promise<TokenCreationResult> {
    if (!stageId || !userId) {
      throw new Error('Stage ID and user ID are required for token creation');
    }

    if (!process.env.CREATE_PARTICIPANT_TOKEN_LAMBDA_ARN) {
      throw new Error(
        'CREATE_PARTICIPANT_TOKEN_LAMBDA_ARN environment variable is required'
      );
    }

    try {
      console.info(
        `Invoking lambda to create participant token for stage ${stageId}, user ${userId}`
      );

      const payload = {
        id: stageId,
        userId,
        allowPublish: true,
        attributes: {
          isVP: 'true',
          username: 'Virtual Participant'
        }
      };

      const command = new InvokeCommand({
        FunctionName: process.env.CREATE_PARTICIPANT_TOKEN_LAMBDA_ARN,
        Payload: Buffer.from(JSON.stringify(payload))
      });

      const response = await this.lambdaClient.send(command);

      if (response.FunctionError) {
        const errorPayload = response.Payload?.transformToString();
        throw new Error(
          `Lambda function error: ${response.FunctionError}, payload: ${errorPayload}`
        );
      }

      if (!response.Payload) {
        throw new Error('Lambda function returned no payload');
      }

      const responsePayload = response.Payload.transformToString();
      const lambdaResponse = JSON.parse(responsePayload);

      // Handle API Gateway response format
      let tokenData;
      if (lambdaResponse.body) {
        tokenData = JSON.parse(lambdaResponse.body);
      } else {
        tokenData = lambdaResponse;
      }

      if (!tokenData.token || !tokenData.participantId) {
        throw new Error(
          'Lambda response missing required token or participantId fields'
        );
      }

      console.info(
        `Successfully created participant token via lambda, participantId: ${tokenData.participantId}`
      );

      return {
        token: tokenData.token,
        participantId: tokenData.participantId
      };
    } catch (error) {
      console.error('Failed to create participant token via lambda:', error);
      throw error;
    }
  }
}
