/* global process, setTimeout */

import ModbusRTU from 'modbus-serial';

const registers = Object.freeze({
  fanType: 1043,
  systemWorkingMode: 1047,
  forcedOperationMode: 2402,
  lowOutdoorFanSettings: 2795,
  humidityFanSettings: 3265,
  cavFanOffset: 3422,
  inletFanControl: 4699,
  actualHumidity: 4716,
  currentTime: 4722,
  roomTemperatureSetPoint: 4746,
  masterSensorTemperature: 5088,
  outdoorTemperature: 5152,
  regulationMode: 5432,
  dhwTemperatureSetPoint: 5548,
  weekPrograms: [573, 643, 713],
  yearPrograms: [783, 848, 913, 978],
});

const fanTypeNames = Object.freeze([
  'ONE_STEP',
  'TWO_STEP',
  'CAV_EXTERNAL',
  'CAV',
  'VAV',
]);

const workingModeNames = Object.freeze([
  'IDLE',
  'AUTO',
  'EXTENDED_OPERATE',
  'MANUAL',
  'LON',
  'SERVICE',
]);

const forcedOperationModeNames = Object.freeze(['AUTO', 'COOLING', 'HEATING']);
const regulationModeNames = Object.freeze(['UNDEFINED', 'COOLING', 'HEATING', 'VENTILATION', 'HOT_WATER']);

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

function isIllegalDataAddress(error) {
  const message = error instanceof Error ? error.message : String(error);
  return error?.modbusCode === 2 || message.includes('Illegal data address');
}

async function readOptionalHoldingRegisters(client, address, count, unsupportedRegisters) {
  try {
    return await readHoldingRegisters(client, address, count);
  } catch (error) {
    if (!isIllegalDataAddress(error)) {
      throw error;
    }
    unsupportedRegisters.push({ address, count });
    return null;
  }
}

async function readOptionalSingleRegister(client, address, unsupportedRegisters) {
  return (await readOptionalHoldingRegisters(client, address, 1, unsupportedRegisters))?.data[0] ?? null;
}

function decodeTemperature(raw) {
  return decodeSigned16(raw) / 10;
}

