//const ModbusRTU = require('modbus-serial');

import { read } from 'fs';
import ModbusRTU from 'modbus-serial';
import { WriteRegisterResult } from 'modbus-serial/ModbusRTU';
import {DateTime, OperationMode, PauseOption, Readings, Register, Settings, VentilationMode, WeekScheduleRecord} from './cts700Data';

export class CTS700Modbus {

    private client: ModbusRTU;

    constructor() {
      
      const client = new ModbusRTU();
      this.client = client;

      // open connection to a tcp line
      client.connectTCP('192.168.5.107', { port: 502 });
      client.setID(1);
    }

    async fetchReadings(): Promise<Readings> {
      const readings: Readings = {
        roomTemperature: await this.readTemperatureRegister(Register.MasterSensorTemperature),
        outdoorTemperature: await this.readTemperatureRegister(Register.OutdoorTemperature),
        panelTemperature: await this.readTemperatureRegister(Register.PanelTemperature),
        actualHumidity: await this.readPercentageRegister(Register.ActualHumidity),
        dhwTankTopTemperature: await this.readTemperatureRegister(Register.DHWTopTankTemperature),
      };
      
      const time = await this.readDateTimeRegister(Register.CurrentTime);
      const week = await this.readWeekProgramRegister(Register.FistWeekProgram, 14);

      if (week.length > 0) {
        readings.activeSchedule = this.findCurrentActiveWeekRecord(week, time);
      }

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
      return this.client.readHoldingRegisters(register, registerCount)
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
      return this.client.readHoldingRegisters(register, registerCount)
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
      return this.client.readHoldingRegisters(register, 1)
        .then((result) => {
          if (result.data.length === 0) {
            throw Error('No result returned.');
          }
          return result.data[0];
        });
    }

    public async writeFanSpeed(value: number) {
      return this.writePercentageRegister(Register.FanSpeed, value);
    }

    public async writeRoomTemperatureSetPoint(value: number) {
      if (value < 5 || value > 50) {
        throw Error('Value outside of acceptable range.');
      }
      return this.writeTemperatureRegister(Register.RoomTemperatureSetPoint, value);
    }

    public async writeDHWSetPoint(value: number) {
      if (value < 5 || value > 65) {
        throw Error('Value outside of acceptable range.');
      }
      return this.writeTemperatureRegister(Register.DHWTemperatureSetPoint, value);
    }

    private async writePercentageRegister(register: Register, value: number): Promise<WriteRegisterResult> {
      if (value < 0 || value > 100) {
        throw Error('Value outside of acceptable range.');
      }
      const modbusValue = Math.floor(value);
      return this.writeSingleRegister(register, modbusValue);
    }

    private async writeTemperatureRegister(register: Register, value: number): Promise<WriteRegisterResult> {
      // Convert to modbus format (adjust negative values and get rid of floating point precision)
      const modbusValue = Math.floor(value < 0 ? (value * 10) + 65535 : (value * 10));
      return this.writeSingleRegister(register, modbusValue);
    }

    private async writeSingleRegister(register: Register, value: number): Promise<WriteRegisterResult> {
      return this.client.writeRegister(register, value)
        .then((result) => {
          if (result.value !== value) {
            throw Error('Setting value failed.');
          }
          return result;
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
