import ModbusRTU from 'modbus-serial';
import { throttle } from 'throttle-debounce';
import { ReadRegisterResult, WriteRegisterResult } from 'modbus-serial/ModbusRTU';
import {DateTime, OperationMode, PauseOption, Readings, Register, Settings, VentilationMode, WeekScheduleRecord} from './cts700Data';

export declare type WriterParameterTypes = number | PauseOption | OperationMode;
export declare type NumericWriter = (value: WriterParameterTypes) => Promise<WriterParameterTypes>;

export class CTS700Modbus {

    private client: ModbusRTU | null = null;

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

    constructor() {
      this.connect();
    }

    private connect() {
      this.client = null;

      const client = new ModbusRTU();
      client.connectTCP('192.168.5.107', { port: 502 })
        .then(() => {
          client.setID(1);
          client.setTimeout(5000);
          this.client = client;    
        })
        .catch((e) => {
          this.checkError(e, true);
        });
    }

    private throttledReconnect = throttle(10000, () => {
      if (this.client !== null && this.client.isOpen) {
        this.client.close(() => {
          this.connect();
        });
      } else {
        this.connect();
      }
    });

    // eslint-disable-next-line
    private checkError(e: any, forceRetry: boolean = false) {
      if((e.message && this.networkErrors.includes(e.message))
          || (e.errno && this.networkErrors.includes(e.errno)) 
          || forceRetry) {
        this.throttledReconnect();
      }
    }

    async fetchReadings(): Promise<Readings> {
      const readings: Readings = {
        roomTemperature: await this.readTemperatureRegister(Register.MasterSensorTemperature),
        outdoorTemperature: await this.readTemperatureRegister(Register.OutdoorTemperature),
        panelTemperature: await this.readTemperatureRegister(Register.PanelTemperature),
        actualHumidity: await this.readPercentageRegister(Register.ActualHumidity),
        dhwTankTopTemperature: await this.readTemperatureRegister(Register.DHWTopTankTemperature),
        currentDateTime: await this.readDateTimeRegister(Register.CurrentTime),
      };

      return readings;
    }

    async fetchSettings(): Promise<Settings> {
      const settings: Settings = {
        paused: await this.readPauseRegister(Register.Pause),
        fanSpeed: await this.readPercentageRegister(Register.FanSpeed),
        roomTemperatureSetPoint: await this.readTemperatureRegister(Register.RoomTemperatureSetPoint),
        dhwTemperatureSetPoint: await this.readTemperatureRegister(Register.DHWTemperatureSetPoint),
        ventilationMode: await this.readVentilationModeRegister(Register.VentilationMode),
        operationMode: await this.readOperationModeRegister(Register.OperationMode),
      };  
      return settings;
    }

    async fetchActiveWeekProgramForDateTime(dateTime: DateTime): Promise<WeekScheduleRecord> {
      // Note: There's a second week program register, which is currently ignored!
      return this.readWeekProgramRegister(Register.FistWeekProgram, 14)
        .then((weekSchedule) => {
          if (weekSchedule.length === 0) {
            throw Error('Week schedule empty.');
          }
          return this.findCurrentActiveWeekRecord(weekSchedule, dateTime);
        });
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
      if (value < 5 || value > 65) {
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
      // Convert to modbus format (adjust negative values and get rid of floating point precision)
      const modbusValue = Math.floor(value < 0 ? (value * 10) + 65535 : (value * 10));
      return this.writeSingleRegister(register, modbusValue);
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

    private findCurrentActiveWeekRecord(records: Array<WeekScheduleRecord>, time: DateTime): WeekScheduleRecord {
      // We create a fake schedule record based on the current time.
      // After sorting we just take the preceding entry as the currently
      // active schedule record.
      const fakeRecord: WeekScheduleRecord = {
        weekDay: time.weekDay,
        hour: time.hour,
        minute: time.minute,
        temperature: Number.MAX_SAFE_INTEGER,
        dhwTemperature: Number.MAX_SAFE_INTEGER,
        flags: Number.MAX_SAFE_INTEGER,
        fanSpeed: Number.MAX_SAFE_INTEGER,
      };

      records.push(fakeRecord);

      records.sort(
        (a, b) => {          
          if (a.weekDay === b.weekDay) {
            if (a.hour === b.hour) {
              if (a.minute === b.minute) {
                return a.temperature > b.temperature ? 1 : -1;
              }
              return a.minute > b.minute ? 1 : -1;
            }
            return a.hour > b.hour ? 1 : -1;
          }
          return a.weekDay > b.weekDay ? 1 : -1;
        });
      
      const index = records.indexOf(fakeRecord);
      if (index === 0) {
        return records[records.length - 1];
      }
      return records[index - 1];
    }
}