function decodeSigned16(raw) {
  return (raw << 16) >> 16;
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

function decodeYearScheduleRecords(buffer) {
  const records = [];
  const bytesPerRecord = 13;
  for (let offset = 0; offset < buffer.length; offset += bytesPerRecord) {
    const type = buffer.readUInt8(offset);
    if (type === 0xff) {
      continue;
    }
    const flags = buffer.readUInt8(offset + 10);
    records.push({
      type,
      recurrence: type === 0 ? 'SELECTED_YEAR' : 'EVERY_YEAR',
      year: type === 0 ? 2000 + buffer.readUInt8(offset + 1) : null,
      month: buffer.readUInt8(offset + 2),
      day: buffer.readUInt8(offset + 3),
      hour: buffer.readUInt8(offset + 4),
      minute: buffer.readUInt8(offset + 5),
      temperature: buffer.readInt16BE(offset + 6) / 10,
      dhwTemperature: buffer.readInt16BE(offset + 8) / 10,
      flags,
      flagNames: decodeScheduleFlags(flags),
      fanSpeed: buffer.readUInt16BE(offset + 11),
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

async function readYearSchedule(client, unsupportedRegisters) {
  const records = [];
  for (const address of registers.yearPrograms) {
    const result = await readOptionalHoldingRegisters(client, address, 65, unsupportedRegisters);
    if (result === null) {
      return null;
    }
    records.push(...decodeYearScheduleRecords(result.buffer));
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

function findNextScheduleRecord(records, dateTime) {
  if (records.length === 0) {
    return null;
  }
  const currentMinute = minuteOfWeek(dateTime);
  const sorted = [...records].sort((left, right) => minuteOfWeek(left) - minuteOfWeek(right));
  return sorted.find(record => minuteOfWeek(record) > currentMinute) ?? sorted[0];
}

function scheduleOccurrence(record, year) {
  return {
    year,
    month: record.month,
    day: record.day,
    hour: record.hour,
    minute: record.minute,
  };
}

function occurrenceTimestamp(occurrence) {
  return Date.UTC(occurrence.year, occurrence.month - 1, occurrence.day, occurrence.hour, occurrence.minute);
}

function findSurroundingYearRecords(records, dateTime) {
  if (records === null || records.length === 0) {
    return { mostRecent: null, next: null };
  }
  const occurrences = records.flatMap(record => {
    const years = record.year === null ? [dateTime.year - 1, dateTime.year, dateTime.year + 1] : [record.year];
    return years.map(year => ({ record, occursAt: scheduleOccurrence(record, year) }));
  }).sort((left, right) => occurrenceTimestamp(left.occursAt) - occurrenceTimestamp(right.occursAt));
  const currentTimestamp = occurrenceTimestamp(dateTime);
  return {
    mostRecent: [...occurrences].reverse().find(entry => occurrenceTimestamp(entry.occursAt) <= currentTimestamp) ?? null,
    next: occurrences.find(entry => occurrenceTimestamp(entry.occursAt) > currentTimestamp) ?? null,
  };
}

async function captureSnapshot(client) {
  const unsupportedRegisters = [];
  const currentDateTime = decodeDateTime((await readHoldingRegisters(client, registers.currentTime, 4)).buffer);
  const fanType = await readOptionalSingleRegister(client, registers.fanType, unsupportedRegisters);
  const systemWorkingMode = await readSingleRegister(client, registers.systemWorkingMode);
  const forcedOperationMode = await readSingleRegister(client, registers.forcedOperationMode);
  const lowOutdoorFanSettings = (await readOptionalHoldingRegisters(
    client,
    registers.lowOutdoorFanSettings,
    5,
    unsupportedRegisters,
  ))?.data ?? null;
  const humidityFanSettings = (await readOptionalHoldingRegisters(
    client,
    registers.humidityFanSettings,
    3,
    unsupportedRegisters,
  ))?.data ?? null;
  const cavFanOffsetRaw = await readOptionalSingleRegister(client, registers.cavFanOffset, unsupportedRegisters);
  const cavFanOffset = cavFanOffsetRaw === null ? null : decodeSigned16(cavFanOffsetRaw);
  const fanControl = (await readHoldingRegisters(client, registers.inletFanControl, 2)).data;
  const actualHumidity = await readSingleRegister(client, registers.actualHumidity);
  const userVentilationTargets = (await readHoldingRegisters(client, registers.roomTemperatureSetPoint, 2)).data;
  const roomTemperatureSetPointRaw = userVentilationTargets[0];
  const fanSpeed = userVentilationTargets[1];
  const masterSensorTemperatureRaw = await readSingleRegister(client, registers.masterSensorTemperature);
  const outdoorTemperatureRaw = await readSingleRegister(client, registers.outdoorTemperature);
  const regulationMode = await readSingleRegister(client, registers.regulationMode);
  const dhwTemperatureSetPointRaw = await readSingleRegister(client, registers.dhwTemperatureSetPoint);
  const schedule = await readWeekSchedule(client);
  const yearSchedule = await readYearSchedule(client, unsupportedRegisters);
  const activeScheduleRecord = findActiveScheduleRecord(schedule, currentDateTime);
  const surroundingYearRecords = findSurroundingYearRecords(yearSchedule, currentDateTime);
  const inletFanControl = fanControl[0];
  const outletFanControl = fanControl[1];

  return {
    capturedAt: new Date().toISOString(),
    controllerDateTime: currentDateTime,
    systemWorkingMode: {
      raw: systemWorkingMode,
      name: workingModeNames[systemWorkingMode] ?? 'UNKNOWN',
    },
    forcedOperationMode: {
      raw: forcedOperationMode,
      name: forcedOperationModeNames[forcedOperationMode] ?? 'UNKNOWN',
    },
    regulationMode: {
      raw: regulationMode,
      name: regulationModeNames[regulationMode] ?? 'UNKNOWN',
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
    fanConfiguration: {
      fanType: {
        raw: fanType,
        name: fanType === null ? 'UNSUPPORTED' : fanTypeNames[fanType] ?? 'UNKNOWN',
      },
      cavFanOffset,
      lowOutdoorFan: {
        enabled: lowOutdoorFanSettings === null ? null : lowOutdoorFanSettings[0] === 1,
        temperature: lowOutdoorFanSettings === null ? null : decodeTemperature(lowOutdoorFanSettings[1]),
        speed: lowOutdoorFanSettings?.[2] ?? null,
      },
      highCoolingFan: {
        enabled: lowOutdoorFanSettings === null ? null : lowOutdoorFanSettings[3] === 1,
        speed: lowOutdoorFanSettings?.[4] ?? null,
      },
      humidity: {
        lowThreshold: humidityFanSettings?.[0] ?? null,
        lowSpeed: humidityFanSettings?.[1] ?? null,
        highSpeed: humidityFanSettings?.[2] ?? null,
      },
    },
    currentConditions: {
      humidity: actualHumidity,
      masterSensorTemperature: decodeTemperature(masterSensorTemperatureRaw),
      outdoorTemperature: decodeTemperature(outdoorTemperatureRaw),
    },
    fanComparison: {
      scheduleMinusUser: activeScheduleRecord === null ? null : activeScheduleRecord.fanSpeed - fanSpeed,
      inletMinusUser: inletFanControl - fanSpeed,
      outletMinusUser: outletFanControl - fanSpeed,
      outletMinusInlet: outletFanControl - inletFanControl,
      outletMinusInletMatchesCavOffset: cavFanOffset === null ? null : outletFanControl - inletFanControl === cavFanOffset,
    },
    activeScheduleRecord,
    nextScheduleRecord: findNextScheduleRecord(schedule, currentDateTime),
    scheduleRecordCount: schedule.length,
    yearSchedule: {
      recordCount: yearSchedule?.length ?? null,
      mostRecentRecord: surroundingYearRecords.mostRecent,
      nextRecord: surroundingYearRecords.next,
    },
    unsupportedRegisters,
  };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  let stopped = false;
  process.once('SIGINT', () => {
    stopped = true;
  });

  for (let captured = 0; !stopped && (options.count === 0 || captured < options.count); captured++) {
    const client = new ModbusRTU();
    try {
      await client.connectTCP(options.host, { port: options.port });
      client.setID(options.unitId);
      client.setTimeout(5000);
      process.stdout.write(`${JSON.stringify(await captureSnapshot(client))}\n`);
    } finally {
      if (client.isOpen) {
        client.close();
      }
    }
    if (!stopped && (options.count === 0 || captured + 1 < options.count)) {
      await delay(options.intervalSeconds * 1000);
    }
  }
}

main().catch(error => {
  process.stderr.write(`CTS700 diagnostic failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
