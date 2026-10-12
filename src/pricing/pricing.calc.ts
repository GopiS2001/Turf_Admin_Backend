import { PlanCode } from '../common/enums';
import { money } from '../common/utils/decimal.transformer';
import {
  NIGHT_START_HOUR,
  SLOT_MINUTES,
  isWeekend,
} from '../common/utils/time';

export interface PlanRates {
  code: PlanCode;
  pricePerHour: number;
  maxGuests: number;
  pricePerGuest: number;
}

export interface PriceBreakdown {
  planCode: PlanCode;
  totalHours: number;
  /** Average hourly rate across the booking (rates can differ day vs night). */
  pricePerHour: number;
  turfAmount: number;
  maxGuests: number;
  pricePerGuest: number;
  additionalGuests: number;
  additionalGuestAmount: number;
  totalAmount: number;
}

export function planCodeFor(date: string, minuteOfDay: number): PlanCode {
  if (isWeekend(date)) return PlanCode.WEEKEND;
  return minuteOfDay >= NIGHT_START_HOUR * 60
    ? PlanCode.WEEKDAY_NIGHT
    : PlanCode.WEEKDAY_DAY;
}

/**
 * turfAmount            = Σ rate of each 30-min block / 2
 * additionalGuests      = explicit count, or max(0, guests − maxGuests)
 * additionalGuestAmount = additionalGuests × pricePerGuest
 * totalAmount           = turfAmount + additionalGuestAmount
 * Guest limits come from the plan of the first block.
 */
export function calculatePrice(input: {
  date: string;
  startMin: number;
  endMin: number;
  plans: PlanRates[];
  guests?: number;
  additionalGuests?: number;
}): PriceBreakdown {
  const find = (code: PlanCode) => {
    const plan = input.plans.find((p) => p.code === code);
    if (!plan) throw new Error(`Pricing plan "${code}" is not configured`);
    return plan;
  };

  let turfAmount = 0;
  for (let m = input.startMin; m < input.endMin; m += SLOT_MINUTES) {
    turfAmount +=
      (find(planCodeFor(input.date, m)).pricePerHour * SLOT_MINUTES) / 60;
  }

  const first = find(planCodeFor(input.date, input.startMin));
  const totalHours = (input.endMin - input.startMin) / 60;
  const additionalGuests =
    input.additionalGuests ??
    Math.max(0, (input.guests ?? 0) - first.maxGuests);
  const additionalGuestAmount = money(additionalGuests * first.pricePerGuest);
  turfAmount = money(turfAmount);

  return {
    planCode: first.code,
    totalHours,
    pricePerHour: money(turfAmount / totalHours),
    turfAmount,
    maxGuests: first.maxGuests,
    pricePerGuest: first.pricePerGuest,
    additionalGuests,
    additionalGuestAmount,
    totalAmount: money(turfAmount + additionalGuestAmount),
  };
}
