# Changelog

## 2.0.0-beta.2

### Fixed

- Constrained the hot-water thermostat to Off and Heat and reject unsupported
  Cool or Auto requests from HomeKit clients.

## 2.0.0-beta.1

### Upgrade notes

- Node.js 22.10 or newer in the Node 22 or Node 24 release lines is required.
- Homebridge 1.8 and 2.x are supported.
- Existing accessory UUIDs and HomeKit service identities are preserved.

### Changed

- Week schedules are now read without copying schedule values into user
  registers. Room and hot-water overrides are tracked independently, and
  recent validated overrides survive short Homebridge restarts.
- Fan speed now reports the controller's effective inlet-fan output, including
  automatic adjustments made for humidity, cooling, or system balancing.
- Fan pause and hot-water pause updates are serialized so concurrent HomeKit
  actions cannot overwrite each other in the shared controller register.
- Filter maintenance is exposed using the controller's time-based inlet and
  outlet filter counters. Invalid counters no longer interrupt unrelated
  polling updates.
- The TypeScript, lint, test, Homebridge, and Node.js toolchain has been
  modernized. The expanded mocked test suite covers protocol conversions,
  reconnects, schedules, overrides, pause behavior, and HomeKit mappings.

### Added

- Read-only CTS 700 diagnostic and settings-inventory commands for hardware
  investigation without controller writes.
- Automated GitHub Release publishing to npm using trusted publishing and
  provenance.
- CI on Node.js 22 and 24, dependency review, CodeQL analysis, Dependabot,
  security policy, contribution guidance, and coding-agent instructions.

### Fixed

- Corrected signed register decoding, temperature limits and scaling, schedule
  boundary handling, Modbus reconnect behavior, and failed-write state
  tracking.
- Improved warnings for connection failures and missing device configuration.
- Repaired README images and replaced the unavailable CTS 700 register-manual
  link with a preserved revision.
- Reduced the published package by excluding development screenshots and other
  repository-only assets.
