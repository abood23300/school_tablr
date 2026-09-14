// @ts-nocheck
// Edge Function: يستقبل بيانات المدرسة (صفوف/مواد/معلمين) ويرجع الجدول الناتج.
// خوارزمية التوزيع تعمل هنا فقط على الخادم، ولا تصل أبدًا إلى متصفح المستخدم --
// هذا هو الجزء الذي أردنا إخفاءه عن أي شخص يفتح "عرض المصدر" على الموقع المنشور.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'غير مصرّح: سجّل الدخول أولاً' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: 'جلسة غير صالحة، سجّل الدخول من جديد' }, 401);

    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('status, trial_ends_at')
      .eq('user_id', user.id)
      .single();

    if (subError || !subscription) return json({ error: 'تعذّر التحقق من الاشتراك' }, 403);

    const isTrialValid = subscription.status === 'trial' && new Date(subscription.trial_ends_at) > new Date();
    const isActive = subscription.status === 'active';
    if (!isTrialValid && !isActive) {
      return json({ error: 'انتهت فترتك التجريبية أو اشتراكك. تواصل معنا لتفعيل/تجديد الاشتراك.' }, 403);
    }

    const body = await req.json();
    const { school, classes, subjects, teachers } = body || {};
    if (!school || !classes || !subjects || !teachers) return json({ error: 'بيانات ناقصة' }, 400);

    const assignments = generateTimetableCore({ school, classes, subjects, teachers });
    return json({ assignments });
  } catch (err) {
    console.error(err);
    return json({ error: 'خطأ غير متوقع في الخادم: ' + (err?.message || err) }, 500);
  }
});

