import { describe, expect, it } from 'vitest';

import type { WeekScheduleRecord } from '../src/cts700Data';
import { CTS700TargetResolver, type UserTargets } from '../src/cts700TargetResolver';

const userTargets: UserTargets = {
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
  it('defaults ambiguous temperature targets to the schedule after startup', () => {
    const resolver = new CTS700TargetResolver();

    expect(resolver.resolveAutomaticTargets(userTargets, sundayNight)).toEqual({
      roomTemperature: 22,
      dhwTemperature: 50,
      sources: {
        roomTemperature: 'schedule',
        dhwTemperature: 'schedule',
      },
    });
  });

  it('keeps explicit HomeKit target overrides until the schedule record changes', () => {
    const resolver = new CTS700TargetResolver();
    resolver.resolveAutomaticTargets(userTargets, sundayNight);
    resolver.markUserOverride('roomTemperature');

    expect(resolver.resolveAutomaticTargets(userTargets, sundayNight)).toMatchObject({
      roomTemperature: 23,
      dhwTemperature: 50,
      sources: {
        roomTemperature: 'user',
        dhwTemperature: 'schedule',
      },
    });

    const mondayMorning = { ...sundayNight, weekDay: 1, hour: 6, temperature: 21 };
    expect(resolver.resolveAutomaticTargets(userTargets, mondayMorning)).toMatchObject({
      roomTemperature: 21,
      sources: {
        roomTemperature: 'schedule',
      },
    });
  });

  it('detects independent user-register changes made by the CTS700 UI or another client', () => {
    const resolver = new CTS700TargetResolver();
    resolver.resolveAutomaticTargets(userTargets, sundayNight);

    const changedTargets = { roomTemperature: 24, dhwTemperature: 52 };
    expect(resolver.resolveAutomaticTargets(changedTargets, sundayNight)).toMatchObject({
      roomTemperature: 24,
      dhwTemperature: 52,
      sources: {
        roomTemperature: 'user',
        dhwTemperature: 'user',
      },
    });
  });

  it('falls back to user targets when there is no active schedule', () => {
    const resolver = new CTS700TargetResolver();

    expect(resolver.resolveAutomaticTargets(userTargets, null)).toEqual({
      ...userTargets,
      sources: {
        roomTemperature: 'user',
        dhwTemperature: 'user',
      },
    });
  });
});
