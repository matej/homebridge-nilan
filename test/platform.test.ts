import type { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockAccessoryHandler, handlers } = vi.hoisted(() => {
  const handlers: Array<{ shutdown: ReturnType<typeof vi.fn> }> = [];
  const MockAccessoryHandler = vi.fn(function MockAccessoryHandler() {
    const handler = { shutdown: vi.fn() };
    handlers.push(handler);
    return handler;
  });
  return { MockAccessoryHandler, handlers };
});

vi.mock('../src/compactPAccessory', () => ({
  CompactPPlatformAccessory: MockAccessoryHandler,
}));

import { NilanHomebridgePlatform } from '../src/platform';

class FakePlatformAccessory {
  public context: Record<string, unknown> = {};

  constructor(
    public readonly displayName: string,
    public readonly UUID: string,
  ) {}
}

function createHarness(devices?: unknown[]) {
  const listeners = new Map<string, () => void>();
  const api = {
    hap: {
      Characteristic: {},
      Service: {},
      uuid: {
        generate: vi.fn((host: string) => `uuid:${host}`),
      },
    },
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return api;
    }),
    platformAccessory: FakePlatformAccessory,
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
  };
  const log = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    prefix: 'test',
    success: vi.fn(),
    warn: vi.fn(),
  };
  const platform = new NilanHomebridgePlatform(
    log as unknown as Logger,
    { devices, name: 'Nilan', platform: 'Nilan' } as PlatformConfig,
    api as unknown as API,
  );
  return { api, listeners, log, platform };
}

beforeEach(() => {
  handlers.length = 0;
});

describe('NilanHomebridgePlatform discovery', () => {
  it('registers unique valid devices and skips malformed or duplicate entries', () => {
    const { api, log, platform } = createHarness([
      { name: 'Living room', host: '192.0.2.10' },
      { name: 'Duplicate', host: '192.0.2.10' },
      { name: 'Missing host' },
      { name: 'Utility room', host: '192.0.2.11' },
    ]);

    platform.discoverDevices();

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(2);
    expect(MockAccessoryHandler).toHaveBeenCalledTimes(2);
    expect(platform.accessories).toHaveLength(2);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('restores configured accessories and safely removes stale cache entries', () => {
    const { api, platform } = createHarness([
      { name: 'Configured', host: '192.0.2.10' },
    ]);
    const configured = new FakePlatformAccessory('Configured', 'uuid:192.0.2.10');
    configured.context.device = { host: '192.0.2.10' };
    const stale = new FakePlatformAccessory('Stale', 'uuid:192.0.2.99');

    platform.configureAccessory(configured as unknown as PlatformAccessory);
    platform.configureAccessory(stale as unknown as PlatformAccessory);
    expect(() => platform.discoverDevices()).not.toThrow();

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.updatePlatformAccessories).toHaveBeenCalledTimes(2);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-nilan',
      'Nilan',
      [stale],
    );
    expect(platform.accessories).toEqual([configured]);
  });

  it('does not register the same accessory again on repeated discovery', () => {
    const { api, platform } = createHarness([
      { name: 'Configured', host: '192.0.2.10' },
    ]);

    platform.discoverDevices();
    platform.discoverDevices();

    expect(api.registerPlatformAccessories).toHaveBeenCalledOnce();
    expect(api.updatePlatformAccessories).toHaveBeenCalledTimes(2);
    expect(MockAccessoryHandler).toHaveBeenCalledOnce();
  });

  it('shuts down every active accessory handler', () => {
    const { listeners, platform } = createHarness([
      { name: 'First', host: '192.0.2.10' },
      { name: 'Second', host: '192.0.2.11' },
    ]);
    platform.discoverDevices();

    listeners.get('shutdown')!();

    expect(handlers).toHaveLength(2);
    expect(handlers.every(handler => handler.shutdown.mock.calls.length === 1)).toBe(true);
  });

  it('warns when cached accessories cannot be activated without a device list', () => {
    const { api, log, platform } = createHarness();
    const cached = new FakePlatformAccessory('Cached', 'uuid:192.0.2.10');
    cached.context.device = { host: '192.0.2.10' };
    platform.configureAccessory(cached as unknown as PlatformAccessory);

    platform.discoverDevices();

    expect(log.warn).toHaveBeenCalledWith('No devices configured; cached accessories will remain inactive (count: 1).');
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(MockAccessoryHandler).not.toHaveBeenCalled();
  });
});
