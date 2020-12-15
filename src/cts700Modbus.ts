//const ModbusRTU = require('modbus-serial');

import { read } from 'fs';
import ModbusRTU from 'modbus-serial';
import {OperationMode, PauseOption, Readings, Register, Settings, VentilationMode} from './cts700Data';

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
        actualHumidity: await this.readPercentageRegister(Register.ActualHumidity),
        dhwTankTopTemperature: await this.readTemperatureRegister(Register.DHWTopTankTemperature),
      };  
      return readings;
    }

    async fetchSettings(): Promise<Settings> {
      const settings: Settings = {
        paused: await this.readPauseRegister(Register.Pause),
        fanSpeed: await this.readPercentageRegister(Register.FanSpeed),
        desiredRoomTemperature: await this.readTemperatureRegister(Register.DesiredRoomTemperature),
        desiredDHWTemperature: await this.readTemperatureRegister(Register.DHWSetPoint),
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
            throw Error('Invalid value.');
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

    private async readSingleRegister(register: Register): Promise<number> {
      return this.client.readHoldingRegisters(register, 1)
        .then((result) => {
          if (result.data.length === 0) {
            throw Error('No result returned.');
          }
          return result.data[0];
        });
    }
}
