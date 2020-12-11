import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { NilanHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CompactPPlatformAccessory {
  private ventilationFanService: Service;
  private ventilationThermostatService: Service;
  private dhwThermostatService: Service;
  private outsideTemperatureSensorService: Service;
  

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private compactPState = {
    VentilationFanSpeed: 65,
    DesiredTemperature: 24,
    CurrentTemperature: 23,
    CurrentHumidity: 46,
    DHWTankTopTemperature: 47,
    DesiredDHWTemperature: 49,
    CurrentOutsideTemperature: 2,
  };

  constructor(
    private readonly platform: NilanHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // Accessory information
    this.accessory.getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Nilan')
      .setCharacteristic(platform.Characteristic.Model, 'Compact P')
      .setCharacteristic(platform.Characteristic.SerialNumber, 'nilan-compact-p-001');

    this.ventilationFanService = this.setUpVentilationFan(platform, accessory);
    this.ventilationThermostatService = this.setUpVentilationThermostat(platform, accessory);
    this.dhwThermostatService = this.setUpDHWThermostat(platform, accessory);
    this.outsideTemperatureSensorService = this.setUpOutsideTemperatureSensor(platform, accessory);
  }

  setUpVentilationFan(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Ventilation fan service
    // https://developers.homebridge.io/#/service/Fanv2
    const ventilationFanService = this.accessory.getServiceById(platform.Service.Fanv2, 'compact-p-fan') || 
      accessory.addService(platform.Service.Fanv2, 'Ventilation Fan', 'compact-p-fan');
    
    ventilationFanService.updateCharacteristic(platform.Characteristic.Active, platform.Characteristic.Active.ACTIVE);

    ventilationFanService.getCharacteristic(platform.Characteristic.RotationSpeed).setProps({
      minValue: 20,
      maxValue: 100,
      minStep: 5,
    });

    ventilationFanService.updateCharacteristic(platform.Characteristic.RotationSpeed, this.compactPState.VentilationFanSpeed);

    setInterval(() => {
      // push the new value to HomeKit
      ventilationFanService.updateCharacteristic(platform.Characteristic.RotationSpeed, this.compactPState.VentilationFanSpeed);
    }, 10000);

    return ventilationFanService;
  }

  setUpVentilationThermostat(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Domestic Hot Water (DHW) thermostat service
    // see https://developers.homebridge.io/#/service/Thermostat
    const ventilationThermostatService = this.accessory.getServiceById(platform.Service.Thermostat, 'compact-p-temperature') || 
      accessory.addService(platform.Service.Thermostat, 'Temperature', 'compact-p-temperature');

    ventilationThermostatService.updateCharacteristic(platform.Characteristic.CurrentHeatingCoolingState, 
      platform.Characteristic.CurrentHeatingCoolingState.HEAT);

    ventilationThermostatService.updateCharacteristic(platform.Characteristic.TargetHeatingCoolingState, 
      platform.Characteristic.TargetHeatingCoolingState.AUTO);

    ventilationThermostatService.updateCharacteristic(platform.Characteristic.TemperatureDisplayUnits, 
      platform.Characteristic.TemperatureDisplayUnits.CELSIUS);

    ventilationThermostatService.getCharacteristic(platform.Characteristic.TargetTemperature).setProps({
      minValue: 5,
      maxValue: 50,
      minStep: 0.5,
    });

    ventilationThermostatService.updateCharacteristic(platform.Characteristic.CurrentTemperature, 
      this.compactPState.CurrentTemperature);
    ventilationThermostatService.updateCharacteristic(platform.Characteristic.TargetTemperature, 
      this.compactPState.DesiredTemperature);
    ventilationThermostatService.updateCharacteristic(platform.Characteristic.CurrentRelativeHumidity, 
      this.compactPState.CurrentHumidity);

    setInterval(() => {
      // push the new value to HomeKit
      ventilationThermostatService.updateCharacteristic(platform.Characteristic.CurrentTemperature, 
        this.compactPState.CurrentTemperature);
      ventilationThermostatService.updateCharacteristic(platform.Characteristic.TargetTemperature, 
        this.compactPState.DesiredTemperature);
      ventilationThermostatService.updateCharacteristic(platform.Characteristic.CurrentRelativeHumidity, 
        this.compactPState.CurrentHumidity);
    }, 10000);

    return ventilationThermostatService;
  }

  setUpDHWThermostat(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Domestic Hot Water (DHW) thermostat service
    // see https://developers.homebridge.io/#/service/Thermostat
    const dhwThermostatService = this.accessory.getServiceById(platform.Service.Thermostat, 'compact-p-dhw') || 
      accessory.addService(platform.Service.Thermostat, 'Hot Water', 'compact-p-dhw');

    dhwThermostatService.updateCharacteristic(platform.Characteristic.CurrentHeatingCoolingState, 
      platform.Characteristic.CurrentHeatingCoolingState.HEAT);
    dhwThermostatService.getCharacteristic(platform.Characteristic.CurrentHeatingCoolingState).setProps({
      validValues: [platform.Characteristic.CurrentHeatingCoolingState.OFF, platform.Characteristic.CurrentHeatingCoolingState.HEAT],
    });
    
    dhwThermostatService.updateCharacteristic(platform.Characteristic.TargetHeatingCoolingState, 
      platform.Characteristic.TargetHeatingCoolingState.HEAT);
    dhwThermostatService.getCharacteristic(platform.Characteristic.TargetHeatingCoolingState).setProps({
      validValues: [platform.Characteristic.TargetHeatingCoolingState.OFF, platform.Characteristic.TargetHeatingCoolingState.HEAT],
    });

    dhwThermostatService.updateCharacteristic(platform.Characteristic.TemperatureDisplayUnits, 
      platform.Characteristic.TemperatureDisplayUnits.CELSIUS);

    dhwThermostatService.getCharacteristic(platform.Characteristic.TargetTemperature).setProps({
      minValue: 5,
      maxValue: 65,
      minStep: 1,
    });

    dhwThermostatService.updateCharacteristic(platform.Characteristic.CurrentTemperature,
      this.compactPState.DHWTankTopTemperature);
    dhwThermostatService.updateCharacteristic(platform.Characteristic.TargetTemperature,
      this.compactPState.DesiredDHWTemperature);

    setInterval(() => {
      // push the new value to HomeKit
      dhwThermostatService.updateCharacteristic(platform.Characteristic.CurrentTemperature,
        this.compactPState.DHWTankTopTemperature);
      dhwThermostatService.updateCharacteristic(platform.Characteristic.TargetTemperature,
        this.compactPState.DesiredDHWTemperature);
    }, 10000);

    return dhwThermostatService;
  }

  setUpOutsideTemperatureSensor(platform: NilanHomebridgePlatform, accessory: PlatformAccessory): Service {
    // Outside temperature sensor service
    // see https://developers.homebridge.io/#/service/TemperatureSensor
    const outsideTemperatureSensorService = this.accessory.getServiceById(platform.Service.TemperatureSensor, 'compact-p-outside-temp') || 
      accessory.addService(platform.Service.TemperatureSensor, 'Outside', 'compact-p-outside-temp');
    
    outsideTemperatureSensorService.getCharacteristic(platform.Characteristic.CurrentTemperature).setProps({
      minValue: -40,
      maxValue: 160,
    });

    outsideTemperatureSensorService.updateCharacteristic(platform.Characteristic.CurrentTemperature,
      this.compactPState.CurrentOutsideTemperature);

    setInterval(() => {
      // push the new value to HomeKit
      outsideTemperatureSensorService.updateCharacteristic(platform.Characteristic.CurrentTemperature,
        this.compactPState.CurrentOutsideTemperature);
    }, 10000);

    return outsideTemperatureSensorService;
  }
  // /**
  //  * Handle "SET" requests from HomeKit
  //  * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
  //  */
  // setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {

  //   // implement your own code to turn your device on/off
  //   //this.exampleStates.On = value as boolean;

  //   this.platform.log.debug('Set Characteristic On ->', value);

  //   // you must call the callback function
  //   callback(null);
  // }

  // /**
  //  * Handle the "GET" requests from HomeKit
  //  * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
  //  * 
  //  * GET requests should return as fast as possbile. A long delay here will result in
  //  * HomeKit being unresponsive and a bad user experience in general.
  //  * 
  //  * If your device takes time to respond you should update the status of your device
  //  * asynchronously instead using the `updateCharacteristic` method instead.

  //  * @example
  //  * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
  //  */
  // getOn(callback: CharacteristicGetCallback) {

  //   // implement your own code to check if the device is on
  //   const isOn = this.exampleStates.On;

  //   this.platform.log.debug('Get Characteristic On ->', isOn);

  //   // you must call the callback function
  //   // the first argument should be null if there were no errors
  //   // the second argument should be the value to return
  //   callback(null, isOn);
  // }

  // /**
  //  * Handle "SET" requests from HomeKit
  //  * These are sent when the user changes the state of an accessory, for example, changing the Brightness
  //  */
  // setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback) {

  //   // implement your own code to set the brightness
  //   this.exampleStates.Brightness = value as number;

  //   this.platform.log.debug('Set Characteristic Brightness -> ', value);

  //   // you must call the callback function
  //   callback(null);
  // }

}
