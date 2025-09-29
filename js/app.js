// Basic app state and persistence
const STORAGE_KEY = 'school-timetable-v1'; // still used as a fallback/migration
const DB_NAME = 'school-timetable-db';
const DB_VERSION = 2;
const PROJECT_STORE = 'projects';
const CATALOG_STORE = 'catalog';
let ACTIVE_PROJECT_ID = null;
let IN_MEMORY_STATE = null;

// -------- IndexedDB helpers --------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        const store = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
        store.createIndex('by_name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        db.createObjectStore(CATALOG_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllProjects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_STORE, 'readonly');
    const store = tx.objectStore(PROJECT_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutProject(project) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    const store = tx.objectStore(PROJECT_STORE);
    const req = store.put(project);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDeleteProject(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_STORE, 'readwrite');
    const store = tx.objectStore(PROJECT_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Catalog helpers
async function idbGetCatalog() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_STORE, 'readonly');
    const store = tx.objectStore(CATALOG_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutCatalogItem(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_STORE, 'readwrite');
    const store = tx.objectStore(CATALOG_STORE);
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbPutCatalogMany(items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_STORE, 'readwrite');
    const store = tx.objectStore(CATALOG_STORE);
    items.forEach(it => store.put(it));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function newProjectTemplate(name) {
  return { id: uid(), name, state: { school: null, classes: [], subjects: [], teachers: [], timetable: [] }, createdAt: Date.now(), updatedAt: Date.now() };
}

async function ensureProjectLoaded() {
  // If already loaded, return
  if (IN_MEMORY_STATE && ACTIVE_PROJECT_ID) return;
  // Try to load projects
  let projects = await idbGetAllProjects();
  if (projects.length === 0) {
    // Migrate from LocalStorage if exists
    const lsRaw = localStorage.getItem(STORAGE_KEY);
    let initialState = { school: null, classes: [], subjects: [], teachers: [], timetable: [] };
    if (lsRaw) {
      try { initialState = JSON.parse(lsRaw) || initialState; } catch {}
    }
    const proj = newProjectTemplate('مشروعي 1');
    proj.state = initialState;
    await idbPutProject(proj);
    projects = [proj];
  }
  // Select first as active if none
  const savedActive = localStorage.getItem('stt-active-project');
  const active = projects.find(p => p.id === savedActive) || projects[0];
  ACTIVE_PROJECT_ID = active.id;
  IN_MEMORY_STATE = active.state;
  // Populate UI select
  renderProjectsBar(projects, ACTIVE_PROJECT_ID);
  // Seed catalog if empty
  await ensureCatalogSeed();
}
async function ensureCatalogSeed() {
  const cat = await idbGetCatalog();
  if (cat.length > 0) return;
  const st = IN_MEMORY_STATE || {};
  const projectSubjects = (st.subjects || []).map(s => s.name);
  const baseSet = new Set(projectSubjects);
  ['التاريخ','جغرافيا','اقتصاد','فلسفة'].forEach(n => baseSet.add(n));
  const items = Array.from(baseSet).filter(Boolean).map(name => ({ id: uid(), name }));
  if (items.length) await idbPutCatalogMany(items);
}

async function renderSubjectsCatalog() {
  const holder = document.getElementById('subjectsCatalog');
  if (!holder) return;
  holder.innerHTML = '';
  const catalog = await idbGetCatalog();
  const current = new Set((getSubjects()||[]).map(s => s.name));
  if (catalog.length === 0) {
    holder.textContent = 'لا توجد مواد جاهزة.';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'checkbox-grid';
  catalog.forEach(item => {
    const label = document.createElement('label');
    const checked = current.has(item.name) ? 'checked' : '';
    label.innerHTML = `<input type="checkbox" value="${item.name}" ${checked}/> <span>${item.name}</span>`;
    wrap.appendChild(label);
  });
  holder.appendChild(wrap);
  holder.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const name = chk.value;
      if (chk.checked) {
        // add to project if missing
        const subs = getSubjects();
        if (!subs.some(s => s.name === name)) {
          subs.push({ id: uid(), name });
          setSubjects(subs);
          renderSubjectsList();
        }
      } else {
        // remove from project if exists
        const subs = getSubjects();
        const next = subs.filter(s => s.name !== name);
        if (next.length !== subs.length) {
          setSubjects(next);
          renderSubjectsList();
        }
      }
    });
  });
}


async function persistState() {
  if (!ACTIVE_PROJECT_ID || !IN_MEMORY_STATE) return;
  const all = await idbGetAllProjects();
  const proj = all.find(p => p.id === ACTIVE_PROJECT_ID);
  if (proj) {
    proj.state = IN_MEMORY_STATE;
    proj.updatedAt = Date.now();
    await idbPutProject(proj);
  }
}

const DEFAULT_DAYS = ['السبت','الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس','الجمعة'];

function loadState() {
  // Use in-memory state for current project
  return IN_MEMORY_STATE || {};
}

function saveState(partial) {
  const current = loadState();
  const next = { ...current, ...partial };
  IN_MEMORY_STATE = next;
  // fire-and-forget persist
  persistState();
  return next;
}

function $(id) { return document.getElementById(id); }

function formatDateTime(dt) {
  try {
    return new Intl.DateTimeFormat('ar', {
      dateStyle: 'medium', timeStyle: 'short'
    }).format(dt);
  } catch {
    return dt.toLocaleString('ar-EG');
  }
}

