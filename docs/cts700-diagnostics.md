# CTS700 read-only diagnostics

Use `scripts/inspect-cts700.mjs` to observe how a controller changes its working
mode and target registers. The script uses the same `modbus-serial` dependency,
zero-based register addresses, TCP port, and unit ID as the plugin. It never
issues a Modbus write.

## Setup

Run the commands from a checkout of this repository on a computer that can
reach the CTS700 controller:

```sh
nvm use
npm ci
npm run diagnose:cts700 -- --host <controller-ip>
```

The single-line JSON result includes:

- register 1047, decoded as the system working mode;
- user targets from registers 4746, 4747, and 5548;
- actual inlet and outlet fan control values from registers 4699 and 4700;
- fan type and the configured CAV inlet/outlet offset;
- forced-operation and current-regulation modes;
- humidity, outdoor-temperature, and related automatic fan settings;
- computed differences between schedule, user, inlet, and outlet fan values;
- the active and next records selected from the three week-program segments;
- the nearest events from all four year-program segments, without assuming
  undocumented week/year precedence;
- raw temperature register values alongside their Celsius decoding.

Use `--help` to see the optional TCP port and unit ID arguments.
Watch mode opens a fresh connection for every snapshot because some CTS700
firmware closes an idle Modbus TCP connection between samples.

Some administrative fan settings require CTS700 authentication. The diagnostic
tool does not authenticate because that protocol step is not read-only; those
addresses are instead listed under `unsupportedRegisters` and their decoded
values remain `null`.

## Capture a manual override and schedule transition

Start a snapshot every ten seconds and redirect the newline-delimited JSON to a
local file:

```sh
npm run diagnose:cts700 -- --host <controller-ip> --interval 10 --count 0 > cts700-mode-capture.ndjson
```

Then:

1. Leave the controller in its normal week-program state for at least two samples.
2. Change one fan or temperature target through HomeKit or the controller panel.
3. Leave it unchanged for at least two more samples.
4. Wait for the next configured week-program transition.
5. After two post-transition samples, press `Ctrl-C`.

Do not use a generic Modbus tool to write registers as part of this test. The
plugin or controller panel is sufficient to create the manual override. Share
the resulting `.ndjson` file after checking that its setpoint values are not
sensitive; it contains no credentials or controller MAC address.

For a finite five-minute capture, use `--interval 10 --count 30`.

## Observed override behavior

Read-only captures around a real week-schedule transition established that the
CTS700 retains the user fan target in register 4747 while applying the active
schedule value to inlet-fan output register 4699. System working mode 1047
remained `AUTO` before and after the transition. Consequently, working mode does
not identify whether a scheduled or temporary user target is currently active.

The plugin therefore treats changes to user registers as overrides whether they
originate in HomeKit, the control-unit UI, or another Modbus client. Overrides
remain active until the selected schedule record changes. Register 4699 remains
useful diagnostic evidence, but is not used to infer target ownership because
automatic humidity, cooling, fan balancing, and other controller functions can
modify the actual output. Consequently, an override already active when the
plugin starts—or an unchanged value reapplied through the control-unit UI—is
ambiguous and HomeKit conservatively displays the active schedule target.
