const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calendar,dayKey,dayBounds,autoWeeks}=require('../resources/activity');
test('calendar spans complete Monday-based weeks, counts own supplied commits, and skips future timestamps',()=>{
  const now=new Date(2026,9,10,12),today=now.getTime()/1000,yesterday=new Date(2026,9,9,10).getTime()/1000;
  const c=calendar([today,yesterday,yesterday,today+86400,0],13,now);
  assert.equal(c.days.length,91);assert.equal(c.start.getDay(),1);assert.equal(c.commits,3);assert.equal(c.activeDays,2);
  assert.equal(c.days.find(d=>d.key==='2026-10-09').count,2);assert.equal(c.days.at(-1).future,true);
  assert.equal(calendar([],52,now).days.length,364);
  assert.equal(autoWeeks(280),13);assert.equal(autoWeeks(450),26);assert.equal(autoWeeks(900),52);
});
test('local day filters handle DST and boundaries with UTC timestamps for remote hosts',()=>{
  const previous=process.env.TZ;process.env.TZ='America/New_York';
  try {
    const spring=dayBounds('2026-03-08'),autumn=dayBounds('2026-11-01');
    assert.equal((Date.parse(spring.until)-Date.parse(spring.since))/1000+1,23*3600);
    assert.equal((Date.parse(autumn.until)-Date.parse(autumn.since))/1000+1,25*3600);
    assert.equal(spring.since,'2026-03-08T05:00:00Z');
    assert.equal(dayKey(new Date('2026-03-09T03:59:59Z')),'2026-03-08');
    assert.throws(()=>dayBounds('2026-02-30'));assert.throws(()=>dayBounds('invalid'));
  } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
