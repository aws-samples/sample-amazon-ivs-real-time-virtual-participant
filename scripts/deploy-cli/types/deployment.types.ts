/**
 * Deployment configuration types for the CLI tool
 */

export type VirtualParticipantType = 'asset-publisher' | 'gpt-realtime';
export type EnvironmentType = 'dev' | 'prod';

export interface DeploymentConfig {
  virtualParticipant: VirtualParticipantType;
  environment: EnvironmentType;
  stackName: string;
  awsProfile?: string;
  publicApi: boolean;
}

export interface SavedDeployment {
  id: string;
  name: string;
  config: DeploymentConfig;
  lastDeployed?: string;
  deployCount: number;
  createdAt: string;
}

export interface DeploymentStore {
  deployments: Record<string, SavedDeployment>;
}

export interface PromptAnswers {
  virtualParticipant: VirtualParticipantType;
  environment: EnvironmentType;
  stackName: string;
  awsProfile: string;
  publicApi: boolean;
  saveConfig?: boolean;
  configName?: string;
}
