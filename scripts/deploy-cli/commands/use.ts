/* eslint-disable no-console */

/**
 * Use command - deploy using a saved configuration
 */

import chalk from 'chalk';

import { ConfigStore } from '../lib/config-store.js';
import { executeDeploy } from '../lib/executor.js';
import {
  promptConfirmDeployment,
  promptDeploymentConfig,
  promptModifyConfig,
  promptSelectConfig
} from '../lib/prompts.js';

export async function useCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n🚀 Deploy from Saved Configuration\n'));

  const configStore = new ConfigStore();
  const deployments = configStore.listDeployments();

  if (deployments.length === 0) {
    console.log(chalk.yellow('No saved configurations found.\n'));
    console.log(
      chalk.dim(
        'Run "npm run deploy:cli" to create and save a deployment configuration.\n'
      )
    );

    return;
  }

  // Select configuration
  const selectedConfigId = await promptSelectConfig(deployments);

  if (!selectedConfigId) {
    console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));

    return;
  }

  const savedDeployment = configStore.getDeployment(selectedConfigId);

  if (!savedDeployment) {
    console.error(chalk.red('❌ Configuration not found'));
    process.exit(1);
  }

  console.log(chalk.green(`\n✓ Selected: ${savedDeployment.name}\n`));

  // Ask if user wants to modify
  const shouldModify = await promptModifyConfig();
  let config = savedDeployment.config;

  if (shouldModify) {
    const answers = await promptDeploymentConfig(savedDeployment.config);

    config = {
      virtualParticipant: answers.virtualParticipant,
      environment: answers.environment,
      stackName: answers.stackName,
      awsProfile: answers.awsProfile,
      publicApi: answers.publicApi
    };
  }

  // Confirm deployment
  const confirmed = await promptConfirmDeployment(config);

  if (!confirmed) {
    console.log(chalk.yellow('\n⚠️  Deployment cancelled\n'));

    return;
  }

  // Execute deployment
  const result = await executeDeploy(config);

  if (result.success) {
    // Update last deployed timestamp
    configStore.updateLastDeployed(selectedConfigId);

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
