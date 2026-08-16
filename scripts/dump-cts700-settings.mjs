/* global process */

import ModbusRTU from 'modbus-serial';

const enumDecoder = labels => raw => ({ value: raw, label: labels[raw] ?? 'UNKNOWN' });
const integerDecoder = raw => ({ value: raw });
const scaledSignedDecoder = divisor => raw => ({ value: ((raw << 16) >> 16) / divisor });
const booleanDecoder = raw => ({ value: raw === 1, label: raw === 1 ? 'ENABLED' : raw === 0 ? 'DISABLED' : 'UNKNOWN' });

const scheduleFlagNames = Object.freeze([
  [6, 'DEHUMIDIFICATION'],
  [5, 'HIGH_FAN'],
  [4, 'DHW'],
  [3, 'NIGHT_SETBACK'],
  [2, 'RECIRCULATION'],
  [1, 'FAN_ONLY'],
  [0, 'SYSTEM_OFF'],
]);

function decodeFlags(flags) {
  return scheduleFlagNames.filter(([bit]) => (flags & (1 << bit)) !== 0).map(([, name]) => name);
}

function extendedOperationDecoder(buffer) {
  const flags = buffer.readUInt8(4);
  const decodeFanSpeed = raw => ({ raw, value: raw > 100 ? raw - 100 : raw });
  return {
    value: {
      roomTemperature: buffer.readInt16BE(0) / 10,
      dhwTemperature: buffer.readInt16BE(2) / 10,
      flags,
      flagNames: decodeFlags(flags),
      separateFanSpeeds: (buffer.readUInt8(5) & 1) === 1,
      exhaustFanSpeed: decodeFanSpeed(buffer.readUInt8(6)),
      supplyFanSpeed: decodeFanSpeed(buffer.readUInt8(7)),
    },
  };
}

