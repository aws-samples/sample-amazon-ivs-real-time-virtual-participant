import { ddbSdk, ecsSdk } from '@lambda/sdk';
import {
  createErrorResponse,
  createSuccessResponse,
  retryWithBackoff
} from '@lambda/utils';
import { VpRecord, VpStatus } from '@typings/virtualparticipant';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';

const { CLUSTER_NAME } = process.env as Record<string, string>;

interface StopResult {
  vpId: string;
  taskId: string;
  success: boolean;
  error?: string;
}

async function stopVpTask(vp: VpRecord): Promise<StopResult> {
  try {
    // Stop the ECS task
    await retryWithBackoff(() => ecsSdk.stopTask(CLUSTER_NAME, vp.taskId));

    // Update VP record status to STOPPED with TTL for cleanup
    const ttl = Math.floor((Date.now() + 1 * 60 * 60 * 1000) / 1000); // 1 hour from now
    await ddbSdk.updateVpRecord({
      id: vp.id,
      attrsToSet: {
        status: VpStatus.STOPPED,
        ttl,
        lastUpdateSource: 'stop-vp-tasks-api'
      }
    });

    console.info(
      `Successfully stopped VP task: ${vp.id} (${vp.taskId}) with TTL: ${ttl} (source: stop-vp-tasks-api)`
    );

    return {
      vpId: vp.id,
      taskId: vp.taskId,
      success: true
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to stop VP task: ${vp.id} (${vp.taskId})`, error);

    return {
      vpId: vp.id,
      taskId: vp.taskId,
      success: false,
      error: errorMessage
    };
  }
}

async function stopAllVpTasks(): Promise<{
  totalFound: number;
  successfulStops: number;
  failedStops: number;
  results: StopResult[];
}> {
  console.info('Starting to stop all running VP tasks');

  // Get all running VP tasks (including AVAILABLE warm pool VPs)
  const runningStatuses = [
    VpStatus.AVAILABLE,
    VpStatus.PROVISIONING,
    VpStatus.PENDING,
    VpStatus.INVITED,
    VpStatus.RUNNING
  ];

  const runningVps = await ddbSdk.getAllVpRecordsByStatus(runningStatuses);

  console.info(`Found ${runningVps.length} running VP tasks to stop`);

  if (runningVps.length === 0) {
    return {
      totalFound: 0,
      successfulStops: 0,
      failedStops: 0,
      results: []
    };
  }

  // Stop all VP tasks in parallel
  const stopPromises = runningVps.map(stopVpTask);
  const results = await Promise.allSettled(stopPromises);

  // Process results
  const stopResults: StopResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const vp = runningVps[index];
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(`Promise rejected for VP ${vp.id}:`, result.reason);

      return {
        vpId: vp.id,
        taskId: vp.taskId,
        success: false,
        error: errorMessage
      };
    }
  });

  const successfulStops = stopResults.filter((r) => r.success).length;
  const failedStops = stopResults.filter((r) => !r.success).length;

  console.info(
    `VP task stop summary: ${successfulStops} successful, ${failedStops} failed out of ${runningVps.length} total`
  );

  return {
    totalFound: runningVps.length,
    successfulStops,
    failedStops,
    results: stopResults
  };
}

async function handler(event: APIGatewayProxyEventV2WithIAMAuthorizer) {
  console.info('[EVENT]', JSON.stringify(event));

  try {
    const result = await stopAllVpTasks();

    // Return success response with summary
    return createSuccessResponse({
      body: {
        message: `Successfully processed ${result.totalFound} VP tasks`,
        summary: {
          totalFound: result.totalFound,
          successfulStops: result.successfulStops,
          failedStops: result.failedStops
        },
        details: result.results
      }
    });
  } catch (error) {
    console.error('Failed to stop VP tasks:', error);

    return createErrorResponse({
      error: new Error('Failed to stop VP tasks.', {
        cause: error
      })
    });
  }
}

export { handler };
