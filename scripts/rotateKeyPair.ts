import axios, { AxiosError } from 'axios';

import { signLambdaRequest } from './utils';

async function rotateKeyPair() {
  try {
    const [signedRequest, rotateKeyPairLambdaURL] = await signLambdaRequest(
      'RotateKeyPairLambdaURL'
    );
    const response = await axios(rotateKeyPairLambdaURL, signedRequest);

    console.info(
      `✅ Successfully rotated key-pair\n\n`,
      `🔑 Public Key ARN: ${response.data}\n`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to rotate key-pair\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

rotateKeyPair();