const definitions = [
  { category: 'system', register: 1047, name: 'System working mode', access: 'R',
    decode: enumDecoder(['IDLE', 'AUTO', 'EXTENDED_OPERATE', 'MANUAL', 'LON', 'SERVICE']) },
  { category: 'system', register: 2402, name: 'Forced operation preference', access: 'R/W',
    decode: enumDecoder(['AUTO', 'COOLING', 'HEATING']) },
  { category: 'system', register: 4104, name: 'User system-off permission', access: 'R/W', decode: booleanDecoder },
  { category: 'system', register: 4727, name: 'Pause mode', access: 'R/W',
    decode: enumDecoder(['NONE', 'VENTILATION', 'DHW', 'ALL']) },
  { category: 'system', register: 5432, name: 'Current regulation mode', access: 'R',
    decode: enumDecoder(['UNDEFINED', 'COOLING', 'HEATING', 'VENTILATION', 'HOT_WATER']) },

  { category: 'ventilation', register: 2403, name: 'Maximum inlet temperature', access: 'R/W', unit: '°C', range: [5, 50],
    decode: scaledSignedDecoder(10) },
  { category: 'ventilation', register: 2404, name: 'Minimum summer inlet temperature', access: 'R/W', unit: '°C',
    range: [5, 50], decode: scaledSignedDecoder(10) },
  { category: 'ventilation', register: 2405, name: 'Minimum winter inlet temperature', access: 'R/W', unit: '°C',
    range: [5, 50], decode: scaledSignedDecoder(10) },
  { category: 'ventilation', register: 2406, name: 'Summer/winter selection setpoint', access: 'R/W', unit: '°C',
    range: [5, 30], decode: scaledSignedDecoder(10) },
  { category: 'ventilation', register: 2407, name: 'Summer/winter selection offset', access: 'R/W', unit: '°C',
    range: [0, 10], decode: scaledSignedDecoder(10) },
  { category: 'ventilation', register: 2832, count: 4, name: 'Extended operation profile 1', access: 'R/W',
    decodeBuffer: extendedOperationDecoder },
  { category: 'ventilation', register: 2836, name: 'Extended operation profile 1 duration', access: 'R/W', unit: 'min',
    range: [0, 480], decode: integerDecoder },
  { category: 'ventilation', register: 2837, count: 4, name: 'Extended operation profile 2', access: 'R/W',
    decodeBuffer: extendedOperationDecoder },
  { category: 'ventilation', register: 2841, name: 'Extended operation profile 2 duration', access: 'R/W', unit: 'min',
    range: [0, 480], decode: integerDecoder },
  { category: 'ventilation', register: 4746, name: 'User room-temperature target', access: 'R/W', unit: '°C', range: [5, 50],
    decode: scaledSignedDecoder(10) },
  { category: 'ventilation', register: 4747, name: 'User fan-speed target', access: 'R/W', unit: '%', range: [20, 100],
    decode: integerDecoder },

  { category: 'dhw', register: 1323, name: 'DHW compressor control', access: 'R/W', unit: '%', range: [0, 100],
    decode: integerDecoder },
  { category: 'dhw', register: 2828, name: 'Maximum DHW temperature', access: 'R/W', unit: '°C', range: [60, 80],
    decode: scaledSignedDecoder(10) },
  { category: 'dhw', register: 3935, name: 'Minimum DHW supply limit', access: 'R/W', unit: '°C', range: [5, 85],
    decode: scaledSignedDecoder(10) },
  { category: 'dhw', register: 3938, name: 'DHW electric heater', access: 'R/W', decode: booleanDecoder },
  { category: 'dhw', register: 3941, name: 'Anti-legionella schedule', access: 'R/W',
    decode: enumDecoder(['OFF', 'WEEKLY', 'MONTHLY']) },
  { category: 'dhw', register: 3942, name: 'Anti-legionella start hour', access: 'R/W', unit: 'hour', range: [0, 23],
    decode: integerDecoder },
  { category: 'dhw', register: 4748, name: 'Anti-legionella activity', access: 'R', decode: booleanDecoder },
  { category: 'dhw', register: 4749, name: 'Anti-legionella force state', access: 'R/W', decode: booleanDecoder },
  { category: 'dhw', register: 5548, name: 'User DHW target', access: 'R/W', unit: '°C', range: [10, 65],
    decode: scaledSignedDecoder(10) },

  { category: 'bufferAndPumps', register: 3259, name: 'Buffer electric-heater delay', access: 'R/W', unit: 'min',
    range: [1, 15], decode: integerDecoder },
  { category: 'bufferAndPumps', register: 3953, name: 'Circulation-pump default output', access: 'R/W', unit: '%',
    range: [20, 100], decode: integerDecoder },
  { category: 'bufferAndPumps', register: 4091, name: 'Buffer-tank heater', access: 'R/W', decode: booleanDecoder },
  { category: 'bufferAndPumps', register: 4094, name: 'Circulation-pump cooling output', access: 'R/W', unit: '%',
    range: [20, 100], decode: integerDecoder },

  { category: 'filters', register: 1326, name: 'Inlet-filter replacement interval', access: 'R/W', unit: 'days',
    range: [30, 360], decode: integerDecoder },
  { category: 'filters', register: 1327, name: 'Outlet-filter replacement interval', access: 'R/W', unit: 'days',
    range: [30, 360], decode: integerDecoder },
  { category: 'filters', register: 1328, name: 'Inlet-filter elapsed time', access: 'R', unit: 'days', range: [0, 360],
    decode: integerDecoder },
  { category: 'filters', register: 1329, name: 'Outlet-filter elapsed time', access: 'R', unit: 'days', range: [0, 360],
    decode: integerDecoder },
  { category: 'filters', register: 4692, name: 'Inlet-filter deterioration', access: 'R', unit: '%', range: [0, 100],
    decode: integerDecoder },
  { category: 'filters', register: 4693, name: 'Outlet-filter deterioration', access: 'R', unit: '%', range: [0, 100],
    decode: integerDecoder },

  { category: 'interface', register: 1325, name: 'Controller buzzer', access: 'R/W', decode: booleanDecoder },
  { category: 'interface', register: 3260, name: 'Controller backlight', access: 'R/W', unit: '%', range: [30, 100],
    decode: integerDecoder },
  { category: 'interface', register: 3261, name: 'Controller sleep timeout', access: 'R/W', unit: 'manual unit unspecified',
    range: [0, 60], decode: integerDecoder },
  { category: 'interface', register: 3951, name: 'Controller language ID', access: 'R/W', decode: integerDecoder },
  { category: 'interface', register: 4233, name: 'DHW sacrificial-anode state', access: 'R',
    decode: enumDecoder(['NOT_DETECTED', 'DETECTED', 'WARNING', 'BROKEN']) },
  { category: 'interface', register: 4235, name: 'Event-list sort mode', access: 'R/W',
    decode: enumDecoder(['UNDEFINED', 'TIME_DESC', 'TIME_ASC', 'BOARD_TIME_DESC', 'BOARD_TIME_ASC', 'TYPE_TIME_DESC', 'TYPE_TIME_ASC']) },

  { category: 'protection', register: 4090, name: 'Compressor outdoor low-temperature limit', access: 'R/W', unit: '°C',
    range: [-200, 200], decode: scaledSignedDecoder(10) },
  { category: 'protection', register: 5019, name: 'External-heater state', access: 'R',
    decode: enumDecoder(['OK', 'ON', 'OFF', 'START_UP', 'REFRIGERATE', 'FROST', 'EXCHANGE_ERROR', 'NOT_READY']) },
  { category: 'protection', register: 5450, name: 'Defrosting phase', access: 'R',
    decode: enumDecoder(['STOPPED', 'STARTING', 'RUNNING', 'AFTER_DEFROSTING']) },

  { category: 'observations', register: 4699, name: 'Inlet-fan control output', access: 'R', unit: '%', decode: integerDecoder },
  { category: 'observations', register: 4700, name: 'Outlet-fan control output', access: 'R', unit: '%', decode: integerDecoder },
  { category: 'observations', register: 4701, name: 'Heater control output', access: 'R', unit: '%', decode: integerDecoder },
  { category: 'observations', register: 4704, name: 'Bypass 1 control output', access: 'R', unit: '%', decode: integerDecoder },
  { category: 'observations', register: 4705, name: 'Bypass 2 control output', access: 'R', unit: '%', decode: integerDecoder },
  { category: 'observations', register: 4706, name: 'Compressor 1 control output', access: 'R', unit: '%', decode: integerDecoder },
  { category: 'observations', register: 4716, name: 'Humidity', access: 'R', unit: '%', decode: integerDecoder },
  { category: 'observations', register: 5088, name: 'Master-sensor temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5152, name: 'T1 outdoor temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5153, name: 'T2 supply temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5154, name: 'T3 extract temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5155, name: 'T4 discharge temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5156, name: 'T5 condenser temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5157, name: 'T6 evaporator temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5162, name: 'T11 DHW top temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
  { category: 'observations', register: 5163, name: 'T12 DHW bottom temperature', access: 'R', unit: '°C',
    decode: scaledSignedDecoder(10) },
];

const protectedSettings = [
  { registers: '1043', name: 'Fan type' },
  { registers: '2795–2799', name: 'Low-outdoor and high-cooling fan overrides' },
  { registers: '2812–2815', name: 'VAV integration and pressure setpoints' },
  { registers: '3265–3267', name: 'Humidity threshold and fan speeds' },
  { registers: '3422', name: 'CAV inlet/outlet fan offset' },
];

function usage() {
  return `Usage: npm run audit:cts700 -- --host <address> [options]

Read-only options:
  --host <address>       CTS700 IPv4 address or hostname (required)
  --port <number>        Modbus TCP port (default: 502)
  --unit-id <number>     Modbus unit ID (default: 1)
  --help                 Show this help

The command emits one JSON settings report. It only calls readHoldingRegisters,
does not authenticate, and contains no Modbus write operation.`;
}

function parseNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

function parseOptions(arguments_) {
  const options = { host: undefined, port: 502, unitId: 1 };
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
    if (argument === '--host') {
      options.host = value;
    } else if (argument === '--port') {
      options.port = parseNumber(value, argument);
    } else if (argument === '--unit-id') {
      options.unitId = parseNumber(value, argument);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.host === undefined) {
    throw new Error('--host is required.');
  }
  return options;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isUnsupported(error) {
  return error?.modbusCode === 2 || errorMessage(error).includes('Illegal data address');
}

async function readDefinition(client, definition) {
  const count = definition.count ?? 1;
  try {
    const result = await client.readHoldingRegisters(definition.register, count);
    if (result.data.length !== count) {
      throw new Error(`Expected ${count} registers, received ${result.data.length}.`);
    }
    const decoded = definition.decodeBuffer ? definition.decodeBuffer(result.buffer) : definition.decode(result.data[0]);
    return {
      register: definition.register,
      registerCount: count,
      name: definition.name,
      access: definition.access,
      raw: count === 1 ? result.data[0] : result.data,
      ...decoded,
      ...(definition.unit === undefined ? {} : { unit: definition.unit }),
      ...(definition.range === undefined ? {} : { documentedRange: definition.range }),
    };
  } catch (error) {
    return {
      register: definition.register,
      registerCount: count,
      name: definition.name,
      access: definition.access,
      status: isUnsupported(error) ? 'UNSUPPORTED_OR_PROTECTED' : 'READ_ERROR',
      error: errorMessage(error),
    };
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const client = new ModbusRTU();
  try {
    await client.connectTCP(options.host, { port: options.port });
    client.setID(options.unitId);
    client.setTimeout(5000);

    const categories = {};
    for (const definition of definitions) {
      categories[definition.category] ??= [];
      categories[definition.category].push(await readDefinition(client, definition));
    }

    process.stdout.write(`${JSON.stringify({
      capturedAt: new Date().toISOString(),
      safety: {
        modbusOperation: 'readHoldingRegisters only',
        authenticationAttempted: false,
        writeOperations: 0,
      },
      categories,
      protectedSettingsNotAvailableWithoutAuthentication: protectedSettings,
      deliberatelyExcluded: [
        'authentication and password registers',
        'MAC and network configuration',
        'write-only clock setting',
        'filter reset registers',
      ],
    }, null, 2)}\n`);
  } finally {
    if (client.isOpen) {
      client.close();
    }
  }
}

main().catch(error => {
  process.stderr.write(`CTS700 settings audit failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
