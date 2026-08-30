import { describe, expect, it } from 'vitest';

import type { DateTime, WeekScheduleRecord } from '../src/cts700Data';
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

const controllerTime: DateTime = {
  second: 0,
  minute: 5,
  hour: 23,
  day: 16,
  weekDay: 7,
  month: 8,
  year: 26,
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
    resolver.markUserOverride('roomTemperature', 23);

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
    expect(resolver.createSnapshot(controllerTime)).toBeUndefined();
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

  it('restores a recent known override when schedule and user targets are unchanged', () => {
    const original = new CTS700TargetResolver();
    original.resolveAutomaticTargets(userTargets, sundayNight);
    original.markUserOverride('roomTemperature', 23);
    const snapshot = original.createSnapshot(controllerTime);

    const restored = new CTS700TargetResolver();
    const fiveMinutesLater = { ...controllerTime, minute: 10 };
    expect(restored.restoreSnapshot(snapshot, fiveMinutesLater, sundayNight, userTargets)).toBe(true);
    expect(restored.resolveAutomaticTargets(userTargets, sundayNight)).toMatchObject({
      roomTemperature: 23,
      dhwTemperature: 50,
      sources: {
        roomTemperature: 'user',
        dhwTemperature: 'schedule',
      },
    });
  });

  it('rejects stale, changed, or malformed snapshots', () => {
    const original = new CTS700TargetResolver();
    original.resolveAutomaticTargets(userTargets, sundayNight);
    original.markUserOverride('roomTemperature', 23);
    const snapshot = original.createSnapshot(controllerTime);
    const changedSchedule = { ...sundayNight, hour: 22 };
    const changedTargets = { ...userTargets, roomTemperature: 24 };

    expect(new CTS700TargetResolver().restoreSnapshot(
      snapshot,
      { ...controllerTime, minute: 21 },
      sundayNight,
      userTargets,
    )).toBe(false);
    expect(new CTS700TargetResolver().restoreSnapshot(snapshot, controllerTime, changedSchedule, userTargets)).toBe(false);
    expect(new CTS700TargetResolver().restoreSnapshot(snapshot, controllerTime, sundayNight, changedTargets)).toBe(false);
    expect(new CTS700TargetResolver().restoreSnapshot({ version: 1 }, controllerTime, sundayNight, userTargets)).toBe(false);
    expect(new CTS700TargetResolver().restoreSnapshot(
      { ...snapshot!, userOverrides: { roomTemperature: false, dhwTemperature: false } },
      controllerTime,
      sundayNight,
      userTargets,
    )).toBe(false);
  });

  it('rejects snapshots when controller time moves backwards or is not a real calendar date', () => {
    const original = new CTS700TargetResolver();
    original.resolveAutomaticTargets(userTargets, sundayNight);
    original.markUserOverride('roomTemperature', 23);
    const snapshot = original.createSnapshot(controllerTime);

    expect(new CTS700TargetResolver().restoreSnapshot(
      snapshot,
      { ...controllerTime, minute: 4 },
      sundayNight,
      userTargets,
    )).toBe(false);
    expect(new CTS700TargetResolver().restoreSnapshot(
      snapshot,
      { ...controllerTime, day: 30, month: 2 },
      sundayNight,
      userTargets,
    )).toBe(false);
  });

  it('restores a recent override across midnight when the active schedule record is unchanged', () => {
    const beforeMidnight = { ...controllerTime, minute: 55 };
    const afterMidnight: DateTime = {
      ...controllerTime,
      minute: 5,
      hour: 0,
      day: 17,
      weekDay: 1,
    };
    const original = new CTS700TargetResolver();
    original.resolveAutomaticTargets(userTargets, sundayNight);
    original.markUserOverride('roomTemperature', 23);

    expect(new CTS700TargetResolver().restoreSnapshot(
      original.createSnapshot(beforeMidnight),
      afterMidnight,
      sundayNight,
      userTargets,
    )).toBe(true);
  });

  it('does not create persisted state without an active override', () => {
    const resolver = new CTS700TargetResolver();
    resolver.resolveAutomaticTargets(userTargets, sundayNight);

    expect(resolver.createSnapshot(controllerTime)).toBeUndefined();
  });
});
