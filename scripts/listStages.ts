import axios, { AxiosError } from 'axios';

import { StageRecord } from '../typings/stage.types';
import { signLambdaRequest } from './utils';

async function listStages() {
  try {
    const requestBody = {}; // Empty body for GET request

    const [signedRequest, listStagesLambdaURL] = await signLambdaRequest(
      'ListStagesLambdaURL',
      'POST',
      requestBody
    );

    const response = await axios(listStagesLambdaURL, {
      data: requestBody,
      ...signedRequest
    });

    const responseData = response.data;
    const { stages, count, scannedCount } = responseData;

    console.info(
      `✅ Successfully retrieved stages\n\n`,
      `📊 Summary:\n`,
      `   • Total Count: ${count}\n`,
      `   • Scanned Count: ${scannedCount}\n`
    );

    if (stages && stages.length > 0) {
      console.info(`\n🎭 Stages:`);

      stages.forEach((stage: StageRecord, index: number) => {
        const createdInfo = stage.createdAt
          ? ` | Created: ${getRelativeTime(stage.createdAt)}`
          : '';
        const updatedInfo = stage.updatedAt
          ? ` | Updated: ${getRelativeTime(stage.updatedAt)}`
          : '';

        console.info(
          `   ${index + 1}. ID: ${stage.id} | Host: ${stage.hostParticipantId}${createdInfo}${updatedInfo}`
        );
        console.info(`      ARN: ${stage.stageArn}`);

        if (stage.stageEndpoints) {
          console.info(`      Events: ${stage.stageEndpoints.events}`);
          console.info(`      WebRTC: ${stage.stageEndpoints.whip}`);
        }

        if (stage.ttl) {
          // ttl is a string in the interface, try to parse it
          const ttlDate = new Date(stage.ttl);
          if (!isNaN(ttlDate.getTime())) {
            console.info(`      TTL: ${ttlDate.toLocaleString()}`);
          } else {
            // If it's a timestamp in seconds, convert it
            const ttlTimestamp = parseInt(stage.ttl, 10);
            if (!isNaN(ttlTimestamp)) {
              const ttlDateFromTimestamp = new Date(ttlTimestamp * 1000);
              console.info(
                `      TTL: ${ttlDateFromTimestamp.toLocaleString()}`
              );
            } else {
              console.info(`      TTL: ${stage.ttl}`);
            }
          }
        }

        console.info(''); // Empty line for readability
      });
    } else {
      console.info(`\n📭 No stages found.`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to list stages\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

function getRelativeTime(dateString: string): string {
  if (!dateString) return 'unknown';

  const now = new Date();
  const date = new Date(dateString);

  // Check if the date is valid
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date format: ${dateString}`);

    return 'invalid date';
  }

  const diffMs = now.getTime() - date.getTime();

  // Handle negative differences (future dates)
  if (diffMs < 0) return 'in future';

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;

  return `${days}d ago`;
}

listStages();
