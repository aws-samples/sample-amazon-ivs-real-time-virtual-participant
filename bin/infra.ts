#!/usr/bin/env node
import 'source-map-support/register';

import { VirtualParticipantStack } from '@stacks';
import { deepMerge } from '@utils/common';
import { App, Environment } from 'aws-cdk-lib';
import { config as dotenvConfig } from 'dotenv';
import { AppEnv, Config } from 'typings/config.types';

// Load environment variables from .env file
dotenvConfig();

const app = new App();

// Runtime context config
const appEnv: AppEnv = app.node.tryGetContext('appEnv');
const stackName: string = app.node.tryGetContext('stackName');
const globalConfig: Partial<Config> = app.node.tryGetContext('global');
const appEnvConfig: Partial<Config> = app.node.tryGetContext(appEnv);
const config = deepMerge(globalConfig, appEnvConfig) as Config;

// Environment
const account = process.env.AWS_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION;
const env: Environment = { account, region };

// Tags applied to all the taggable resources and the stack itself
const tags: Record<string, string> = {
  'app:env': appEnv,
  'stack:root': stackName
};

new VirtualParticipantStack(app, stackName, {
  env,
  tags,
  appEnv,
  config,
  terminationProtection: appEnv === AppEnv.PROD
});
