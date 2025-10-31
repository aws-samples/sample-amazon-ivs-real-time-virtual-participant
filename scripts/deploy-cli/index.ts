#!/usr/bin/env node

/**
 * Main CLI entry point for IVS Virtual Participant deployment tool
 */

import { Command } from 'commander';

import { deleteCommand } from './commands/delete.js';
import { deployCommand } from './commands/deploy.js';
import { listCommand } from './commands/list.js';
import { useCommand } from './commands/use.js';

const program = new Command();

program
  .name('deploy-cli')
  .description(
    'Interactive CLI tool for deploying IVS Virtual Participant stacks'
  )
  .version('1.0.0');

// Main deploy command (default)
program
  .command('deploy', { isDefault: true })
  .description('Interactive deployment wizard')
  .action(async () => {
    try {
      await deployCommand();
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Use saved configuration
program
  .command('use')
  .description('Deploy using a saved configuration')
  .action(async () => {
    try {
      await useCommand();
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// List saved configurations
program
  .command('list')
  .alias('ls')
  .description('List all saved deployment configurations')
  .action(() => {
    try {
      listCommand();
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Delete saved configuration
program
  .command('delete')
  .alias('rm')
  .description('Delete a saved deployment configuration')
  .action(async () => {
    try {
      await deleteCommand();
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);
