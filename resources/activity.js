/* Calendar arithmetic runs in the client's timezone, including Remote SSH. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitrismActivity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function dayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function dayBounds(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid calendar day');
    const [year, month, day] = key.split('-').map(Number);
    const start = new Date(year, month-1, day), next = new Date(year, month-1, day+1);
    if (dayKey(start) !== key) throw new Error('Invalid calendar day');
    return { since: start.toISOString().replace('.000Z','Z'), until: new Date(next.getTime()-1000).toISOString().replace('.000Z','Z') };
  }
  function autoWeeks(width) { return width >= 740 ? 52 : width >= 410 ? 26 : 13; }
  function calendar(timestamps, weeks = 13, now = new Date()) {
    if (![13,26,52].includes(weeks)) weeks = 13;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today); start.setDate(start.getDate() - (today.getDay()+6)%7 - (weeks-1)*7);
    const counts = new Map();
    for (const timestamp of timestamps) {
      const date = new Date(timestamp*1000);
      if (Number.isFinite(date.getTime()) && date >= start && date <= now) {
        const key = dayKey(date); counts.set(key, (counts.get(key)||0)+1);
      }
    }
    const days = [], months = []; let previousMonth;
    for (let column=0; column<weeks; column++) for (let row=0; row<7; row++) {
      const date = new Date(start); date.setDate(start.getDate()+column*7+row);
      const key = dayKey(date), count = counts.get(key)||0;
      days.push({ key, date, column, row, count, future: date > today, level: count ? Math.min(4,1+Math.floor(Math.log2(count))) : 0 });
      if (row === 0 && date.getMonth() !== previousMonth) { months.push({column,date}); previousMonth=date.getMonth(); }
    }
    const visible = days.filter(day=>!day.future);
    return { days, months, commits: visible.reduce((total,day)=>total+day.count,0), activeDays: visible.filter(day=>day.count).length, start, end: today, weeks };
  }
  return { dayKey, dayBounds, autoWeeks, calendar };
});
