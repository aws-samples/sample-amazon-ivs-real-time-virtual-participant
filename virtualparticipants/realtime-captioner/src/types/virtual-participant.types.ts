export enum VirtualParticipantStatus {
  AVAILABLE = 'AVAILABLE',
  INVITED = 'INVITED',
  JOINED = 'JOINED',
  KICKED = 'KICKED'
}

export interface VirtualParticipant {
  id: string;
  status: VirtualParticipantStatus;
  taskId: string;
  updatedAt: string;
  participantToken?: string;
  stageArn?: string;
  assetName?: string;
  lastUpdateSource?: string;
  stageEndpoints?: {
    events?: string;
    whip?: string;
    whep?: string;
  };
}

export interface VirtualParticipantSubscriptionData {
  onVirtualParticipantStateChanged?: VirtualParticipant;
}
