import { returnPeriods } from '../../src/lib/ignis/science';
import { buildUnified } from '../../src/lib/ignis/analytics';
import type { CalendarDoc } from '../../src/lib/ignis/types';

const doc = JSON.parse(await Bun.file('data/ignis/calendar_amazon.json').text()) as CalendarDoc;
const u = buildUnified(doc);
const annual = new Map<number, { sum: number; n: number }>();
for (const r of u.rows) {
  const y = Number(r.ym.slice(0, 4));
  const a = annual.get(y) || { sum: 0, n: 0 };
  a.sum += r.count; a.n++;
  annual.set(y, a);
}
const annualArr = [...annual.entries()].filter(([, a]) => a.n >= 10).sort((a, b) => a[0] - b[0]).map(([y, a]) => ({ y, total: Math.round(a.sum / (a.n / 12)) }));
console.log('annual rows:', annualArr.length);
console.log(annualArr.slice(0, 5), '...');
const ext = returnPeriods(annualArr);
console.log('fit:', ext.gumbelFit, 'l10:', ext.level10, 'l25:', ext.level25, 'l50:', ext.level50);
console.log('rows T range:', ext.rows[0], '->', ext.rows[ext.rows.length - 1]);
