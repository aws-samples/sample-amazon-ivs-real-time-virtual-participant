import axios, { AxiosError } from 'axios';

import { signLambdaRequest } from './utils';

interface StopResult {
  vpId: string;
  taskId: string;
  success: boolean;
  error?: string;
}

async function stopVps() {
  try {
    const requestBody = {}; // Empty body as the handler processes all running VPs

    const [signedRequest, stopVpTasksLambdaURL] = await signLambdaRequest(
      'StopVpTasksLambdaURL',
      'POST',
      requestBody
    );

    const response = await axios(stopVpTasksLambdaURL, {
      data: requestBody,
      ...signedRequest
    });

    const responseData = response.data;
    const { summary, details } = responseData;

    console.info(
      `✅ Successfully processed VP tasks\n\n`,
      `📊 Summary:\n`,
      `   • Total Found: ${summary.totalFound}\n`,
      `   • Successful Stops: ${summary.successfulStops}\n`,
      `   • Failed Stops: ${summary.failedStops}\n`
    );

    if (details && details.length > 0) {
      console.info(`\n📋 Details:`);
      details.forEach((result: StopResult) => {
        const status = result.success ? '✅' : '❌';
        const errorInfo = result.error ? ` (${result.error})` : '';
        console.info(
          `   ${status} VP ${result.vpId} (Task: ${result.taskId})${errorInfo}`
        );
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to stop VP tasks\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

stopVps();
