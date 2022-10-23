import { Service, PlatformAccessory, CharacteristicEventTypes, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import deepEqual from 'deep-equal';

import { DateTime, OperationMode, PauseOption, VentilationMode, WeekScheduleRecord } from './cts700Data';
import { CTS700Modbus, NumericWriter, WriterParameterTypes } from './cts700Modbus';
import { NilanHomebridgePlatform } from './platform';

export class CompactPPlatformAccessory {
  private ventilationFanService: Service;
  private ventilationThermostatService: Service;
  private dhwThermostatService: Service;
  private outsideTemperatureSensorService: Service;
  private panelTemperatureSensorService: Service;
  
  private cts700Modbus: CTS700Modbus;

  private processedDateTime?: DateTime;
  private processedSchedule?: WeekScheduleRecord;

  constructor(
    private readonly platform: NilanHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.cts700Modbus = new CTS700Modbus(this.accessory.context.device.host, () => {
      this.setUpAfterConnection();
    }); 

    // Accessory information
    this.accessory.getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Nilan A/S')
      .setCharacteristic(platform.Characteristic.Model, 'Compact P');

    this.ventilationFanService = this.setUpVentilationFan(platform, accessory);
    this.ventilationThermostatService = this.setUpVentilationThermostat(platform, accessory);
    this.dhwThermostatService = this.setUpDHWThermostat(platform, accessory);
    this.outsideTemperatureSensorService = this.setUpOutsideTemperatureSensor(platform, accessory);
    this.panelTemperatureSensorService = this.setUpPanelTemperatureSensor(platform, accessory);

    setInterval(() => {
      this.updateFromDevice(platform);
    }, 10000);
  }

  private async setUpAfterConnection() {
    try {
      const metadata = await this.cts700Modbus.fetchMetadata();
      this.platform.log.debug('Updating metadata:', metadata);

      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.SerialNumber, metadata.macAddress)
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, metadata.softwareVersion);

    } catch (e) {
      this.platform.log.error('Could obtain device metadata after connection.', e instanceof Error ? e.message : '');
    }
  }

  private setUpVentilationFan(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Ventilation fan service
    // https://developers.homebridge.io/#/service/Fanv2
    const ventilationFanService = this.accessory.getServiceById(platform.Service.Fanv2, 'compact-p-fan') || 
      accessory.addService(platform.Service.Fanv2, 'Ventilation Fan', 'compact-p-fan');
    
    const c = platform.Characteristic;
    ventilationFanService.getCharacteristic(c.RotationSpeed).setProps({
      minValue: 20,
      maxValue: 100,
      minStep: 5,
    });

    ventilationFanService.getCharacteristic(c.RotationSpeed)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.handleWrite(CTS700Modbus.prototype.writeFanSpeed, value as number, 'Rotation speed', callback);
      });

    ventilationFanService.getCharacteristic(c.Active)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        const pauseOption = value === c.Active.INACTIVE ? PauseOption.Ventilation : PauseOption.Disabled;
        this.handleWrite(CTS700Modbus.prototype.writePauseOption, pauseOption, 'Pause option', callback);
      });

    return ventilationFanService;
  }

  private setUpVentilationThermostat(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Domestic Hot Water (DHW) thermostat service
    // see https://developers.homebridge.io/#/service/Thermostat
    const ventilationThermostatService = this.accessory.getServiceById(platform.Service.Thermostat, 'compact-p-temperature') || 
      accessory.addService(platform.Service.Thermostat, 'Temperature', 'compact-p-temperature');

    const c = platform.Characteristic;
    ventilationThermostatService.updateCharacteristic(c.TemperatureDisplayUnits, c.TemperatureDisplayUnits.CELSIUS);
    ventilationThermostatService.getCharacteristic(platform.Characteristic.TargetTemperature).setProps({
      minValue: 5,
      maxValue: 50,
      minStep: 0.5,
    });

    ventilationThermostatService.getCharacteristic(c.TargetTemperature)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.handleWrite(CTS700Modbus.prototype.writeRoomTemperatureSetPoint, value as number, 'Room temperature', callback);
      });
    
    ventilationThermostatService.getCharacteristic(c.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        let pauseOption: PauseOption;
        let ventilationMode: VentilationMode | null = null;  

        if (value === c.TargetHeatingCoolingState.OFF) {
          pauseOption = PauseOption.Ventilation;
        } else if (value === c.TargetHeatingCoolingState.HEAT) {
          pauseOption = PauseOption.Disabled;
          ventilationMode = VentilationMode.Heating;
        } else if (value === c.TargetHeatingCoolingState.COOL) {
          pauseOption = PauseOption.Disabled;
          ventilationMode = VentilationMode.Cooling;
        } else { //  c.TargetHeatingCoolingState.AUTO
          pauseOption = PauseOption.Disabled;
          ventilationMode = VentilationMode.Auto;
        }

        this.handleWrite(CTS700Modbus.prototype.writePauseOption, pauseOption, 'Pause option', (result) => {
          // Only set ventilation mode if not paused and the previous operation succeeded. 
          if ((ventilationMode !== null) && (result === null)) {
            this.handleWrite(CTS700Modbus.prototype.writeVentilationMode, ventilationMode as VentilationMode, 'Ventilation mode', callback);
          } else {
            callback(result);
          }
        });
      });

    return ventilationThermostatService;
  }

  private setUpDHWThermostat(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Domestic Hot Water (DHW) thermostat service
    // see https://developers.homebridge.io/#/service/Thermostat
    const dhwThermostatService = this.accessory.getServiceById(platform.Service.Thermostat, 'compact-p-dhw') || 
      accessory.addService(platform.Service.Thermostat, 'Hot Water', 'compact-p-dhw');

    const c = platform.Characteristic;
    dhwThermostatService.getCharacteristic(c.CurrentHeatingCoolingState).setProps({
      validValues: [c.CurrentHeatingCoolingState.OFF, c.CurrentHeatingCoolingState.HEAT],
    });
    dhwThermostatService.getCharacteristic(c.TargetHeatingCoolingState).setProps({
      validValues: [c.TargetHeatingCoolingState.OFF, c.TargetHeatingCoolingState.HEAT],
    });
    dhwThermostatService.updateCharacteristic(c.TemperatureDisplayUnits, c.TemperatureDisplayUnits.CELSIUS);
    dhwThermostatService.getCharacteristic(c.TargetTemperature).setProps({
      minValue: 5,
      maxValue: 65,
      minStep: 1,
    });

    dhwThermostatService.getCharacteristic(c.TargetTemperature)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.handleWrite(CTS700Modbus.prototype.writeDHWSetPoint, value as number, 'DHW temperature', callback);
      });

    dhwThermostatService.getCharacteristic(c.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        const pauseOption = value === c.TargetHeatingCoolingState.OFF ? PauseOption.DHW : PauseOption.Disabled;
        this.handleWrite(CTS700Modbus.prototype.writePauseOption, pauseOption, 'Pause option', callback);
      });

    return dhwThermostatService;
  }

  private setUpOutsideTemperatureSensor(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Outside temperature sensor service
    // see https://developers.homebridge.io/#/service/TemperatureSensor
    const outsideTemperatureSensorService = this.accessory.getServiceById(platform.Service.TemperatureSensor, 'compact-p-outside-temp') || 
      accessory.addService(platform.Service.TemperatureSensor, 'Outside', 'compact-p-outside-temp');
    
    const c = platform.Characteristic;
    outsideTemperatureSensorService.getCharacteristic(c.CurrentTemperature).setProps({
      minValue: -40,
      maxValue: 160,
    });

    return outsideTemperatureSensorService;
  }

  private setUpPanelTemperatureSensor(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Panel temperature sensor service
    // see https://developers.homebridge.io/#/service/TemperatureSensor
    const panelTemperatureSensorService = this.accessory.getServiceById(platform.Service.TemperatureSensor, 'compact-p-panel-temp') || 
      accessory.addService(platform.Service.TemperatureSensor, 'Panel', 'compact-p-panel-temp');
    
    const c = platform.Characteristic;
    panelTemperatureSensorService.getCharacteristic(c.CurrentTemperature).setProps({
      minValue: -40,
      maxValue: 160,
    });

    return panelTemperatureSensorService;
  }

  private async updateFromDevice(platform: NilanHomebridgePlatform) {
    try {
      const readings = await this.cts700Modbus.fetchReadings();
      this.platform.log.debug('Updating with readings:', readings);

      const c = platform.Characteristic;

      this.ventilationThermostatService.updateCharacteristic(c.CurrentTemperature, readings.roomTemperature);
      this.outsideTemperatureSensorService.updateCharacteristic(c.CurrentTemperature, readings.outdoorTemperature);
      this.panelTemperatureSensorService.updateCharacteristic(c.CurrentTemperature, readings.panelTemperature);
      this.ventilationThermostatService.updateCharacteristic(c.CurrentRelativeHumidity, readings.actualHumidity);
      this.dhwThermostatService.updateCharacteristic(c.CurrentTemperature, readings.dhwTankTopTemperature);

      // The schedule only has minute precision, so we can ignore checks if at least a minute didn't pass. 
      const normalizedDateTime = readings.currentDateTime;
      normalizedDateTime.second = 0;
      const shouldSkipSchedule = this.accessory.context.device.schedule === false;
      if (!shouldSkipSchedule && !deepEqual(normalizedDateTime, this.processedDateTime)) {
        this.platform.log.debug('Checking week schedule.');
        const activeSchedule = await this.cts700Modbus.fetchActiveWeekProgramForDateTime(readings.currentDateTime);

        if (activeSchedule && !deepEqual(activeSchedule, this.processedSchedule)) {
          this.platform.log.debug('Updating fan temperature, dhw temperature and fan speed to match schedule.',
            activeSchedule.temperature,
            activeSchedule.dhwTemperature,
            activeSchedule.fanSpeed);

          await this.cts700Modbus.writeRoomTemperatureSetPoint(activeSchedule.temperature);
          await this.cts700Modbus.writeDHWSetPoint(activeSchedule.dhwTemperature);
          await this.cts700Modbus.writeFanSpeed(activeSchedule.fanSpeed);

          this.platform.log.debug('Updated fan temperature, dhw temperature and fan speed to match schedule.');

          this.processedSchedule = activeSchedule;
        } else {
          this.platform.log.debug('No updates for week schedule needed.');
        }

        this.processedDateTime = normalizedDateTime;
      }
      
      const settings = await this.cts700Modbus.fetchSettings();
      this.platform.log.debug('Updating with settings:', settings);

      if (settings.paused === PauseOption.Ventilation || settings.paused === PauseOption.All) {
        this.ventilationThermostatService.updateCharacteristic(c.CurrentHeatingCoolingState, c.CurrentHeatingCoolingState.OFF);
        this.ventilationThermostatService.updateCharacteristic(c.TargetHeatingCoolingState, c.TargetHeatingCoolingState.OFF);
        this.ventilationFanService.updateCharacteristic(c.Active, c.Active.INACTIVE);
      } else {
        switch (settings.ventilationMode) {
          case VentilationMode.Auto:
            this.ventilationThermostatService.updateCharacteristic(c.TargetHeatingCoolingState, c.TargetHeatingCoolingState.AUTO);
            break;
          case VentilationMode.Cooling:
            this.ventilationThermostatService.updateCharacteristic(c.TargetHeatingCoolingState, c.TargetHeatingCoolingState.COOL);
            break;
          case VentilationMode.Heating:
            this.ventilationThermostatService.updateCharacteristic(c.TargetHeatingCoolingState, c.TargetHeatingCoolingState.HEAT);
            break;
        }
        switch (settings.operationMode) {
          case OperationMode.Cooling:
            this.ventilationThermostatService.updateCharacteristic(c.CurrentHeatingCoolingState, c.CurrentHeatingCoolingState.COOL);
            break;
          case OperationMode.Heating:
            this.ventilationThermostatService.updateCharacteristic(c.CurrentHeatingCoolingState, c.CurrentHeatingCoolingState.HEAT);
            break;
          default:
            this.ventilationThermostatService.updateCharacteristic(c.CurrentHeatingCoolingState, c.CurrentHeatingCoolingState.OFF);
            break;
        }
        this.ventilationFanService.updateCharacteristic(c.Active, c.Active.ACTIVE);
      }

      if (settings.paused === PauseOption.DHW || settings.paused === PauseOption.All) {
        this.dhwThermostatService.updateCharacteristic(c.CurrentHeatingCoolingState, c.CurrentHeatingCoolingState.OFF);
        this.dhwThermostatService.updateCharacteristic(c.TargetHeatingCoolingState, c.TargetHeatingCoolingState.OFF);
      } else {
        // settings.operationMode === OperationMode.DHW doesn't seem to be reliable for setting CurrentHeatingCoolingState
        // DHW status is not indicated when heating with the compressor. Instead we always indicate heating unless the system is paused.
        this.dhwThermostatService.updateCharacteristic(c.CurrentHeatingCoolingState, c.CurrentHeatingCoolingState.HEAT);
        this.dhwThermostatService.updateCharacteristic(c.TargetHeatingCoolingState, c.TargetHeatingCoolingState.HEAT); 
      }

      this.ventilationFanService.updateCharacteristic(c.RotationSpeed, settings.fanSpeed);
      this.ventilationThermostatService.updateCharacteristic(c.TargetTemperature, settings.roomTemperatureSetPoint);
      this.dhwThermostatService.updateCharacteristic(c.TargetTemperature, settings.dhwTemperatureSetPoint);
    } catch (e) {
      this.platform.log.error('Could not update readings and settings.', e instanceof Error ? e.message : '');
    }
  }

  private async handleWrite(writer: NumericWriter, value: WriterParameterTypes, name: string, callback: CharacteristicSetCallback): 
    Promise<WriterParameterTypes | null> {
      
    this.platform.log.debug(name, 'updating to to:', value);

    return writer.call(this.cts700Modbus, value)
      .then((result) => {
        this.platform.log.debug(name, 'update ok. Wrote:', result);
        callback(null);
        return result;
      })
      .catch((error) => {
        this.platform.log.debug(name, 'update failed. Error:', error.message);
        callback(error);
        return null;
      });
  }
}
