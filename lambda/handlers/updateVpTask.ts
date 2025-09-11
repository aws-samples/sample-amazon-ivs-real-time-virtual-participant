import { TaskOverride, TaskStopCode } from '@aws-sdk/client-ecs';
import { ddbSdk } from '@lambda/sdk';
import { parseTaskId } from '@lambda/utils';
import { VpStatus } from '@typings/virtualparticipant';
import { EventBridgeEvent } from 'aws-lambda';

interface TaskStateChangeDetail {
  taskArn: string;
  stopCode: TaskStopCode;
  overrides: TaskOverride;
  lastStatus: VpStatus;
}

async function handler(
  event: EventBridgeEvent<'ECS Task State Change', TaskStateChangeDetail>
) {
  console.info('[EVENT]', JSON.stringify(event));

  const { taskArn, lastStatus } = event.detail;
  const isRunning = lastStatus === VpStatus.RUNNING;
  const taskId = parseTaskId(taskArn);

  try {
    const vpRecord = await ddbSdk.queryVpRecordByTask(taskId);

    if (!vpRecord) {
      throw new Error(
        `No virtual participant exists for the provided task ID (${taskId})`
      );
    }

    let ttl: number | undefined;
    if (lastStatus === VpStatus.STOPPED) {
      // If the task is STOPPED, set the TTL to 1 hour from now
      ttl = Math.floor((Date.now() + 1 * 60 * 60 * 1000) / 1000);
    }

    let stageArn = vpRecord.stageArn;
    let stageEndpoints = vpRecord.stageEndpoints;
    if (lastStatus === VpStatus.STOPPED) {
      // If the task is STOPPED, reset the stage arn and endpoints
      stageArn = 'unassigned';
      stageEndpoints = {};
    }

    await ddbSdk.updateVpRecord({
      id: vpRecord.id,
      attrsToSet: {
        status: lastStatus,
        stageArn,
        stageEndpoints,
        lastUpdateSource: 'ecs-task-state-change',
        ...(ttl !== undefined && { ttl }),
        ...(isRunning && { running: 'yes' })
      },
      attrsToRemove: isRunning ? [] : ['running']
    });

    console.info(
      `Updated VP ${vpRecord.id} status to ${lastStatus}${ttl !== undefined ? ` with TTL ${ttl}` : ''} (source: ecs-task-state-change)`
    );
  } catch (error) {
    console.error('Failed to update virtual participant', error);
  }
}

export { handler };
