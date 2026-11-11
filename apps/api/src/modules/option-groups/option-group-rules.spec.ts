import { groupRangeProblem, groupWarnings } from './option-group-rules';

describe('groupRangeProblem', () => {
  it('accepts optional (0..n) and required (n..m) groups', () => {
    expect(groupRangeProblem(0, 1)).toBeNull();
    expect(groupRangeProblem(1, 1)).toBeNull();
    expect(groupRangeProblem(2, 5)).toBeNull();
    expect(groupRangeProblem(50, 50)).toBeNull();
  });

  it('refuses what the database CHECK would refuse, with a sentence for the panel', () => {
    expect(groupRangeProblem(-1, 3)).toMatch(/negativo/);
    expect(groupRangeProblem(0, 0)).toMatch(/entre 1 e 50/);
    expect(groupRangeProblem(0, 51)).toMatch(/entre 1 e 50/);
    expect(groupRangeProblem(3, 2)).toMatch(/maior que o máximo/);
    expect(groupRangeProblem(0.5, 2)).toMatch(/negativo/);
  });
});

describe('groupWarnings', () => {
  const option = (
    over: Partial<{ active: boolean; soldOut: boolean; maxQuantity: number }> = {},
  ) => ({
    active: true,
    soldOut: false,
    maxQuantity: 1,
    ...over,
  });

  it('a healthy group, an optional empty group and an inactive group have nothing to warn', () => {
    expect(groupWarnings({ minSelect: 1, active: true, options: [option()] })).toEqual([]);
    expect(groupWarnings({ minSelect: 0, active: true, options: [] })).toEqual([]);
    expect(groupWarnings({ minSelect: 1, active: false, options: [] })).toEqual([]);
  });

  it('warns when a required group has no available option (its products show as sold out)', () => {
    expect(
      groupWarnings({
        minSelect: 1,
        active: true,
        options: [option({ soldOut: true }), option({ active: false })],
      }),
    ).toEqual([expect.stringMatching(/esgotados/)]);
  });

  it('warns when the minimum cannot be reached with what is available', () => {
    expect(
      groupWarnings({
        minSelect: 3,
        active: true,
        options: [option(), option({ maxQuantity: 1 })],
      }),
    ).toEqual([expect.stringMatching(/mínimo \(3\).*\(2\)/)]);
    expect(
      groupWarnings({ minSelect: 3, active: true, options: [option({ maxQuantity: 3 })] }),
    ).toEqual([]);
  });
});
