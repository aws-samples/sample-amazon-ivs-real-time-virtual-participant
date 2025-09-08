import { StageEndpoints } from '@aws-sdk/client-ivs-realtime';

interface VpRecord {
  id: string;
  ttl?: number;
  running?: 'yes';
  participantId?: string;
  assetName?: string;
  status: VpStatus;
  taskId: string;
  createdAt: string;
  updatedAt: string;
  stageArn: string;
  stageEndpoints: StageEndpoints;
  lastUpdateSource?: string;
}

enum VpStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  PROVISIONING = 'PROVISIONING',
  DEPROVISIONING = 'DEPROVISIONING',
  INVITED = 'INVITED',
  JOINED = 'JOINED',
  ERRORED = 'ERRORED',
  KICKED = 'KICKED',
  AVAILABLE = 'AVAILABLE'
}

interface InviteVpRequest {
  id: string;
  assetName: string;
}

interface KickVpRequest {
  id: string;
}

interface TokenConfiguration {
  userId: string;
  attributes?: Record<string, string>;
}

interface CreateTokenRequest {
  id: string;
  userId?: string;
  attributes?: Record<string, string>;
}

interface CreateTokenResponse {
  token: string;
  participantId: string;
}

export type {
  CreateTokenRequest,
  CreateTokenResponse,
  InviteVpRequest,
  KickVpRequest,
  TokenConfiguration,
  VpRecord
};

export { VpStatus };
