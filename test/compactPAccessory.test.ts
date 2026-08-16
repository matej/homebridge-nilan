import type { CharacteristicSetCallback, CharacteristicValue, PlatformAccessory } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OperationMode, PauseOption, SystemWorkingMode, VentilationMode } from '../src/cts700Data';
import type { CTS700Modbus } from '../src/cts700Modbus';

vi.mock('homebridge', () => ({
  CharacteristicEventTypes: { SET: 'set' },
}));

import { CompactPPlatformAccessory } from '../src/compactPAccessory';
import type { NilanHomebridgePlatform } from '../src/platform';

type SetHandler = (value: CharacteristicValue, callback: CharacteristicSetCallback) => void;

class FakeCharacteristic {
  public setHandler?: SetHandler;
  public props?: Record<string, number>;

  setProps(props: Record<string, number>): this {
    this.props = props;
    return this;
  }

  on(_event: string, handler: SetHandler): this {
    this.setHandler = handler;
    return this;
  }
}

class FakeService {
  public readonly characteristics = new Map<unknown, FakeCharacteristic>();
  public readonly updates: Array<[unknown, unknown]> = [];

  getCharacteristic(characteristic: unknown): FakeCharacteristic {
    const existing = this.characteristics.get(characteristic);
    if (existing) {
      return existing;
    }
    const created = new FakeCharacteristic();
    this.characteristics.set(characteristic, created);
    return created;
  }

  setCharacteristic(characteristic: unknown, value: unknown): this {
    this.updates.push([characteristic, value]);
    return this;
  }

  updateCharacteristic(characteristic: unknown, value: unknown): this {
    this.updates.push([characteristic, value]);
    return this;
  }
}

