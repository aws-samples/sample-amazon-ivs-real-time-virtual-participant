import {
  GetSecretValueCommand,
  SecretsManagerClient
} from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { fromContainerMetadata } from '@aws-sdk/credential-providers';
import jwt from 'jsonwebtoken';
import { customAlphabet } from 'nanoid';

import { StageEndpoints } from '../src/types/virtual-participant.types';

// Constants
const PARTICIPANT_TOKEN_DURATION_IN_MINUTES = 10_080; // 1 week
const generateParticipantId = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', // alphanumeric
  12
);

export interface TokenCreationResult {
  token: string;
  participantId: string;
}

/**
 * Service for creating participant tokens for Virtual Participants
 * Handles AWS service interactions and token generation
 */
export class ParticipantTokenService {
  private ssmClient: SSMClient;
  private secretsManagerClient: SecretsManagerClient;
  private privateKeyCache: string | null = null;
  private publicKeyArnCache: string | null = null;

  constructor() {
    // Initialize AWS clients
    const credentials = fromContainerMetadata();
    this.ssmClient = new SSMClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials
    });
    this.secretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials
    });
  }

  /**
   * Create a participant token for a Virtual Participant
   * @param stageArn - The ARN of the IVS stage
   * @param stageEndpoints - The stage endpoints (whip, events)
   * @param userId - Optional user ID to include in the token
   * @returns Promise containing the token and participant ID
   */
  async createParticipantToken(
    stageArn: string,
    stageEndpoints: StageEndpoints,
    userId?: string
  ): Promise<TokenCreationResult> {
    if (!stageArn || !stageEndpoints) {
      throw new Error(
        'Stage ARN and endpoints are required for token creation'
      );
    }

    try {
      const [privateKey, keyid] = await Promise.all([
        this.getPrivateKey(),
        this.getPublicKeyArn()
      ]);

      console.info('Creating participant token with key ID:', keyid);

      const participantId = generateParticipantId();
      const stageId = this.parseStageId(stageArn);

      const payload = {
        capabilities: {
          allow_publish: true,
          allow_subscribe: true
        },
        version: '1.0',
        topic: stageId,
        resource: stageArn,
        jti: participantId,
        whip_url: stageEndpoints.whip,
        events_url: stageEndpoints.events,
        attributes: { isVP: 'true', username: 'Virtual Participant' },
        ...(userId && { user_id: userId })
      };

      const expiresIn = `${PARTICIPANT_TOKEN_DURATION_IN_MINUTES} minutes`;
      const signOptions: jwt.SignOptions = {
        algorithm: 'ES384',
        keyid,
        expiresIn
      };

      const token = jwt.sign(payload, privateKey, signOptions);

      console.info(
        `Created participant token for VP, participantId: ${participantId}`
      );

      return { token, participantId };
    } catch (error) {
      console.error('Failed to create participant token:', error);
      throw error;
    }
  }

  /**
   * Get private key from AWS Secrets Manager (with caching)
   * @returns Promise<string> - The private key
   */
  private async getPrivateKey(): Promise<string> {
    if (this.privateKeyCache) {
      return this.privateKeyCache;
    }

    if (!process.env.PRIVATE_KEY_SECRET_ARN) {
      throw new Error(
        'PRIVATE_KEY_SECRET_ARN environment variable is required'
      );
    }

    try {
      const command = new GetSecretValueCommand({
        SecretId: process.env.PRIVATE_KEY_SECRET_ARN
      });
      const response = await this.secretsManagerClient.send(command);

      if (!response.SecretString) {
        throw new Error('Private key secret value is empty');
      }

      this.privateKeyCache = response.SecretString;

      return this.privateKeyCache;
    } catch (error) {
      console.error('Failed to get private key from Secrets Manager:', error);
      throw error;
    }
  }

  /**
   * Get public key ARN from AWS SSM Parameter Store (with caching)
   * @returns Promise<string> - The public key ARN
   */
  private async getPublicKeyArn(): Promise<string> {
    if (this.publicKeyArnCache) {
      return this.publicKeyArnCache;
    }

    if (!process.env.PUBLIC_KEY_ARN_PARAM_NAME) {
      throw new Error(
        'PUBLIC_KEY_ARN_PARAM_NAME environment variable is required'
      );
    }

    try {
      const command = new GetParameterCommand({
        Name: process.env.PUBLIC_KEY_ARN_PARAM_NAME
      });
      const response = await this.ssmClient.send(command);

      if (!response.Parameter?.Value) {
        throw new Error('Public key ARN parameter value is empty');
      }

      const { arn } = JSON.parse(response.Parameter.Value) as { arn: string };
      this.publicKeyArnCache = arn;

      return this.publicKeyArnCache;
    } catch (error) {
      console.error('Failed to get public key ARN from SSM:', error);
      throw error;
    }
  }

  /**
   * Parse stage ID from stage ARN
   * @param stageArn - The stage ARN
   * @returns string - The stage ID
   */
  private parseStageId(stageArn: string): string {
    const arnParts = stageArn.split('/');

    return arnParts[arnParts.length - 1];
  }

  /**
   * Clear cached keys (useful for testing or key rotation)
   */
  clearCache(): void {
    this.privateKeyCache = null;
    this.publicKeyArnCache = null;
  }
}
