/* eslint-disable no-console */

/**
 * Delete command - delete a saved deployment configuration
 */

import chalk from 'chalk';

import { ConfigStore } from '../lib/config-store.js';
import { promptDeleteConfig } from '../lib/prompts.js';

export async function deleteCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n🗑️  Delete Saved Configuration\n'));

  const configStore = new ConfigStore();
  const deployments = configStore.listDeployments();

  if (deployments.length === 0) {
    console.log(chalk.yellow('No saved configurations to delete.\n'));

    return;
  }

  // Select configuration to delete
  const configIdToDelete = await promptDeleteConfig(deployments);

  if (!configIdToDelete) {
    console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));

    return;
  }

  const deleted = configStore.deleteDeployment(configIdToDelete);

  if (deleted) {
    console.log(chalk.green('\n✅ Configuration deleted successfully!\n'));
  } else {
    console.error(chalk.red('\n❌ Failed to delete configuration\n'));
    process.exit(1);
  }
}