function createHarness(schedule = false) {
  const Characteristic = {
    Active: Object.assign(Symbol('Active'), { ACTIVE: 1, INACTIVE: 0 }),
    CurrentHeatingCoolingState: Object.assign(Symbol('CurrentHeatingCoolingState'), { COOL: 2, HEAT: 1, OFF: 0 }),
    CurrentRelativeHumidity: Symbol('CurrentRelativeHumidity'),
    CurrentTemperature: Symbol('CurrentTemperature'),
    FirmwareRevision: Symbol('FirmwareRevision'),
    FilterChangeIndication: Object.assign(Symbol('FilterChangeIndication'), { CHANGE_FILTER: 1, FILTER_OK: 0 }),
    FilterLifeLevel: Symbol('FilterLifeLevel'),
    Manufacturer: Symbol('Manufacturer'),
    Model: Symbol('Model'),
    RotationSpeed: Symbol('RotationSpeed'),
    ResetFilterIndication: Symbol('ResetFilterIndication'),
    SerialNumber: Symbol('SerialNumber'),
    TargetHeatingCoolingState: Object.assign(Symbol('TargetHeatingCoolingState'), { AUTO: 3, COOL: 2, HEAT: 1, OFF: 0 }),
    TargetTemperature: Symbol('TargetTemperature'),
    TemperatureDisplayUnits: Object.assign(Symbol('TemperatureDisplayUnits'), { CELSIUS: 0 }),
  };
  const ServiceTypes = {
    AccessoryInformation: Symbol('AccessoryInformation'),
    Fanv2: Symbol('Fanv2'),
    FilterMaintenance: Symbol('FilterMaintenance'),
    TemperatureSensor: Symbol('TemperatureSensor'),
    Thermostat: Symbol('Thermostat'),
  };
  const informationService = new FakeService();
  const services = new Map<string, FakeService>();
  const accessory = {
    addService: vi.fn((_type: unknown, _name: string, subtype: string) => {
      const service = new FakeService();
      services.set(subtype, service);
      return service;
    }),
    context: { device: { host: '192.0.2.1', schedule } },
    getService: vi.fn(() => informationService),
    getServiceById: vi.fn((_type: unknown, subtype: string) => services.get(subtype)),
  };
  const platform = {
    Characteristic,
    Service: ServiceTypes,
    log: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
  const modbus = {
    close: vi.fn(),
    fetchActiveWeekProgramForDateTime: vi.fn(),
    fetchMetadata: vi.fn().mockResolvedValue({ macAddress: '00:11:22:33:44:55', softwareVersion: '1.2.3' }),
    fetchReadings: vi.fn().mockResolvedValue({
      actualHumidity: 48,
      inletFilterDeterioration: 25,
      outletFilterDeterioration: 100,
      currentDateTime: { second: 1, minute: 2, hour: 3, day: 4, weekDay: 5, month: 6, year: 26 },
      dhwTankTopTemperature: 51,
      outdoorTemperature: -5,
      panelTemperature: 20,
      roomTemperature: 21,
    }),
    fetchSettings: vi.fn().mockResolvedValue({
      dhwTemperatureSetPoint: 50,
      fanSpeed: 60,
      operationMode: OperationMode.Heating,
      paused: PauseOption.Disabled,
      roomTemperatureSetPoint: 22,
      systemWorkingMode: SystemWorkingMode.Manual,
      ventilationMode: VentilationMode.Auto,
    }),
    writeDHWPaused: vi.fn().mockResolvedValue(PauseOption.Disabled),
    writeDHWSetPoint: vi.fn().mockResolvedValue(50),
    writeFanSpeed: vi.fn().mockResolvedValue(60),
    resetInletFilter: vi.fn().mockResolvedValue(1),
    resetOutletFilter: vi.fn().mockResolvedValue(1),
    writeRoomTemperatureSetPoint: vi.fn().mockResolvedValue(22),
    writeVentilationMode: vi.fn().mockResolvedValue(VentilationMode.Auto),
    writeVentilationPaused: vi.fn().mockResolvedValue(PauseOption.Disabled),
  };
  let didConnect: (() => void) | undefined;
  const handler = new CompactPPlatformAccessory(
    platform as unknown as NilanHomebridgePlatform,
    accessory as unknown as PlatformAccessory,
    (_host, callback) => {
      didConnect = callback;
      return modbus as unknown as CTS700Modbus;
    },
  );

  return { accessory, Characteristic, didConnect: () => didConnect?.(), handler, informationService, modbus, platform, services };
}

async function invokeSet(service: FakeService, characteristic: unknown, value: CharacteristicValue) {
  const callback = vi.fn();
  service.getCharacteristic(characteristic).setHandler!(value, callback);
  await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CompactPPlatformAccessory', () => {
  it('loads metadata after Modbus connects', async () => {
    const { Characteristic, didConnect, informationService } = createHarness();

    didConnect();
    await vi.waitFor(() => expect(informationService.updates).toContainEqual([Characteristic.SerialNumber, '00:11:22:33:44:55']));
    expect(informationService.updates).toContainEqual([Characteristic.FirmwareRevision, '1.2.3']);
  });

  it('routes HomeKit writes through component-preserving pause operations', async () => {
    const { Characteristic, modbus, services } = createHarness();

    await invokeSet(services.get('compact-p-fan')!, Characteristic.Active, Characteristic.Active.INACTIVE);
    await invokeSet(services.get('compact-p-dhw')!, Characteristic.TargetHeatingCoolingState,
      Characteristic.TargetHeatingCoolingState.OFF);
    await invokeSet(services.get('compact-p-temperature')!, Characteristic.TargetHeatingCoolingState,
      Characteristic.TargetHeatingCoolingState.HEAT);

    expect(modbus.writeVentilationPaused).toHaveBeenNthCalledWith(1, true);
    expect(modbus.writeDHWPaused).toHaveBeenCalledWith(true);
    expect(modbus.writeVentilationPaused).toHaveBeenLastCalledWith(false);
    expect(modbus.writeVentilationMode).toHaveBeenCalledWith(VentilationMode.Heating);
  });

  it('uses the controller-supported DHW temperature range', () => {
    const { Characteristic, services } = createHarness();

    expect(services.get('compact-p-dhw')!.getCharacteristic(Characteristic.TargetTemperature).props).toMatchObject({
      minValue: 10,
      maxValue: 65,
    });
  });

  it('polls readings and settings into HomeKit services', async () => {
    const { Characteristic, modbus, services } = createHarness();

    await vi.advanceTimersByTimeAsync(10000);

    expect(modbus.fetchReadings).toHaveBeenCalledOnce();
    expect(modbus.fetchSettings).toHaveBeenCalledOnce();
    expect(services.get('compact-p-temperature')!.updates).toContainEqual([Characteristic.CurrentTemperature, 21]);
    expect(services.get('compact-p-fan')!.updates).toContainEqual([Characteristic.RotationSpeed, 60]);
    expect(services.get('compact-p-dhw')!.updates).toContainEqual([Characteristic.TargetTemperature, 50]);
    expect(services.get('compact-p-inlet-filter')!.updates).toContainEqual([Characteristic.FilterLifeLevel, 75]);
    expect(services.get('compact-p-inlet-filter')!.updates).toContainEqual([
      Characteristic.FilterChangeIndication,
      Characteristic.FilterChangeIndication.FILTER_OK,
    ]);
    expect(services.get('compact-p-outlet-filter')!.updates).toContainEqual([Characteristic.FilterLifeLevel, 0]);
    expect(services.get('compact-p-outlet-filter')!.updates).toContainEqual([
      Characteristic.FilterChangeIndication,
      Characteristic.FilterChangeIndication.CHANGE_FILTER,
    ]);
  });

  it('reads automatic targets from the week schedule without writing them to user registers', async () => {
    const { Characteristic, modbus, services } = createHarness(true);
    modbus.fetchSettings.mockResolvedValue({
      dhwTemperatureSetPoint: 50,
      fanSpeed: 60,
      operationMode: OperationMode.Heating,
      paused: PauseOption.Disabled,
      roomTemperatureSetPoint: 22,
      systemWorkingMode: SystemWorkingMode.Auto,
      ventilationMode: VentilationMode.Auto,
    });
    modbus.fetchActiveWeekProgramForDateTime.mockResolvedValue({
      dhwTemperature: 48,
      fanSpeed: 40,
      flags: 0,
      hour: 3,
      minute: 0,
      temperature: 20,
      weekDay: 5,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(modbus.fetchActiveWeekProgramForDateTime).toHaveBeenCalledOnce();
    expect(services.get('compact-p-fan')!.updates).toContainEqual([Characteristic.RotationSpeed, 40]);
    expect(services.get('compact-p-temperature')!.updates).toContainEqual([Characteristic.TargetTemperature, 20]);
    expect(services.get('compact-p-dhw')!.updates).toContainEqual([Characteristic.TargetTemperature, 48]);
    expect(modbus.writeFanSpeed).not.toHaveBeenCalled();
    expect(modbus.writeRoomTemperatureSetPoint).not.toHaveBeenCalled();
    expect(modbus.writeDHWSetPoint).not.toHaveBeenCalled();
  });

  it('uses user targets and skips the schedule outside automatic working mode', async () => {
    const { Characteristic, modbus, services } = createHarness(true);

    await vi.advanceTimersByTimeAsync(10000);

    expect(modbus.fetchActiveWeekProgramForDateTime).not.toHaveBeenCalled();
    expect(services.get('compact-p-fan')!.updates).toContainEqual([Characteristic.RotationSpeed, 60]);
    expect(services.get('compact-p-temperature')!.updates).toContainEqual([Characteristic.TargetTemperature, 22]);
    expect(services.get('compact-p-dhw')!.updates).toContainEqual([Characteristic.TargetTemperature, 50]);
  });

  it('resets inlet and outlet filter counters from HomeKit', async () => {
    const { Characteristic, modbus, services } = createHarness();

    await invokeSet(services.get('compact-p-inlet-filter')!, Characteristic.ResetFilterIndication, 0);
    await invokeSet(services.get('compact-p-inlet-filter')!, Characteristic.ResetFilterIndication, 1);
    await invokeSet(services.get('compact-p-outlet-filter')!, Characteristic.ResetFilterIndication, 1);

    expect(modbus.resetInletFilter).toHaveBeenCalledOnce();
    expect(modbus.resetOutletFilter).toHaveBeenCalledOnce();
  });

  it('does not overlap slow polling cycles', async () => {
    const { modbus } = createHarness();
    let resolveReadings: ((value: unknown) => void) | undefined;
    modbus.fetchReadings.mockImplementationOnce(() => new Promise(resolve => {
      resolveReadings = resolve;
    }));

    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(modbus.fetchReadings).toHaveBeenCalledOnce();

    resolveReadings!({
      actualHumidity: 48,
      inletFilterDeterioration: 25,
      outletFilterDeterioration: 100,
      currentDateTime: { second: 1, minute: 2, hour: 3, day: 4, weekDay: 5, month: 6, year: 26 },
      dhwTankTopTemperature: 51,
      outdoorTemperature: -5,
      panelTemperature: 20,
      roomTemperature: 21,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(modbus.fetchReadings).toHaveBeenCalledTimes(2);
  });

  it('cleans up polling and Modbus state on shutdown', async () => {
    const { handler, modbus } = createHarness();

    handler.shutdown();
    await vi.advanceTimersByTimeAsync(20000);

    expect(modbus.close).toHaveBeenCalledOnce();
    expect(modbus.fetchReadings).not.toHaveBeenCalled();
  });
});
