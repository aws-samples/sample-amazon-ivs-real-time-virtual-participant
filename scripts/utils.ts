import util from 'node:util';

import { Sha256 } from '@aws-crypto/sha256-js';
import {
  CloudFormationClient,
  DescribeStacksCommand
} from '@aws-sdk/client-cloudformation';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

const { positionals } = util.parseArgs({
  allowPositionals: true,
  strict: false
});
const [stackName] = positionals;

if (!stackName) throw new Error('Stack name not provided.');

const credentialsProvider = defaultProvider();
const cloudFormationClient = new CloudFormationClient();

async function getStackExport(key: string) {
  const dsCommand = new DescribeStacksCommand({ StackName: stackName });
  const dsResponse = await cloudFormationClient.send(dsCommand);
  const stackOutputs = dsResponse.Stacks?.[0]?.Outputs ?? [];

  const { OutputValue: value } =
    stackOutputs.find((output) => {
      const [exportKey] = output.ExportName?.split('::').slice(-1) ?? [];

      return exportKey === key;
    }) ?? {};

  return value;
}

async function signLambdaRequest(
  urlExportKey: string,
  method = 'GET',
  body?: object | string
) {
  const invokeUrl = await getStackExport(urlExportKey);

  if (!invokeUrl) {
    throw new Error('Lambda URL not found in stack outputs.');
  }

  const url = new URL(invokeUrl);
  const httpRequest = new HttpRequest({
    method,
    path: url.pathname,
    hostname: url.hostname,
    protocol: url.protocol,
    headers: {
      host: url.hostname,
      'content-type': 'application/json'
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

  const signer = new SignatureV4({
    service: 'lambda',
    sha256: Sha256,
    applyChecksum: true,
    uriEscapePath: true,
    credentials: credentialsProvider,
    region: httpRequest.hostname.split('.')[2]
  });

  const signedRequest = await signer.sign(httpRequest);

  return [signedRequest, invokeUrl] as const;
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

export { getRelativeTime, getStackExport, signLambdaRequest };
