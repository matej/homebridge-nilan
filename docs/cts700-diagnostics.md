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
- the active record selected from the three week-program segments;
- raw temperature register values alongside their Celsius decoding.

Use `--help` to see the optional TCP port and unit ID arguments.

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
