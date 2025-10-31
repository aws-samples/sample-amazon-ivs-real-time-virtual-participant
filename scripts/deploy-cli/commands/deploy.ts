/* eslint-disable no-console */

/**
 * Deploy command - interactive deployment workflow
 */

import { execSync } from 'node:child_process';

import chalk from 'chalk';

import { ConfigStore } from '../lib/config-store.js';
import { executeDeploy } from '../lib/executor.js';
import {
  promptConfirmDeployment,
  promptDeploymentConfig,
  promptModifyConfig,
  promptSelectConfig
} from '../lib/prompts.js';
import { generateConfigId } from '../lib/validator.js';
import type { DeploymentConfig } from '../types/deployment.types.js';

/**
 * Check if a CloudFormation stack exists
 */
function checkStackExists(stackName: string, awsProfile?: string): boolean {
  try {
    const profileFlag =
      awsProfile && awsProfile !== 'default' ? `--profile ${awsProfile}` : '';
    const command = `aws cloudformation describe-stacks --stack-name ${stackName} ${profileFlag}`;

    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

export async function deployCommand(): Promise<void> {
  console.log(
    chalk.bold.cyan('\n🚀 IVS Virtual Participant Deployment Tool\n')
  );

  const configStore = new ConfigStore();
  const deployments = configStore.listDeployments();

  // Step 1: Choose to use saved config or create new
  const selectedConfigId = await promptSelectConfig(deployments);

  let config: DeploymentConfig;
  let configId: string;
  let configName: string;
  let shouldSaveConfig = false;

  if (selectedConfigId) {
    // Using saved configuration
    const savedDeployment = configStore.getDeployment(selectedConfigId);

    if (!savedDeployment) {
      console.error(chalk.red('❌ Configuration not found'));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ Selected: ${savedDeployment.name}\n`));

    // Ask if user wants to modify
    const shouldModify = await promptModifyConfig();

    if (shouldModify) {
      const answers = await promptDeploymentConfig(savedDeployment.config);

      config = {
        virtualParticipant: answers.virtualParticipant,
        environment: answers.environment,
        stackName: answers.stackName,
        awsProfile: answers.awsProfile,
        publicApi: answers.publicApi
      };
    } else {
      config = savedDeployment.config;
    }

    configId = selectedConfigId;
    configName = savedDeployment.name;
  } else {
    // Create new configuration
    const answers = await promptDeploymentConfig();

    config = {
      virtualParticipant: answers.virtualParticipant,
      environment: answers.environment,
      stackName: answers.stackName,
      awsProfile: answers.awsProfile,
      publicApi: answers.publicApi
    };

    configId = generateConfigId(
      answers.virtualParticipant,
      answers.environment
    );
    configName = answers.configName ?? configId;
    shouldSaveConfig = answers.saveConfig ?? false;
  }

  // Step 2: Confirm deployment
  const confirmed = await promptConfirmDeployment(config);

  if (!confirmed) {
    console.log(chalk.yellow('\n  Deployment cancelled\n'));
    process.exit(0);
  }

  // Step 3: Check if this stack has been deployed before
  const stackExists = checkStackExists(config.stackName, config.awsProfile);
  const isFirstDeploy = !stackExists;

  if (isFirstDeploy) {
    console.log(
      chalk.cyan(
        '\n📦 First-time deployment detected. Running full setup (install + bootstrap + deploy)...\n'
      )
    );
  }

  // Step 4: Execute deployment
  const result = await executeDeploy(config, isFirstDeploy);

  if (result.success) {
    // Save configuration after successful deployment if requested
    if (shouldSaveConfig) {
      configStore.saveDeployment(configId, configName, config);
      console.log(chalk.green(`\n✓ Configuration saved as: ${configName}\n`));
    }

    // Update last deployed timestamp if using saved config
    if (selectedConfigId) {
      configStore.updateLastDeployed(configId);
    }

    console.log(chalk.green('\n✅ Deployment completed successfully!\n'));
    console.log(
      chalk.dim('You can now use your deployed virtual participant.\n')
    );
  } else {
    console.error(chalk.red('\n❌ Deployment failed\n'));

    if (result.error) {
      console.error(chalk.red(result.error));
    }

    process.exit(1);
  }
}
