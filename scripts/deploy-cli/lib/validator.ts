/**
 * Input validation functions for deployment configuration
 */

import type {
  EnvironmentType,
  VirtualParticipantType
} from '../types/deployment.types.js';

/**
 * Validate virtual participant type
 */
export function isValidVirtualParticipant(
  value: string
): value is VirtualParticipantType {
  return value === 'asset-publisher' || value === 'gpt-realtime';
}

/**
 * Validate environment type
 */
export function isValidEnvironment(value: string): value is EnvironmentType {
  return value === 'dev' || value === 'prod';
}

/**
 * Validate stack name format
 */
export function validateStackName(name: string): true | string {
  if (!name || name.trim().length === 0) {
    return 'Stack name cannot be empty';
  }

  if (name.length > 128) {
    return 'Stack name cannot exceed 128 characters';
  }

  // Stack names can only contain alphanumeric characters and hyphens
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
    return 'Stack name must start with a letter and contain only alphanumeric characters and hyphens';
  }

  return true;
}

/**
 * Validate configuration name for saving
 */
export function validateConfigName(name: string): true | string {
  if (!name || name.trim().length === 0) {
    return 'Configuration name cannot be empty';
  }

  if (name.length > 64) {
    return 'Configuration name cannot exceed 64 characters';
  }

  return true;
}

/**
 * Generate default stack name based on environment
 */
export function getDefaultStackName(environment: EnvironmentType): string {
  return `IVSVirtualParticipant-${environment}`;
}

/**
 * Generate configuration ID from config values
 */
export function generateConfigId(
  vp: VirtualParticipantType,
  env: EnvironmentType
): string {
  return `${env}-${vp}`;
}
