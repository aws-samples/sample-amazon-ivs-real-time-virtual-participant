/* eslint-disable no-console */

/**
 * CDK deployment executor - integrates with Makefile
 */

import { spawn } from 'node:child_process';

import chalk from 'chalk';
import ora, { type Ora } from 'ora';

import type { DeploymentConfig } from '../types/deployment.types.js';

export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  error?: string;
}

/**
 * Execute deployment using Make
 */
export async function executeDeploy(
  config: DeploymentConfig,
  isFirstDeploy = false
): Promise<ExecutionResult> {
  console.log(chalk.cyan('\n🚀 Starting deployment...\n'));

  try {
    // Use 'app' target for first-time deployments (includes install + bootstrap + deploy)
    // Use 'deploy' target for subsequent deployments
    const command = isFirstDeploy ? 'app' : 'deploy';
    const result = await runMakeCommand(command, config);

    if (result.success) {
      console.log(chalk.green('\n✅ Deployment completed successfully!'));
    } else {
      console.log(chalk.red('\n❌ Deployment failed'));
    }

    return result;
  } catch (error) {
    console.log(chalk.red('\n❌ Deployment error'));

    return {
      success: false,
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Execute bootstrap using Make
 */
export async function executeBootstrap(
  config: DeploymentConfig
): Promise<ExecutionResult> {
  const spinner = ora('Bootstrapping CDK...').start();

  try {
    const result = await runMakeCommand('bootstrap', config, spinner);

    if (result.success) {
      spinner.succeed(chalk.green('✅ Bootstrap completed successfully!'));
    } else {
      spinner.fail(chalk.red('❌ Bootstrap failed'));
    }

    return result;
  } catch (error) {
    spinner.fail(chalk.red('❌ Bootstrap error'));

    return {
      success: false,
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Execute diff using Make
 */
export async function executeDiff(
  config: DeploymentConfig
): Promise<ExecutionResult> {
  console.log(chalk.cyan('\n🔍 Checking for changes...\n'));

  try {
    const result = await runMakeCommand('diff', config);

    return result;
  } catch (error) {
    return {
      success: false,
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Execute synth using Make
 */
export async function executeSynth(
  config: DeploymentConfig
): Promise<ExecutionResult> {
  const spinner = ora('Synthesizing CloudFormation template...').start();

  try {
    const result = await runMakeCommand('synth', config, spinner);

    if (result.success) {
      spinner.succeed(chalk.green('✅ Synthesis completed successfully!'));
    } else {
      spinner.fail(chalk.red('❌ Synthesis failed'));
    }

    return result;
  } catch (error) {
    spinner.fail(chalk.red('❌ Synthesis error'));

    return {
      success: false,
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Install dependencies for the selected virtual participant
 */
export async function executeInstall(
  config: DeploymentConfig
): Promise<ExecutionResult> {
  console.log(chalk.cyan('\n📦 Installing dependencies...\n'));

  try {
    const result = await runMakeCommand('install', config);

    if (result.success) {
      console.log(chalk.green('\n✅ Dependencies installed successfully!'));
    } else {
      console.log(chalk.red('\n❌ Installation failed'));
    }

    return result;
  } catch (error) {
    console.log(chalk.red('\n❌ Installation error'));

    return {
      success: false,
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Run a make command with the deployment configuration
 */
function runMakeCommand(
  command: string,
  config: DeploymentConfig,
  spinner?: Ora
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VP: config.virtualParticipant,
      ENV: config.environment,
      STACK: config.stackName,
      PUBLIC_API: config.publicApi.toString()
    };

    // Only add AWS_PROFILE if it's not the default
    if (config.awsProfile && config.awsProfile !== 'default') {
      env.AWS_PROFILE = config.awsProfile;
    }

    const makeProcess = spawn('make', [command], {
      env,
      stdio: spinner ? 'pipe' : 'inherit',
      shell: true
    });

    let stdout = '';
    let stderr = '';

    if (spinner && makeProcess.stdout) {
      makeProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Update spinner text with latest output line
        const lines = stdout.split('\n');
        const lastLine = lines[lines.length - 2] || lines[lines.length - 1];

        if (lastLine?.trim()) {
          spinner.text = lastLine.trim().substring(0, 80);
        }
      });
    }

    if (spinner && makeProcess.stderr) {
      makeProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    makeProcess.on('error', (error) => {
      resolve({
        success: false,
        exitCode: 1,
        error: error.message
      });
    });

    makeProcess.on('close', (code) => {
      const exitCode = code ?? 0;

      resolve({
        success: exitCode === 0,
        exitCode,
        error: exitCode !== 0 ? stderr || 'Command failed' : undefined
      });
    });
  });
}
