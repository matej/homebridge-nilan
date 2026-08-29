import { isDeepStrictEqual } from 'node:util';

import type { WeekScheduleRecord } from './cts700Data';

export interface UserTargets {
  fanSpeed: number;
  roomTemperature: number;
  dhwTemperature: number;
}

export type UserTarget = keyof UserTargets;
type TargetSource = 'schedule' | 'user';

export interface ResolvedTargets extends UserTargets {
  sources: Record<UserTarget, TargetSource>;
}

export class CTS700TargetResolver {
  private previousSchedule: WeekScheduleRecord | null | undefined;
  private previousUserTargets?: UserTargets;
  private readonly userOverrides: Record<UserTarget, boolean> = {
    fanSpeed: false,
    roomTemperature: false,
    dhwTemperature: false,
  };

  public markUserOverride(target: UserTarget): void {
    this.userOverrides[target] = true;
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
      fanSpeed: this.userOverrides.fanSpeed ? userTargets.fanSpeed : schedule.fanSpeed,
      roomTemperature: this.userOverrides.roomTemperature ? userTargets.roomTemperature : schedule.temperature,
      dhwTemperature: this.userOverrides.dhwTemperature ? userTargets.dhwTemperature : schedule.dhwTemperature,
      sources: {
        fanSpeed: this.userOverrides.fanSpeed ? 'user' : 'schedule',
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
      fanSpeed: source,
      roomTemperature: source,
      dhwTemperature: source,
    };
  }
}
