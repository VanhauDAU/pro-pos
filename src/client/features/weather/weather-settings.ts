import { useCallback, useEffect, useState } from 'react';

export const POS_WEATHER_ENABLED_STORAGE_KEY = 'propos:pos:weather_enabled';
export const POS_WEATHER_CHANGE_EVENT = 'propos:weather:pos-display-changed';

/**
 * Checks whether weather widget is enabled on this POS device.
 * Defaults to true.
 */
export function getPosWeatherEnabled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true;
  }
  try {
    const saved = window.localStorage.getItem(POS_WEATHER_ENABLED_STORAGE_KEY);
    if (saved === null) return true;
    return saved === 'true';
  } catch {
    return true;
  }
}

/**
 * Updates weather widget display preference for POS device and notifies all listeners.
 */
export function setPosWeatherEnabled(enabled: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(POS_WEATHER_ENABLED_STORAGE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent<boolean>(POS_WEATHER_CHANGE_EVENT, { detail: enabled }));
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * React hook to read and toggle weather widget display state on POS device.
 * Automatically synchronizes across components, tabs, and windows.
 */
export function usePosWeatherDisplay(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(() => getPosWeatherEnabled());

  useEffect(() => {
    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      if (typeof customEvent.detail === 'boolean') {
        setEnabledState(customEvent.detail);
      } else {
        setEnabledState(getPosWeatherEnabled());
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === POS_WEATHER_ENABLED_STORAGE_KEY) {
        setEnabledState(e.newValue !== 'false');
      }
    };

    window.addEventListener(POS_WEATHER_CHANGE_EVENT, handleCustomChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener(POS_WEATHER_CHANGE_EVENT, handleCustomChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setPosWeatherEnabled(nextEnabled);
    setEnabledState(nextEnabled);
  }, []);

  return [enabled, setEnabled];
}
