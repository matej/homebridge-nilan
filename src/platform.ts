import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import fakegato from 'fakegato-history';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { CompactPPlatformAccessory } from './compactPAccessory';

export class NilanHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // This is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private FakeGatoHistoryService;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {

    this.FakeGatoHistoryService = fakegato(api);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Set up accessories from the configuration.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    const devices = this.config.devices;
    if (!Array.isArray(devices)) {
      return;
    }

    for (const device of devices) {
      const host = device.host;
      const name = device.name;
      if (!host || !name) {
        this.log.warn('Encountered a device without required attributes (name / host). Skipping it.');
        continue;
      }

      // We're using the IP as the UUID to avoid making network requests at this point.
      // The IP is a static one. It can technically be changed in the device settings, but that's
      // unlikely enough that we should be fine with this simplification. Worst case HomeKit
      // customization needs to be performed again after an IP change.
      const uuid = this.api.hap.uuid.generate(host);
      // See if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above.
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
      
      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new CompactPPlatformAccessory(this, existingAccessory, this.FakeGatoHistoryService);
          
        // update accessory cache with any changes to the accessory details and information
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', name);

        const accessory = new this.api.platformAccessory(name, uuid);
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `compactPAccessory.ts`
        new CompactPPlatformAccessory(this, accessory, this.FakeGatoHistoryService);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Remove existing accessories that were removed from the configuration.
    for (const existingAccessory of this.accessories) {
      if (devices.find(device => device.host === existingAccessory.context.device.host) === undefined) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      }
    }
  }
}
