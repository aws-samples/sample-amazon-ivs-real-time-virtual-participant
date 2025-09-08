import axios, { AxiosError } from 'axios';

import { signLambdaRequest } from './utils';

async function createStage() {
  try {
    const [signedRequest, createStageLambdaURL] = await signLambdaRequest(
      'CreateIvsStageLambdaURL',
      'POST'
    );
    const response = await axios(createStageLambdaURL, signedRequest);

    console.info(
      `✅ Successfully created IVS stage\n\n`,
      `🎭 Stage ID: ${response.data.id}\n`,
      `👤 Participant ID: ${response.data.participantId}\n`,
      `🔑 Token: ${response.data.token}\n`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to create IVS stage\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

createStage();
