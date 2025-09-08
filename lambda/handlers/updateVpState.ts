import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { appSyncSdk } from '@lambda/sdk';
import { VpRecord } from '@typings/virtualparticipant';
import {
  DynamoDBBatchItemFailure,
  DynamoDBBatchResponse,
  DynamoDBStreamEvent
} from 'aws-lambda';

// Updates the fleet of virtual participants based on dynamodb updates

async function handler(
  event: DynamoDBStreamEvent
): Promise<DynamoDBBatchResponse> {
  const vpRecordsMap = new Map<string, VpRecord>();
  const sequenceNumberLookupMap = new Map<string, string>();
  const batchItemFailures: DynamoDBBatchItemFailure[] = [];
  const changedRecords: VpRecord[] = [];

  console.info('[EVENT]', JSON.stringify(event));

  // Process DynamoDB stream records and populate array of changed records
  for (const { dynamodb } of event.Records) {
    if (dynamodb?.NewImage) {
      const newImage = dynamodb.NewImage as Record<string, AttributeValue>;
      const vpRecord = unmarshall(newImage) as VpRecord;
      const { id } = vpRecord;

      // Check if this is a meaningful change by comparing old and new images
      let shouldPushToAppSync = true;

      if (dynamodb.OldImage) {
        const oldImage = unmarshall(
          dynamodb.OldImage as Record<string, AttributeValue>
        ) as VpRecord;

        // Only push to AppSync if there are meaningful changes
        // Skip if only metadata fields changed (lastUpdateSource, updatedAt, etc.)
        const meaningfulFieldsChanged =
          oldImage.status !== vpRecord.status ||
          oldImage.stageArn !== vpRecord.stageArn ||
          oldImage.running !== vpRecord.running ||
          oldImage.taskId !== vpRecord.taskId ||
          JSON.stringify(oldImage.stageEndpoints) !==
            JSON.stringify(vpRecord.stageEndpoints);

        if (!meaningfulFieldsChanged) {
          console.info(
            `Skipping AppSync update for VP ${id} - no meaningful changes detected (likely metadata update)`
          );
          shouldPushToAppSync = false;
        }
      }

      vpRecordsMap.set(id, vpRecord);

      // Only add to changed records if it should be pushed to AppSync
      if (shouldPushToAppSync) {
        changedRecords.push(vpRecord);
      }

      if (dynamodb.SequenceNumber) {
        sequenceNumberLookupMap.set(id, dynamodb.SequenceNumber);
      }
    }
  }

  // Push changed records as mutations to AppSync GraphQL API
  if (changedRecords.length > 0) {
    console.info(
      `Processing ${changedRecords.length} VP records for AppSync:`,
      changedRecords.map((r) => ({
        id: r.id,
        status: r.status,
        updatedAt: r.updatedAt,
        running: r.running,
        stageArn: r.stageArn,
        stageEndpoints: r.stageEndpoints,
        taskId: r.taskId,
        assetName: r.assetName
      }))
    );

    const failedRecordIds =
      await appSyncSdk.pushMutationsToAppSync(changedRecords);

    if (failedRecordIds.length > 0) {
      console.error(
        `Failed to push ${failedRecordIds.length} VP records to AppSync:`,
        failedRecordIds
      );
    } else {
      console.info('Successfully pushed all VP records to AppSync');
    }

    // Add failed records to batch item failures
    for (const failedId of failedRecordIds) {
      const sequenceNumber = sequenceNumberLookupMap.get(failedId);
      if (sequenceNumber) {
        batchItemFailures.push({
          itemIdentifier: sequenceNumber
        });
      }
    }
  } else {
    console.info('No changed VP records to push to AppSync');
  }

  console.info('Batch item failures:', batchItemFailures);

  // Return failures
  return { batchItemFailures };
}

export { handler };
