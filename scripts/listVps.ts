import axios, { AxiosError } from 'axios';

import { VpRecord } from '../typings/virtualparticipant.types';
import { signLambdaRequest } from './utils';

async function listVps() {
  try {
    const requestBody = {}; // Empty body for GET request

    const [signedRequest, listVpsLambdaURL] = await signLambdaRequest(
      'ListVpsLambdaURL',
      'POST',
      requestBody
    );

    const response = await axios(listVpsLambdaURL, {
      data: requestBody,
      ...signedRequest
    });

    const responseData = response.data;
    const { totalCount, virtualParticipants } = responseData;

    console.info(
      `✅ Successfully retrieved virtual participants\n\n`,
      `📊 Summary:\n`,
      `   • Total Count: ${totalCount}\n`
    );

    if (virtualParticipants && virtualParticipants.length > 0) {
      console.info(`\n📋 Virtual Participants:`);

      // Group VPs by status for better readability
      const vpsByStatus = virtualParticipants.reduce(
        (acc: Record<string, VpRecord[]>, vp: VpRecord) => {
          if (!acc[vp.status]) {
            acc[vp.status] = [];
          }

          acc[vp.status].push(vp);

          return acc;
        },
        {}
      );

      for (const [status, vps] of Object.entries(vpsByStatus)) {
        const vpList = vps as VpRecord[];
        console.info(
          `\n   ${getStatusEmoji(status)} ${status} (${vpList.length}):`
        );
        vpList.forEach((vp: VpRecord) => {
          const assetInfo = vp.assetName
            ? ` | Asset: ${vp.assetName}`
            : ` | Asset:  <empty>`;
          const participantInfo = vp.participantId
            ? ` | Participant: ${vp.participantId}`
            : '';
          const stageInfo = ` | Stage: ${vp.stageArn}`;
          const ageInfo = ` | Last updated: ${getRelativeTime(vp.updatedAt)}`;

          console.info(
            `     • ID: ${vp.id} | Task: ${vp.taskId.split('/').pop()}${assetInfo}${participantInfo}${stageInfo}${ageInfo}`
          );
        });
      }
    } else {
      console.info(`\n📭 No virtual participants found.`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Failed to list virtual participants\n\n`,
        error instanceof AxiosError
          ? { ...error.toJSON(), data: error.response?.data }
          : error.toString()
      );
    }
  }
}

function getStatusEmoji(status: string): string {
  const statusEmojis: Record<string, string> = {
    AVAILABLE: '🟢',
    PROVISIONING: '🔄',
    PENDING: '🟡',
    INVITED: '📧',
    JOINED: '🎯',
    RUNNING: '▶️',
    STOPPED: '⏹️',
    ERRORED: '❌',
    KICKED: '🚪',
    DEPROVISIONING: '🔄'
  };

  return statusEmojis[status] || '⚪';
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

listVps();
