// Types for Virtual Participant subscription data
// Based on the GraphQL schema VirtualParticipant type

export enum VirtualParticipantStatus {
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

export enum TaskState {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED'
}

export interface StageEndpoints {
  whip?: string;
  events?: string;
}

export interface Task {
  id: string;
  state: TaskState;
}

export interface VirtualParticipant {
  id: string;
  status: VirtualParticipantStatus;
  tasks?: Task[];
  running?: string;
  stageArn: string;
  stageEndpoints?: StageEndpoints;
  taskId: string;
  updatedAt: string;
  lastUpdateSource?: string;
  assetName?: string;
  // Additional fields that may be added by the WebSocket server
  participantToken?: string;
  participantId?: string;
}

export interface VirtualParticipantSubscriptionData {
  onVirtualParticipantStateChanged: VirtualParticipant;
}
