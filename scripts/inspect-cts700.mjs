/* global process, setTimeout */

import ModbusRTU from 'modbus-serial';

const registers = Object.freeze({
  systemWorkingMode: 1047,
  inletFanControl: 4699,
  outletFanControl: 4700,
  currentTime: 4722,
  roomTemperatureSetPoint: 4746,
  fanSpeed: 4747,
  dhwTemperatureSetPoint: 5548,
  weekPrograms: [573, 643, 713],
});

const workingModeNames = Object.freeze([
  'IDLE',
  'AUTO',
  'EXTENDED_OPERATE',
  'MANUAL',
  'LON',
  'SERVICE',
]);

const scheduleFlagNames = Object.freeze([
  [6, 'DEHUMIDIFICATION'],
  [5, 'HIGH_FAN'],
  [4, 'DHW'],
  [3, 'NIGHT_SETBACK'],
  [2, 'RECIRCULATION'],
  [1, 'FAN_ONLY'],
  [0, 'SYSTEM_OFF'],
]);

function usage() {
  return `Usage: npm run diagnose:cts700 -- --host <address> [options]

Read-only options:
  --host <address>       CTS700 IPv4 address or hostname (required)
  --port <number>        Modbus TCP port (default: 502)
  --unit-id <number>     Modbus unit ID (default: 1)
  --interval <seconds>   Delay between snapshots (default: 0)
  --count <number>       Snapshots to capture; 0 runs until interrupted (default: 1)
  --help                 Show this help

Output is newline-delimited JSON. This script only issues Modbus holding-register
reads; it never calls a Modbus write operation.`;
}

function parsePositiveNumber(value, option, allowZero = false) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${option} must be a number greater than or equal to ${minimum}.`);
  }
  return parsed;
}

function parseOptions(arguments_) {
  const options = {
    count: 1,
    host: undefined,
    intervalSeconds: 0,
    port: 502,
    unitId: 1,
  };

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }

    const value = arguments_[++index];
    if (value === undefined) {
      throw new Error(`${argument} requires a value.`);
    }

    switch (argument) {
      case '--host':
        options.host = value;
        break;
      case '--port':
        options.port = parsePositiveNumber(value, argument);
        break;
      case '--unit-id':
        options.unitId = parsePositiveNumber(value, argument);
        break;
      case '--interval':
        options.intervalSeconds = parsePositiveNumber(value, argument, true);
        break;
      case '--count':
        options.count = parsePositiveNumber(value, argument, true);
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.host === undefined) {
    throw new Error('--host is required.');
  }
  if (options.count !== 1 && options.intervalSeconds === 0) {
    throw new Error('--interval must be greater than zero when capturing multiple snapshots.');
  }
  return options;
}

async function readHoldingRegisters(client, address, count) {
  const result = await client.readHoldingRegisters(address, count);
  if (result.data.length !== count) {
    throw new Error(`Register ${address}: expected ${count} values, received ${result.data.length}.`);
  }
  return result;
}

async function readSingleRegister(client, address) {
  return (await readHoldingRegisters(client, address, 1)).data[0];
}

function decodeTemperature(raw) {
  return ((raw << 16) >> 16) / 10;
}

function decodeDateTime(buffer) {
  return {
    second: buffer.readUInt8(0),
    minute: buffer.readUInt8(1),
    hour: buffer.readUInt8(2),
    day: buffer.readUInt8(3),
    weekDay: buffer.readUInt8(4),
    month: buffer.readUInt8(5),
    year: 2000 + buffer.readUInt8(6),
  };
}

function decodeScheduleFlags(flags) {
  return scheduleFlagNames
    .filter(([bit]) => (flags & (1 << bit)) !== 0)
    .map(([, name]) => name);
}

function decodeScheduleRecords(buffer) {
  const records = [];
  const bytesPerRecord = 10;
  for (let offset = 0; offset < buffer.length; offset += bytesPerRecord) {
    const weekDay = buffer.readUInt8(offset);
    if (weekDay === 0) {
      break;
    }
    const flags = buffer.readUInt8(offset + 7);
    records.push({
      weekDay,
      hour: buffer.readUInt8(offset + 1),
      minute: buffer.readUInt8(offset + 2),
      temperature: buffer.readInt16BE(offset + 3) / 10,
      dhwTemperature: buffer.readInt16BE(offset + 5) / 10,
      flags,
      flagNames: decodeScheduleFlags(flags),
      fanSpeed: buffer.readUInt16BE(offset + 8),
    });
  }
  return records;
}

async function readWeekSchedule(client) {
  const records = [];
  for (const address of registers.weekPrograms) {
    const segment = decodeScheduleRecords((await readHoldingRegisters(client, address, 70)).buffer);
    records.push(...segment);
    if (segment.length < 14) {
      break;
    }
  }
  return records;
}

function minuteOfWeek(value) {
  return ((value.weekDay - 1) * 24 * 60) + (value.hour * 60) + value.minute;
}

function findActiveScheduleRecord(records, dateTime) {
  if (records.length === 0) {
    return null;
  }
  const currentMinute = minuteOfWeek(dateTime);
  const sorted = [...records].sort((left, right) => minuteOfWeek(left) - minuteOfWeek(right));
  return [...sorted].reverse().find(record => minuteOfWeek(record) <= currentMinute) ?? sorted.at(-1);
}

async function captureSnapshot(client) {
  const currentDateTime = decodeDateTime((await readHoldingRegisters(client, registers.currentTime, 4)).buffer);
  const systemWorkingMode = await readSingleRegister(client, registers.systemWorkingMode);
  const roomTemperatureSetPointRaw = await readSingleRegister(client, registers.roomTemperatureSetPoint);
  const fanSpeed = await readSingleRegister(client, registers.fanSpeed);
  const dhwTemperatureSetPointRaw = await readSingleRegister(client, registers.dhwTemperatureSetPoint);
  const inletFanControl = await readSingleRegister(client, registers.inletFanControl);
  const outletFanControl = await readSingleRegister(client, registers.outletFanControl);
  const schedule = await readWeekSchedule(client);

  return {
    capturedAt: new Date().toISOString(),
    controllerDateTime: currentDateTime,
    systemWorkingMode: {
      raw: systemWorkingMode,
      name: workingModeNames[systemWorkingMode] ?? 'UNKNOWN',
    },
    userTargets: {
      roomTemperature: decodeTemperature(roomTemperatureSetPointRaw),
      roomTemperatureRaw: roomTemperatureSetPointRaw,
      fanSpeed,
      dhwTemperature: decodeTemperature(dhwTemperatureSetPointRaw),
      dhwTemperatureRaw: dhwTemperatureSetPointRaw,
    },
    actualFanControl: {
      inlet: inletFanControl,
      outlet: outletFanControl,
    },
    activeScheduleRecord: findActiveScheduleRecord(schedule, currentDateTime),
    scheduleRecordCount: schedule.length,
  };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const client = new ModbusRTU();
  let stopped = false;
  process.once('SIGINT', () => {
    stopped = true;
  });

  try {
    await client.connectTCP(options.host, { port: options.port });
    client.setID(options.unitId);
    client.setTimeout(5000);

    for (let captured = 0; !stopped && (options.count === 0 || captured < options.count); captured++) {
      process.stdout.write(`${JSON.stringify(await captureSnapshot(client))}\n`);
      if (!stopped && (options.count === 0 || captured + 1 < options.count)) {
        await delay(options.intervalSeconds * 1000);
      }
    }
  } finally {
    if (client.isOpen) {
      client.close();
    }
  }
}

main().catch(error => {
  process.stderr.write(`CTS700 diagnostic failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
