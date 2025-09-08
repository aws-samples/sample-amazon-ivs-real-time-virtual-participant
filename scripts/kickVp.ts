import util from 'node:util';

import axios, { AxiosError } from 'axios';

import { signLambdaRequest } from './utils';

const { values } = util.parseArgs({
  options: {
    stageId: {
      type: 'string',
      short: 's'
    }
  },
  allowPositionals: true
});

async function kickVp() {
  const { stageId } = values;

  if (!stageId) {
    console.error(
      '❌ Missing required arguments\n\n',
      'Usage: npm run kickVp <stack-name> --stageId <stage-id>\n',
      'Or: npm run kickVp <stack-name> -s <stage-id>'
    );
    process.exit(1);
  }

  try {
    const requestBody = {
      id: stageId
    };

    const [signedRequest, kickVpLambdaURL] = await signLambdaRequest(
      'KickVpLambdaURL',
      'POST',
      requestBody
    );

    await axios(kickVpLambdaURL, {
      data: requestBody,
      ...signedRequest
    });

    console.info(
      `✅ Successfully kicked virtual participant from stage\n\n`,
      `🎭 Stage ID: ${stageId}\n`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to kick virtual participant\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

kickVp();