// ==== خوارزمية توزيع الجدول (منقولة من js/app.js دون تغيير في المنطق) ====
function generateTimetableCore({ school, classes, subjects, teachers }) {
  const workingDays = (school.workingDays || []).slice();
  const slotsPerDay = school.slotsPerDay || 6;

  const slotCategories = Array.from({ length: slotsPerDay }, (_, slot) => {
    if (slotsPerDay <= 0) return `slot-${slot}`;
    if (slotsPerDay <= 3) return `slot-${slot}`;
    const segment = slotsPerDay / 3;
    if (slot < Math.ceil(segment)) return 'early';
    if (slot < Math.ceil(segment * 2)) return 'mid';
    return 'late';
  });
  const categorySlotCounts = new Map();
  slotCategories.forEach(cat => {
    categorySlotCounts.set(cat, (categorySlotCounts.get(cat) || 0) + 1);
  });
  const uniqueSlotCategories = Array.from(new Set(slotCategories));

  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const teacherSubjectRemaining = new Map();
  const teacherTotalLoad = new Map();
  const teacherIdealDailyLoad = new Map();
  const teacherIdealCategoryLoad = new Map();
  teachers.forEach(t => {
    const subjMap = new Map();
    let totalLoad = 0;
    (t.subjects || []).forEach(s => {
      const secMap = new Map();
      Object.entries(s.perSections || {}).forEach(([secId, rawValue]) => {
        const count = Math.max(0, rawValue || 0);
        secMap.set(secId, count);
        totalLoad += count;
      });
      if (secMap.size > 0) subjMap.set(s.subjectId, secMap);
    });
    teacherSubjectRemaining.set(t.id, subjMap);
    teacherTotalLoad.set(t.id, totalLoad);
    const availableDaysCount = workingDays.filter(d => !(t.offDays || []).includes(d)).length || workingDays.length || 1;
    const idealDaily = availableDaysCount ? (totalLoad / availableDaysCount) : totalLoad;
    teacherIdealDailyLoad.set(t.id, idealDaily);
    const catIdealMap = new Map();
    uniqueSlotCategories.forEach(cat => {
      const ratio = (categorySlotCounts.get(cat) || 0) / Math.max(1, slotsPerDay);
      catIdealMap.set(cat, totalLoad * ratio);
    });
    teacherIdealCategoryLoad.set(t.id, catIdealMap);
  });

  const demands = [];
  classes.forEach(cls => {
    const sections = cls.sections && cls.sections.length ? cls.sections : [{ id: cls.id, name: cls.name }];
    sections.forEach(sec => {
      subjects.forEach(sub => {
        const capable = teachers.filter(t => {
          const rec = (t.subjects || []).find(s => s.subjectId === sub.id);
          return rec && rec.perSections && typeof rec.perSections[sec.id] === 'number' && rec.perSections[sec.id] > 0;
        });
        const totalPeriods = capable.reduce((acc, t) => {
          const rec = t.subjects.find(s => s.subjectId === sub.id);
          return acc + (rec.perSections[sec.id] || 0);
        }, 0);
        if (totalPeriods > 0) {
          demands.push({ sectionId: sec.id, classId: cls.id, subjectId: sub.id, remaining: totalPeriods, teachers: capable.map(t => t.id) });
        }
      });
    });
  });

  demands.sort((a, b) => a.teachers.length - b.teachers.length || a.remaining - b.remaining);

  const assignments = [];
  const classBusy = new Map();
  const teacherBusy = new Map();
  const teacherDayLoad = new Map();
  const classDaySubjectCount = new Map();
  const teacherDaySectionCount = new Map();
  const teacherCategoryLoad = new Map();

  function isTeacherAvailable(tid, day, slot) {
    const t = teacherMap.get(tid);
    if (!t) return false;
    if ((t.offDays || []).includes(day)) return false;
    if ((t.forbiddenSlots || []).includes(slot)) return false;
    if (Array.isArray(t.forbiddenDaySlots) && t.forbiddenDaySlots.length) {
      const rule = t.forbiddenDaySlots.find(r => r.day === day);
      if (rule && Array.isArray(rule.slots) && rule.slots.includes(slot)) return false;
    }
    const busyDay = teacherBusy.get(tid)?.get(day);
    if (busyDay && busyDay.has(slot)) return false;
    return true;
  }
  function markBusy(map, id, day, slot) {
    if (!map.has(id)) map.set(id, new Map());
    const dayMap = map.get(id);
    if (!dayMap.has(day)) dayMap.set(day, new Set());
    dayMap.get(day).add(slot);
  }
  function incTeacherDayLoad(tid, day, delta) {
    if (!teacherDayLoad.has(tid)) teacherDayLoad.set(tid, new Map());
    const m = teacherDayLoad.get(tid);
    m.set(day, (m.get(day) || 0) + delta);
  }
  function incClassDaySubject(clsId, day, subjectId, delta) {
    if (!classDaySubjectCount.has(clsId)) classDaySubjectCount.set(clsId, new Map());
    const m = classDaySubjectCount.get(clsId);
    if (!m.has(day)) m.set(day, new Map());
    const sm = m.get(day);
    sm.set(subjectId, (sm.get(subjectId) || 0) + delta);
  }
  function getSlotCategory(slot) {
    return slotCategories[slot] || `slot-${slot}`;
  }
  function adjustTeacherDaySectionCount(tid, day, sectionId, delta) {
    if (!teacherDaySectionCount.has(tid)) teacherDaySectionCount.set(tid, new Map());
    const dayMap = teacherDaySectionCount.get(tid);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    const secMap = dayMap.get(day);
    const next = (secMap.get(sectionId) || 0) + delta;
    if (next <= 0) {
      secMap.delete(sectionId);
      if (secMap.size === 0) dayMap.delete(day);
      if (dayMap.size === 0) teacherDaySectionCount.delete(tid);
    } else {
      secMap.set(sectionId, next);
    }
  }
  function adjustTeacherCategoryLoad(tid, category, delta) {
    if (!teacherCategoryLoad.has(tid)) teacherCategoryLoad.set(tid, new Map());
    const catMap = teacherCategoryLoad.get(tid);
    const next = (catMap.get(category) || 0) + delta;
    if (next <= 0) {
      catMap.delete(category);
      if (catMap.size === 0) teacherCategoryLoad.delete(tid);
    } else {
      catMap.set(category, next);
    }
  }
  function recordAssignment(day, slot, demand, tid) {
    const assignment = { day, slot, sectionId: demand.sectionId, classId: demand.classId, subjectId: demand.subjectId, teacherId: tid };
    assignments.push(assignment);
    indexAssignment(day, slot, assignment);
    markBusy(classBusy, demand.sectionId, day, slot);
    markBusy(teacherBusy, tid, day, slot);
    incTeacherDayLoad(tid, day, 1);
    incClassDaySubject(demand.sectionId, day, demand.subjectId, 1);
    adjustTeacherDaySectionCount(tid, day, demand.sectionId, 1);
    adjustTeacherCategoryLoad(tid, getSlotCategory(slot), 1);
    const subjMap = teacherSubjectRemaining.get(tid);
    const secMap = subjMap?.get(demand.subjectId);
    if (secMap) {
      const current = secMap.get(demand.sectionId) || 0;
      secMap.set(demand.sectionId, current > 0 ? current - 1 : 0);
    }
    demand.remaining--;
  }
  function releaseAssignment(assignment) {
    const { day, slot, sectionId, subjectId, teacherId } = assignment;
    unindexAssignment(day, slot, assignment);
    const classDayMap = classBusy.get(sectionId)?.get(day);
    classDayMap?.delete(slot);
    if (classDayMap && classDayMap.size === 0) {
      classBusy.get(sectionId)?.delete(day);
      if ((classBusy.get(sectionId)?.size || 0) === 0) classBusy.delete(sectionId);
    }
    const teacherDayMap = teacherBusy.get(teacherId)?.get(day);
    teacherDayMap?.delete(slot);
    if (teacherDayMap && teacherDayMap.size === 0) {
      teacherBusy.get(teacherId)?.delete(day);
      if ((teacherBusy.get(teacherId)?.size || 0) === 0) teacherBusy.delete(teacherId);
    }
    incTeacherDayLoad(teacherId, day, -1);
    incClassDaySubject(sectionId, day, subjectId, -1);
    adjustTeacherDaySectionCount(teacherId, day, sectionId, -1);
    adjustTeacherCategoryLoad(teacherId, getSlotCategory(slot), -1);
    const subjMap = teacherSubjectRemaining.get(teacherId);
    const secMap = subjMap?.get(subjectId);
    if (secMap) secMap.set(sectionId, (secMap.get(sectionId) || 0) + 1);
  }

  function calculatePlacementScore(tid, day, slot, demand, assignmentsBySlot) {
    let score = 0;
    const category = getSlotCategory(slot);

    const subjCount = classDaySubjectCount.get(demand.sectionId)?.get(day)?.get(demand.subjectId) || 0;
    if (subjCount > 0) score += 1000 * subjCount;

    const prevKey = `${day}-${slot - 1}`;
    const nextKey = `${day}-${slot + 1}`;
    if (assignmentsBySlot.has(prevKey) || assignmentsBySlot.has(nextKey)) {
      const prevMatch = assignmentsBySlot.get(prevKey)?.some(a => a.sectionId === demand.sectionId && a.subjectId === demand.subjectId);
      const nextMatch = assignmentsBySlot.get(nextKey)?.some(a => a.sectionId === demand.sectionId && a.subjectId === demand.subjectId);
      if (prevMatch || nextMatch) score += 200;
    }

    const classDayLoad = (classBusy.get(demand.sectionId)?.get(day)?.size) || 0;
    score += classDayLoad * 5;

    const tLoad = teacherDayLoad.get(tid)?.get(day) || 0;
    const idealDaily = teacherIdealDailyLoad.get(tid) || 0;
    const dailyCap = Math.max(1, Math.ceil(idealDaily));
    score += tLoad * 120;
    const overCap = (tLoad + 1) - dailyCap;
    if (overCap > 0) score += 700 * Math.pow(overCap, 1.5);

    const sectionRepeatCount = teacherDaySectionCount.get(tid)?.get(day)?.get(demand.sectionId) || 0;
    if (sectionRepeatCount >= 2) {
      score += 1500 * Math.pow(sectionRepeatCount - 1, 1.5);
    } else if (sectionRepeatCount === 1) {
      score += 400;
    } else {
      score -= 10;
    }

    const tBusyDay = teacherBusy.get(tid)?.get(day);
    if (tBusyDay) {
      if (tBusyDay.has(slot - 1)) {
        const prevAssignments = assignmentsBySlot.get(`${day}-${slot - 1}`) || [];
        const prevInSameSection = prevAssignments.some(a => a.teacherId === tid && a.sectionId === demand.sectionId);
        score += prevInSameSection ? 800 : 150;
      }
      if (tBusyDay.has(slot + 1)) {
        const nextAssignments = assignmentsBySlot.get(`${day}-${slot + 1}`) || [];
        const nextInSameSection = nextAssignments.some(a => a.teacherId === tid && a.sectionId === demand.sectionId);
        score += nextInSameSection ? 800 : 150;
      }
      const hasGapBefore = slot > 0 && !tBusyDay.has(slot - 1);
      const hasGapAfter = slot < slotsPerDay - 1 && !tBusyDay.has(slot + 1);
      if (hasGapBefore || hasGapAfter) score -= 30;
    }

    const catMap = teacherCategoryLoad.get(tid);
    const catCount = catMap?.get(category) || 0;
    const idealCat = teacherIdealCategoryLoad.get(tid)?.get(category) ?? ((teacherTotalLoad.get(tid) || 0) / Math.max(1, uniqueSlotCategories.length));
    const catDiff = Math.abs(catCount + 1 - idealCat);
    score += catDiff * 60;
    if (catCount < idealCat) score -= Math.min(idealCat - catCount, 1) * 15;

    if (slot === slotsPerDay - 1) {
      let lastSlotCount = 0;
      workingDays.forEach(d => {
        if (teacherBusy.get(tid)?.get(d)?.has(slotsPerDay - 1)) lastSlotCount++;
      });
      if (lastSlotCount > 0) {
        score += 300 * lastSlotCount;
      } else {
        score += 100;
      }
      const totalTeachers = teachers.length;
      const avgLastSlots = workingDays.length / Math.max(1, totalTeachers);
      if (lastSlotCount > avgLastSlots * 1.2) score += 200;
    } else {
      score -= 15;
    }

    const daysWorked = Array.from(teacherDayLoad.get(tid)?.keys() || []).length;
    const totalDays = workingDays.length;
    const hasWorkedToday = teacherDayLoad.get(tid)?.has(day) && (teacherDayLoad.get(tid)?.get(day) || 0) > 0;
    if (!hasWorkedToday && daysWorked < totalDays) score -= 40;

    if (subjCount === 0) score -= 50;

    score += Math.random() * 0.01;

    return score;
  }

  const assignmentsBySlot = new Map();
  function indexAssignment(day, slot, assignment) {
    const key = `${day}-${slot}`;
    if (!assignmentsBySlot.has(key)) assignmentsBySlot.set(key, []);
    assignmentsBySlot.get(key).push(assignment);
  }
  function unindexAssignment(day, slot, assignment) {
    const key = `${day}-${slot}`;
    const list = assignmentsBySlot.get(key);
    if (list) {
      const idx = list.indexOf(assignment);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) assignmentsBySlot.delete(key);
    }
  }

  for (const demand of demands) {
    let attempts = 0;
    const baseSweep = workingDays.length * slotsPerDay;
    const maxAttempts = Math.max(baseSweep * Math.max(1, demand.teachers.length) * 4, demand.remaining * baseSweep * 2);
    while (demand.remaining > 0 && attempts < maxAttempts) {
      attempts++;
      const candidates = [];
      for (const day of workingDays) {
        for (let slot = 0; slot < slotsPerDay; slot++) {
          const cBusyDay = classBusy.get(demand.sectionId)?.get(day);
          if (cBusyDay && cBusyDay.has(slot)) continue;
          for (const tid of demand.teachers) {
            if (!isTeacherAvailable(tid, day, slot)) continue;
            const subjMap = teacherSubjectRemaining.get(tid);
            if (!subjMap) continue;
            const secMap = subjMap.get(demand.subjectId);
            const left = secMap?.get(demand.sectionId) || 0;
            if (left <= 0) continue;
            const score = calculatePlacementScore(tid, day, slot, demand, assignmentsBySlot);
            candidates.push({ day, slot, tid, score, sectionId: demand.sectionId, classId: demand.classId, subjectId: demand.subjectId });
          }
        }
      }

      candidates.sort((a, b) => a.score - b.score);
      let placed = false;
      if (candidates.length > 0) {
        const best = candidates[0];
        const bestSubjCount = classDaySubjectCount.get(best.sectionId)?.get(best.day)?.get(demand.subjectId) || 0;
        if (bestSubjCount > 0 && candidates.length > 1) {
          const betterOption = candidates.find((c, idx) => {
            if (idx === 0) return false;
            const cSubjCount = classDaySubjectCount.get(c.sectionId)?.get(c.day)?.get(demand.subjectId) || 0;
            return cSubjCount === 0;
          });
          if (betterOption) {
            const { day, slot, tid } = betterOption;
            recordAssignment(day, slot, demand, tid);
            placed = true;
          }
        }
        if (!placed) {
          const { day, slot, tid } = best;
          recordAssignment(day, slot, demand, tid);
          placed = true;
        }
      }
      if (!placed) {
        const idx = assignments.findIndex(a => a.sectionId === demand.sectionId);
        if (idx >= 0) {
          const a = assignments.splice(idx, 1)[0];
          releaseAssignment(a);
          const back = demands.find(d => d.sectionId === a.sectionId && d.subjectId === a.subjectId);
          if (back) back.remaining++;
        } else {
          break;
        }
      }
    }
  }

  const leftovers = demands.filter(d => d.remaining > 0);
  if (leftovers.length > 0) {
    leftovers.sort((a, b) => b.remaining - a.remaining);
    for (const demand of leftovers) {
      outer_leftover: while (demand.remaining > 0) {
        let placed = false;
        for (const day of workingDays) {
          const cBusyDay = classBusy.get(demand.sectionId)?.get(day);
          for (let slot = 0; slot < slotsPerDay; slot++) {
            if (cBusyDay && cBusyDay.has(slot)) continue;
            for (const tid of demand.teachers) {
              const subjMap = teacherSubjectRemaining.get(tid);
              if (!subjMap) continue;
              const secMap = subjMap.get(demand.subjectId);
              const left = secMap?.get(demand.sectionId) || 0;
              if (left <= 0) continue;
              if (!isTeacherAvailable(tid, day, slot)) continue;
              const tBusyDay = teacherBusy.get(tid)?.get(day);
              if (tBusyDay && tBusyDay.has(slot)) continue;
              recordAssignment(day, slot, demand, tid);
              placed = true;
              break;
            }
            if (placed) continue outer_leftover;
          }
        }
        if (!placed) break;
      }
    }
  }

  return assignments;
}
