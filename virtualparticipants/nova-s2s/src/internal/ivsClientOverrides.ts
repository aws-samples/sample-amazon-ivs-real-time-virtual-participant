// Extend Window interface to include our custom property
declare global {
  interface Window {
    [GLOBAL_OVERRIDE_KEY: string]: Record<string, unknown> | undefined;
    IVS_CLIENT_OVERRIDES?: Record<string, unknown>;
  }
}

type OverrideConfig = NonNullable<typeof window.IVS_CLIENT_OVERRIDES>;
type OverrideKey = keyof OverrideConfig;

const GLOBAL_OVERRIDE_KEY = 'IVS_CLIENT_OVERRIDES';

function getClientOverrideConfig() {
  return window[GLOBAL_OVERRIDE_KEY] ?? {};
}

function getClientOverrideValue<T extends OverrideKey>(key: T) {
  return getClientOverrideConfig()[key];
}

function setClientOverrideValue<T extends OverrideKey>(
  key: T,
  value: OverrideConfig[T]
) {
  window[GLOBAL_OVERRIDE_KEY] = { ...getClientOverrideConfig(), [key]: value };
}

function unsetClientOverrideValue<T extends OverrideKey>(key: T) {
  const overrideConfig = getClientOverrideConfig();
  delete overrideConfig[key];

  if (!Object.keys(overrideConfig).length) {
    delete window.IVS_CLIENT_OVERRIDES;
  }
}

export {
  getClientOverrideValue,
  setClientOverrideValue,
  unsetClientOverrideValue
};
