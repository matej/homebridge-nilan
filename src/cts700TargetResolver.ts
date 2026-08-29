import { isDeepStrictEqual } from 'node:util';

import type { DateTime, WeekScheduleRecord } from './cts700Data';

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

export interface UserTargets {
  roomTemperature: number;
  dhwTemperature: number;
}

export type UserTarget = keyof UserTargets;
type TargetSource = 'schedule' | 'user';

export interface ResolvedTargets extends UserTargets {
  sources: Record<UserTarget, TargetSource>;
}

export interface CTS700TargetResolverSnapshot {
  version: typeof SNAPSHOT_VERSION;
  savedAt: DateTime;
  schedule: WeekScheduleRecord;
  userTargets: UserTargets;
  userOverrides: Record<UserTarget, boolean>;
}

export class CTS700TargetResolver {
  private previousSchedule: WeekScheduleRecord | null | undefined;
  private previousUserTargets?: UserTargets;
  private readonly userOverrides: Record<UserTarget, boolean> = {
    roomTemperature: false,
    dhwTemperature: false,
  };

  public markUserOverride(target: UserTarget, value: number): void {
    this.userOverrides[target] = true;
    if (this.previousUserTargets !== undefined) {
      this.previousUserTargets[target] = value;
    }
  }

  public createSnapshot(savedAt: DateTime): CTS700TargetResolverSnapshot | undefined {
    if (this.previousSchedule === undefined || this.previousSchedule === null || this.previousUserTargets === undefined ||
      !Object.values(this.userOverrides).some(Boolean)) {
      return undefined;
    }

    return {
      version: SNAPSHOT_VERSION,
      savedAt: { ...savedAt },
      schedule: { ...this.previousSchedule },
      userTargets: { ...this.previousUserTargets },
      userOverrides: { ...this.userOverrides },
    };
  }

  public restoreSnapshot(
    value: unknown,
    currentTime: DateTime,
    currentSchedule: WeekScheduleRecord | null,
    currentUserTargets: UserTargets,
  ): boolean {
    if (!this.isSnapshot(value) || currentSchedule === null || !isDeepStrictEqual(value.schedule, currentSchedule) ||
      !isDeepStrictEqual(value.userTargets, currentUserTargets)) {
      return false;
    }

    const savedAt = this.dateTimeMilliseconds(value.savedAt);
    const now = this.dateTimeMilliseconds(currentTime);
    const age = now - savedAt;
    if (!Number.isFinite(age) || age < 0 || age > SNAPSHOT_MAX_AGE_MS) {
      return false;
    }

    this.previousSchedule = { ...currentSchedule };
    this.previousUserTargets = { ...currentUserTargets };
    Object.assign(this.userOverrides, value.userOverrides);
    return true;
  }

  public useUserTargets(userTargets: UserTargets): ResolvedTargets {
    this.previousSchedule = undefined;
    this.previousUserTargets = { ...userTargets };
    this.clearUserOverrides();
    return {
      ...userTargets,
      sources: this.sources('user'),
    };
  }

  public resolveAutomaticTargets(
    userTargets: UserTargets,
    schedule: WeekScheduleRecord | null,
  ): ResolvedTargets {
    const scheduleChanged = this.previousSchedule !== undefined && !isDeepStrictEqual(schedule, this.previousSchedule);
    if (scheduleChanged) {
      this.clearUserOverrides();
    }

    this.detectChangedUserTargets(userTargets);

    this.previousSchedule = schedule;
    this.previousUserTargets = { ...userTargets };

    if (schedule === null) {
      return {
        ...userTargets,
        sources: this.sources('user'),
      };
    }

    return {
      roomTemperature: this.userOverrides.roomTemperature ? userTargets.roomTemperature : schedule.temperature,
      dhwTemperature: this.userOverrides.dhwTemperature ? userTargets.dhwTemperature : schedule.dhwTemperature,
      sources: {
        roomTemperature: this.userOverrides.roomTemperature ? 'user' : 'schedule',
        dhwTemperature: this.userOverrides.dhwTemperature ? 'user' : 'schedule',
      },
    };
  }

  private detectChangedUserTargets(userTargets: UserTargets): void {
    if (this.previousUserTargets === undefined) {
      return;
    }

    for (const target of Object.keys(userTargets) as UserTarget[]) {
      if (userTargets[target] !== this.previousUserTargets[target]) {
        this.userOverrides[target] = true;
      }
    }
  }

  private clearUserOverrides(): void {
    for (const target of Object.keys(this.userOverrides) as UserTarget[]) {
      this.userOverrides[target] = false;
    }
  }

  private sources(source: TargetSource): Record<UserTarget, TargetSource> {
    return {
      roomTemperature: source,
      dhwTemperature: source,
    };
  }

  private isSnapshot(value: unknown): value is CTS700TargetResolverSnapshot {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const snapshot = value as Partial<CTS700TargetResolverSnapshot>;
    return snapshot.version === SNAPSHOT_VERSION &&
      this.isDateTime(snapshot.savedAt) &&
      this.isSchedule(snapshot.schedule) &&
      this.isUserTargets(snapshot.userTargets) &&
      this.isUserOverrides(snapshot.userOverrides) &&
      Object.values(snapshot.userOverrides).some(Boolean);
  }

  private isDateTime(value: unknown): value is DateTime {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const dateTime = value as Partial<DateTime>;
    return this.isIntegerInRange(dateTime.second, 0, 59) &&
      this.isIntegerInRange(dateTime.minute, 0, 59) &&
      this.isIntegerInRange(dateTime.hour, 0, 23) &&
      this.isIntegerInRange(dateTime.day, 1, 31) &&
      this.isIntegerInRange(dateTime.weekDay, 1, 7) &&
      this.isIntegerInRange(dateTime.month, 1, 12) &&
      this.isIntegerInRange(dateTime.year, 0, 38);
  }

  private isSchedule(value: unknown): value is WeekScheduleRecord {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const schedule = value as Partial<WeekScheduleRecord>;
    return this.isIntegerInRange(schedule.weekDay, 1, 7) &&
      this.isIntegerInRange(schedule.hour, 0, 23) &&
      this.isIntegerInRange(schedule.minute, 0, 59) &&
      typeof schedule.temperature === 'number' && schedule.temperature >= 5 && schedule.temperature <= 50 &&
      typeof schedule.dhwTemperature === 'number' && schedule.dhwTemperature >= 10 && schedule.dhwTemperature <= 60 &&
      this.isIntegerInRange(schedule.flags, -128, 255) &&
      this.isIntegerInRange(schedule.fanSpeed, 0, 100);
  }

  private isUserTargets(value: unknown): value is UserTargets {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const targets = value as Partial<UserTargets>;
    return typeof targets.roomTemperature === 'number' && targets.roomTemperature >= 5 && targets.roomTemperature <= 50 &&
      typeof targets.dhwTemperature === 'number' && targets.dhwTemperature >= 10 && targets.dhwTemperature <= 65;
  }

  private isUserOverrides(value: unknown): value is Record<UserTarget, boolean> {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const overrides = value as Partial<Record<UserTarget, boolean>>;
    return typeof overrides.roomTemperature === 'boolean' && typeof overrides.dhwTemperature === 'boolean';
  }

  private isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
  }

  private dateTimeMilliseconds(value: DateTime): number {
    const milliseconds = Date.UTC(2000 + value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
    const normalized = new Date(milliseconds);
    if (normalized.getUTCFullYear() !== 2000 + value.year || normalized.getUTCMonth() !== value.month - 1 ||
      normalized.getUTCDate() !== value.day) {
      return Number.NaN;
    }
    return milliseconds;
  }
}
