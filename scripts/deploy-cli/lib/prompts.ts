/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

/**
 * Interactive prompt definitions using Inquirer
 */

import { execSync } from 'node:child_process';

import inquirer from 'inquirer';

import type {
  DeploymentConfig,
  PromptAnswers,
  SavedDeployment
} from '../types/deployment.types.js';
import {
  getDefaultStackName,
  validateConfigName,
  validateStackName
} from './validator.js';

/**
 * Get list of available AWS profiles
 */
function getAwsProfiles(): string[] {
  try {
    const output = execSync('aws configure list-profiles', {
      encoding: 'utf-8'
    });
    const profiles = output.trim().split('\n').filter(Boolean);

    return profiles.length > 0 ? profiles : ['default'];
  } catch {
    return ['default'];
  }
}

/**
 * Get current AWS profile from environment or default
 */
function getCurrentAwsProfile(): string {
  return process.env.AWS_PROFILE ?? 'default';
}

/**
 * Main interactive deployment prompt
 */
export async function promptDeploymentConfig(
  previousConfig?: DeploymentConfig
): Promise<PromptAnswers> {
  const awsProfiles = getAwsProfiles();
  const currentProfile = getCurrentAwsProfile();

  const answers = (await inquirer.prompt([
    {
      type: 'list',
      name: 'virtualParticipant',
      message: 'Select Virtual Participant Type:',
      choices: [
        {
          name: 'asset-publisher - Publishes media assets to IVS stage',
          value: 'asset-publisher'
        },
        {
          name: 'gpt-realtime - GPT-powered real-time participant',
          value: 'gpt-realtime'
        },
        {
          name: 'nova-s2s - Amazon Nova Sonic speech-to-speech AI participant',
          value: 'nova-s2s'
        },
        {
          name: 'realtime-captioner - Real-time captioning/transcription participant',
          value: 'realtime-captioner'
        }
      ],
      default: previousConfig?.virtualParticipant ?? 'asset-publisher'
    },
    {
      type: 'list',
      name: 'environment',
      message: 'Select Environment:',
      choices: [
        {
          name: 'dev - Development environment',
          value: 'dev'
        },
        {
          name: 'prod - Production environment',
          value: 'prod'
        }
      ],
      default: previousConfig?.environment ?? 'dev'
    },
    {
      type: 'input',
      name: 'stackName',
      message: 'Enter Stack Name:',
      default: (ans: any) =>
        previousConfig?.stackName ?? getDefaultStackName(ans.environment),
      validate: validateStackName
    },
    {
      type: 'list',
      name: 'awsProfile',
      message: 'Select AWS Profile:',
      choices: awsProfiles,
      default: previousConfig?.awsProfile ?? currentProfile
    },
    {
      type: 'confirm',
      name: 'publicApi',
      message: 'Enable Public API?',
      default: previousConfig?.publicApi ?? false
    },
    {
      type: 'confirm',
      name: 'saveConfig',
      message: 'Save this configuration for future use?',
      default: false,
      when: () => !previousConfig // Only ask if not using existing config
    },
    {
      type: 'input',
      name: 'configName',
      message: 'Enter a name for this configuration:',
      default: (ans: any) => ans.stackName,
      validate: validateConfigName,
      when: (ans: any) => ans.saveConfig === true
    }
  ])) as PromptAnswers;

  return answers;
}

/**
 * Prompt to select from saved configurations
 */
export async function promptSelectConfig(
  deployments: SavedDeployment[]
): Promise<string | null> {
  if (deployments.length === 0) {
    console.log(
      '\nNo saved configurations found. Creating a new deployment...\n'
    );

    return null;
  }

  const choices = deployments.map((d) => ({
    name: `${d.name} (${d.config.virtualParticipant} / ${d.config.environment}) - Last deployed: ${
      d.lastDeployed ? new Date(d.lastDeployed).toLocaleString() : 'Never'
    }`,
    value: d.id
  }));

  choices.push({
    name: '→ Create new deployment configuration',
    value: 'new'
  });

  const answer = await inquirer.prompt<{ configId: string }>([
    {
      type: 'list',
      name: 'configId',
      message: 'Select a deployment configuration:',
      choices,
      pageSize: 15
    }
  ]);

  return answer.configId === 'new' ? null : answer.configId;
}

/**
 * Prompt to confirm deployment
 */
export async function promptConfirmDeployment(
  config: DeploymentConfig
): Promise<boolean> {
  console.log('\n📋 Deployment Configuration Summary:');
  console.log('─────────────────────────────────────');
  console.log(`Virtual Participant: ${config.virtualParticipant}`);
  console.log(`Environment:         ${config.environment}`);
  console.log(`Stack Name:          ${config.stackName}`);
  console.log(`AWS Profile:         ${config.awsProfile ?? 'default'}`);
  console.log(`Public API:          ${config.publicApi ? 'Yes' : 'No'}`);
  console.log('─────────────────────────────────────\n');

  const answer = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Proceed with deployment?',
      default: true
    }
  ]);

  return answer.confirm;
}

/**
 * Prompt to select configuration for deletion
 */
export async function promptDeleteConfig(
  deployments: SavedDeployment[]
): Promise<string | null> {
  if (deployments.length === 0) {
    console.log('\nNo saved configurations to delete.\n');

    return null;
  }

  const choices = deployments.map((d) => ({
    name: `${d.name} (${d.config.virtualParticipant} / ${d.config.environment})`,
    value: d.id
  }));

  const answer = await inquirer.prompt<{ configId: string }>([
    {
      type: 'list',
      name: 'configId',
      message: 'Select configuration to delete:',
      choices
    }
  ]);

  // Confirm deletion
  const confirmAnswer = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete this configuration?`,
      default: false
    }
  ]);

  return confirmAnswer.confirm ? answer.configId : null;
}

/**
 * Prompt to modify configuration before deployment
 */
export async function promptModifyConfig(): Promise<boolean> {
  const answer = await inquirer.prompt<{ modify: boolean }>([
    {
      type: 'confirm',
      name: 'modify',
      message: 'Would you like to modify this configuration before deploying?',
      default: false
    }
  ]);

  return answer.modify;
}