function renderWorkingDays(days, selected = null) {
  const container = $('workingDays');
  container.innerHTML = '';
  const chosen = new Set(selected || days);
  days.forEach((day, idx) => {
    const id = `day-${idx}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'day-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = day;
    input.id = id;
    input.checked = chosen.has(day);
    const span = document.createElement('span');
    span.textContent = day;
    wrapper.appendChild(input);
    wrapper.appendChild(span);
    container.appendChild(wrapper);
  });
}

function getSelectedDays() {
  const container = $('workingDays');
  return Array.from(container.querySelectorAll('input[type="checkbox"]'))
    .filter(el => el.checked)
    .map(el => el.value);
}

function updatePreview(state) {
  $('previewSchoolName').textContent = state.school?.name || '—';
  $('previewDays').textContent = (state.school?.workingDays || []).join('، ') || '—';
  $('previewSlots').textContent = state.school?.slotsPerDay ?? '—';
  $('startedAt').textContent = state.school?.startedAt ? state.school.startedAtLabel : '—';
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize projects and state
  ensureProjectLoaded().then(() => {
  const state = loadState();

  // Ensure startedAt exists once
  if (!state.school || !state.school.startedAt) {
    const startedAt = new Date();
    const startedAtLabel = formatDateTime(startedAt);
    saveState({ school: { ...(state.school || {}), startedAt: startedAt.toISOString(), startedAtLabel } });
  }

  // Bootstrap UI
  const latest = loadState();
  const school = latest.school || {};

  // Fill inputs
  $('schoolName').value = school.name || '';
  $('slotsPerDay').value = school.slotsPerDay || 6;
  // Auto-calc inputs
  if ($('firstLessonStart')) $('firstLessonStart').value = school.firstLessonStart || '';
  if ($('lessonDuration')) $('lessonDuration').value = school.lessonDuration || '';
  if ($('breakDuration')) $('breakDuration').value = school.breakDuration || '';
  // School type and branches
  if ($('schoolType')) $('schoolType').value = school.type || '';
  const branchesRow = document.getElementById('branchesRow');
  if (school.type === 'اعدادية' || school.type === 'ثانوية') {
    branchesRow?.classList.remove('hidden-row');
  } else {
    branchesRow?.classList.add('hidden-row');
  }
  const branchesSet = new Set(school.branches || []);
  document.querySelectorAll('#schoolBranches input[type="checkbox"]').forEach(chk => {
    chk.checked = branchesSet.has(chk.value);
  });
  renderWorkingDays(DEFAULT_DAYS, school.workingDays || DEFAULT_DAYS.filter(d => d !== 'الجمعة' && d !== 'السبت'));

  // Render slot times editor (prefill from stored times or auto-calc if available)
  const initialSlotsCount = school.slotsPerDay || 6;
  const prefillTimesInit = (school.slotTimes && school.slotTimes.length)
    ? school.slotTimes
    : ((school.firstLessonStart && school.lessonDuration)
        ? autoCalcSlotTimes(school.firstLessonStart, parseInt(school.lessonDuration,10)||0, parseInt(school.breakDuration||'0',10)||0, initialSlotsCount)
        : []);
  renderSlotTimesEditor(initialSlotsCount, prefillTimesInit);

  updatePreview(loadState());

  // Handlers
  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('saveSettingsBtn');
    const fb = document.getElementById('setupSaveFeedback');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('saving'); }
    const name = $('schoolName').value.trim();
    const slotsPerDay = Math.max(1, Math.min(12, parseInt($('slotsPerDay').value, 10) || 6));
    const workingDays = getSelectedDays();
    const type = $('schoolType')?.value || '';
    const branches = Array.from(document.querySelectorAll('#schoolBranches input[type="checkbox"]:checked')).map(i => i.value);
    const firstLessonStart = $('firstLessonStart')?.value || '';
    const lessonDuration = parseInt($('lessonDuration')?.value || '0', 10) || 0;
    const breakDuration = parseInt($('breakDuration')?.value || '0', 10) || 0;

    if (!name) {
      alert('يرجى إدخال اسم المدرسة');
      return;
    }
    if (workingDays.length === 0) {
      alert('يرجى اختيار يوم واحد على الأقل للدوام');
      return;
    }

    const prev = loadState();
    // Collect slot times
    const slotTimes = collectSlotTimes(slotsPerDay);

    const next = saveState({
      school: {
        ...(prev.school || {}),
        name,
        workingDays,
        slotsPerDay,
        slotTimes,
        type,
        branches,
        firstLessonStart,
        lessonDuration,
        breakDuration,
      }
    });
    updatePreview(next);
    // visual feedback
    setTimeout(() => {
      if (saveBtn) {
        saveBtn.classList.remove('saving');
        saveBtn.classList.add('saved');
        const oldText = saveBtn.textContent;
        saveBtn.textContent = 'تم الحفظ';
        setTimeout(() => {
          saveBtn.textContent = oldText || 'حفظ الإعدادات';
          saveBtn.classList.remove('saved');
          saveBtn.disabled = false;
        }, 1200);
      }
      if (fb) {
        fb.classList.remove('hidden');
        fb.classList.add('show');
        setTimeout(() => {
          fb.classList.remove('show');
          fb.classList.add('hidden');
        }, 1500);
      }
    }, 50);
  });

  // Toggle branches row when type changes
  $('schoolType')?.addEventListener('change', () => {
    const type = $('schoolType').value;
    const row = document.getElementById('branchesRow');
    if (type === 'اعدادية' || type === 'ثانوية') row?.classList.remove('hidden-row');
    else row?.classList.add('hidden-row');
  });
  
  // Tabs wiring
  setupTabs();
  // Setup CRUD UIs
  renderClassesList();
  renderSubjectsList();
  renderTeachersList();
  setupForms();
  setupProjectsUI();
  renderSubjectsCatalog();
  // Load print header
  const ph = document.getElementById('printHeader');
  const st2 = loadState();
  ph.textContent = st2.printHeader || defaultPrintHeader(st2);
  ph.addEventListener('input', () => {
    saveState({ printHeader: ph.textContent });
  });
  // Auto-calc button
  document.getElementById('autoCalcSlotTimesBtn')?.addEventListener('click', () => {
    const slotsCount = Math.max(1, Math.min(12, parseInt($('slotsPerDay').value, 10) || 6));
    const start = $('firstLessonStart')?.value || '';
    const duration = parseInt($('lessonDuration')?.value || '0', 10) || 0;
    const brk = parseInt($('breakDuration')?.value || '0', 10) || 0;
    if (!start || duration <= 0) {
      alert('يرجى إدخال وقت بداية أول حصة ومدة الحصة (بالدقائق)');
      return;
    }
    const times = autoCalcSlotTimes(start, duration, brk, slotsCount);
    // Render editor with calculated times
    renderSlotTimesEditor(slotsCount, times);
  });
  });
});

// ---------- Projects UI ----------
async function renderProjectsBar(projects, activeId) {
  const select = document.getElementById('projectSelect');
  if (!select) return;
  select.innerHTML = '';
  (projects||[]).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    if (p.id === activeId) opt.selected = true;
    select.appendChild(opt);
  });
}

function setupProjectsUI() {
  const select = document.getElementById('projectSelect');
  const newBtn = document.getElementById('newProjectBtn');
  const renameBtn = document.getElementById('renameProjectBtn');
  const dupBtn = document.getElementById('duplicateProjectBtn');
  const delBtn = document.getElementById('deleteProjectBtn');

  select?.addEventListener('change', async () => {
    const id = select.value;
    const all = await idbGetAllProjects();
    const p = all.find(x => x.id === id);
    if (!p) return;
    ACTIVE_PROJECT_ID = p.id;
    IN_MEMORY_STATE = p.state;
    localStorage.setItem('stt-active-project', ACTIVE_PROJECT_ID);
    // Refresh UI
  // Rebuild editors and lists
    const latest = loadState();
    $('schoolName').value = latest.school?.name || '';
    $('slotsPerDay').value = latest.school?.slotsPerDay || 6;
  if ($('firstLessonStart')) $('firstLessonStart').value = latest.school?.firstLessonStart || '';
  if ($('lessonDuration')) $('lessonDuration').value = latest.school?.lessonDuration || '';
  if ($('breakDuration')) $('breakDuration').value = latest.school?.breakDuration || '';
    renderWorkingDays(DEFAULT_DAYS, latest.school?.workingDays || DEFAULT_DAYS.filter(d => d !== 'الجمعة' && d !== 'السبت'));
    const sCount = latest.school?.slotsPerDay || 6;
    const prefillTimes = (latest.school?.slotTimes && latest.school.slotTimes.length)
      ? latest.school.slotTimes
      : ((latest.school?.firstLessonStart && latest.school?.lessonDuration)
          ? autoCalcSlotTimes(latest.school.firstLessonStart, parseInt(latest.school.lessonDuration,10)||0, parseInt(latest.school.breakDuration||'0',10)||0, sCount)
          : []);
    renderSlotTimesEditor(sCount, prefillTimes);
    updatePreview(latest);
    renderClassesList();
    renderSubjectsList();
    renderTeachersList();
    renderSubjectsCatalog();
    document.querySelector('[data-target="setup-section"]').click();
  });

  newBtn?.addEventListener('click', async () => {
    const name = prompt('اسم المشروع الجديد؟', 'مشروع جديد');
    if (!name) return;
    const proj = newProjectTemplate(name);
    // Prefill subjects from catalog
    const cat = await idbGetCatalog();
    if (cat && cat.length) {
      proj.state.subjects = cat.map(c => ({ id: uid(), name: c.name }));
    }
    await idbPutProject(proj);
    const all = await idbGetAllProjects();
    ACTIVE_PROJECT_ID = proj.id; IN_MEMORY_STATE = proj.state;
    localStorage.setItem('stt-active-project', ACTIVE_PROJECT_ID);
    renderProjectsBar(all, ACTIVE_PROJECT_ID);
    // Refresh UI
    location.reload();
  });

  renameBtn?.addEventListener('click', async () => {
    const all = await idbGetAllProjects();
    const p = all.find(x => x.id === ACTIVE_PROJECT_ID);
    if (!p) return;
    const name = prompt('اسم المشروع:', p.name);
    if (!name) return;
    p.name = name; p.updatedAt = Date.now();
    await idbPutProject(p);
    const updated = await idbGetAllProjects();
    renderProjectsBar(updated, ACTIVE_PROJECT_ID);
  });

  dupBtn?.addEventListener('click', async () => {
    const all = await idbGetAllProjects();
    const p = all.find(x => x.id === ACTIVE_PROJECT_ID);
    if (!p) return;
    const clone = { ...p, id: uid(), name: p.name + ' (نسخة)', createdAt: Date.now(), updatedAt: Date.now(), state: JSON.parse(JSON.stringify(p.state)) };
    await idbPutProject(clone);
    const updated = await idbGetAllProjects();
    renderProjectsBar(updated, ACTIVE_PROJECT_ID);
  });

  delBtn?.addEventListener('click', async () => {
    const ok = confirm('سيتم حذف المشروع الحالي نهائيًا، هل تريد المتابعة؟');
    if (!ok) return;
    await idbDeleteProject(ACTIVE_PROJECT_ID);
    const all = await idbGetAllProjects();
    if (all.length === 0) {
      const proj = newProjectTemplate('مشروع جديد');
      await idbPutProject(proj);
    }
    const projects = await idbGetAllProjects();
    ACTIVE_PROJECT_ID = projects[0].id;
    IN_MEMORY_STATE = projects[0].state;
    localStorage.setItem('stt-active-project', ACTIVE_PROJECT_ID);
    renderProjectsBar(projects, ACTIVE_PROJECT_ID);
    location.reload();
  });
}

// ---------------- Tabs ----------------
function setupTabs() {
  const links = document.querySelectorAll('.tab-link');
  links.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
      document.getElementById(target).classList.remove('hidden');
    });
  });
}

// ------------- Slot Times Editor -------------
function renderSlotTimesEditor(slotsCount, existing = []) {
  const container = $('slotTimesContainer');
  const table = document.createElement('table');
  table.className = 'slot-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>بداية</th>
        <th>نهاية</th>
      </tr>
    </thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  for (let i = 0; i < slotsCount; i++) {
    const tr = document.createElement('tr');
    const startId = `slot-start-${i}`;
    const endId = `slot-end-${i}`;
    const startVal = existing[i]?.start || '';
    const endVal = existing[i]?.end || '';
    tr.innerHTML = `
      <td>${i+1}</td>
      <td><input type="time" id="${startId}" value="${startVal}"/></td>
      <td><input type="time" id="${endId}" value="${endVal}"/></td>`;
    tbody.appendChild(tr);
  }
  container.innerHTML = '';
  container.appendChild(table);

  // React to slot count changes
  $('slotsPerDay').addEventListener('input', () => {
    const count = Math.max(1, Math.min(12, parseInt($('slotsPerDay').value, 10) || 6));
    // If auto-calc inputs are filled, try to auto-calc; otherwise blank
    const start = $('firstLessonStart')?.value || '';
    const duration = parseInt($('lessonDuration')?.value || '0', 10) || 0;
    const brk = parseInt($('breakDuration')?.value || '0', 10) || 0;
    const prefill = (start && duration > 0) ? autoCalcSlotTimes(start, duration, brk, count) : [];
    renderSlotTimesEditor(count, prefill);
  });
}

function collectSlotTimes(count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const start = (document.getElementById(`slot-start-${i}`)?.value || '').trim();
    const end = (document.getElementById(`slot-end-${i}`)?.value || '').trim();
    if (start && end) {
      result.push({ start, end });
    } else {
      result.push({ start: '', end: '' });
    }
  }
  return result;
}

// ---- Time helpers for auto calculation of slot times ----
function timeToMinutes(t) {
  const [h, m] = (t || '00:00').split(':').map(n => parseInt(n, 10) || 0);
  return h * 60 + m;
}
function minutesToTime(mins) {
  let m = Math.max(0, mins);
  m = m % (24*60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(mm)}`;
}
function autoCalcSlotTimes(firstStartHHMM, lessonMinutes, breakMinutes, count) {
  const res = [];
  const start0 = timeToMinutes(firstStartHHMM);
  let curStart = start0;
  for (let i = 0; i < count; i++) {
    const curEnd = curStart + lessonMinutes;
    res.push({ start: minutesToTime(curStart), end: minutesToTime(curEnd) });
    curStart = curEnd + (i === count - 1 ? 0 : breakMinutes);
  }
  return res;
}

// ------------- Data helpers -------------
function uid() { return Math.random().toString(36).slice(2, 9); }

function getClasses() { return loadState().classes || []; }
function setClasses(list) { saveState({ classes: list }); }

function getSubjects() { return loadState().subjects || []; }
function setSubjects(list) { saveState({ subjects: list }); }

function getTeachers() { return loadState().teachers || []; }
function setTeachers(list) { saveState({ teachers: list }); }
function getTimetable() { return loadState().timetable || []; }
function setTimetable(tt) { saveState({ timetable: tt }); }

// ------------- Forms wiring -------------
function setupForms() {
  // Class form
  const classForm = $('class-form');
  classForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const baseName = $('className').value.trim();
    const sectionsCount = Math.max(1, Math.min(20, parseInt($('classSectionsCount').value, 10) || 1));
    if (!baseName) return;
    const st = loadState();
    const editId = st.ui?.editingClassId || null;
    const list = getClasses();
    const letters = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ'.split('');
    if (editId) {
      // update existing class
      const idx = list.findIndex(c => c.id === editId);
      if (idx >= 0) {
        const old = list[idx];
        const oldSections = old.sections && old.sections.length ? old.sections : [{ id: old.id, name: old.name }];
        // build new sections preserving IDs for first N
        const newSections = [];
        for (let i = 0; i < sectionsCount; i++) {
          if (oldSections[i]) {
            newSections.push({ id: oldSections[i].id, name: `${baseName} ${letters[i] || String.fromCharCode(65+i)}` });
          } else {
            newSections.push({ id: uid(), name: `${baseName} ${letters[i] || String.fromCharCode(65+i)}` });
          }
        }
        // sections removed: collect removed IDs
        const removedIds = oldSections.slice(sectionsCount).map(s => s.id);
        list[idx] = { ...old, name: baseName, sections: newSections };
        setClasses(list);
        // cascade: remove references in teachers and timetable
        if (removedIds.length > 0) {
          // update teachers
          const ts = getTeachers().map(t => {
            const classIds = t.classIds.filter(cid => cid !== editId ? true : true); // keep classId; it's the base class id
            const subjects = (t.subjects||[]).map(s => {
              const per = { ...(s.perSections||{}) };
              removedIds.forEach(id => { delete per[id]; });
              return { ...s, perSections: per };
            });
            return { ...t, classIds, subjects };
          });
          setTeachers(ts);
          // update timetable
          const tt = getTimetable().filter(a => !removedIds.includes(a.sectionId));
          setTimetable(tt);
        }
      }
      clearClassEditMode();
    } else {
      // create new class
      const sections = Array.from({length: sectionsCount}).map((_,i) => ({ id: uid(), name: `${baseName} ${letters[i] || String.fromCharCode(65+i)}` }));
      list.push({ id: uid(), name: baseName, sections });
      setClasses(list);
      $('className').value = '';
      $('classSectionsCount').value = '1';
    }
    renderClassesList();
    refreshTeacherEditors();
  });

  // Auto-generate classes from settings
  const autoBtn = document.getElementById('autoGenerateClassesBtn');
  autoBtn?.addEventListener('click', () => {
    const st = loadState();
    const type = st.school?.type || '';
    const branches = st.school?.branches || [];
    const existing = getClasses();
    const names = [];
    function addName(n) { if (!existing.some(c => c.name === n) && !names.includes(n)) names.push(n); }
    if (type === 'ابتدائية') {
      ['الأول','الثاني','الثالث','الرابع','الخامس','السادس'].forEach((g) => addName(`الصف ${g}`));
    } else if (type === 'متوسطة') {
      ['الأول','الثاني','الثالث'].forEach((g) => addName(`الصف ${g} المتوسط`));
    } else if (type === 'اعدادية') {
      const base = ['الرابع','الخامس','السادس'];
      if (branches.length === 0) {
        base.forEach((g) => addName(`الصف ${g} الإعدادي`));
      } else {
        base.forEach((g) => branches.forEach(b => addName(`الصف ${g} ${b}`)));
      }
    } else if (type === 'ثانوية') {
      ['الأول','الثاني','الثالث'].forEach((g) => addName(`الصف ${g} المتوسط`));
      const base = ['الرابع','الخامس','السادس'];
      if (branches.length === 0) {
        base.forEach((g) => addName(`الصف ${g} الإعدادي`));
      } else {
        base.forEach((g) => branches.forEach(b => addName(`الصف ${g} ${b}`)));
      }
    }
    if (names.length === 0) { alert('يرجى تحديد نوع المدرسة أولًا من الإعدادات'); return; }
    const letters = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ'.split('');
    const list = getClasses();
    names.forEach(n => {
      list.push({ id: uid(), name: n, sections: [{ id: uid(), name: `${n} ${letters[0]}` }] });
    });
    setClasses(list);
    renderClassesList();
    refreshTeacherEditors();
    alert('تم إنشاء الصفوف الأساسية، يمكنك تعديل الأسماء أو زيادة الشُعب من هنا.');
  });

  // Cancel class edit
  $('cancelEditClassBtn')?.addEventListener('click', () => clearClassEditMode());

  // Subject form
  const subjectForm = $('subject-form');
  subjectForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('subjectName').value.trim();
    if (!name) return;
    const list = getSubjects();
    list.push({ id: uid(), name });
    setSubjects(list);
    $('subjectName').value = '';
    renderSubjectsList();
    // sync to catalog
    (async () => {
      const cat = await idbGetCatalog();
      if (!cat.some(x => x.name === name)) {
        await idbPutCatalogItem({ id: uid(), name });
      }
      renderSubjectsCatalog();
    })();
    refreshTeacherEditors();
  });

  // Teacher form
  const teacherForm = $('teacher-form');
  teacherForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('teacherName').value.trim();
    if (!name) { alert('يرجى إدخال اسم المعلم'); return; }
  const sel = getSelectedClassScopesFromUI();
  const classIds = sel.classIds;
    const offDays = Array.from(document.querySelectorAll('#teacherOffDays input[type="checkbox"]:checked')).map(i => i.value);
  const forbiddenSlots = Array.from(document.querySelectorAll('#teacherForbiddenSlots input[type="checkbox"]:checked')).map(i => parseInt(i.value,10));
    // collect per-day-per-slot forbidden matrix
    const forbiddenDaySlots = collectForbiddenDaySlotsFromUI();

    // subjects with per-section periods/week
    const subjects = [];
    getSubjects().forEach((s) => {
      const perSections = {};
      // collect for each selected section input
      const sectionInputs = document.querySelectorAll(`[data-subject="${s.id}"][data-section]`);
      sectionInputs.forEach(inp => {
        const secId = inp.getAttribute('data-section');
        const val = Math.max(0, parseInt(inp.value, 10) || 0);
        if (val > 0) perSections[secId] = val;
      });
      // push only if any section is > 0
      if (Object.keys(perSections).length > 0) {
        subjects.push({ subjectId: s.id, perSections });
      }
    });

    const st = loadState();
    const editId = st.ui?.editingTeacherId || null;
    const list = getTeachers();
    if (editId) {
      // update existing
      const idx = list.findIndex(t => t.id === editId);
      if (idx >= 0) {
  list[idx] = { ...list[idx], name, classIds, classScopes: sel.scopes, subjects, offDays, forbiddenSlots, forbiddenDaySlots };
        setTeachers(list);
      }
      clearTeacherEditMode();
    } else {
      // add new
  list.push({ id: uid(), name, classIds, classScopes: sel.scopes, subjects, offDays, forbiddenSlots, forbiddenDaySlots });
      setTeachers(list);
    }
    $('teacherName').value = '';
    renderTeachersList();
  });

  // Cancel edit button
  $('cancelEditTeacherBtn')?.addEventListener('click', () => {
    clearTeacherEditMode();
  });
}

