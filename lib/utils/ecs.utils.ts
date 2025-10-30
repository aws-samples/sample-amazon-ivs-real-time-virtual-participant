/**
 * Extracts environment variables prefixed with `ECS_` from process.env.
 * These variables are intended to be forwarded to ECS containers.
 *
 * @returns An object containing all ECS_* prefixed environment variables
 *
 * @example
 * // In .env file:
 * // ECS_OPENAI_API_KEY=sk-proj-...
 * // ECS_CUSTOM_VAR=value
 *
 * const ecsEnvVars = extractEcsEnvVars();
 * // Returns: { ECS_OPENAI_API_KEY: 'sk-proj-...', ECS_CUSTOM_VAR: 'value' }
 */
export function extractEcsEnvVars(): Record<string, string> {
  return Object.keys(process.env)
    .filter((key) => key.startsWith('ECS_'))
    .reduce(
      (acc, key) => {
        acc[key] = process.env[key]!;

        return acc;
      },
      {} as Record<string, string>
    );
}
