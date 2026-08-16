import ModbusRTU from 'modbus-serial';
import { ReadRegisterResult, WriteRegisterResult } from 'modbus-serial/ModbusRTU';
import {
  DateTime, 
  Metadata, 
  OperationMode, 
  PauseOption, 
  Readings, 
  Register, 
  Settings, 
  SystemWorkingMode,
  VentilationMode, 
  WeekScheduleRecord,
} from './cts700Data';

export class CTS700Modbus {

  private client: ModbusRTU | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  private networkErrors = [
    'ESOCKETTIMEDOUT',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETRESET',
    'ECONNABORTED',
    'ENETUNREACH',
    'ENOTCONN',
    'ESHUTDOWN',
    'EHOSTDOWN',
    'ENETDOWN',
    'EWOULDBLOCK',
    'EAGAIN',
  ];

  constructor(
      private readonly host: string,
      private readonly didConnect: () => void,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.disposed) {
      return;
    }
    this.client = null;

    const client = new ModbusRTU();
    client.connectTCP(this.host, { port: 502 })
      .then(() => {
        if (this.disposed) {
          client.close();
          return;
        }
        client.setID(1);
        client.setTimeout(5000);
        this.client = client;
        this.didConnect();    
      })
      .catch((e) => {
        this.checkError(e, true);
      });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== undefined) {
      return;
    }

    const client = this.client;
    this.client = null;
    if (client?.isOpen) {
      client.close();
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 10000);
  }

  private checkError(error: unknown, forceRetry: boolean = false): void {
    const networkError = typeof error === 'object' && error !== null ? error as NodeJS.ErrnoException : undefined;
    const errorValues = [
      networkError?.code,
      networkError?.errno?.toString(),
      networkError?.message,
      typeof error === 'string' ? error : undefined,
    ];
    const shouldRetry = this.networkErrors.some(code => errorValues.some(value => value?.includes(code)));
    if (forceRetry || shouldRetry) {
      this.scheduleReconnect();
    }
  }

  public close(): void {
    this.disposed = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const client = this.client;
    this.client = null;
    if (client?.isOpen) {
      client.close();
    }
  }

  async fetchMetadata(): Promise<Metadata> {
    const metadata: Metadata = {
      macAddress: await this.readMacAddressRegister(Register.MacAddress),
      softwareVersion: await this.readSoftwareVersionRegister(Register.SoftwareVersion),
    };

    return metadata;
  }

  async fetchReadings(): Promise<Readings> {
    const readings: Readings = {
      roomTemperature: await this.readTemperatureRegister(Register.MasterSensorTemperature),
      outdoorTemperature: await this.readTemperatureRegister(Register.OutdoorTemperature),
      panelTemperature: await this.readTemperatureRegister(Register.PanelTemperature),
      actualHumidity: await this.readPercentageRegister(Register.ActualHumidity),
      inletFilterDeterioration: await this.readPercentageRegister(Register.InletFilterDeterioration),
      outletFilterDeterioration: await this.readPercentageRegister(Register.OutletFilterDeterioration),
      dhwTankTopTemperature: await this.readTemperatureRegister(Register.DHWTopTankTemperature),
      currentDateTime: await this.readDateTimeRegister(Register.CurrentTime),
    };

    return readings;
  }

  async fetchSettings(): Promise<Settings> {
    const settings: Settings = {
      systemWorkingMode: await this.readSystemWorkingModeRegister(Register.SystemWorkingMode),
      paused: await this.readPauseRegister(Register.Pause),
      fanSpeed: await this.readPercentageRegister(Register.FanSpeed),
      roomTemperatureSetPoint: await this.readTemperatureRegister(Register.RoomTemperatureSetPoint),
      dhwTemperatureSetPoint: await this.readTemperatureRegister(Register.DHWTemperatureSetPoint),
      ventilationMode: await this.readVentilationModeRegister(Register.VentilationMode),
      operationMode: await this.readOperationModeRegister(Register.OperationMode),
    };  
    return settings;
  }

  async fetchActiveWeekProgramForDateTime(dateTime: DateTime): Promise<WeekScheduleRecord | null> {
    const weekSchedule = Array<WeekScheduleRecord>();
    const weekProgramRegisters = [Register.FirstWeekProgram, Register.SecondWeekProgram, Register.ThirdWeekProgram];
    for (const register of weekProgramRegisters) {
      const records = await this.readWeekProgramRegister(register, 14);
      weekSchedule.push(...records);
      if (records.length < 14) {
        break;
      }
    }
    return this.findCurrentActiveWeekRecord(weekSchedule, dateTime);
  }

  private async readTemperatureRegister(register: Register): Promise<number> {
    return this.readSingleRegister(register)
      .then((result) => {
        // int16 conversion to account for negative values
        const signed = (result << 16) >> 16;
        return signed / 10;
      });
  }

  private async readPercentageRegister(register: Register): Promise<number> {
    return this.readSingleRegister(register)
      .then((result) => {
        if (result < 0 || result > 100) {
          throw Error('Value outside of acceptable range.');
        }
        return result;
      });
  }

  private async readPauseRegister(register: Register): Promise<PauseOption> {
    return this.readSingleRegister(register)
      .then((result) => {
        if (result < PauseOption.Disabled || result > PauseOption.All) {
          throw Error('Invalid pause option value.');
        }
        return result;
      });
  }

  private async readVentilationModeRegister(register: Register): Promise<VentilationMode> {
    return this.readSingleRegister(register)
      .then((result) => {
        if (result < VentilationMode.Auto || result > VentilationMode.Heating) {
          throw Error('Invalid ventilation mode value.');
        }
        return result;
      });
  }

  private async readOperationModeRegister(register: Register): Promise<OperationMode> {
    return this.readSingleRegister(register)
      .then((result) => {
        if (result < OperationMode.Undefined || result > OperationMode.DHW) {
          throw Error('Invalid operation mode value.');
        }
        return result;
      });
  }

  private async readSystemWorkingModeRegister(register: Register): Promise<SystemWorkingMode> {
    return this.readSingleRegister(register)
      .then((result) => {
        if (result < SystemWorkingMode.Idle || result > SystemWorkingMode.Service) {
          throw Error('Invalid system working mode value.');
        }
        return result;
      });
  }

  private async readDateTimeRegister(register: Register): Promise<DateTime> {
    const registerCount = 4;
    return this.readHoldingRegisters(register, registerCount)
      .then((result) => {
        if (result.data.length !== registerCount) {
          throw Error('Invalid result returned.');
        }
        const date: DateTime = {
          second: result.buffer.readInt8(0),
          minute: result.buffer.readInt8(1),
          hour: result.buffer.readInt8(2),
          day: result.buffer.readInt8(3),
          weekDay: result.buffer.readInt8(4),
          month: result.buffer.readInt8(5),
          year: result.buffer.readInt8(6),
        };
        return date;
      });
  }

  private async readWeekProgramRegister(register: Register, programCount: number): Promise<Array<WeekScheduleRecord>> {
    const bytesPerProgram = 10;
    const totalBytes = programCount * bytesPerProgram;
    // 2 bytes per register
    const registerCount = totalBytes / 2;
    return this.readHoldingRegisters(register, registerCount)
      .then((result) => {
        if (result.data.length !== registerCount) {
          throw Error('Invalid result returned.');
        }
        const schedule = Array<WeekScheduleRecord>();
        let byte = 0;
        while(byte < totalBytes) {
          const weekDay = result.buffer.readInt8(byte);
          // Week day 0 indicates an unused entry.
          if (weekDay === 0) {
            break;
          }
          const record: WeekScheduleRecord = {
            weekDay: result.buffer.readInt8(byte),
            hour: result.buffer.readInt8(byte + 1),
            minute: result.buffer.readInt8(byte + 2),
            temperature: result.buffer.readInt16BE(byte + 3) / 10,
            dhwTemperature: result.buffer.readInt16BE(byte + 5) / 10,
            flags: result.buffer.readInt8(byte + 7),
            fanSpeed: result.buffer.readInt16BE(byte + 8),
          };
          schedule.push(record);
          byte += bytesPerProgram;
        }
        return schedule;
      });
  }

  private async readMacAddressRegister(register: Register): Promise<string> {
    return this.readHoldingRegisters(register, 8)
      .then((result) => {
        const values: Array<string> = [];
        for (let segment = 0; segment < 6; segment++) {
          values.push(result.buffer.readUInt8(segment).toString(16).toUpperCase().padStart(2, '0'));
        }
        return values.join(':');
      });
  }

  private async readSoftwareVersionRegister(register: Register): Promise<string> {
    return this.readHoldingRegisters(register, 2)
      .then((result) => {
        const major = result.buffer.readInt8(0);
        const middle = result.buffer.readInt16BE(1);
        const minor = result.buffer.readInt8(3);
        // This is odd, but that's what matches the display
        return minor + '.' + middle + '.' + major;
      });
  }

  private async readSingleRegister(register: Register): Promise<number> {
    return this.readHoldingRegisters(register, 1)
      .then((result) => {
        if (result.data.length === 0) {
          throw Error('No result returned.');
        }
        return result.data[0];
      });
  }

  private async readHoldingRegisters(dataAddress: number, length: number): Promise<ReadRegisterResult> {
    if (this.client === null) {
      return Promise.reject(new Error('Disconnected.'));
    }
    return this.client.readHoldingRegisters(dataAddress, length)
      .catch((e) => {
        this.checkError(e);
        throw e;
      });
  }

  public async writeFanSpeed(value: number): Promise<number> {
    return this.writePercentageRegister(Register.FanSpeed, value);
  }

  public async writeRoomTemperatureSetPoint(value: number): Promise<number> {
    if (value < 5 || value > 50) {
      throw Error('Value outside of acceptable range.');
    }
    return this.writeTemperatureRegister(Register.RoomTemperatureSetPoint, value);
  }

  public async writeDHWSetPoint(value: number): Promise<number> {
    if (value < 10 || value > 65) {
      throw Error('Value outside of acceptable range.');
    }
    return this.writeTemperatureRegister(Register.DHWTemperatureSetPoint, value);
  }

  public async writePauseOption(value: PauseOption): Promise<PauseOption> {
    if (value < PauseOption.Disabled || value > PauseOption.All) {
      throw Error('Invalid pause option value.');
    }
    return this.writeSingleRegister(Register.Pause, value);
  }

  public async writeVentilationPaused(paused: boolean): Promise<PauseOption> {
    return this.writePauseComponent(PauseOption.Ventilation, paused);
  }

  public async writeDHWPaused(paused: boolean): Promise<PauseOption> {
    return this.writePauseComponent(PauseOption.DHW, paused);
  }

  public async resetInletFilter(): Promise<number> {
    return this.writeSingleRegister(Register.InletFilterReset, 1);
  }

  public async resetOutletFilter(): Promise<number> {
    return this.writeSingleRegister(Register.OutletFilterReset, 1);
  }

  public async writeVentilationMode(value: VentilationMode): Promise<VentilationMode> {
    if (value < VentilationMode.Auto || value > VentilationMode.Heating) {
      throw Error('Invalid ventilation mode value.');
    }
    return this.writeSingleRegister(Register.VentilationMode, value);
  }

  private async writePercentageRegister(register: Register, value: number): Promise<number> {
    if (value < 0 || value > 100) {
      throw Error('Value outside of acceptable range.');
    }
    const modbusValue = Math.floor(value);
    return this.writeSingleRegister(register, modbusValue);
  }

  private async writeTemperatureRegister(register: Register, value: number): Promise<number> {
    const signedValue = Math.round(value * 10);
    const modbusValue = signedValue < 0 ? signedValue + 0x10000 : signedValue;
    return this.writeSingleRegister(register, modbusValue);
  }

  private async writePauseComponent(component: PauseOption, paused: boolean): Promise<PauseOption> {
    const current = await this.readPauseRegister(Register.Pause);
    const updated = paused ? current | component : current & ~component;
    return this.writePauseOption(updated as PauseOption);
  }

  private async writeSingleRegister(register: Register, value: number): Promise<number> {
    return this.writeRegister(register, value)
      .then((result) => {
        if (result.value !== value) {
          throw Error('Setting value failed.');
        }
        return result.value;
      });
  }

  private async writeRegister(dataAddress: number, value: number): Promise<WriteRegisterResult> {
    if (this.client === null) {
      return Promise.reject(new Error('Disconnected.'));
    }
    return this.client.writeRegister(dataAddress, value)
      .catch((e) => {
        this.checkError(e);
        throw e;
      });
  }

  private findCurrentActiveWeekRecord(records: Array<WeekScheduleRecord>, time: DateTime): WeekScheduleRecord | null {
    if (records.length === 0) {
      return null;
    } else if (records.length === 1) {
      return records[0];
    }
    const minuteOfWeek = (value: Pick<DateTime, 'weekDay' | 'hour' | 'minute'>) =>
      ((value.weekDay - 1) * 24 * 60) + (value.hour * 60) + value.minute;
    const currentMinute = minuteOfWeek(time);
    const sortedRecords = [...records].sort((a, b) => minuteOfWeek(a) - minuteOfWeek(b));

    for (let index = sortedRecords.length - 1; index >= 0; index--) {
      if (minuteOfWeek(sortedRecords[index]) <= currentMinute) {
        return sortedRecords[index];
      }
    }

    return sortedRecords[sortedRecords.length - 1];
  }
}
