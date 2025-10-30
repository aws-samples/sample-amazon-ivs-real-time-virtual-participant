enum AppEnv {
  DEV = 'dev',
  PROD = 'prod'
}

interface Config {
  readonly vpc: Readonly<VpcConfig>;
  readonly enablePublicIP: boolean;
  readonly enablePublicApi?: boolean;
}

interface VpcConfig {
  maxAzs?: number;
  natGateways?: number;
}

export { AppEnv };
export type { Config };