function renderClassesList() {
  const container = $('classesList');
  if (!container) return;
  const list = getClasses();
  container.innerHTML = '';
  if (list.length === 0) {
    container.textContent = 'لا توجد صفوف بعد.';
    return;
  }
  list.forEach(item => {
    const row = document.createElement('div');
    row.className = 'list-item';
    const sectionNames = (item.sections||[]).map(s => s.name).join('، ');
    row.innerHTML = `
      <div>
        <div><strong>${item.name}</strong></div>
        <div class="hint">الشُعب: ${sectionNames || '—'}</div>
      </div>
      <div>
        <button class="btn" data-action="edit" data-id="${item.id}">تعديل</button>
        <button class="btn danger" data-id="${item.id}">حذف</button>
      </div>`;
    const delBtn = row.querySelector('button.btn.danger');
    delBtn.addEventListener('click', () => {
      const next = getClasses().filter(x => x.id !== item.id);
      setClasses(next);
      // cascade remove from teachers subject perSections and timetable
      const removedSectionIds = (item.sections||[]).map(s => s.id);
      const ts = getTeachers().map(t => {
        const subjects = (t.subjects||[]).map(s => {
          const per = { ...(s.perSections||{}) };
          removedSectionIds.forEach(id => { delete per[id]; });
          return { ...s, perSections: per };
        });
        // remove base class ref if no longer exists
        const classIds = t.classIds.filter(cid => cid !== item.id);
        return { ...t, classIds, subjects };
      });
      setTeachers(ts);
      const tt = getTimetable().filter(a => !removedSectionIds.includes(a.sectionId));
      setTimetable(tt);
      renderClassesList();
      refreshTeacherEditors();
    });
    const editBtn = row.querySelector('button.btn:not(.danger)');
    editBtn.addEventListener('click', () => enterClassEditMode(item.id));
    container.appendChild(row);
  });
}

