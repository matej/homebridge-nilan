import { describe, expect, it } from 'vitest';

import type { WeekScheduleRecord } from '../src/cts700Data';
import { CTS700TargetResolver, type UserTargets } from '../src/cts700TargetResolver';

const userTargets: UserTargets = {
  fanSpeed: 65,
  roomTemperature: 23,
  dhwTemperature: 48,
};

const sundayNight: WeekScheduleRecord = {
  weekDay: 7,
  hour: 23,
  minute: 0,
  temperature: 22,
  dhwTemperature: 50,
  flags: 0,
  fanSpeed: 55,
};

describe('CTS700TargetResolver', () => {
  it('uses schedule targets when the fan output confirms scheduled control', () => {
    const resolver = new CTS700TargetResolver();

    expect(resolver.resolveAutomaticTargets(userTargets, sundayNight, 55)).toEqual({
      fanSpeed: 55,
      roomTemperature: 22,
      dhwTemperature: 50,
      sources: {
        fanSpeed: 'schedule',
        roomTemperature: 'schedule',
        dhwTemperature: 'schedule',
      },
    });
  });

  it('keeps explicit HomeKit target overrides until the schedule record changes', () => {
    const resolver = new CTS700TargetResolver();
    resolver.resolveAutomaticTargets(userTargets, sundayNight, 55);
    resolver.markUserOverride('fanSpeed');
    resolver.markUserOverride('roomTemperature');

    expect(resolver.resolveAutomaticTargets(userTargets, sundayNight, 65)).toMatchObject({
      fanSpeed: 65,
      roomTemperature: 23,
      dhwTemperature: 50,
      sources: {
        fanSpeed: 'user',
        roomTemperature: 'user',
        dhwTemperature: 'schedule',
      },
    });

    const mondayMorning = { ...sundayNight, weekDay: 1, hour: 6, temperature: 21 };
    expect(resolver.resolveAutomaticTargets(userTargets, mondayMorning, 65)).toMatchObject({
      fanSpeed: 55,
      roomTemperature: 21,
      sources: {
        fanSpeed: 'schedule',
        roomTemperature: 'schedule',
      },
    });
  });

  it('detects independent user-register changes made by the CTS700 UI or another client', () => {
    const resolver = new CTS700TargetResolver();
    resolver.resolveAutomaticTargets(userTargets, sundayNight, 55);

    const changedTargets = { fanSpeed: 70, roomTemperature: 24, dhwTemperature: 52 };
    expect(resolver.resolveAutomaticTargets(changedTargets, sundayNight, 55)).toMatchObject({
      fanSpeed: 70,
      roomTemperature: 24,
      dhwTemperature: 52,
      sources: {
        fanSpeed: 'user',
        roomTemperature: 'user',
        dhwTemperature: 'user',
      },
    });
  });

  it('detects a same-value fan override from the observed inlet output', () => {
    const resolver = new CTS700TargetResolver();
    resolver.resolveAutomaticTargets(userTargets, sundayNight, 55);

    expect(resolver.resolveAutomaticTargets(userTargets, sundayNight, 65)).toMatchObject({
      fanSpeed: 65,
      sources: { fanSpeed: 'user' },
    });
  });

  it('uses fan output for restart inference but defaults ambiguous temperature targets to the schedule', () => {
    const resolver = new CTS700TargetResolver();

    expect(resolver.resolveAutomaticTargets(userTargets, sundayNight, 65)).toMatchObject({
      fanSpeed: 65,
      roomTemperature: 22,
      dhwTemperature: 50,
      sources: {
        fanSpeed: 'user',
        roomTemperature: 'schedule',
        dhwTemperature: 'schedule',
      },
    });
  });

  it('falls back to user targets when there is no active schedule', () => {
    const resolver = new CTS700TargetResolver();

    expect(resolver.resolveAutomaticTargets(userTargets, null, 65)).toEqual({
      ...userTargets,
      sources: {
        fanSpeed: 'user',
        roomTemperature: 'user',
        dhwTemperature: 'user',
      },
    });
  });
});
