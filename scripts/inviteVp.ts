import util from 'node:util';

import axios, { AxiosError } from 'axios';

import { signLambdaRequest } from './utils';

const { values } = util.parseArgs({
  options: {
    stageId: {
      type: 'string',
      short: 's'
    },
    assetName: {
      type: 'string',
      short: 'a'
    }
  },
  allowPositionals: true
});

async function inviteVp() {
  const { stageId, assetName } = values;

  if (!stageId) {
    console.error(
      '❌ Missing required arguments\n\n',
      'Usage: npm run inviteVp <stack-name> --stageId <stage-id> [--assetName <asset-name>]\n',
      'Or: npm run inviteVp <stack-name> -s <stage-id> [-a <asset-name>]'
    );
    process.exit(1);
  }

  try {
    const requestBody: { id: string; assetName?: string } = {
      id: stageId
    };

    if (assetName) {
      requestBody.assetName = assetName;
    }

    const [signedRequest, inviteVpLambdaURL] = await signLambdaRequest(
      'InviteVpLambdaURL',
      'POST',
      requestBody
    );

    await axios(inviteVpLambdaURL, {
      data: requestBody,
      ...signedRequest
    });

    console.info(
      `✅ Successfully invited virtual participant to stage\n\n`,
      `🎭 Stage ID: ${stageId}\n`,
      assetName ? `🎬 Asset Name: ${assetName}\n` : ''
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to invite virtual participant\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

inviteVp();