function enterClassEditMode(classId) {
  const st = loadState();
  saveState({ ui: { ...(st.ui||{}), editingClassId: classId } });
  const c = getClasses().find(x => x.id === classId);
  if (!c) return;
  $('className').value = c.name || '';
  const count = (c.sections && c.sections.length) ? c.sections.length : 1;
  $('classSectionsCount').value = String(count);
  $('classSubmitBtn').textContent = 'حفظ التعديلات';
  $('cancelEditClassBtn').classList.remove('hidden');
}

function clearClassEditMode() {
  const st = loadState();
  const ui = { ...(st.ui||{}) };
  delete ui.editingClassId;
  saveState({ ui });
  $('className').value = '';
  $('classSectionsCount').value = '1';
  $('classSubmitBtn').textContent = 'إضافة';
  $('cancelEditClassBtn').classList.add('hidden');
}

function renderSubjectsList() {
  const container = $('subjectsList');
  if (!container) return;
  const list = getSubjects();
  container.innerHTML = '';
  if (list.length === 0) {
    container.textContent = 'لا توجد مواد بعد.';
    return;
  }
  list.forEach(item => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `
      <span>${item.name}</span>
      <div>
        <button class="btn danger" data-id="${item.id}">حذف</button>
      </div>`;
    row.querySelector('button').addEventListener('click', () => {
      const next = getSubjects().filter(x => x.id !== item.id);
      setSubjects(next);
      renderSubjectsList();
      renderSubjectsCatalog();
      refreshTeacherEditors();
    });
    container.appendChild(row);
  });
}

