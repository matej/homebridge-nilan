import { Service, PlatformAccessory, CharacteristicEventTypes, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { isDeepStrictEqual } from 'node:util';

import { DateTime, OperationMode, PauseOption, SystemWorkingMode, VentilationMode, WeekScheduleRecord } from './cts700Data';
import { CTS700Modbus } from './cts700Modbus';
import { CTS700TargetResolver, UserTargets, UserTarget } from './cts700TargetResolver';
import type { NilanHomebridgePlatform } from './platform';

type WriterParameter = boolean | number | PauseOption | VentilationMode;
type ModbusFactory = (host: string, didConnect: () => void) => CTS700Modbus;

export class CompactPPlatformAccessory {
  private ventilationFanService: Service;
  private ventilationThermostatService: Service;
  private dhwThermostatService: Service;
  private outsideTemperatureSensorService: Service;
  private panelTemperatureSensorService: Service;
  private inletFilterMaintenanceService: Service;
  private outletFilterMaintenanceService: Service;
  
  private cts700Modbus: CTS700Modbus;
  private readonly updateInterval: ReturnType<typeof setInterval>;
  private updateInProgress = false;

  private processedDateTime?: DateTime;
  private processedSchedule: WeekScheduleRecord | null = null;
  private readonly targetResolver = new CTS700TargetResolver();

  constructor(
    private readonly platform: NilanHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    modbusFactory: ModbusFactory = (host, didConnect) => new CTS700Modbus(host, didConnect),
  ) {

    this.cts700Modbus = modbusFactory(this.accessory.context.device.host, () => {
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
    this.inletFilterMaintenanceService = this.setUpFilterMaintenance(
      platform,
      accessory,
      'Inlet Filter',
      'compact-p-inlet-filter',
      () => this.cts700Modbus.resetInletFilter(),
    );
    this.outletFilterMaintenanceService = this.setUpFilterMaintenance(
      platform,
      accessory,
      'Outlet Filter',
      'compact-p-outlet-filter',
      () => this.cts700Modbus.resetOutletFilter(),
    );

    this.updateInterval = setInterval(() => {
      void this.updateFromDevice(platform);
    }, 10000);
  }

  public shutdown(): void {
    clearInterval(this.updateInterval);
    this.cts700Modbus.close();
  }

  private async setUpAfterConnection() {
    try {
      const metadata = await this.cts700Modbus.fetchMetadata();
      this.platform.log.debug('Updating metadata:', metadata);

      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.SerialNumber, metadata.macAddress)
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, metadata.softwareVersion);

    } catch (e) {
      this.platform.log.error('Could not obtain device metadata after connection.', e instanceof Error ? e.message : '');
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
        this.handleTargetWrite('fanSpeed', next => this.cts700Modbus.writeFanSpeed(next), value as number, 'Rotation speed', callback);
      });

    ventilationFanService.getCharacteristic(c.Active)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        const paused = value === c.Active.INACTIVE;
        this.handleWrite(next => this.cts700Modbus.writeVentilationPaused(next), paused, 'Ventilation pause', callback);
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
        this.handleTargetWrite(
          'roomTemperature',
          next => this.cts700Modbus.writeRoomTemperatureSetPoint(next),
          value as number,
          'Room temperature',
          callback,
        );
      });
    
    ventilationThermostatService.getCharacteristic(c.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        let paused: boolean;
        let ventilationMode: VentilationMode | null = null;  

        if (value === c.TargetHeatingCoolingState.OFF) {
          paused = true;
        } else if (value === c.TargetHeatingCoolingState.HEAT) {
          paused = false;
          ventilationMode = VentilationMode.Heating;
        } else if (value === c.TargetHeatingCoolingState.COOL) {
          paused = false;
          ventilationMode = VentilationMode.Cooling;
        } else { //  c.TargetHeatingCoolingState.AUTO
          paused = false;
          ventilationMode = VentilationMode.Auto;
        }

        this.handleWrite(next => this.cts700Modbus.writeVentilationPaused(next), paused, 'Ventilation pause', (result) => {
          // Only set ventilation mode if not paused and the previous operation succeeded. 
          if ((ventilationMode !== null) && (result === null)) {
            this.handleWrite(next => this.cts700Modbus.writeVentilationMode(next), ventilationMode as VentilationMode,
              'Ventilation mode', callback);
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
      minValue: 10,
      maxValue: 65,
      minStep: 1,
    });

    dhwThermostatService.getCharacteristic(c.TargetTemperature)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.handleTargetWrite(
          'dhwTemperature',
          next => this.cts700Modbus.writeDHWSetPoint(next),
          value as number,
          'DHW temperature',
          callback,
        );
      });

    dhwThermostatService.getCharacteristic(c.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        const paused = value === c.TargetHeatingCoolingState.OFF;
        this.handleWrite(next => this.cts700Modbus.writeDHWPaused(next), paused, 'DHW pause', callback);
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

  private setUpFilterMaintenance(
    platform: NilanHomebridgePlatform,
    accessory: PlatformAccessory,
    name: string,
    subtype: string,
    reset: () => Promise<number>,
  ): Service {
    const filterMaintenanceService = this.accessory.getServiceById(platform.Service.FilterMaintenance, subtype) ||
      accessory.addService(platform.Service.FilterMaintenance, name, subtype);

    const c = platform.Characteristic;
    filterMaintenanceService.getCharacteristic(c.ResetFilterIndication)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value !== 1) {
          callback(null);
          return;
        }
        this.handleWrite(() => reset(), value as number, `${name} reset`, callback);
      });

    return filterMaintenanceService;
  }

  private async updateFromDevice(platform: NilanHomebridgePlatform) {
    if (this.updateInProgress) {
      this.platform.log.debug('Skipping device update because the previous poll is still running.');
      return;
    }

    this.updateInProgress = true;
    try {
      const readings = await this.cts700Modbus.fetchReadings();
      this.platform.log.debug('Updating with readings:', readings);

      const c = platform.Characteristic;

      this.ventilationThermostatService.updateCharacteristic(c.CurrentTemperature, readings.roomTemperature);
      this.outsideTemperatureSensorService.updateCharacteristic(c.CurrentTemperature, readings.outdoorTemperature);
      this.panelTemperatureSensorService.updateCharacteristic(c.CurrentTemperature, readings.panelTemperature);
      this.ventilationThermostatService.updateCharacteristic(c.CurrentRelativeHumidity, readings.actualHumidity);
      this.dhwThermostatService.updateCharacteristic(c.CurrentTemperature, readings.dhwTankTopTemperature);
      this.updateFilterMaintenance(
        this.inletFilterMaintenanceService,
        readings.inletFilterElapsedDays,
        readings.inletFilterReplacementInterval,
        c,
      );
      this.updateFilterMaintenance(
        this.outletFilterMaintenanceService,
        readings.outletFilterElapsedDays,
        readings.outletFilterReplacementInterval,
        c,
      );

      const settings = await this.cts700Modbus.fetchSettings();
      this.platform.log.debug('Updating with settings:', settings);

      const userTargets: UserTargets = {
        fanSpeed: settings.fanSpeed,
        roomTemperature: settings.roomTemperatureSetPoint,
        dhwTemperature: settings.dhwTemperatureSetPoint,
      };

      const shouldReadSchedule = this.accessory.context.device.schedule !== false &&
        settings.systemWorkingMode === SystemWorkingMode.Auto;
      let displayedTargets;
      if (shouldReadSchedule) {
        // The schedule only has minute precision, so reuse the active record within the same controller minute.
        const normalizedDateTime = { ...readings.currentDateTime, second: 0 };
        if (!isDeepStrictEqual(normalizedDateTime, this.processedDateTime)) {
          this.platform.log.debug('Reading active week schedule entry.');
          this.processedSchedule = await this.cts700Modbus.fetchActiveWeekProgramForDateTime(readings.currentDateTime);
          this.processedDateTime = normalizedDateTime;
        }

        displayedTargets = this.targetResolver.resolveAutomaticTargets(
          userTargets,
          this.processedSchedule,
          readings.inletFanControl,
        );
        this.platform.log.debug('Resolved automatic targets:', displayedTargets);
      } else {
        displayedTargets = this.targetResolver.useUserTargets(userTargets);
      }

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

      this.ventilationFanService.updateCharacteristic(c.RotationSpeed, displayedTargets.fanSpeed);
      this.ventilationThermostatService.updateCharacteristic(c.TargetTemperature, displayedTargets.roomTemperature);
      this.dhwThermostatService.updateCharacteristic(c.TargetTemperature, displayedTargets.dhwTemperature);
    } catch (e) {
      this.platform.log.error('Could not update readings and settings.', e instanceof Error ? e.message : '');
    } finally {
      this.updateInProgress = false;
    }
  }

  private updateFilterMaintenance(
    service: Service,
    elapsedDays: number,
    replacementInterval: number,
    c: NilanHomebridgePlatform['Characteristic'],
  ): void {
    const remainingDays = Math.max(0, replacementInterval - elapsedDays);
    const filterLifeLevel = Math.round(remainingDays / replacementInterval * 100);
    const changeIndication = elapsedDays >= replacementInterval
      ? c.FilterChangeIndication.CHANGE_FILTER
      : c.FilterChangeIndication.FILTER_OK;
    service.updateCharacteristic(c.FilterLifeLevel, filterLifeLevel);
    service.updateCharacteristic(c.FilterChangeIndication, changeIndication);
  }

  private async handleWrite<T extends WriterParameter, R extends WriterParameter>(
    writer: (value: T) => Promise<R>,
    value: T,
    name: string,
    callback: CharacteristicSetCallback,
  ): Promise<R | null> {
      
    this.platform.log.debug(name, 'updating to:', value);

    return writer(value)
      .then((result) => {
        this.platform.log.debug(name, 'update ok. Wrote:', result);
        callback(null);
        return result;
      })
      .catch((error: unknown) => {
        const callbackError = error instanceof Error ? error : new Error(String(error));
        this.platform.log.debug(name, 'update failed. Error:', callbackError.message);
        callback(callbackError);
        return null;
      });
  }

  private async handleTargetWrite(
    target: UserTarget,
    writer: (value: number) => Promise<number>,
    value: number,
    name: string,
    callback: CharacteristicSetCallback,
  ): Promise<number | null> {
    return this.handleWrite(writer, value, name, (error) => {
      if (error === null) {
        this.targetResolver.markUserOverride(target);
      }
      callback(error);
    });
  }
}
