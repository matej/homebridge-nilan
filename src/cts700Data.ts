export enum Register {
	// Pause is ID of register holding the pause flag
	// 0 (Disabled)
	// 1 (Pause ventilation)
	// 2 (Pause DHW)
	// 3 (Pause all)
	Pause = 4727,
	// FanSpeed is ID of register holding desired FanSpeed value
	FanSpeed = 4747,
	// DesiredRoomTemperature is ID of register holding desired room temperature in C times 10.
	// Example: 23.5 C is stored as 235.
	RoomTemperatureSetPoint = 4746,
	// MasterSensorTemperature is ID of register holding the temperature that 
	// is used for regulation.
	MasterSensorTemperature = 5088,
	// Temperature at the CTS700 panel
	PanelTemperature = 4713,
	// OutdoorTemperature is ID of register outdoor temperature
	OutdoorTemperature = 5152,
	// ActualHumidity is ID of register holding actual humidity value
	ActualHumidity = 4716,
	// DHWTopTankTemperature is ID of register holding T11 top DHW tank temperature
	DHWTopTankTemperature = 5162,
	// DHWBottomTankTemperature is ID of register holding T12 bottom DHW tank temperature
	DHWBottomTankTemperature = 5163,
	// DHWSetPoint is ID of register holding desired DHW temperature
	DHWTemperatureSetPoint = 5548,
	// Forced operation mode.
	// 0 (Auto)
	// 1 (Cooling)
	// 2 (Heating)
	VentilationMode = 2402,
	// Current regulation mode
	// 0 Mode isn't defined.
	// 1 Cooling mode.
	// 2 Heating mode.
	// 3 Ventilation mode.
	// 4 Hot water mode.
	OperationMode = 5432,
	// Current Date-Time value.
	CurrentTime = 4722,
	// First 14 program records of Week Program.
	FistWeekProgram = 573
  }

export enum PauseOption {
    // Disabled represents no pause option being set
	Disabled = 0,
	// Ventilation represents just ventilation being paused
	Ventilation,
	// DHW represents just hot water production being paused
	DHW,
	// All represents all operations being paused
	All,
  }

export enum VentilationMode {
    // Auto represents automatic heading or cooling operation
	Auto = 0,
	// Cooling represents forced cooling mode
	Cooling,
	// Heating represents forced heating mode
	Heating
  }

export enum OperationMode {
	// Mode isn't defined.
	Undefined = 0,
	// Cooling mode.
	Cooling,
	// Heating mode.
	Heating,
	// Ventilation mode.
	Ventilation,
	// Hot water mode.
	DHW
  }

// Settings of Nilan system
export interface Settings {
    // Paused tells if operation is currently paused
	paused: PauseOption;
	// Fan speed of ventilation (20-100)
	fanSpeed: number;
	// Desired room temperature in C (5-40) times 10
	roomTemperatureSetPoint: number;
	// Desired DHW temperature in C (10-60) times 10
	dhwTemperatureSetPoint: number;
	// Ventilation mode indicates automatic or forced aur conditioning operation
	ventilationMode: VentilationMode;
	// The current operation mode of the unit.
	operationMode: OperationMode;
}

// Readings from Nilan sensors
export interface Readings {
	// Room temperature in C times 10
	roomTemperature: number;
	// Outdoor temperature in C times 10
	outdoorTemperature: number;
	// Panel temperature in C times 10
	panelTemperature: number;
	// Actual humidity of air (0-100%)
	actualHumidity: number;
	// DHW tank top temperature in C times 10
	dhwTankTopTemperature: number;
	// Current device time.
	currentDateTime: DateTime;
}

// Nilan date / time entry
export interface DateTime {
	// Seconds (0 ÷ 59)
	second: number;
	// Minutes (0 ÷ 59)
	minute: number;
	// Hours (0 ÷ 23)
	hour: number;
	// Day (1 ÷ 31)
	day: number;
	// Day of week (1 ÷ 7)
	weekDay: number;
	// Month (1 ÷ 12)
	month: number;
	// Year (0 ÷ 38)
	year: number;
}

// Nilan date / time entry
export interface WeekScheduleRecord {
	// Day of week (1 ÷ 7)
	weekDay: number;
	// Hours (0 ÷ 23)
	hour: number;
	// Minutes (0 ÷ 59)
	minute: number;
	// 50 ÷ 500 (5ºC ÷ 50ºC)
	temperature: number;
	// 100 ÷ 600 (10ºC ÷ 60ºC)
	dhwTemperature: number;
	// Flag bitmask
	flags: number;
	// 0 ÷ 100 (%)
	fanSpeed: number;
}

