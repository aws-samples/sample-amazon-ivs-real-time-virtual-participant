import { Stack } from 'aws-cdk-lib';
import crypto from 'crypto';

function createResourceName(
  stack: Stack,
  id: string,
  maxLength?: number,
  addUuid?: boolean
) {
  let name = `${stack.stackName}-${id}`;

  if (addUuid) {
    const fullUuid = crypto.randomUUID();
    const nameWithFullUuid = `${name}-${fullUuid}`;

    if (maxLength && nameWithFullUuid.length > maxLength) {
      // Calculate how much space we have for the UUID after base name and dashes
      const baseNameLength = name.length + 1; // +1 for the dash before UUID
      const availableUuidLength = maxLength - baseNameLength;

      if (availableUuidLength > 0) {
        // Use a shortened UUID that fits within constraints
        const shortenedUuid = fullUuid.substring(0, availableUuidLength);
        name = `${name}-${shortenedUuid}`;
      } else {
        // If even a minimal UUID won't fit, truncate stackName and keep id intact
        const minUuidLength = 8; // Minimum UUID length for reasonable uniqueness
        const requiredLength = id.length + minUuidLength + 2; // +2 for two dashes
        const maxStackNameLength = maxLength - requiredLength;

        if (maxStackNameLength > 0) {
          const truncatedStackName = stack.stackName.slice(
            0,
            maxStackNameLength
          );
          const shortUuid = fullUuid.substring(0, minUuidLength);
          name = `${truncatedStackName}-${id}-${shortUuid}`;
        } else {
          // If still can't fit, use minimal stackName and shortest possible UUID
          const shortUuid = fullUuid.substring(
            0,
            Math.max(4, maxLength - id.length - 3)
          );
          name = `${stack.stackName.slice(0, 1)}-${id}-${shortUuid}`;
        }
      }
    } else {
      name = nameWithFullUuid;
    }
  } else if (maxLength && name.length > maxLength) {
    const truncName = name.slice(0, maxLength - 5);
    const hash = crypto
      .createHash('shake256', { outputLength: 2 })
      .update(name)
      .digest('hex');

    name = [truncName, hash].join('-');
  }

  return name;
}

function createExportName(stack: Stack, id: string) {
  return `${stack.stackName}::${id}`;
}

function deepMerge(
  target: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  ...sources: Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
) {
  if (!sources.length) {
    return target;
  }

  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    Object.entries(source).forEach(([key, value]) => {
      if (isObject(value)) {
        if (!target[key]) {
          Object.assign(target, { [key]: {} });
        }

        deepMerge(target[key] as Record<string, unknown>, value);
      } else {
        Object.assign(target, { [key]: value });
      }
    });
  }

  return deepMerge(target, ...sources);
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export { capitalize, createExportName, createResourceName, deepMerge };
