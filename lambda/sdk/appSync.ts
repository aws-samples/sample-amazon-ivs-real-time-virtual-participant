import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { VpRecord } from '@typings/virtualparticipant';
import axios, { AxiosRequestConfig } from 'axios';

import { mapVpStatusToGraphQLState } from '../utils';

const MUTATION_TIMEOUT_MS = 10_000; // 10 seconds per mutation

// Helper function to push mutations to AppSync
async function pushMutationsToAppSync(
  changedRecords: VpRecord[]
): Promise<string[]> {
  const graphqlUrl = process.env.GRAPHQL_API_URL!;
  const region = process.env.AWS_REGION!;
  const failedRecordIds: string[] = [];

  if (!graphqlUrl || !region) {
    console.error(
      'Missing required environment variables: GRAPHQL_API_URL or AWS_REGION'
    );

    return changedRecords.map((r) => r.id);
  }

  // GraphQL mutation
  const mutation = `
    mutation UpdateVirtualParticipantState($input: VPStateInput!) {
      updateVirtualParticipantState(input: $input) {
        id
        status
        running
        assetName
        lastUpdateSource
        stageArn
        stageEndpoints {
          whip
          events
        }
        taskId
        updatedAt
        tasks {
          id
          state
        }
      }
    }
  `;

  // Initialize credentials and signer
  let signer;

  try {
    signer = new SignatureV4({
      credentials: defaultProvider(),
      region,
      service: 'appsync',
      sha256: Sha256
    });
  } catch (error) {
    console.error('Failed to initialize credentials or signer:', error);

    return changedRecords.map((r) => r.id);
  }

  // Create promises for all mutations to execute in parallel
  const mutationPromises = changedRecords.map(async (vpRecord) => {
    try {
      const variables = {
        input: {
          id: vpRecord.id,
          status: mapVpStatusToGraphQLState(vpRecord.status),
          running: vpRecord.running,
          assetName: vpRecord.assetName ?? '',
          lastUpdateSource: vpRecord.lastUpdateSource,
          stageArn: vpRecord.stageArn,
          stageEndpoints: vpRecord.stageEndpoints
            ? {
                whip: vpRecord.stageEndpoints.whip,
                events: vpRecord.stageEndpoints.events
              }
            : undefined,
          taskId: vpRecord.taskId,
          updatedAt: vpRecord.updatedAt
        }
      };

      const requestPayload = {
        query: mutation,
        variables
      };

      const body = JSON.stringify(requestPayload);
      const url = new URL(graphqlUrl);

      // Create HTTP request for signing
      const request = new HttpRequest({
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port
          ? parseInt(url.port)
          : url.protocol === 'https:'
            ? 443
            : 80,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length.toString(),
          host: url.hostname
        },
        body
      });

      // Sign the request
      const signedRequest = await signer.sign(request);

      // Configure axios request with timeout
      const axiosConfig: AxiosRequestConfig = {
        method: 'POST',
        url: graphqlUrl,
        headers: {
          ...signedRequest.headers,
          'User-Agent': 'AWS-Lambda-Function'
        },
        data: body,
        timeout: MUTATION_TIMEOUT_MS, // Use axios's built-in timeout
        validateStatus: (status) => status < 500 // Don't throw on 4xx errors
      };

      const response = await axios(axiosConfig);

      if (response.status !== 200) {
        console.error(
          `HTTP error ${response.status} for VP ${vpRecord.id}:`,
          response.data
        );

        return { success: false, recordId: vpRecord.id };
      }

      const responseData = response.data;

      if (responseData.errors && responseData.errors.length > 0) {
        console.error(
          `GraphQL errors for VP ${vpRecord.id}:`,
          responseData.errors
        );

        return { success: false, recordId: vpRecord.id };
      }

      console.info(
        `Successfully updated VP state for ${vpRecord.id}:`,
        responseData.data
      );

      return { success: true, recordId: vpRecord.id };
    } catch (error) {
      // Handle timeout and other errors
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ECONNABORTED'
      ) {
        console.error(
          `Request timeout for VP ${vpRecord.id} after ${MUTATION_TIMEOUT_MS}ms`
        );
      } else {
        console.error(`Error processing VP record ${vpRecord.id}:`, error);
      }

      return { success: false, recordId: vpRecord.id };
    }
  });

  // Execute all mutations in parallel and collect results
  const results = await Promise.allSettled(mutationPromises);

  // Process results to collect failed record IDs
  for (const result of results) {
    if (result.status === 'fulfilled' && !result.value.success) {
      failedRecordIds.push(result.value.recordId);
    } else if (result.status === 'rejected') {
      console.error('Unexpected promise rejection:', result.reason);
      // If we can't determine which record failed, we'll need to fail all remaining
      // This shouldn't happen with our timeout handling, but adding safety
    }
  }

  return failedRecordIds;
}

export { pushMutationsToAppSync };