function renderTeachersList() {
  const container = $('teachersList');
  if (!container) return;
  const list = getTeachers();
  container.innerHTML = '';
  if (list.length === 0) {
    container.textContent = 'لا يوجد معلمون بعد.';
    refreshTeacherEditors();
    return;
  }
  list.forEach(item => {
    const row = document.createElement('div');
    row.className = 'list-item';
    const classes = getClasses().filter(c => item.classIds.includes(c.id)).map(c => c.name).join('، ');
  const subjects = getSubjects().filter(s => item.subjects.some(ts => ts.subjectId === s.id)).map(s => s.name).join('، ');
    const offDays = (item.offDays || []).join('، ');
    row.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <div class="hint">الصفوف: ${classes || '—'} | المواد: ${subjects || '—'} | OFF: ${offDays || '—'}</div>
      </div>
      <div>
        <button class="btn" data-action="edit" data-id="${item.id}">تعديل</button>
        <button class="btn danger" data-id="${item.id}">حذف</button>
      </div>`;
    const delBtn = row.querySelector('button.btn.danger');
    delBtn.addEventListener('click', () => {
      const next = getTeachers().filter(x => x.id !== item.id);
      setTeachers(next);
      renderTeachersList();
    });
    const editBtn = row.querySelector('button.btn:not(.danger)');
    editBtn.addEventListener('click', () => {
      enterTeacherEditMode(item.id);
    });
    container.appendChild(row);
  });
  refreshTeacherEditors();
}

function refreshTeacherEditors() {
  // classes with per-class section scope (all vs some)
  const clsC = $('teacherClasses');
  if (clsC) {
    const classes = getClasses();
    const st = loadState();
    const editing = st.ui?.editingTeacherId ? getTeachers().find(x => x.id === st.ui.editingTeacherId) : null;
    const selectedClasses = new Set(editing?.classIds || []);
    const scopes = (editing?.classScopes) || {};
    clsC.innerHTML = '';
    classes.forEach(c => {
      const wrap = document.createElement('div');
      wrap.className = 'class-scope-box';
      const isChecked = selectedClasses.has(c.id);
      const scope = scopes[c.id] || { mode: 'all', sectionIds: [] };
      wrap.innerHTML = `
        <label class="day-chip"><input type="checkbox" class="class-check" value="${c.id}" ${isChecked ? 'checked' : ''}/> <span>${c.name}</span></label>
        <div class="scope-controls ${isChecked ? '' : 'hidden'}" data-class="${c.id}">
          <label class="scope-option"><input type="radio" name="scope-${c.id}" value="all" ${scope.mode !== 'some' ? 'checked' : ''}/> <span>كل الشُعب</span></label>
          <label class="scope-option"><input type="radio" name="scope-${c.id}" value="some" ${scope.mode === 'some' ? 'checked' : ''}/> <span>تحديد الشُعب</span></label>
          <div class="sections-choices ${scope.mode === 'some' ? '' : 'hidden'}" data-sections-for="${c.id}"></div>
        </div>`;
      clsC.appendChild(wrap);
      // fill sections choices
      const secWrap = wrap.querySelector(`[data-sections-for="${c.id}"]`);
      const chosen = new Set(scope.sectionIds || []);
      (c.sections || [{ id: c.id, name: c.name }]).forEach(sec => {
        const lbl = document.createElement('label');
        lbl.className = 'day-chip';
        lbl.innerHTML = `<input type="checkbox" class="section-check" value="${sec.id}" ${chosen.has(sec.id) ? 'checked' : ''}/> <span>${sec.name}</span>`;
        secWrap.appendChild(lbl);
      });
    });
    // wire events
    clsC.querySelectorAll('.class-check').forEach(chk => {
      chk.addEventListener('change', () => {
        const box = clsC.querySelector(`.scope-controls[data-class="${chk.value}"]`);
        if (chk.checked) box?.classList.remove('hidden'); else box?.classList.add('hidden');
        buildTeacherSubjectsGrid();
      });
    });
    clsC.querySelectorAll('.scope-option input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => {
        const classId = r.name.replace('scope-','');
        const wrap = clsC.querySelector(`.sections-choices[data-sections-for="${classId}"]`);
        if (r.value === 'some') wrap?.classList.remove('hidden'); else wrap?.classList.add('hidden');
        buildTeacherSubjectsGrid();
      });
    });
    clsC.querySelectorAll('.sections-choices .section-check').forEach(ch => {
      ch.addEventListener('change', () => buildTeacherSubjectsGrid());
    });
  }

  // off days checklist
  const offC = $('teacherOffDays');
  if (offC) {
    // preserve selection
    const currentSelected = Array.from(offC.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
    const st = loadState();
    let selectedSet = new Set(currentSelected);
    if (selectedSet.size === 0 && st.ui?.editingTeacherId) {
      const t = getTeachers().find(x => x.id === st.ui.editingTeacherId);
      if (t) selectedSet = new Set(t.offDays || []);
    }
    offC.innerHTML = '';
    (loadState().school?.workingDays || DEFAULT_DAYS).forEach((d, idx) => {
      const label = document.createElement('label');
      label.className = 'day-chip';
      const checkedAttr = selectedSet.has(d) ? 'checked' : '';
      label.innerHTML = `<input type="checkbox" value="${d}" id="off-${idx}" ${checkedAttr}/> <span>${d}</span>`;
      offC.appendChild(label);
    });
  }

  // forbidden slots checklist
  const forbC = $('teacherForbiddenSlots');
  if (forbC) {
    const st = loadState();
    const slotsPerDay = st.school?.slotsPerDay || 6;
    // preserve selection
    const currentSelected = Array.from(forbC.querySelectorAll('input[type="checkbox"]:checked')).map(i => parseInt(i.value,10));
    let selectedSet = new Set(currentSelected);
    if (selectedSet.size === 0 && st.ui?.editingTeacherId) {
      const t = getTeachers().find(x => x.id === st.ui.editingTeacherId);
      if (t) selectedSet = new Set((t.forbiddenSlots || []).map(Number));
    }
    forbC.innerHTML = '';
    for (let i=0;i<slotsPerDay;i++) {
      const label = document.createElement('label');
      const checkedAttr = selectedSet.has(i) ? 'checked' : '';
      label.innerHTML = `<input type="checkbox" value="${i}" ${checkedAttr}/> <span>الحصة ${i+1}</span>`;
      forbC.appendChild(label);
    }
  }

  // render per-day/per-slot matrix
  renderForbiddenDaySlotsMatrix();

  buildTeacherSubjectsGrid();
}

// ---------- Forbidden Day/Slot Matrix helpers ----------
function renderForbiddenDaySlotsMatrix() {
  const holder = document.getElementById('teacherForbiddenDaySlots');
  if (!holder) return;
  const st = loadState();
  const days = st.school?.workingDays || DEFAULT_DAYS;
  const slots = st.school?.slotsPerDay || 6;
  const slotTimes = st.school?.slotTimes || [];
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  trh.innerHTML = `<th>اليوم \ الحصة</th>${Array.from({length: slots}).map((_,i)=>`<th>${i+1}<div class="hint">${slotTimes[i]?.start||''} - ${slotTimes[i]?.end||''}</div></th>`).join('')}`;
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  days.forEach((day, di) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = day;
    tr.appendChild(th);
    for (let si=0; si<slots; si++) {
      const td = document.createElement('td');
      td.innerHTML = `<input type="checkbox" data-day="${day}" data-slot="${si}" />`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  holder.innerHTML = '';
  holder.appendChild(table);
}

function collectForbiddenDaySlotsFromUI() {
  const holder = document.getElementById('teacherForbiddenDaySlots');
  if (!holder) return [];
  const days = (loadState().school?.workingDays || DEFAULT_DAYS);
  const byDay = new Map(days.map(d => [d, []]));
  holder.querySelectorAll('input[type="checkbox"]').forEach(ch => {
    if (ch.checked) {
      const day = ch.getAttribute('data-day');
      const slot = parseInt(ch.getAttribute('data-slot'), 10);
      if (byDay.has(day)) byDay.get(day).push(slot);
    }
  });
  const result = [];
  byDay.forEach((slots, day) => { if (slots.length > 0) result.push({ day, slots }); });
  return result;
}

function restoreForbiddenDaySlotsMatrix(list) {
  const holder = document.getElementById('teacherForbiddenDaySlots');
  if (!holder || !Array.isArray(list)) return;
  // clear
  holder.querySelectorAll('input[type="checkbox"]').forEach(ch => { ch.checked = false; });
  list.forEach(item => {
    const day = item.day;
    (item.slots || []).forEach(s => {
      const ch = holder.querySelector(`input[type="checkbox"][data-day="${day}"][data-slot="${s}"]`);
      if (ch) ch.checked = true;
    });
  });
}

function getSelectedClassScopesFromUI() {
  const clsC = $('teacherClasses');
  const classIds = Array.from(clsC.querySelectorAll('.class-check:checked')).map(i => i.value);
  const scopes = {};
  classIds.forEach(cid => {
    const modeEl = clsC.querySelector(`input[name="scope-${cid}"]:checked`);
    const mode = modeEl ? modeEl.value : 'all';
    if (mode === 'some') {
      const sections = Array.from(clsC.querySelectorAll(`.sections-choices[data-sections-for="${cid}"] .section-check:checked`)).map(i => i.value);
      scopes[cid] = { mode: 'some', sectionIds: sections };
    } else {
      scopes[cid] = { mode: 'all', sectionIds: [] };
    }
  });
  return { classIds, scopes };
}

function buildTeacherSubjectsGrid() {
  const subC = $('teacherSubjects');
  if (!subC) return;
  const subs = getSubjects();
  subC.innerHTML = '';
  const cls = getClasses();
  const { classIds, scopes } = getSelectedClassScopesFromUI();
  const selectedSections = new Set();
  cls.filter(c => classIds.includes(c.id)).forEach(c => {
    const scope = scopes[c.id] || { mode: 'all' };
    const sections = (c.sections || [{ id: c.id, name: c.name }]);
    if (scope.mode === 'some') {
      sections.filter(sec => (scope.sectionIds || []).includes(sec.id)).forEach(sec => selectedSections.add(sec.id));
    } else {
      sections.forEach(sec => selectedSections.add(sec.id));
    }
  });
  subs.forEach(s => {
    const row = document.createElement('div');
    row.className = 'subject-row';
    const title = document.createElement('div');
    title.className = 'subject-title';
    title.textContent = s.name;
    const sectionsWrap = document.createElement('div');
    sectionsWrap.className = 'sections-grid';
    cls.filter(c => classIds.includes(c.id)).forEach(c => {
      (c.sections || [{id: c.id, name: c.name}]).forEach(sec => {
        if (!selectedSections.has(sec.id)) return;
        const cell = document.createElement('div');
        cell.className = 'section-cell';
        cell.innerHTML = `<span class="hint">${sec.name}</span><input type="number" min="0" max="40" data-subject="${s.id}" data-section="${sec.id}" placeholder="حصص/أسبوع" />`;
        sectionsWrap.appendChild(cell);
      });
    });
    row.appendChild(title);
    row.appendChild(sectionsWrap);
    subC.appendChild(row);
  });
}

// ---------- Teacher Edit Mode ----------
function enterTeacherEditMode(teacherId) {
  // save edit id into state.ui
  const st = loadState();
  const ui = { ...(st.ui || {}), editingTeacherId: teacherId };
  saveState({ ui });

  const t = getTeachers().find(x => x.id === teacherId);
  if (!t) return;

  // Fill form
  $('teacherName').value = t.name || '';
  // mark classes and offDays; then refresh editor to build sections grid
  document.querySelectorAll('#teacherClasses input[type="checkbox"]').forEach(chk => {
    chk.checked = t.classIds.includes(chk.value);
  });
  document.querySelectorAll('#teacherOffDays input[type="checkbox"]').forEach(chk => {
    chk.checked = (t.offDays || []).includes(chk.value);
  });
  // Defer to next tick to ensure DOM is updated
  setTimeout(() => {
    refreshTeacherEditors();
    // now fill per-section values
    // restore class scopes selection
    if (t.classScopes) {
      const clsC = document.getElementById('teacherClasses');
      Object.entries(t.classScopes).forEach(([cid, sc]) => {
        const box = clsC?.querySelector(`.scope-controls[data-class="${cid}"]`);
        if (box) {
          box.classList.remove('hidden');
          const r = clsC.querySelector(`input[name="scope-${cid}"][value="${sc.mode === 'some' ? 'some' : 'all'}"]`);
          if (r) r.checked = true;
          const wrap = clsC.querySelector(`.sections-choices[data-sections-for="${cid}"]`);
          if (wrap) {
            if (sc.mode === 'some') {
              wrap.classList.remove('hidden');
              (sc.sectionIds||[]).forEach(id => {
                const secChk = wrap.querySelector(`.section-check[value="${id}"]`);
                if (secChk) secChk.checked = true;
              });
            } else {
              wrap.classList.add('hidden');
            }
          }
        }
      });
      buildTeacherSubjectsGrid();
    }
    (t.subjects || []).forEach(sub => {
      Object.entries(sub.perSections || {}).forEach(([secId, val]) => {
        const el = document.querySelector(`[data-subject="${sub.subjectId}"][data-section="${secId}"]`);
        if (el) el.value = String(val);
      });
    });
    // restore forbidden day/slot matrix
    restoreForbiddenDaySlotsMatrix(t.forbiddenDaySlots || []);
  }, 0);

  // UI state
  $('teacherSubmitBtn').textContent = 'حفظ التعديلات';
  $('cancelEditTeacherBtn').classList.remove('hidden');
  $('teacherEditBadge').classList.remove('hidden');

  // UX: scroll to the teacher form and highlight it
  const section = document.getElementById('teachers-section');
  if (section && section.scrollIntoView) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  }
  const formEl = document.getElementById('teacher-form');
  if (formEl) {
    formEl.classList.add('flash-highlight');
    setTimeout(() => formEl.classList.remove('flash-highlight'), 1200);
  }
  const nameInput = document.getElementById('teacherName');
  nameInput?.focus?.();
}

function clearTeacherEditMode() {
  const st = loadState();
  const ui = { ...(st.ui || {}) };
  delete ui.editingTeacherId;
  saveState({ ui });

  // clear form
  $('teacherName').value = '';
  document.querySelectorAll('#teacherClasses input[type="checkbox"]').forEach(chk => chk.checked = false);
  document.querySelectorAll('#teacherOffDays input[type="checkbox"]').forEach(chk => chk.checked = false);
  refreshTeacherEditors();

  $('teacherSubmitBtn').textContent = 'إضافة معلم';
  $('cancelEditTeacherBtn').classList.add('hidden');
  $('teacherEditBadge').classList.add('hidden');
}

// ------------- Progress (placeholder) -------------
function renderProgressSummary() {
  const el = document.getElementById('progressSummary');
  if (!el) return;
  const st = loadState();
  const stats = {
    classes: (st.classes || []).length,
    subjects: (st.subjects || []).length,
    teachers: (st.teachers || []).length,
  };
  el.innerHTML = `
    <div>المدرسة: <strong>${st.school?.name || '—'}</strong></div>
    <div>صفوف: <strong>${stats.classes}</strong> | مواد: <strong>${stats.subjects}</strong> | معلمون: <strong>${stats.teachers}</strong></div>`;
}

// Re-render progress on tab activation
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t instanceof HTMLElement && t.classList.contains('tab-link') && t.getAttribute('data-target') === 'progress-section') {
    setTimeout(renderProgressSummary, 0);
  }
});

// ---------- Timetable generation ----------
function generateTimetable() {
  const st = loadState();
  const workingDays = (st.school?.workingDays || []).slice();
  const slotsPerDay = st.school?.slotsPerDay || 6;
  const classes = st.classes || [];
  const subjects = st.subjects || [];
  const teachers = st.teachers || [];
  if (!st.school?.name || workingDays.length === 0 || slotsPerDay <= 0) {
    alert('يرجى إكمال الإعدادات أولاً');
    return [];
  }
  if (classes.length === 0 || subjects.length === 0 || teachers.length === 0) {
    alert('أضف صفوفًا وموادًا ومعلمين قبل توليد الجدول');
    return [];
  }

  // Build teacher subject capacity map
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  // Track per-teacher per-subject per-section remaining
  const teacherSubjectRemaining = new Map(); // teacherId -> Map(subjectId->Map(sectionId->remaining))
  teachers.forEach(t => {
    const subjMap = new Map();
    (t.subjects||[]).forEach(s => {
      const secMap = new Map(Object.entries(s.perSections || {}).map(([secId, v]) => [secId, v]));
      subjMap.set(s.subjectId, secMap);
    });
    teacherSubjectRemaining.set(t.id, subjMap);
  });

  // Create demand items per SECTION by subjects derived from teachers who can teach that section
  const demands = [];
  classes.forEach(cls => {
    const sections = cls.sections && cls.sections.length ? cls.sections : [{ id: cls.id, name: cls.name }];
    sections.forEach(sec => {
      subjects.forEach(sub => {
        // teachers who have perSections allocation for this section and subject
        const capable = teachers.filter(t => t.classIds.includes(cls.id)).filter(t => {
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

  // Sort demands by scarcity (fewer teachers first)
  demands.sort((a,b) => a.teachers.length - b.teachers.length || a.remaining - b.remaining);

  // Timetable structure and load maps
  const assignments = [];
  const classBusy = new Map(); // sectionId -> Map(day->Set(slot))
  const teacherBusy = new Map(); // teacherId -> Map(day->Set(slot))
  const teacherDayLoad = new Map(); // teacherId -> Map(day->count)
  const classDaySubjectCount = new Map(); // sectionId -> Map(day -> Map(subjectId->count))

  function isTeacherAvailable(tid, day, slot) {
    const t = teacherMap.get(tid);
    if (!t) return false;
    if ((t.offDays || []).includes(day)) return false;
    if ((t.forbiddenSlots || []).includes(slot)) return false;
    // Check per-day/slot forbiddance
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

  // Greedy assignment with scoring and limited backtracking
  for (const demand of demands) {
    let attempts = 0;
    while (demand.remaining > 0 && attempts < workingDays.length * slotsPerDay * 2) {
      attempts++;
      // build candidate list (day, slot, teacher) with scores
      const candidates = [];
      for (const day of workingDays) {
        for (let slot = 0; slot < slotsPerDay; slot++) {
          const cBusyDay = classBusy.get(demand.sectionId)?.get(day);
          if (cBusyDay && cBusyDay.has(slot)) continue;
          for (const tid of demand.teachers) {
            if (!isTeacherAvailable(tid, day, slot)) continue;
            const subjMap = teacherSubjectRemaining.get(tid);
            const secMap = subjMap?.get(demand.subjectId);
            const left = secMap?.get(demand.sectionId) || 0;
            if (left <= 0) continue;

            // scoring
            let score = 0;
            const tLoad = teacherDayLoad.get(tid)?.get(day) || 0;
            score += tLoad; // prefer days with less load for that teacher
            const subjCount = classDaySubjectCount.get(demand.sectionId)?.get(day)?.get(demand.subjectId) || 0;
            if (subjCount > 0) score += 100; // strong penalty: avoid repeating same subject in same day for same class

            // penalty if adjacent slot already has same subject for this class
            const prev = assignments.find(a => a.sectionId === demand.sectionId && a.day === day && a.slot === slot-1 && a.subjectId === demand.subjectId);
            const next = assignments.find(a => a.sectionId === demand.sectionId && a.day === day && a.slot === slot+1 && a.subjectId === demand.subjectId);
            if (prev || next) score += 50;

            // mild penalty if teacher has adjacent slot busy the same day (to give them breaks if possible)
            const tBusyDay = teacherBusy.get(tid)?.get(day);
            if (tBusyDay && (tBusyDay.has(slot-1) || tBusyDay.has(slot+1))) score += 10;

            // mild penalty for class day load to spread across days
            const classDayLoad = (classBusy.get(demand.sectionId)?.get(day)?.size) || 0;
            score += classDayLoad * 0.5;

            // small jitter to avoid ties
            score += Math.random() * 0.01;

            candidates.push({ day, slot, tid, score });
          }
        }
      }

      // pick best candidate
      candidates.sort((a,b) => a.score - b.score);
      let placed = false;
      if (candidates.length > 0) {
        const { day, slot, tid } = candidates[0];
        assignments.push({ day, slot, sectionId: demand.sectionId, classId: demand.classId, subjectId: demand.subjectId, teacherId: tid });
        markBusy(classBusy, demand.sectionId, day, slot);
        markBusy(teacherBusy, tid, day, slot);
        incTeacherDayLoad(tid, day, 1);
        incClassDaySubject(demand.sectionId, day, demand.subjectId, 1);
  const subjMap = teacherSubjectRemaining.get(tid);
  const secMap = subjMap.get(demand.subjectId);
  secMap.set(demand.sectionId, (secMap.get(demand.sectionId) || 0) - 1);
        demand.remaining--;
        placed = true;
      }
      // If not placed in a full sweep, try soft backtracking: free one random conflicting slot for this class
      if (!placed) {
        const idx = assignments.findIndex(a => a.sectionId === demand.sectionId);
        if (idx >= 0) {
          const a = assignments.splice(idx, 1)[0];
          // unmark busy
          classBusy.get(a.sectionId)?.get(a.day)?.delete(a.slot);
          teacherBusy.get(a.teacherId)?.get(a.day)?.delete(a.slot);
          incTeacherDayLoad(a.teacherId, a.day, -1);
          incClassDaySubject(a.sectionId, a.day, a.subjectId, -1);
          // return that demand
          const back = demands.find(d => d.sectionId === a.sectionId && d.subjectId === a.subjectId);
          if (back) back.remaining++;
          // restore teacher subject remaining
          const subjMap = teacherSubjectRemaining.get(a.teacherId);
          const secMap = subjMap?.get(a.subjectId);
          if (secMap) secMap.set(a.sectionId, (secMap.get(a.sectionId) || 0) + 1);
        } else {
          break; // nothing to backtrack
        }
      }
    }
  }

  setTimetable(assignments);
  return assignments;
}

function renderTimetableByClass(assignments) {
  const st = loadState();
  const classes = st.classes || [];
  const subjects = new Map((st.subjects||[]).map(s => [s.id, s.name]));
  const teachers = new Map((st.teachers||[]).map(t => [t.id, t.name]));
  const workingDays = st.school?.workingDays || [];
  const slotsPerDay = st.school?.slotsPerDay || 6;
  const slotTimes = st.school?.slotTimes || [];
  const container = document.getElementById('timetableContainer');
  container.innerHTML = '';

  classes.forEach(cls => {
    const sections = cls.sections && cls.sections.length ? cls.sections : [{ id: cls.id, name: cls.name }];
    sections.forEach(sec => {
    const table = document.createElement('table');
    table.className = 'timetable';
    const caption = document.createElement('caption');
      caption.textContent = `${st.school?.name || ''} - جدول الشُعبة: ${sec.name}`;
    table.appendChild(caption);
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = `<th>اليوم/الحصة</th>${Array.from({length: slotsPerDay}).map((_,i)=>`<th>${i+1}<div class="hint">${slotTimes[i]?.start||''} - ${slotTimes[i]?.end||''}</div></th>`).join('')}`;
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    workingDays.forEach(day => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th>${day}</th>`;
      for (let slot=0; slot<slotsPerDay; slot++) {
        const cell = document.createElement('td');
          const a = assignments.find(x => x.sectionId === sec.id && x.day === day && x.slot === slot);
        if (a) {
          cell.innerHTML = `<div>${subjects.get(a.subjectId)||''}</div><div class="hint">${teachers.get(a.teacherId)||''}</div>`;
        } else {
          cell.textContent = '—';
        }
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
    });
  });
}

