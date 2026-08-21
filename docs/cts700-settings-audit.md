# CTS700 read-only settings audit

`scripts/dump-cts700-settings.mjs` produces a structured JSON report of useful
public CTS700 settings and related observations:

```sh
npm run audit:cts700 -- --host <controller-ip> > cts700-settings-audit.json
```

The script only calls the Modbus `readHoldingRegisters` operation. It contains
no write call, does not perform the CTS700 authentication procedure, and skips
passwords, network identity, write-only clock configuration, and reset
registers.

The report preserves raw values and adds decoded values, enum labels, units,
documented ranges, and access levels from the CTS700 Modbus register manual.
Model-specific or authentication-protected registers are reported rather than
causing the audit to fail.

For software-mode filters, registers 1326–1329 expose the configured replacement
interval and elapsed days. These are the default source for the plugin's HomeKit
filter-life calculation; registers 4692–4693 are also included in the report for
comparison with installations that have hardware deterioration monitoring.

Administrative settings such as humidity fan thresholds, low-outdoor fan
overrides, fan type, VAV pressure targets, and the CAV balancing offset cannot
be inspected without authentication. Authentication is intentionally excluded
because the CTS700 protocol does not provide a strictly read-only login flow.
