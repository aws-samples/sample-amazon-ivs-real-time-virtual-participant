import {
  CreateStageCommand,
  DeletePublicKeyCommand,
  DeleteStageCommand,
  DisconnectParticipantCommand,
  GetParticipantCommand,
  GetStageCommand,
  ImportPublicKeyCommand,
  IVSRealTimeClient,
  ListParticipantsCommand,
  ListStagesCommand,
  Participant,
  ParticipantState,
  PublicKey,
  ResourceNotFoundException,
  StageEndpoints,
  StageSummary
} from '@aws-sdk/client-ivs-realtime';
import jwt from 'jsonwebtoken';
import { customAlphabet } from 'nanoid';

import {
  PARTICIPANT_TOKEN_DURATION_IN_MINUTES,
  RESOURCE_TAGS
} from '../constants';
import { parseArn, retryWithBackoff } from '../utils';
import { getSecretValue } from './secretsManager';
import { getParameter } from './ssm';

const ivsRealTimeClient = new IVSRealTimeClient();

const generateParticipantId = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', // alphanumeric
  12
);

async function createStage() {
  const { stage } = await retryWithBackoff(() =>
    ivsRealTimeClient.send(
      new CreateStageCommand({
        tags: RESOURCE_TAGS
      })
    )
  );

  return stage!;
}

async function createToken({
  stageArn,
  stageEndpoints,
  allowSubscribe,
  allowPublish,
  userId,
  attributes
}: {
  stageArn: string;
  stageEndpoints: StageEndpoints;
  allowSubscribe: boolean;
  allowPublish: boolean;
  userId?: string;
  attributes?: Record<string, string>;
}) {
  const capabilities = {
    allow_publish: allowPublish,
    allow_subscribe: allowSubscribe
  };
  const participantId = generateParticipantId();
  const stageId = parseArn(stageArn).resourceId;
  const payload = {
    capabilities,
    version: '1.0',
    topic: stageId,
    resource: stageArn,
    jti: participantId,
    whip_url: stageEndpoints.whip,
    events_url: stageEndpoints.events,
    ...(!!attributes && { attributes }),
    ...(!!userId && { user_id: userId })
  };

  const [privateKey, keyid] = await Promise.all([
    getSecretValue(process.env.PRIVATE_KEY_SECRET_ARN!),
    getPublicKeyArn()
  ]);
  const expiresIn = `${PARTICIPANT_TOKEN_DURATION_IN_MINUTES} minutes`;
  const signOptions: jwt.SignOptions = { algorithm: 'ES384', keyid, expiresIn };
  const participantToken = jwt.sign(payload, privateKey, signOptions);

  return { token: participantToken, participantId };
}

async function disconnectParticipant(
  stageArn: string,
  participantId: string,
  reason?: string
) {
  await retryWithBackoff(() =>
    ivsRealTimeClient.send(
      new DisconnectParticipantCommand({ stageArn, participantId, reason })
    )
  );
}

async function deletePublicKey(arn: string) {
  try {
    await retryWithBackoff(() =>
      ivsRealTimeClient.send(new DeletePublicKeyCommand({ arn }))
    );
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }
}

async function deleteStage(stageArn: string) {
  await retryWithBackoff(() =>
    ivsRealTimeClient.send(new DeleteStageCommand({ arn: stageArn }))
  );
}

async function getParticipant(
  stageArn: string,
  participantId: string,
  sessionId: string
) {
  const { participant } = await retryWithBackoff(() =>
    ivsRealTimeClient.send(
      new GetParticipantCommand({ stageArn, participantId, sessionId })
    )
  );

  return participant!;
}

async function getPublicKeyArn() {
  const publicKeyArnParamName = process.env.PUBLIC_KEY_ARN_PARAM_NAME!;

  try {
    const parameterValue = await getParameter(publicKeyArnParamName);
    const { arn } = JSON.parse(parameterValue) as Pick<PublicKey, 'arn'>;

    return arn;
  } catch (error) {
    throw new Error(
      `Failed to retrieve the Public Key ARN parameter "${publicKeyArnParamName}".`,
      { cause: error }
    );
  }
}

async function getStage(arn: string) {
  try {
    const { stage } = await retryWithBackoff(() =>
      ivsRealTimeClient.send(new GetStageCommand({ arn }))
    );

    return stage!;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }
}

async function importPublicKey(keyPrefix: string, publicKeyMaterial: string) {
  const createdAt = Date.now();
  const { publicKey } = await ivsRealTimeClient.send(
    new ImportPublicKeyCommand({
      publicKeyMaterial,
      name: `${keyPrefix}-${createdAt}`,
      tags: { createdAt: new Date(createdAt).toISOString() }
    })
  );

  return publicKey!.arn!;
}

async function listParticipants(
  stageArn: string,
  sessionId: string,
  state?: ParticipantState
) {
  const totalParticipants: Participant[] = [];

  async function listStageParticipants(token?: string, depth = 0) {
    const { participants = [], nextToken } = await retryWithBackoff(() =>
      ivsRealTimeClient.send(
        new ListParticipantsCommand({
          stageArn,
          sessionId,
          maxResults: 100,
          nextToken: token,
          ...(state && { filterByState: state })
        })
      )
    );
    totalParticipants.push(...participants);

    if (nextToken) {
      // Exponential backoff (1s maximum delay)
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(2 ** depth * 10, 1000));
      });

      await listStageParticipants(nextToken, depth + 1);
    }
  }

  await listStageParticipants();

  return totalParticipants;
}

async function listStages() {
  const totalStages: StageSummary[] = [];

  async function _listStages(token?: string, depth = 0) {
    const { stages = [], nextToken } = await retryWithBackoff(() =>
      ivsRealTimeClient.send(
        new ListStagesCommand({ maxResults: 100, nextToken: token })
      )
    );

    totalStages.push(...stages);

    if (nextToken) {
      // Exponential backoff (1s maximum delay)
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(2 ** depth * 100, 1000));
      });

      await _listStages(nextToken, depth + 1);
    }
  }

  await _listStages();

  const stackStages = totalStages.filter(
    ({ tags }) => !!tags?.stack && tags.stack === RESOURCE_TAGS.stack
  );

  return stackStages;
}

export {
  createStage,
  createToken,
  deletePublicKey,
  deleteStage,
  disconnectParticipant,
  getParticipant,
  getPublicKeyArn,
  getStage,
  importPublicKey,
  listParticipants,
  listStages
};
