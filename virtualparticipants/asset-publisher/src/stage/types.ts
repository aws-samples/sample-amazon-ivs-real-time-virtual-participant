import { StageParticipantInfo } from 'amazon-ivs-web-broadcast';

interface StrategyMutators {
  publish: (mediaStreamToPublish?: MediaStream) => void;
  unpublish: () => void;
  republish: () => Promise<void>;
  updateStreamsToPublish: (mediaStreamToPublish: MediaStream) => void;
}

interface TokenPayload {
  exp: number;
  iat: number;
  jti: string;
  resource: string;
  topic: string;
  events_url: string;
  whip_url: string;
  user_id: string;
  capabilities: {
    allow_publish?: boolean;
    allow_subscribe?: boolean;
  };
  version: string;
}

enum PeerClientEvents {
  SEI_MESSAGE_RECEIVED = 'seiMessageReceived'
}

interface SEIMessage {
  _dedupeId: string;
  [key: string]: unknown;
}

interface SEIPayload {
  type: 'delta';
  uuid: Uint16Array;
  message: Uint8Array;
  timestamp: number;
}

interface SeiMessageItem {
  sender: SeiSenderInfo;
  payload: SeiPayload;
}

interface SeiPayload {
  id: string;
  content: string;
}

type SeiSenderInfo = Pick<StageParticipantInfo, 'id' | 'userId' | 'isLocal'>;

type SeiReceivedCallback = (sender: SeiSenderInfo, payload: SeiPayload) => void;

export type {
  SEIMessage,
  SeiMessageItem,
  SEIPayload,
  SeiPayload,
  SeiReceivedCallback,
  StrategyMutators,
  TokenPayload
};

export { PeerClientEvents };
