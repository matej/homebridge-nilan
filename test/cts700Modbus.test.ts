import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OperationMode, PauseOption, Register, SystemWorkingMode, VentilationMode } from '../src/cts700Data';
import { CTS700Modbus } from '../src/cts700Modbus';

const { MockModbusRTU, client } = vi.hoisted(() => {
  const client = {
    close: vi.fn((callback?: () => void) => callback?.()),
    connectTCP: vi.fn<() => Promise<void>>(),
    isOpen: true,
    readHoldingRegisters: vi.fn(),
    setID: vi.fn(),
    setTimeout: vi.fn(),
    writeRegister: vi.fn(),
  };

  return {
    client,
    MockModbusRTU: vi.fn(function MockModbusRTU() {
      return client;
    }),
  };
});

vi.mock('modbus-serial', () => ({
  default: MockModbusRTU,
}));

function registerResult(values: number[]) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16BE(value, index * 2));
  return { data: values, buffer };
}

function scheduleResult(records: Array<{
  weekDay: number;
  hour: number;
  minute: number;
  temperature: number;
  dhwTemperature: number;
  flags: number;
  fanSpeed: number;
}>) {
  const buffer = Buffer.alloc(140);
  records.forEach((record, index) => {
    const offset = index * 10;
    buffer.writeUInt8(record.weekDay, offset);
    buffer.writeUInt8(record.hour, offset + 1);
    buffer.writeUInt8(record.minute, offset + 2);
    buffer.writeInt16BE(record.temperature * 10, offset + 3);
    buffer.writeInt16BE(record.dhwTemperature * 10, offset + 5);
    buffer.writeUInt8(record.flags, offset + 7);
    buffer.writeUInt16BE(record.fanSpeed, offset + 8);
  });
  return { data: new Array(70).fill(0), buffer };
}

async function createModbus() {
  const didConnect = vi.fn();
  const modbus = new CTS700Modbus('192.0.2.1', didConnect);
  await vi.waitFor(() => expect(didConnect).toHaveBeenCalledOnce());
  return modbus;
}

