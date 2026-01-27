import { Stage } from 'amazon-ivs-web-broadcast';

export interface TokenPayload {
  jti: string;
  user_id: string;
}

export interface StrategyMutators {
  publish: (mediaStream: MediaStream) => void;
}

export type StageType = Stage & {
  strategyMutators: StrategyMutators;
};
