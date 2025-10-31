/* eslint-disable no-console */

/**
 * List command - display all saved deployment configurations
 */

import chalk from 'chalk';

import { ConfigStore } from '../lib/config-store.js';

export function listCommand(): void {
  console.log(chalk.bold.cyan('\n📋 Saved Deployment Configurations\n'));

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

  console.log(chalk.dim('─'.repeat(80)));

  for (const deployment of deployments) {
    console.log(chalk.bold.white(`\n${deployment.name}`));
    console.log(chalk.dim(`  ID: ${deployment.id}`));
    console.log(
      chalk.cyan(
        `  Virtual Participant: ${deployment.config.virtualParticipant}`
      )
    );
    console.log(chalk.cyan(`  Environment: ${deployment.config.environment}`));
    console.log(chalk.cyan(`  Stack Name: ${deployment.config.stackName}`));
    console.log(
      chalk.cyan(`  AWS Profile: ${deployment.config.awsProfile ?? 'default'}`)
    );
    console.log(
      chalk.cyan(
        `  Public API: ${deployment.config.publicApi ? 'Enabled' : 'Disabled'}`
      )
    );

    if (deployment.lastDeployed) {
      const date = new Date(deployment.lastDeployed);

      console.log(chalk.green(`  Last Deployed: ${date.toLocaleString()}`));
    } else {
      console.log(chalk.yellow('  Last Deployed: Never'));
    }

    console.log(chalk.dim(`  Deploy Count: ${deployment.deployCount}`));
    console.log(
      chalk.dim(`  Created: ${new Date(deployment.createdAt).toLocaleString()}`)
    );
    console.log(chalk.dim('─'.repeat(80)));
  }

  console.log(chalk.dim(`\nTotal: ${deployments.length} configuration(s)\n`));
}