function renderTimetableByTeacher(assignments) {
  const st = loadState();
  const classSectionName = new Map();
  (st.classes||[]).forEach(c => {
    if (c.sections && c.sections.length) {
      c.sections.forEach(sec => classSectionName.set(sec.id, sec.name));
    } else {
      classSectionName.set(c.id, c.name);
    }
  });
  const subjects = new Map((st.subjects||[]).map(s => [s.id, s.name]));
  const teachers = st.teachers || [];
  const workingDays = st.school?.workingDays || [];
  const slotsPerDay = st.school?.slotsPerDay || 6;
  const slotTimes = st.school?.slotTimes || [];
  const container = document.getElementById('timetableContainer');
  container.innerHTML = '';

  teachers.forEach(t => {
    const table = document.createElement('table');
    table.className = 'timetable';
    const caption = document.createElement('caption');
    caption.textContent = `${st.school?.name || ''} - جدول المعلم: ${t.name}`;
    table.appendChild(caption);
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    trh.innerHTML = `<th>اليوم/الحصة</th>${Array.from({length: slotsPerDay}).map((_,i)=>`<th>${i+1}<div class="hint">${slotTimes[i]?.start||''} - ${slotTimes[i]?.end||''}</div></th>`).join('')}`;
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    workingDays.forEach(day => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th>${day}</th>`;
      for (let slot=0; slot<slotsPerDay; slot++) {
        const cell = document.createElement('td');
        const a = assignments.find(x => x.teacherId === t.id && x.day === day && x.slot === slot);
        if (a) {
          cell.innerHTML = `<div>${subjects.get(a.subjectId)||''}</div><div class="hint">${classSectionName.get(a.sectionId)||''}</div>`;
        } else {
          cell.textContent = '—';
        }
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  });
}

// Combined view: single big table for all classes; columns are grouped by class with section columns under each
function renderCombinedByClass(assignments) {
  const st = loadState();
  const classes = st.classes || [];
  const subjects = new Map((st.subjects||[]).map(s => [s.id, s.name]));
  const teachers = new Map((st.teachers||[]).map(t => [t.id, t.name]));
  const workingDays = st.school?.workingDays || [];
  const slotsPerDay = st.school?.slotsPerDay || 6;
  const slotTimes = st.school?.slotTimes || [];
  const container = document.getElementById('timetableContainer');
  container.innerHTML = '';

  // Flatten columns: for each class, collect its sections
  const classSections = classes.map(cls => ({
    classId: cls.id,
    className: cls.name,
    sections: (cls.sections && cls.sections.length) ? cls.sections : [{ id: cls.id, name: cls.name }]
  }));

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'timetable';
  const caption = document.createElement('caption');
  caption.textContent = `${st.school?.name || ''} - عرض مجمع لجميع الصفوف والشُعب`;
  table.appendChild(caption);

  const thead = document.createElement('thead');
  // Header row 1: day/time + class group headers with colspan of number of sections
  const trTop = document.createElement('tr');
  trTop.innerHTML = `<th rowspan="2">اليوم</th><th rowspan="2">الحصة</th>`;
  classSections.forEach(group => {
    const th = document.createElement('th');
    th.colSpan = group.sections.length;
    th.textContent = group.className;
    trTop.appendChild(th);
  });
  thead.appendChild(trTop);
  // Header row 2: section names under each class
  const trSub = document.createElement('tr');
  classSections.forEach(group => {
    group.sections.forEach(sec => {
      const th = document.createElement('th');
      th.textContent = sec.name;
      trSub.appendChild(th);
    });
  });
  thead.appendChild(trSub);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  workingDays.forEach(day => {
    for (let slot=0; slot<slotsPerDay; slot++) {
      const tr = document.createElement('tr');
      if (slot === 0) {
        const thDay = document.createElement('th');
        thDay.rowSpan = slotsPerDay;
        thDay.textContent = day;
        tr.appendChild(thDay);
      }
      const thSlot = document.createElement('th');
      thSlot.innerHTML = `الحصة ${slot+1}<div class="hint">${slotTimes[slot]?.start||''} - ${slotTimes[slot]?.end||''}</div>`;
      tr.appendChild(thSlot);

      classSections.forEach(group => {
        group.sections.forEach(sec => {
          const td = document.createElement('td');
          const a = assignments.find(x => x.sectionId === sec.id && x.day === day && x.slot === slot);
          if (a) {
            td.innerHTML = `<div>${subjects.get(a.subjectId) || ''}</div><div class="hint">${teachers.get(a.teacherId) || ''}</div>`;
          } else {
            td.textContent = '—';
          }
          tr.appendChild(td);
        });
      });
      tbody.appendChild(tr);
    }
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

// Wire buttons
document.addEventListener('DOMContentLoaded', () => {
  const genBtn = document.getElementById('generateBtn');
  const container = document.getElementById('timetableContainer');
  let CURRENT_VIEW = 'by-class';
  genBtn?.addEventListener('click', () => {
    const assignments = generateTimetable();
    if (assignments.length) {
      renderTimetableByClass(assignments);
    } else {
      container.innerHTML = '';
    }
  });
  document.querySelectorAll('.view-toggle .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const assignments = getTimetable();
      const view = btn.getAttribute('data-view');
      if (view === 'by-class') { renderTimetableByClass(assignments); CURRENT_VIEW = 'by-class'; }
      else if (view === 'by-teacher') { renderTimetableByTeacher(assignments); CURRENT_VIEW = 'by-teacher'; }
      else if (view === 'combined-class') { renderCombinedByClass(assignments); CURRENT_VIEW = 'combined-class'; }
    });
  });

  // Print
  document.getElementById('printBtn')?.addEventListener('click', () => {
    // If combined view, add body class to tighten print spacing and force landscape
    if (CURRENT_VIEW === 'combined-class') {
      document.body.classList.add('combined-print');
      tryFitCombinedTableToA4();
    }
    window.print();
    // Remove after a short delay to keep screen styles normal
    setTimeout(() => {
      if (CURRENT_VIEW === 'combined-class') unscaleCombinedTable();
      document.body.classList.remove('combined-print');
    }, 100);
  });

  // Export: Image (PNG)
  document.getElementById('exportImageBtn')?.addEventListener('click', async () => {
    if (!container || container.children.length === 0) { alert('يرجى توليد الجدول أولًا'); return; }
    try {
      const blob = await captureElementAsPNG(container);
      if (!blob) { alert('تعذر إنشاء الصورة'); return; }
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `timetable-${Date.now()}.png`);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء التصدير كصورة');
    }
  });

  // Export: Excel (.xls)
  document.getElementById('exportExcelBtn')?.addEventListener('click', () => {
    if (!container || container.children.length === 0) { alert('يرجى توليد الجدول أولًا'); return; }
    const html = buildTablesExportHTML(container, 'excel');
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `timetable-${Date.now()}.xls`);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // Export: Word (.doc)
  document.getElementById('exportWordBtn')?.addEventListener('click', () => {
    if (!container || container.children.length === 0) { alert('يرجى توليد الجدول أولًا'); return; }
    const html = buildTablesExportHTML(container, 'word');
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `timetable-${Date.now()}.doc`);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
});

function defaultPrintHeader(st) {
  const name = st.school?.name ? `إدارة ${st.school.name}` : 'إدارة [اسم المدرسة]';
  return name;
}

// --- Print scaling helpers for combined view ---
let COMBINED_SCALE_APPLIED = false;
function tryFitCombinedTableToA4() {
  const wrap = document.querySelector('#timetableContainer .table-scroll');
  const table = wrap?.querySelector('table.timetable');
  if (!wrap || !table) return;
  // Make sure scroll holder doesn't constrain width at print
  wrap.style.overflow = 'visible';
  // A4 landscape printable width approximation in pixels (at 96dpi ~ 1122px minus margins). We'll compute from page size when possible.
  // Use container width as reference; if table is wider, scale it down.
  const availableWidth = document.body.clientWidth; // approx printable area in CSS pixels
  const tableWidth = table.getBoundingClientRect().width;
  if (tableWidth > 0 && availableWidth > 0 && tableWidth > availableWidth) {
    const scale = Math.max(0.6, (availableWidth - 12) / tableWidth);
    table.style.transformOrigin = 'right top';
    table.style.transform = `scale(${scale})`;
    COMBINED_SCALE_APPLIED = true;
  } else {
    COMBINED_SCALE_APPLIED = false;
  }
}
function unscaleCombinedTable() {
  const table = document.querySelector('#timetableContainer .table-scroll table.timetable');
  if (!table) return;
  if (COMBINED_SCALE_APPLIED) {
    table.style.transform = '';
    table.style.transformOrigin = '';
  }
  const wrap = document.querySelector('#timetableContainer .table-scroll');
  if (wrap) {
    wrap.style.overflow = '';
  }
  COMBINED_SCALE_APPLIED = false;
}

// ---------- Export helpers ----------
function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function inlineCurrentStyles() {
  // Collect relevant CSS from the page for tables
  const styles = [];
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
    if (node.tagName.toLowerCase() === 'style') {
      styles.push(node.textContent || '');
    }
  });
  // Minimal fallback styles
  styles.push(`
    body { direction: rtl; font-family: Tahoma, Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #999; padding: 4px; font-size: 12px; text-align: center; }
    caption { font-weight: bold; margin: 4px 0; }
  `);
  return `<style>${styles.join('\n')}</style>`;
}

function buildTablesExportHTML(container, mode) {
  const st = loadState();
  const head = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${inlineCurrentStyles()}</head><body>`;
  const title = `<h3 style="text-align:center;">${st.printHeader || defaultPrintHeader(st)}</h3>`;
  // Clone visible tables
  const tables = Array.from(container.querySelectorAll('table.timetable')).map(t => t.cloneNode(true));
  // Remove captions if needed for Excel; keep structure compact
  if (mode === 'excel') {
    tables.forEach(tbl => {
      // Excel likes inline widths and basic tables
      tbl.style.width = '100%';
    });
  }
  const html = tables.map(t => t.outerHTML).join('\n');
  const foot = `</body></html>`;
  return `${head}${title}${html}${foot}`;
}

async function captureElementAsPNG(container) {
  // Snapshot via SVG foreignObject to canvas
  const rect = container.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  fo.setAttribute('x', '0'); fo.setAttribute('y', '0');
  fo.setAttribute('width', '100%'); fo.setAttribute('height', '100%');
  const styles = inlineCurrentStyles();
  const html = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;direction:rtl;">${styles}${container.innerHTML}</div>`;
  fo.innerHTML = html;
  svg.appendChild(fo);
  const xml = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  URL.revokeObjectURL(url);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