beforeEach(() => {
  client.connectTCP.mockResolvedValue(undefined);
  client.readHoldingRegisters.mockReset();
  client.writeRegister.mockReset();
  client.writeRegister.mockImplementation(async (address: number, value: number) => ({ address, value }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CTS700Modbus connection', () => {
  it('connects with the CTS700 TCP defaults', async () => {
    await createModbus();

    expect(MockModbusRTU).toHaveBeenCalled();
    expect(client.connectTCP).toHaveBeenCalledWith('192.0.2.1', { port: 502 });
    expect(client.setID).toHaveBeenCalledWith(1);
    expect(client.setTimeout).toHaveBeenCalledWith(5000);
  });

  it('reconnects after network errors and recognizes the Node error code', async () => {
    const modbus = await createModbus();
    vi.useFakeTimers();
    const error = Object.assign(new Error('socket failure'), { code: 'ECONNRESET' });
    client.readHoldingRegisters.mockRejectedValue(error);

    await expect(modbus.fetchReadings()).rejects.toBe(error);
    expect(client.close).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10000);
    expect(client.connectTCP).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('cancels pending reconnects when closed', async () => {
    const modbus = await createModbus();
    vi.useFakeTimers();
    const error = Object.assign(new Error('socket failure'), { code: 'ETIMEDOUT' });
    client.readHoldingRegisters.mockRejectedValue(error);

    await expect(modbus.fetchReadings()).rejects.toBe(error);
    modbus.close();
    await vi.advanceTimersByTimeAsync(10000);

    expect(client.connectTCP).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('CTS700Modbus reads', () => {
  it('decodes metadata', async () => {
    const modbus = await createModbus();
    client.readHoldingRegisters.mockImplementation(async (address: number) => {
      if (address === Register.MacAddress) {
        return registerResult([0x0011, 0x2233, 0x4455, 0, 0, 0, 0, 0]);
      }
      return registerResult([0x0102, 0x0304]);
    });

    await expect(modbus.fetchMetadata()).resolves.toEqual({
      macAddress: '00:11:22:33:44:55',
      softwareVersion: '4.515.1',
    });
  });

  it('decodes sensor readings, including signed temperatures', async () => {
    const modbus = await createModbus();
    client.readHoldingRegisters.mockImplementation(async (address: number) => {
      const values = new Map<number, number>([
        [Register.MasterSensorTemperature, 215],
        [Register.OutdoorTemperature, 0xffc9],
        [Register.PanelTemperature, 203],
        [Register.ActualHumidity, 48],
        [Register.InletFilterReplacementInterval, 90],
        [Register.InletFilterElapsedDays, 59],
        [Register.OutletFilterReplacementInterval, 90],
        [Register.OutletFilterElapsedDays, 90],
        [Register.DHWTopTankTemperature, 521],
      ]);
      if (address === Register.CurrentTime) {
        return registerResult([0x1e2d, 0x0e10, 0x0708, 0x1a00]);
      }
      return registerResult([values.get(address)!]);
    });

    await expect(modbus.fetchReadings()).resolves.toEqual({
      roomTemperature: 21.5,
      outdoorTemperature: -5.5,
      panelTemperature: 20.3,
      actualHumidity: 48,
      inletFilterReplacementInterval: 90,
      inletFilterElapsedDays: 59,
      outletFilterReplacementInterval: 90,
      outletFilterElapsedDays: 90,
      dhwTankTopTemperature: 52.1,
      currentDateTime: {
        second: 30,
        minute: 45,
        hour: 14,
        day: 16,
        weekDay: 7,
        month: 8,
        year: 26,
      },
    });
  });

  it('validates and decodes settings', async () => {
    const modbus = await createModbus();
    const values = new Map<number, number>([
      [Register.SystemWorkingMode, SystemWorkingMode.Manual],
      [Register.Pause, PauseOption.DHW],
      [Register.FanSpeed, 60],
      [Register.RoomTemperatureSetPoint, 225],
      [Register.DHWTemperatureSetPoint, 500],
      [Register.VentilationMode, VentilationMode.Heating],
      [Register.OperationMode, OperationMode.Heating],
    ]);
    client.readHoldingRegisters.mockImplementation(async (address: number) => registerResult([values.get(address)!]));

    await expect(modbus.fetchSettings()).resolves.toEqual({
      systemWorkingMode: SystemWorkingMode.Manual,
      paused: PauseOption.DHW,
      fanSpeed: 60,
      roomTemperatureSetPoint: 22.5,
      dhwTemperatureSetPoint: 50,
      ventilationMode: VentilationMode.Heating,
      operationMode: OperationMode.Heating,
    });
  });

  it('rejects an invalid device percentage', async () => {
    const modbus = await createModbus();
    const values = new Map<number, number>([
      [Register.Pause, PauseOption.Disabled],
      [Register.FanSpeed, 101],
    ]);
    client.readHoldingRegisters.mockImplementation(async (address: number) => registerResult([values.get(address)!]));

    await expect(modbus.fetchSettings()).rejects.toThrow('Value outside of acceptable range.');
  });

  it('selects the latest active week-program record', async () => {
    const modbus = await createModbus();
    client.readHoldingRegisters.mockResolvedValue(scheduleResult([
      { weekDay: 1, hour: 8, minute: 0, temperature: 20, dhwTemperature: 48, flags: 0, fanSpeed: 40 },
      { weekDay: 1, hour: 18, minute: 0, temperature: 22, dhwTemperature: 52, flags: 0, fanSpeed: 60 },
      { weekDay: 5, hour: 9, minute: 30, temperature: 21, dhwTemperature: 50, flags: 0, fanSpeed: 50 },
    ]));

    await expect(modbus.fetchActiveWeekProgramForDateTime({
      second: 0,
      minute: 0,
      hour: 12,
      day: 1,
      weekDay: 2,
      month: 1,
      year: 26,
    })).resolves.toMatchObject({ weekDay: 1, hour: 18, fanSpeed: 60 });
  });

  it('wraps week-program selection to the final record', async () => {
    const modbus = await createModbus();
    client.readHoldingRegisters.mockResolvedValue(scheduleResult([
      { weekDay: 2, hour: 8, minute: 0, temperature: 20, dhwTemperature: 48, flags: 0, fanSpeed: 40 },
      { weekDay: 6, hour: 18, minute: 0, temperature: 22, dhwTemperature: 52, flags: 0, fanSpeed: 60 },
    ]));

    await expect(modbus.fetchActiveWeekProgramForDateTime({
      second: 0,
      minute: 0,
      hour: 6,
      day: 1,
      weekDay: 1,
      month: 1,
      year: 26,
    })).resolves.toMatchObject({ weekDay: 6, hour: 18, fanSpeed: 60 });
  });

  it('returns null for an empty week program', async () => {
    const modbus = await createModbus();
    client.readHoldingRegisters.mockResolvedValue(scheduleResult([]));

    await expect(modbus.fetchActiveWeekProgramForDateTime({
      second: 0,
      minute: 0,
      hour: 6,
      day: 1,
      weekDay: 1,
      month: 1,
      year: 26,
    })).resolves.toBeNull();
  });

  it('reads and selects records from the second half of a full week program', async () => {
    const modbus = await createModbus();
    const firstHalf = Array.from({ length: 14 }, (_, hour) => ({
      weekDay: 1,
      hour,
      minute: 0,
      temperature: 20,
      dhwTemperature: 48,
      flags: 0,
      fanSpeed: 40,
    }));
    client.readHoldingRegisters.mockImplementation(async (address: number) => {
      if (address === Register.FirstWeekProgram) {
        return scheduleResult(firstHalf);
      }
      return scheduleResult([
        { weekDay: 7, hour: 23, minute: 0, temperature: 22, dhwTemperature: 52, flags: 0, fanSpeed: 70 },
      ]);
    });

    await expect(modbus.fetchActiveWeekProgramForDateTime({
      second: 0,
      minute: 30,
      hour: 23,
      day: 1,
      weekDay: 7,
      month: 1,
      year: 26,
    })).resolves.toMatchObject({ weekDay: 7, hour: 23, fanSpeed: 70 });
    expect(client.readHoldingRegisters).toHaveBeenCalledWith(Register.SecondWeekProgram, 70);
  });

  it('reads and selects records from the third segment of a full week program', async () => {
    const modbus = await createModbus();
    const fullSegment = Array.from({ length: 14 }, (_, hour) => ({
      weekDay: 1,
      hour,
      minute: 0,
      temperature: 20,
      dhwTemperature: 48,
      flags: 0,
      fanSpeed: 40,
    }));
    client.readHoldingRegisters.mockImplementation(async (address: number) => {
      if (address === Register.ThirdWeekProgram) {
        return scheduleResult([
          { weekDay: 7, hour: 23, minute: 0, temperature: 22, dhwTemperature: 52, flags: 0, fanSpeed: 70 },
        ]);
      }
      return scheduleResult(fullSegment);
    });

    await expect(modbus.fetchActiveWeekProgramForDateTime({
      second: 0,
      minute: 30,
      hour: 23,
      day: 1,
      weekDay: 7,
      month: 1,
      year: 26,
    })).resolves.toMatchObject({ weekDay: 7, hour: 23, fanSpeed: 70 });
    expect(client.readHoldingRegisters).toHaveBeenCalledWith(Register.ThirdWeekProgram, 70);
  });

  it('rejects reads while disconnected', async () => {
    const modbus = await createModbus();
    (modbus as unknown as { client: null }).client = null;

    await expect(modbus.fetchSettings()).rejects.toThrow('Disconnected.');
  });
});

describe('CTS700Modbus writes', () => {
  it('encodes supported values for Modbus registers', async () => {
    const modbus = await createModbus();

    await expect(modbus.writeFanSpeed(55.9)).resolves.toBe(55);
    await expect(modbus.writeRoomTemperatureSetPoint(21.5)).resolves.toBe(215);
    await expect(modbus.writeDHWSetPoint(52)).resolves.toBe(520);
    await expect(modbus.resetInletFilter()).resolves.toBe(1);
    await expect(modbus.resetOutletFilter()).resolves.toBe(1);
    await expect(modbus.writePauseOption(PauseOption.All)).resolves.toBe(PauseOption.All);
    await expect(modbus.writeVentilationMode(VentilationMode.Cooling)).resolves.toBe(VentilationMode.Cooling);

    expect(client.writeRegister.mock.calls).toEqual([
      [Register.FanSpeed, 55],
      [Register.RoomTemperatureSetPoint, 215],
      [Register.DHWTemperatureSetPoint, 520],
      [Register.InletFilterReset, 1],
      [Register.OutletFilterReset, 1],
      [Register.Pause, PauseOption.All],
      [Register.VentilationMode, VentilationMode.Cooling],
    ]);
  });

  it.each([
    ['fan speed', () => createModbus().then((modbus) => modbus.writeFanSpeed(101))],
    ['room temperature', () => createModbus().then((modbus) => modbus.writeRoomTemperatureSetPoint(4.5))],
    ['low DHW temperature', () => createModbus().then((modbus) => modbus.writeDHWSetPoint(9.5))],
    ['high DHW temperature', () => createModbus().then((modbus) => modbus.writeDHWSetPoint(66))],
    ['pause option', () => createModbus().then((modbus) => modbus.writePauseOption(99 as PauseOption))],
    ['ventilation mode', () => createModbus().then((modbus) => modbus.writeVentilationMode(99 as VentilationMode))],
  ])('rejects an invalid %s', async (_name, operation) => {
    await expect(operation()).rejects.toThrow();
  });

  it('rejects a write when the device echoes a different value', async () => {
    const modbus = await createModbus();
    client.writeRegister.mockResolvedValue({ address: Register.FanSpeed, value: 20 });

    await expect(modbus.writeFanSpeed(50)).rejects.toThrow('Setting value failed.');
  });

  it('preserves the DHW pause bit when changing ventilation pause', async () => {
    const modbus = await createModbus();
    client.readHoldingRegisters.mockResolvedValueOnce(registerResult([PauseOption.DHW]));

    await expect(modbus.writeVentilationPaused(true)).resolves.toBe(PauseOption.All);
    expect(client.writeRegister).toHaveBeenLastCalledWith(Register.Pause, PauseOption.All);

    client.readHoldingRegisters.mockResolvedValueOnce(registerResult([PauseOption.All]));
    await expect(modbus.writeVentilationPaused(false)).resolves.toBe(PauseOption.DHW);
    expect(client.writeRegister).toHaveBeenLastCalledWith(Register.Pause, PauseOption.DHW);
  });

  it('preserves the ventilation pause bit when changing DHW pause', async () => {
    const modbus = await createModbus();
    client.readHoldingRegisters.mockResolvedValueOnce(registerResult([PauseOption.Ventilation]));

    await expect(modbus.writeDHWPaused(true)).resolves.toBe(PauseOption.All);
    expect(client.writeRegister).toHaveBeenLastCalledWith(Register.Pause, PauseOption.All);

    client.readHoldingRegisters.mockResolvedValueOnce(registerResult([PauseOption.All]));
    await expect(modbus.writeDHWPaused(false)).resolves.toBe(PauseOption.Ventilation);
    expect(client.writeRegister).toHaveBeenLastCalledWith(Register.Pause, PauseOption.Ventilation);
  });
});
