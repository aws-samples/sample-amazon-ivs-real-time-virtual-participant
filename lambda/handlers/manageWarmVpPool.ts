import { ddbSdk, ecsSdk } from '@lambda/sdk';
import { parseTaskId, retryWithBackoff } from '@lambda/utils';
import { VpRecord, VpStatus } from '@typings/virtualparticipant';
import { ScheduledEvent } from 'aws-lambda';
import { randomUUID } from 'crypto';

const {
  CLUSTER_NAME,
  TASK_DEFINITION_ARN,
  VP_CONTAINER_NAME,
  MAX_WARM_VPS = '10',
  MIN_WARM_VPS = '2'
} = process.env as Record<string, string>;

async function createWarmVpRecord(): Promise<VpRecord> {
  const now = new Date().toISOString();
  const vpId = randomUUID();

  // Start ECS task first
  const task = await retryWithBackoff(() =>
    ecsSdk.runTask({
      cluster: CLUSTER_NAME,
      taskDefinition: TASK_DEFINITION_ARN,
      environment: {
        [VP_CONTAINER_NAME]: [
          {
            name: 'VP_ID',
            value: vpId
          }
        ]
      },
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: process.env.SUBNET_IDS?.split(',') ?? [],
          securityGroups: process.env.SECURITY_GROUP_IDS?.split(',') ?? [],
          assignPublicIp:
            process.env.ASSIGN_PUBLIC_IP === 'true' ? 'ENABLED' : 'DISABLED'
        }
      }
    })
  );

  if (!task?.taskArn) {
    throw new Error('Failed to start ECS task - no task ARN returned');
  }

  const taskId = parseTaskId(task.taskArn);

  // Create VP record with PROVISIONING status
  const vpRecord: VpRecord = {
    id: vpId,
    status: VpStatus.PROVISIONING,
    taskId,
    createdAt: now,
    updatedAt: now,
    stageArn: 'unassigned', // Empty until assigned to a stage
    stageEndpoints: {}, // Empty until assigned to a stage
    lastUpdateSource: 'warm-pool-manager'
  };

  await ddbSdk.createVpRecord(vpRecord);

  console.info(`Created warm VP record: ${vpId} with task: ${taskId}`);

  return vpRecord;
}

async function stopExcessAvailableVps(
  warmVps: VpRecord[],
  excessCount: number
): Promise<void> {
  console.info(`Stopping ${excessCount} excess warm VPs`);

  // Only stop AVAILABLE VPs
  const availableVps = warmVps.filter((vp) => vp.status === VpStatus.AVAILABLE);

  if (availableVps.length < excessCount) {
    console.error(
      `Not enough AVAILABLE VPs to stop. Need to stop ${excessCount} but only ${availableVps.length} AVAILABLE VPs found.`
    );
    // Continue execution with available VPs
  }

  const vpsToStop = availableVps.slice(0, excessCount);

  if (vpsToStop.length === 0) {
    console.info('No AVAILABLE VPs to stop');

    return;
  }

  console.info(`Stopping ${vpsToStop.length} AVAILABLE VPs`);

  // Stop VPs with individual error handling
  const stopPromises = vpsToStop.map(async (vp, index) => {
    try {
      // Stop the ECS task
      await retryWithBackoff(() => ecsSdk.stopTask(CLUSTER_NAME, vp.taskId));

      // Update VP record status to STOPPED with TTL for cleanup
      const ttl = Math.floor((Date.now() + 1 * 60 * 60 * 1000) / 1000); // 1 hour from now
      await ddbSdk.updateVpRecord({
        id: vp.id,
        attrsToSet: {
          status: VpStatus.STOPPED,
          updatedAt: new Date().toISOString(),
          ttl,
          lastUpdateSource: 'warm-pool-manager'
        }
      });

      console.info(
        `Successfully stopped excess VP ${index + 1}/${vpsToStop.length}: ${vp.id}`
      );
    } catch (error) {
      console.error(
        `Failed to stop excess VP ${index + 1}/${vpsToStop.length}: ${vp.id}`,
        error
      );
      // Don't throw - allow other stops to continue
    }
  });

  await Promise.allSettled(stopPromises);
}

async function manageWarmVpPool(): Promise<void> {
  const maxWarmVps = parseInt(MAX_WARM_VPS, 10);
  const minWarmVps = parseInt(MIN_WARM_VPS, 10);

  console.info(
    `Managing warm VP pool (min: ${minWarmVps}, max: ${maxWarmVps})`
  );

  // Get current warm VPs (AVAILABLE, PROVISIONING, or RUNNING)
  const warmVps = await ddbSdk.getAllVpRecordsByStatus([
    VpStatus.AVAILABLE,
    VpStatus.PROVISIONING,
    VpStatus.PENDING,
    VpStatus.RUNNING
  ]);

  console.info(`Current warm VPs: ${JSON.stringify(warmVps)}`);

  const currentCount = warmVps.length;

  console.info(`Current warm VP count: ${currentCount}`);

  // Check if we have too many VPs and need to stop some
  if (currentCount > maxWarmVps) {
    const excessCount = currentCount - maxWarmVps;

    console.info(
      `Pool has ${excessCount} excess VPs, attempting to stop AVAILABLE ones`
    );
    await stopExcessAvailableVps(warmVps, excessCount);
    console.info('Excess VP cleanup completed');

    return;
  }

  // Calculate how many VPs to create
  const vpsToCreate = Math.max(0, minWarmVps - currentCount);

  if (vpsToCreate === 0) {
    console.info('Warm VP pool is adequately sized');

    return;
  }

  console.info(`Creating ${vpsToCreate} new warm VPs`);

  // Create new VPs with individual error handling
  const creationPromises = Array.from(
    { length: vpsToCreate },
    async (_, index) => {
      try {
        await createWarmVpRecord();
        console.info(
          `Successfully created warm VP ${index + 1}/${vpsToCreate}`
        );
      } catch (error) {
        console.error(
          `Failed to create warm VP ${index + 1}/${vpsToCreate}:`,
          error
        );
        // Don't throw - allow other creations to continue
      }
    }
  );

  await Promise.allSettled(creationPromises);

  console.info('Warm VP pool management completed');
}

async function handler(event: ScheduledEvent): Promise<void> {
  console.info('[EVENT]', JSON.stringify(event));

  try {
    await manageWarmVpPool();
  } catch (error) {
    console.error('Failed to manage warm VP pool:', error);
    throw error;
  }
}

export { handler };
