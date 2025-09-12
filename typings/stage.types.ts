import {
  DeleteStageResponse,
  StageEndpoints
} from '@aws-sdk/client-ivs-realtime';

interface StageRecord {
  id: string;
  hostParticipantId: string;
  ttl?: string;
  createdAt: string;
  updatedAt: string;
  stageArn: string;
  stageEndpoints: StageEndpoints;
}

interface CreateStageRequest {
  userId?: string;
  attributes?: Record<string, string>;
}

interface CreateStageResponse {
  token: string;
  participantId: string;
  id: string;
}

interface JoinStageRequest {
  id: string;
  userId?: string;
  attributes?: Record<string, string>;
  allowPublish?: boolean;
}

interface JoinStageResponse {
  token: string;
  participantId: string;
}

interface DeleteStageRequest {
  id: string;
  participantId: string;
}

export type {
  CreateStageRequest,
  CreateStageResponse,
  DeleteStageRequest,
  DeleteStageResponse,
  JoinStageRequest,
  JoinStageResponse,
  StageRecord
};
