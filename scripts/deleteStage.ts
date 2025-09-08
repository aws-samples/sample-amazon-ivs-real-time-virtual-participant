import util from 'node:util';

import axios, { AxiosError } from 'axios';

import { signLambdaRequest } from './utils';

const { values } = util.parseArgs({
  options: {
    stageId: {
      type: 'string',
      short: 's'
    },
    participantId: {
      type: 'string',
      short: 'p'
    }
  },
  allowPositionals: true
});

async function deleteStage() {
  const { stageId, participantId } = values;

  if (!stageId || !participantId) {
    console.error(
      '❌ Missing required arguments\n\n',
      'Usage: npm run deleteStage <stack-name> --stageId <stage-id> --participantId <participant-id>\n',
      'Or: npm run deleteStage <stack-name> -s <stage-id> -p <participant-id>'
    );
    process.exit(1);
  }

  try {
    const requestBody = {
      id: stageId,
      participantId
    };

    const [signedRequest, deleteStageLambdaURL] = await signLambdaRequest(
      'DeleteIvsStageLambdaURL',
      'POST',
      requestBody
    );

    await axios(deleteStageLambdaURL, {
      data: requestBody,
      ...signedRequest
    });

    console.info(
      `✅ Successfully deleted IVS stage\n\n`,
      `🎭 Stage ID: ${stageId}\n`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to delete IVS stage\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

deleteStage();
