import { Stack } from 'aws-cdk-lib';
import crypto from 'crypto';

function createResourceName(stack: Stack, id: string, maxLength?: number) {
  let name = `${stack.stackName}-${id}`;

  if (maxLength && name.length > maxLength) {
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
