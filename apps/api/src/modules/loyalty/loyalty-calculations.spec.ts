import { creditWithinLimit, earnedPoints, MAX_POINTS_BALANCE } from './loyalty-calculations';

describe('earnedPoints', () => {
  it('gives pointsPerReal points for each whole real paid for the items', () => {
    expect(earnedPoints({ subtotalCents: 2500, discountCents: 0 }, 1)).toBe(25);
    expect(earnedPoints({ subtotalCents: 2500, discountCents: 0 }, 3)).toBe(75);
  });

  it('rounds down: cents below one real earn nothing', () => {
    expect(earnedPoints({ subtotalCents: 2599, discountCents: 0 }, 1)).toBe(25);
    expect(earnedPoints({ subtotalCents: 199, discountCents: 0 }, 10)).toBe(10);
    expect(earnedPoints({ subtotalCents: 99, discountCents: 0 }, 10)).toBe(0);
  });

  it('counts only what was paid after the discount', () => {
    expect(earnedPoints({ subtotalCents: 2500, discountCents: 500 }, 1)).toBe(20);
    expect(earnedPoints({ subtotalCents: 2500, discountCents: 2450 }, 1)).toBe(0);
    expect(earnedPoints({ subtotalCents: 2500, discountCents: 2500 }, 5)).toBe(0);
  });

  it('never earns from nothing, from a negative value or from a broken input', () => {
    expect(earnedPoints({ subtotalCents: 0, discountCents: 0 }, 1)).toBe(0);
    expect(earnedPoints({ subtotalCents: -500, discountCents: 0 }, 1)).toBe(0);
    expect(earnedPoints({ subtotalCents: 2500, discountCents: -1 }, 1)).toBe(0);
    expect(earnedPoints({ subtotalCents: 2500, discountCents: 3000 }, 1)).toBe(0);
    expect(earnedPoints({ subtotalCents: 2500, discountCents: 0 }, 0)).toBe(0);
    expect(earnedPoints({ subtotalCents: 25.5, discountCents: 0 }, 1)).toBe(0);
    expect(earnedPoints({ subtotalCents: Number.NaN, discountCents: 0 }, 1)).toBe(0);
  });

  it('is always a whole number inside the balance range', () => {
    const points = earnedPoints({ subtotalCents: 2_147_483_647, discountCents: 0 }, 1000);
    expect(Number.isInteger(points)).toBe(true);
    expect(points).toBe(MAX_POINTS_BALANCE);
  });
});

describe('creditWithinLimit', () => {
  it('passes a normal credit through', () => {
    expect(creditWithinLimit(100, 25)).toBe(25);
  });

  it('trims a credit that would leave the range, and gives nothing to a full account', () => {
    expect(creditWithinLimit(MAX_POINTS_BALANCE - 10, 25)).toBe(10);
    expect(creditWithinLimit(MAX_POINTS_BALANCE, 25)).toBe(0);
  });
});
