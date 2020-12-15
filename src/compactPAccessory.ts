import { read } from 'fs';
import { Service, PlatformAccessory } from 'homebridge';
import { OperationMode, PauseOption, VentilationMode } from './cts700Data';
import { CTS700Modbus } from './cts700Modbus';

import { NilanHomebridgePlatform } from './platform';

export class CompactPPlatformAccessory {
  private ventilationFanService: Service;
  private ventilationThermostatService: Service;
  private dhwThermostatService: Service;
  private outsideTemperatureSensorService: Service;
  private panelTemperatureSensorService: Service;
  
  private cts700Modbus: CTS700Modbus;

  constructor(
    private readonly platform: NilanHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.cts700Modbus = new CTS700Modbus(); 

    // Accessory information
    this.accessory.getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Nilan')
      .setCharacteristic(platform.Characteristic.Model, 'Compact P')
      .setCharacteristic(platform.Characteristic.SerialNumber, 'nilan-compact-p-001');

    this.ventilationFanService = this.setUpVentilationFan(platform, accessory);
    this.ventilationThermostatService = this.setUpVentilationThermostat(platform, accessory);
    this.dhwThermostatService = this.setUpDHWThermostat(platform, accessory);
    this.outsideTemperatureSensorService = this.setUpOutsideTemperatureSensor(platform, accessory);
    this.panelTemperatureSensorService = this.setUpPanelTemperatureSensor(platform, accessory);

    setInterval(() => {
      this.updateFromDevice(platform);
    }, 10000);
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
      this.ventilationThermostatService.updateCharacteristic(c.TargetTemperature, settings.desiredRoomTemperature);
      this.dhwThermostatService.updateCharacteristic(c.TargetTemperature, settings.desiredDHWTemperature);
    } catch (e) {
      this.platform.log.error('Could not update readings.', e.message);
    }
  }
}
