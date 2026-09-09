import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPosWeatherEnabled,
  setPosWeatherEnabled,
  POS_WEATHER_CHANGE_EVENT,
  POS_WEATHER_ENABLED_STORAGE_KEY,
} from '@client/features/weather/weather-settings';

describe('weather-settings', () => {
  let store: Record<string, string> = {};
  const eventTarget = new EventTarget();

  beforeEach(() => {
    store = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };

    (globalThis as any).window = {
      localStorage: mockLocalStorage,
      dispatchEvent: (event: Event) => eventTarget.dispatchEvent(event),
      addEventListener: (type: string, listener: EventListener) =>
        eventTarget.addEventListener(type, listener),
      removeEventListener: (type: string, listener: EventListener) =>
        eventTarget.removeEventListener(type, listener),
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('defaults to true when nothing is in localStorage', () => {
    expect(getPosWeatherEnabled()).toBe(true);
  });

  it('saves false and dispatches custom event when disabled', () => {
    const listener = vi.fn();
    (globalThis as any).window.addEventListener(POS_WEATHER_CHANGE_EVENT, listener);

    setPosWeatherEnabled(false);

    expect(store[POS_WEATHER_ENABLED_STORAGE_KEY]).toBe('false');
    expect(getPosWeatherEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent<boolean>;
    expect(event.detail).toBe(false);

    (globalThis as any).window.removeEventListener(POS_WEATHER_CHANGE_EVENT, listener);
  });

  it('saves true and dispatches custom event when re-enabled', () => {
    setPosWeatherEnabled(false);
    expect(getPosWeatherEnabled()).toBe(false);

    const listener = vi.fn();
    (globalThis as any).window.addEventListener(POS_WEATHER_CHANGE_EVENT, listener);

    setPosWeatherEnabled(true);

    expect(store[POS_WEATHER_ENABLED_STORAGE_KEY]).toBe('true');
    expect(getPosWeatherEnabled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent<boolean>;
    expect(event.detail).toBe(true);

    (globalThis as any).window.removeEventListener(POS_WEATHER_CHANGE_EVENT, listener);
  });
});
