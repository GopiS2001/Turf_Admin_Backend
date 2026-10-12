import { PlanCode } from '../common/enums';
import { calculatePrice, planCodeFor, PlanRates } from './pricing.calc';

const plans: PlanRates[] = [
  {
    code: PlanCode.WEEKDAY_DAY,
    pricePerHour: 800,
    maxGuests: 14,
    pricePerGuest: 50,
  },
  {
    code: PlanCode.WEEKDAY_NIGHT,
    pricePerHour: 1200,
    maxGuests: 14,
    pricePerGuest: 50,
  },
  {
    code: PlanCode.WEEKEND,
    pricePerHour: 1400,
    maxGuests: 14,
    pricePerGuest: 50,
  },
];

// 2026-10-08 is a Thursday, 2026-10-10 a Saturday.
const THU = '2026-10-08';
const SAT = '2026-10-10';
const h = (hours: number) => hours * 60;

describe('planCodeFor', () => {
  it('uses day rate before 6 PM and night rate from 6 PM on weekdays', () => {
    expect(planCodeFor(THU, h(17) + 30)).toBe(PlanCode.WEEKDAY_DAY);
    expect(planCodeFor(THU, h(18))).toBe(PlanCode.WEEKDAY_NIGHT);
  });

  it('uses the weekend rate all day on Saturday and Sunday', () => {
    expect(planCodeFor(SAT, h(7))).toBe(PlanCode.WEEKEND);
    expect(planCodeFor('2026-10-11', h(22))).toBe(PlanCode.WEEKEND);
  });
});

describe('calculatePrice', () => {
  it('prices a 2-hour weekday morning booking with 2 extra players (matches the website)', () => {
    const p = calculatePrice({
      date: THU,
      startMin: h(7),
      endMin: h(9),
      guests: 16,
      plans,
    });
    expect(p).toMatchObject({
      totalHours: 2,
      turfAmount: 1600,
      additionalGuests: 2,
      additionalGuestAmount: 100,
      totalAmount: 1700,
    });
  });

  it('splits a booking that crosses 6 PM between day and night rates', () => {
    const p = calculatePrice({
      date: THU,
      startMin: h(17),
      endMin: h(19),
      plans,
    });
    expect(p.turfAmount).toBe(800 + 1200);
    expect(p.pricePerHour).toBe(1000);
  });

  it('charges half-hour blocks at half the hourly rate', () => {
    const p = calculatePrice({
      date: SAT,
      startMin: h(18),
      endMin: h(19) + 30,
      plans,
    });
    expect(p.totalHours).toBe(1.5);
    expect(p.turfAmount).toBe(2100);
  });

  it('prefers an explicit additionalGuests count over total guests', () => {
    const p = calculatePrice({
      date: THU,
      startMin: h(20),
      endMin: h(21),
      guests: 30,
      additionalGuests: 1,
      plans,
    });
    expect(p.additionalGuests).toBe(1);
    expect(p.totalAmount).toBe(1250);
  });

  it('never charges for guests at or under the limit', () => {
    const p = calculatePrice({
      date: THU,
      startMin: h(20),
      endMin: h(21),
      guests: 10,
      plans,
    });
    expect(p.additionalGuests).toBe(0);
    expect(p.totalAmount).toBe(1200);
  });

  it('throws when a plan is missing', () => {
    expect(() =>
      calculatePrice({
        date: SAT,
        startMin: h(8),
        endMin: h(9),
        plans: plans.slice(0, 2),
      }),
    ).toThrow(/weekend/);
  });
});
