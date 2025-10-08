// Basic app state and persistence
const STORAGE_KEY = 'school-timetable-v1'; // still used as a fallback/migration
const DB_NAME = 'school-timetable-db';
const DB_VERSION = 2;
const PROJECT_STORE = 'projects';
const CATALOG_STORE = 'catalog';
let ACTIVE_PROJECT_ID = null;
let IN_MEMORY_STATE = null;
let DB_CONNECTION = null; // Cached DB connection

// -------- IndexedDB helpers --------
function openDB() {
  if (DB_CONNECTION) return Promise.resolve(DB_CONNECTION);
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
    req.onsuccess = () => {
      DB_CONNECTION = req.result;
      resolve(DB_CONNECTION);
    };
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

// -------- Central UI Refresh --------
function refreshUIFromState(state) {
  if (!state || !state.school) return;
  const school = state.school;
  
  // Fill school settings
  $('schoolName').value = school.name || '';
  $('slotsPerDay').value = school.slotsPerDay || 6;
  if ($('firstLessonStart')) $('firstLessonStart').value = school.firstLessonStart || '';
  if ($('lessonDuration')) $('lessonDuration').value = school.lessonDuration || '';
  if ($('breakDuration')) $('breakDuration').value = school.breakDuration || '';
  if ($('schoolType')) $('schoolType').value = school.type || '';
  
  // School type and branches
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
  
  // Working days
  renderWorkingDays(DEFAULT_DAYS, school.workingDays || DEFAULT_DAYS.filter(d => d !== 'الجمعة' && d !== 'السبت'));
  
  // Slot times
  const sCount = school.slotsPerDay || 6;
  const prefillTimes = (school.slotTimes && school.slotTimes.length)
    ? school.slotTimes
    : ((school.firstLessonStart && school.lessonDuration)
        ? autoCalcSlotTimes(school.firstLessonStart, parseInt(school.lessonDuration,10)||0, parseInt(school.breakDuration||'0',10)||0, sCount)
        : []);
  renderSlotTimesEditor(sCount, prefillTimes);
  
  // Update preview
  updatePreview(state);
  
  // Refresh lists
  renderClassesList();
  renderSubjectsList();
  renderTeachersList();
  renderSubjectsCatalog();
  
  // Print header
  const ph = document.getElementById('printHeader');
  if (ph) ph.textContent = state.printHeader || defaultPrintHeader(state);
}

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
  refreshUIFromState(latest);

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
  renderStats(); // عرض الإحصائيات إذا كان هناك جدول موجود
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
    refreshUIFromState(loadState());
    document.querySelector('[data-target="setup-section"]')?.click();
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
    refreshUIFromState(loadState());
    document.querySelector('[data-target="setup-section"]')?.click();
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
    refreshUIFromState(loadState());
    document.querySelector('[data-target="setup-section"]')?.click();
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

// ---------- Helpers: planned counts and capacity per section ----------
function computeSectionPlannedCounts() {
  // returns Map<sectionId, totalPlannedPeriods>
  const m = new Map();
  const teachers = getTeachers();
  (teachers||[]).forEach(t => {
    (t.subjects||[]).forEach(su => {
      Object.entries(su.perSections || {}).forEach(([secId, cnt]) => {
        m.set(secId, (m.get(secId)||0) + (cnt||0));
      });
    });
  });
  return m;
}
function getWeeklyCapacity() {
  const st = loadState();
  const workingDays = st.school?.workingDays || [];
  const slotsPerDay = st.school?.slotsPerDay || 6;
  return workingDays.length * slotsPerDay;
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
  const secPlannedMap = computeSectionPlannedCounts();
  const weeklyCap = getWeeklyCapacity();
  list.forEach(item => {
    const row = document.createElement('div');
    row.className = 'list-item';
    const sectionNames = (item.sections||[]).map(s => s.name).join('، ');
    // build over-capacity warning per section
    const overDetails = [];
    const secs = (item.sections && item.sections.length) ? item.sections : [{ id: item.id, name: item.name }];
    secs.forEach(sec => {
      const planned = secPlannedMap.get(sec.id) || 0;
      if (planned > weeklyCap) {
        overDetails.push(`${sec.name}: +${planned - weeklyCap}`);
      }
    });
    const warnHtml = overDetails.length
      ? `<div class="hint" style="color:#b91c1c;">⚠️ تجاوز السعة الأسبوعية — ${overDetails.join('، ')}</div>`
      : '';
    row.innerHTML = `
      <div>
        <div><strong>${item.name}</strong></div>
        <div class="hint">الشُعب: ${sectionNames || '—'}</div>
        ${warnHtml}
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
// دالة التحقق من عدد الحصص
function validatePeriodsCount(st, workingDays, slotsPerDay, classes, subjects, teachers) {
  const totalAvailableSlots = workingDays.length * slotsPerDay;
  
  // حساب مجموع الحصص المطلوبة لكل شعبة
  const sectionDemands = new Map(); // sectionId -> { name, required, available }
  
  classes.forEach(cls => {
    const sections = cls.sections && cls.sections.length ? cls.sections : [{ id: cls.id, name: cls.name }];
    sections.forEach(sec => {
      let totalRequired = 0;
      
      // حساب الحصص المطلوبة من المعلمين
      subjects.forEach(sub => {
        const capable = teachers.filter(t => t.classIds.includes(cls.id)).filter(t => {
          const rec = (t.subjects || []).find(s => s.subjectId === sub.id);
          return rec && rec.perSections && typeof rec.perSections[sec.id] === 'number' && rec.perSections[sec.id] > 0;
        });
        
        const totalPeriods = capable.reduce((acc, t) => {
          const rec = t.subjects.find(s => s.subjectId === sub.id);
          return acc + (rec.perSections[sec.id] || 0);
        }, 0);
        
        totalRequired += totalPeriods;
      });
      
      sectionDemands.set(sec.id, {
        name: sec.name,
        required: totalRequired,
        available: totalAvailableSlots
      });
    });
  });
  
  // التحقق من وجود فرق بين المطلوب والمتاح
  let hasIssues = false;
  let message = '';
  let excessSections = [];
  let deficitSections = [];
  
  sectionDemands.forEach((demand, secId) => {
    const diff = demand.required - demand.available;
    
    if (diff > 0) {
      hasIssues = true;
      excessSections.push({ name: demand.name, diff, required: demand.required });
    } else if (diff < 0) {
      deficitSections.push({ name: demand.name, diff: Math.abs(diff), required: demand.required });
    }
  });
  
  if (hasIssues) {
    let totalExcess = excessSections.reduce((sum, sec) => sum + sec.diff, 0);
    message = '⚠️ تنبيه: تم اكتشاف مشكلة في عدد الحصص!\n\n';
    message += `📊 الحصص المتاحة أسبوعياً: ${totalAvailableSlots} حصة (${workingDays.length} أيام × ${slotsPerDay} حصص)\n\n`;
    
    if (excessSections.length > 0) {
      message += '🔴 الشعب التالية لديها حصص أكثر من المتاح:\n';
      excessSections.forEach(sec => {
        message += `   • ${sec.name}: ${sec.diff} حصة زائدة (المطلوب: ${sec.required}، المتاح: ${totalAvailableSlots})\n`;
      });
      message += `\n⚠️ المجموع: ${totalExcess} حصة زائدة سيتم إسقاطها تلقائياً!\n\n`;
    }
    
    message += 'هل تريد المتابعة في توليد الجدول؟';
    
    return { isValid: false, message };
  }
  
  // إذا كانت هناك حصص فارغة فقط (بدون زيادة)
  if (deficitSections.length > 0) {
    let totalDeficit = deficitSections.reduce((sum, sec) => sum + sec.diff, 0);
    message = `ℹ️ ملاحظة: الحصص المدخلة أقل من المتاح\n\n`;
    message += `📊 الحصص المتاحة أسبوعياً: ${totalAvailableSlots} حصة (${workingDays.length} أيام × ${slotsPerDay} حصص)\n\n`;
    message += `سيتم توليد الجدول مع ترك ${totalDeficit} حصة فارغة.\n\n`;
    message += 'التفاصيل:\n';
    deficitSections.forEach(sec => {
      message += `   • ${sec.name}: ${sec.diff} حصة فارغة (المطلوب: ${sec.required}، المتاح: ${totalAvailableSlots})\n`;
    });
    message += '\nهل تريد المتابعة؟';
    
    return { isValid: false, message };
  }
  
  return { isValid: true, message: '' };
}

function generateTimetable() {
  const st = loadState();
  const workingDays = (st.school?.workingDays || []).slice();
  const slotsPerDay = st.school?.slotsPerDay || 6;
  const classes = st.classes || [];
  const subjects = st.subjects || [];
  const teachers = st.teachers || [];
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
  
  // حماية: لو كانت هناك دالة مقارنة مع منهاج الوزارة مستخدمة في نسخة أخرى، لا تتسبب في إيقاف التنفيذ إن لم تُحمّل
  try {
    if (typeof compareWithMinistryCurriculum === 'function') {
      // تُستدعى داخل بعض النسخ المنشورة قبل التوليد
      compareWithMinistryCurriculum();
    }
  } catch (e) {
    console.warn('تخطي مقارنة المنهاج الوزاري لعدم توفر السكربت:', e?.message || e);
  }
  if (!st.school?.name || workingDays.length === 0 || slotsPerDay <= 0) {
    alert('يرجى إكمال الإعدادات أولاً');
    return [];
  }
  if (classes.length === 0 || subjects.length === 0 || teachers.length === 0) {
    alert('أضف صفوفًا وموادًا ومعلمين قبل توليد الجدول');
    return [];
  }

  // التحقق من عدد الحصص قبل التوليد
  const validationResult = validatePeriodsCount(st, workingDays, slotsPerDay, classes, subjects, teachers);
  if (!validationResult.isValid) {
    if (!confirm(validationResult.message)) {
      return [];
    }
  }

  // Build teacher subject capacity map
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  // Track per-teacher per-subject per-section remaining
  const teacherSubjectRemaining = new Map(); // teacherId -> Map(subjectId->Map(sectionId->remaining))
  const teacherTotalLoad = new Map();
  const teacherIdealDailyLoad = new Map();
  const teacherIdealCategoryLoad = new Map();
  teachers.forEach(t => {
    const subjMap = new Map();
    let totalLoad = 0;
    (t.subjects||[]).forEach(s => {
      const secMap = new Map();
      Object.entries(s.perSections || {}).forEach(([secId, rawValue]) => {
        const count = Math.max(0, rawValue || 0);
        secMap.set(secId, count);
        totalLoad += count;
      });
      if (secMap.size > 0) {
        subjMap.set(s.subjectId, secMap);
      }
    });
    teacherSubjectRemaining.set(t.id, subjMap);
    teacherTotalLoad.set(t.id, totalLoad);
    const idealDaily = workingDays.length ? (totalLoad / workingDays.length) : totalLoad;
    teacherIdealDailyLoad.set(t.id, idealDaily);
    const catIdealMap = new Map();
    uniqueSlotCategories.forEach(cat => {
      const ratio = (categorySlotCounts.get(cat) || 0) / Math.max(1, slotsPerDay);
      catIdealMap.set(cat, totalLoad * ratio);
    });
    teacherIdealCategoryLoad.set(t.id, catIdealMap);
  });

  // Create demand items per SECTION by subjects derived from teachers who can teach that section
  const demands = [];
  
  // Debug logging
  console.log('=== توليد الجدول - تشخيص ===');
  console.log('عدد المعلمون:', teachers.length);
  console.log('عدد الصفوف:', classes.length);
  console.log('عدد المواد:', subjects.length);
  
  // تفصيل كل معلم
  teachers.forEach(t => {
    console.log(`المعلم: ${t.name}`);
    console.log('  - الصفوف المربوطة:', t.classIds);
    console.log('  - المواد:', t.subjects);
  });
  
  classes.forEach(cls => {
    const sections = cls.sections && cls.sections.length ? cls.sections : [{ id: cls.id, name: cls.name }];
    sections.forEach(sec => {
      subjects.forEach(sub => {
        // teachers who have perSections allocation for this section and subject
        // Note: rely on perSections itself; do NOT require classIds linkage to avoid accidental exclusion
        const capable = teachers.filter(t => {
          const rec = (t.subjects || []).find(s => s.subjectId === sub.id);
          return rec && rec.perSections && typeof rec.perSections[sec.id] === 'number' && rec.perSections[sec.id] > 0;
        });
        
        // Debug logging
        if (capable.length > 0) {
          console.log(`الشعبة ${sec.name} - المادة ${sub.name}:`, capable.map(t => ({
            teacher: t.name,
            periods: t.subjects.find(s => s.subjectId === sub.id)?.perSections[sec.id]
          })));
        }
        
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
  
  console.log('الطلبات المُنشأة:', demands);
  console.log('========================');

  // Sort demands by scarcity (fewer teachers first)
  demands.sort((a,b) => a.teachers.length - b.teachers.length || a.remaining - b.remaining);

  // Timetable structure and load maps
  const assignments = [];
  const classBusy = new Map(); // sectionId -> Map(day->Set(slot))
  const teacherBusy = new Map(); // teacherId -> Map(day->Set(slot))
  const teacherDayLoad = new Map(); // teacherId -> Map(day->count)
  const classDaySubjectCount = new Map(); // sectionId -> Map(day -> Map(subjectId->count))
  const teacherDaySectionCount = new Map(); // teacherId -> Map(day -> Map(sectionId->count))
  const teacherCategoryLoad = new Map(); // teacherId -> Map(category -> count)

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
    if (secMap) {
      secMap.set(sectionId, (secMap.get(sectionId) || 0) + 1);
    }
  }

  // Helper: Calculate score for a candidate placement
  function calculatePlacementScore(tid, day, slot, demand, assignmentsBySlot) {
    let score = 0;
    const category = getSlotCategory(slot);
    
    // 1. CRITICAL: Avoid repeating same subject in same day for same class
    const subjCount = classDaySubjectCount.get(demand.sectionId)?.get(day)?.get(demand.subjectId) || 0;
    if (subjCount > 0) score += 1000 * subjCount;

    // 2. HIGH: Penalty if adjacent slot has same subject (use pre-indexed map)
    const daySlotKey = `${day}-${slot}`;
    const prevKey = `${day}-${slot-1}`;
    const nextKey = `${day}-${slot+1}`;
    if (assignmentsBySlot.has(prevKey) || assignmentsBySlot.has(nextKey)) {
      const prevMatch = assignmentsBySlot.get(prevKey)?.some(a => a.sectionId === demand.sectionId && a.subjectId === demand.subjectId);
      const nextMatch = assignmentsBySlot.get(nextKey)?.some(a => a.sectionId === demand.sectionId && a.subjectId === demand.subjectId);
      if (prevMatch || nextMatch) score += 200;
    }

    // 3. MEDIUM: Spread class load across days
    const classDayLoad = (classBusy.get(demand.sectionId)?.get(day)?.size) || 0;
    score += classDayLoad * 5;

    // 4. Balance teacher load across days
    const tLoad = teacherDayLoad.get(tid)?.get(day) || 0;
    const idealDaily = teacherIdealDailyLoad.get(tid) || 0;
    const projectedDiff = Math.abs(tLoad + 1 - idealDaily);
    score += projectedDiff * 90;
    if (tLoad < idealDaily) score -= Math.min(idealDaily - tLoad, 1) * 35;

    // 5. Diversify sections taught by teacher in same day
    const sectionRepeatCount = teacherDaySectionCount.get(tid)?.get(day)?.get(demand.sectionId) || 0;
    if (sectionRepeatCount > 0) {
      score += 250 * (sectionRepeatCount + 1);
    } else {
      score -= 10;
    }

    // 6. Balance slot categories (early/mid/late)
    const catMap = teacherCategoryLoad.get(tid);
    const catCount = catMap?.get(category) || 0;
    const idealCat = teacherIdealCategoryLoad.get(tid)?.get(category) ?? ((teacherTotalLoad.get(tid) || 0) / Math.max(1, uniqueSlotCategories.length));
    const catDiff = Math.abs(catCount + 1 - idealCat);
    score += catDiff * 60;
    if (catCount < idealCat) score -= Math.min(idealCat - catCount, 1) * 15;

    // 7. Teacher breaks
    const tBusyDay = teacherBusy.get(tid)?.get(day);
    if (tBusyDay && (tBusyDay.has(slot-1) || tBusyDay.has(slot+1))) score += 10;

    // 8. Bonus for days without this subject
    if (subjCount === 0) score -= 50;

    // 9. Small jitter
    score += Math.random() * 0.01;
    
    return score;
  }

  // Pre-index assignments by day-slot for faster adjacency lookups
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

  // Greedy assignment with scoring and limited backtracking
  // التحسينات المطبقة:
  // 1. عقوبة تصاعدية قوية لتكرار المادة في نفس اليوم للشعبة.
  // 2. تجنب الحصص المتجاورة لنفس المادة في اليوم نفسه.
  // 3. موازنة عدد حصص المعلم بين الأيام وفق الحمل المثالي.
  // 4. موازنة الشعب التي يدرسها المعلم في اليوم الواحد.
  // 5. توزيع حصص المعلم بين فترات اليوم (أولى/وسطى/أخيرة).
  // 6. الحفاظ على استراحات المعلم بقدر الإمكان.
  // 7. مكافأة اختيار الأيام الخالية من المادة وتشويش بسيط لمنع التعادل.
  for (const demand of demands) {
    let attempts = 0;
    // السماح بعدد محاولات أعلى يتناسب مع عدد المعلّمين والطلب المتبقي
    const baseSweep = workingDays.length * slotsPerDay;
    const maxAttempts = Math.max(baseSweep * Math.max(1, demand.teachers.length) * 4, demand.remaining * baseSweep * 2);
    while (demand.remaining > 0 && attempts < maxAttempts) {
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
            if (!subjMap) continue; // teacher has no subjects map (safety)
            const secMap = subjMap.get(demand.subjectId);
            const left = secMap?.get(demand.sectionId) || 0;
            if (left <= 0) continue;

            // Calculate score using helper
            const score = calculatePlacementScore(tid, day, slot, demand, assignmentsBySlot);
            candidates.push({ day, slot, tid, score, sectionId: demand.sectionId, classId: demand.classId, subjectId: demand.subjectId });
          }
        }
      }

      // pick best candidate
      candidates.sort((a,b) => a.score - b.score);
      let placed = false;
      if (candidates.length > 0) {
        // تحسين إضافي: إذا كان أفضل مرشح يكرر المادة في نفس اليوم،
        // نتحقق إذا كان هناك مرشح بديل في يوم مختلف بفارق نقاط معقول
        const best = candidates[0];
        const bestSubjCount = classDaySubjectCount.get(best.sectionId)?.get(best.day)?.get(demand.subjectId) || 0;
        
        if (bestSubjCount > 0 && candidates.length > 1) {
          // ابحث عن أول مرشح في يوم خالٍ من هذه المادة
          const betterOption = candidates.find((c, idx) => {
            if (idx === 0) return false; // تجاوز الأفضل الحالي
            const cSubjCount = classDaySubjectCount.get(c.sectionId)?.get(c.day)?.get(demand.subjectId) || 0;
            return cSubjCount === 0; // يوم خالٍ من المادة
          });
          
          // إذا وجدنا خيار أفضل (يوم خالٍ)، نستخدمه بدلاً من best
          if (betterOption) {
            const { day, slot, tid } = betterOption;
            recordAssignment(day, slot, demand, tid);
            placed = true;
          }
        }
        
        // إذا لم نجد خيار أفضل، نستخدم الخيار الأفضل الأصلي
        if (!placed) {
          const { day, slot, tid } = best;
          recordAssignment(day, slot, demand, tid);
          placed = true;
        }
      }
      // If not placed in a full sweep, try soft backtracking: free one random conflicting slot for this class
      if (!placed) {
        const idx = assignments.findIndex(a => a.sectionId === demand.sectionId);
        if (idx >= 0) {
          const a = assignments.splice(idx, 1)[0];
          releaseAssignment(a);
          // return that demand
          const back = demands.find(d => d.sectionId === a.sectionId && d.subjectId === a.subjectId);
          if (back) back.remaining++;
        } else {
          break; // nothing to backtrack
        }
      }
    }
  }

  // Fallback pass: try to place any remaining demand in any free slot with any available teacher
  const leftovers = demands.filter(d => d.remaining > 0);
  if (leftovers.length > 0) {
    console.log('=== مرحلة التعويض - الطلبات المتبقية ===');
    leftovers.forEach(d => console.log(`شعبة ${d.sectionId} مادة ${d.subjectId}: ${d.remaining} حصة متبقية`));
    
    // Count free slots per section
    const freeSlotsPerSection = new Map();
    workingDays.forEach(day => {
      for (let slot = 0; slot < slotsPerDay; slot++) {
        classes.forEach(cls => {
          const sections = cls.sections && cls.sections.length ? cls.sections : [{ id: cls.id }];
          sections.forEach(sec => {
            const busy = classBusy.get(sec.id)?.get(day)?.has(slot);
            if (!busy) {
              freeSlotsPerSection.set(sec.id, (freeSlotsPerSection.get(sec.id) || 0) + 1);
            }
          });
        });
      }
    });
    console.log('الخانات المتاحة لكل شعبة:');
    freeSlotsPerSection.forEach((count, secId) => console.log(`شعبة ${secId}: ${count} خانة متاحة`));
    
    // Sort leftovers by remaining descending to prioritize high-demand
    leftovers.sort((a,b) => b.remaining - a.remaining);
    
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
              // also ensure teacher not busy at that time
              const tBusyDay = teacherBusy.get(tid)?.get(day);
              if (tBusyDay && tBusyDay.has(slot)) continue;

              // place without heavy penalties (lenient)
              recordAssignment(day, slot, demand, tid);
              placed = true;
              break;
            }
            if (placed) continue outer_leftover;
          }
        }
        // no place found for this unit -> break to avoid infinite loop
        if (!placed) {
          const reasonCounts = new Map();
          const pushReason = (key) => {
            reasonCounts.set(key, (reasonCounts.get(key) || 0) + 1);
          };
          for (const day of workingDays) {
            const cBusyDay = classBusy.get(demand.sectionId)?.get(day);
            for (let slot = 0; slot < slotsPerDay; slot++) {
              if (cBusyDay && cBusyDay.has(slot)) {
                pushReason(`الشعبة مشغولة - ${day} ${slot+1}`);
                continue;
              }
              let anyTeacherEvaluated = false;
              for (const tid of demand.teachers) {
                anyTeacherEvaluated = true;
                const subjMap = teacherSubjectRemaining.get(tid);
                if (!subjMap) {
                  pushReason(`المعلم ${tid} لا يدرّس هذه المادة بعد الآن`);
                  continue;
                }
                const secMap = subjMap.get(demand.subjectId);
                const left = secMap?.get(demand.sectionId) || 0;
                if (left <= 0) {
                  pushReason(`المعلم ${tid} استوفى حصصه للشعبة`);
                  continue;
                }
                const t = teacherMap.get(tid);
                if (!t) {
                  pushReason(`المعلم ${tid} محذوف من القائمة`);
                  continue;
                }
                if ((t.offDays || []).includes(day)) {
                  pushReason(`المعلم ${t.name} في إجازة يوم ${day}`);
                  continue;
                }
                if ((t.forbiddenSlots || []).includes(slot)) {
                  pushReason(`المعلم ${t.name} يمنع حصة ${slot+1}`);
                  continue;
                }
                if (Array.isArray(t.forbiddenDaySlots) && t.forbiddenDaySlots.length) {
                  const rule = t.forbiddenDaySlots.find(r => r.day === day);
                  if (rule && Array.isArray(rule.slots) && rule.slots.includes(slot)) {
                    pushReason(`المعلم ${t.name} يمنع الفترة ${day} الحصة ${slot+1}`);
                    continue;
                  }
                }
                const tBusyDay = teacherBusy.get(tid)?.get(day);
                if (tBusyDay && tBusyDay.has(slot)) {
                  pushReason(`المعلم ${t.name} لديه حصة أخرى ${day} الحصة ${slot+1}`);
                  continue;
                }
                // إذا وصلنا هنا فهذا المكان متاح فعليًا
                pushReason(`متاح لكن لم يُختَر - ${day} الحصة ${slot+1} مع ${t.name}`);
              }
              if (!anyTeacherEvaluated) {
                pushReason('لا يوجد معلمون متبقون لهذه المادة');
              }
            }
          }
          console.log(`فشل في وضع حصة لشعبة ${demand.sectionId} مادة ${demand.subjectId}`);
          console.log('أسباب الرفض:', Array.from(reasonCounts.entries()));
          break;
        }
      }
    }
    const stillLeft = leftovers.filter(d => d.remaining > 0);
    if (stillLeft.length > 0) {
      console.log('=== الطلبات التي لم تُوضع نهائيًا ===');
      stillLeft.forEach(d => console.log(`شعبة ${d.sectionId} مادة ${d.subjectId}: ${d.remaining} حصة`));
    } else {
      console.log('تم وضع جميع الطلبات المتبقية بنجاح');
    }
  }

  setTimetable(assignments);
  return assignments;
}

// Helper: Render floating unassigned lessons box
function renderFloatingUnassignedBox() {
  const st = loadState();
  const assignments = getTimetable() || [];
  const teachers = st.teachers || [];
  const subjects = new Map((st.subjects||[]).map(s => [s.id, s]));
  const classSectionMap = new Map();
  
  // Build section map
  (st.classes || []).forEach(cls => {
    if (cls.sections && cls.sections.length) {
      cls.sections.forEach(sec => classSectionMap.set(sec.id, { classId: cls.id, className: cls.name, ...sec }));
    } else {
      classSectionMap.set(cls.id, { classId: cls.id, className: cls.name, id: cls.id, name: cls.name });
    }
  });
  
  // Count assigned lessons per teacher/subject/section
  const assignedCount = new Map();
  assignments.forEach(a => {
    const key = `${a.teacherId}|${a.subjectId}|${a.sectionId}`;
    assignedCount.set(key, (assignedCount.get(key) || 0) + 1);
  });
  
  // Calculate unassigned from teachers' allocations
  const unassignedByTeacher = new Map(); // teacherId -> array of lessons
  let totalUnassigned = 0;
  
  teachers.forEach(teacher => {
    const teacherLessons = [];
    (teacher.subjects || []).forEach(ts => {
      (ts.sections || []).forEach(sectionId => {
        const key = `${teacher.id}|${ts.subjectId}|${sectionId}`;
        const planned = ts.periodsPerWeek || 0;
        const assigned = assignedCount.get(key) || 0;
        const remaining = planned - assigned;
        
        if (remaining > 0) {
          const subject = subjects.get(ts.subjectId);
          const section = classSectionMap.get(sectionId);
          if (subject && section) {
            for (let i = 0; i < remaining; i++) {
              teacherLessons.push({
                teacherId: teacher.id,
                teacherName: teacher.name,
                subjectId: ts.subjectId,
                subjectName: subject.name,
                sectionId: sectionId,
                sectionName: section.name
              });
              totalUnassigned++;
            }
          }
        }
      });
    });
    
    if (teacherLessons.length > 0) {
      unassignedByTeacher.set(teacher.id, { name: teacher.name, lessons: teacherLessons });
    }
  });
  
  // Remove old floating box if exists
  const oldBox = document.getElementById('floatingUnassignedBox');
  if (oldBox) oldBox.remove();
  
  // Don't create box if no unassigned lessons
  if (totalUnassigned === 0) return;
  
  // Create floating box
  const floatingBox = document.createElement('div');
  floatingBox.id = 'floatingUnassignedBox';
  floatingBox.className = 'floating-unassigned-box';
  
  let html = `
    <div class="floating-box-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <span class="floating-box-title">📚 حصص غير موزعة (${totalUnassigned})</span>
      <span class="floating-box-toggle">▼</span>
    </div>
    <div class="floating-box-content">`;
  
  unassignedByTeacher.forEach((data, teacherId) => {
    html += `
      <div class="teacher-group">
        <div class="teacher-name">👨‍🏫 ${data.name} <span class="badge">${data.lessons.length}</span></div>
        <div class="lessons-grid">`;
    
    data.lessons.forEach(lesson => {
      html += `
        <div class="unassigned-lesson-card" draggable="true"
          data-teacher-id="${lesson.teacherId}"
          data-subject-id="${lesson.subjectId}"
          data-section-id="${lesson.sectionId}"
          data-source="unassigned"
          title="${lesson.teacherName} - ${lesson.subjectName} - ${lesson.sectionName}">
          <div class="card-subject">${lesson.subjectName}</div>
          <div class="card-section">${lesson.sectionName}</div>
        </div>`;
    });
    
    html += `
        </div>
      </div>`;
  });
  
  html += `
    </div>
    <div class="floating-box-footer">
      <small>💡 اسحب الحصص إلى الجدول أو اسحب من الجدول هنا للحذف</small>
    </div>`;
  
  floatingBox.innerHTML = html;
  document.body.appendChild(floatingBox);
  
  // Add drag handlers to all cards
  floatingBox.querySelectorAll('.unassigned-lesson-card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });
}

// Drag-and-drop event handlers
let draggedElement = null;
let draggedData = null;

// Copy-Paste functionality
let copiedLessonData = null;
let copiedIndicatorTimeout = null;

// Smart font sizing for combined view cells
function getSmartFontSize(text) {
  const length = text.length;
  if (length <= 12) return '14px';      // نص قصير: خط كبير
  if (length <= 20) return '12px';      // نص متوسط: خط متوسط
  if (length <= 30) return '10px';      // نص طويل: خط صغير
  return '9px';                         // نص طويل جداً: خط صغير جداً
}

function handleDragStart(e) {
  draggedElement = e.target;
  draggedElement.classList.add('dragging');
  
  draggedData = {
    teacherId: e.target.dataset.teacherId,
    subjectId: e.target.dataset.subjectId,
    sectionId: e.target.dataset.sectionId,
    source: e.target.dataset.source,
    day: e.target.dataset.day,
    slot: parseInt(e.target.dataset.slot)
  };
  
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.target.innerHTML);
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  // Remove all drop-over visual feedback
  document.querySelectorAll('.drag-over-empty, .drag-over-replace').forEach(el => {
    el.classList.remove('drag-over-empty', 'drag-over-replace');
  });
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  
  const cell = e.currentTarget;
  const hasContent = cell.querySelector('.lesson-cell-content');
  
  // Visual feedback
  if (hasContent) {
    cell.classList.add('drag-over-replace');
    cell.classList.remove('drag-over-empty');
  } else {
    cell.classList.add('drag-over-empty');
    cell.classList.remove('drag-over-replace');
  }
  
  return false;
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-empty', 'drag-over-replace');
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  e.preventDefault();
  
  const cell = e.currentTarget;
  cell.classList.remove('drag-over-empty', 'drag-over-replace');
  
  if (!draggedData) return false;
  
  const targetDay = cell.dataset.day;
  const targetSlot = parseInt(cell.dataset.slot);
  const targetSectionId = cell.dataset.sectionId;
  
  // Get current assignments
  const st = loadState();
  let assignments = getTimetable() || [];
  
  // Check if dropping on the same cell (no-op)
  if (draggedData.source === 'table' && 
      draggedData.day === targetDay && 
      parseInt(draggedData.slot) === targetSlot &&
      draggedData.sectionId === targetSectionId) {
    return false;
  }
  
  // Check if target cell has existing assignment
  const existingIndex = assignments.findIndex(a => 
    a.day === targetDay && parseInt(a.slot) === targetSlot && a.sectionId === targetSectionId
  );
  
  // Scenario 1: From unassigned card to empty cell
  if (draggedData.source === 'unassigned' && existingIndex === -1) {
    assignments.push({
      teacherId: draggedData.teacherId,
      subjectId: draggedData.subjectId,
      sectionId: targetSectionId,
      day: targetDay,
      slot: targetSlot
    });
    draggedElement.remove();
  }
  // Scenario 2: From unassigned card to occupied cell (swap)
  else if (draggedData.source === 'unassigned' && existingIndex !== -1) {
    const oldAssignment = assignments[existingIndex];
    assignments[existingIndex] = {
      teacherId: draggedData.teacherId,
      subjectId: draggedData.subjectId,
      sectionId: targetSectionId,
      day: targetDay,
      slot: targetSlot
    };
    draggedElement.remove();
    // Note: الحصة القديمة ستظهر تلقائياً في الإحصائيات عند إعادة العرض
  }
  // Scenario 3: From table cell to another cell (move or swap)
  else if (draggedData.source === 'table') {
    const sourceIndex = assignments.findIndex(a =>
      a.day === draggedData.day && parseInt(a.slot) === parseInt(draggedData.slot) && a.sectionId === draggedData.sectionId
    );
    
    if (sourceIndex !== -1) {
      if (existingIndex === -1) {
        // Move to empty cell
        assignments[sourceIndex].day = targetDay;
        assignments[sourceIndex].slot = targetSlot;
        assignments[sourceIndex].sectionId = targetSectionId;
      } else {
        // Swap with existing cell
        const temp = { ...assignments[existingIndex] };
        assignments[existingIndex] = {
          ...assignments[sourceIndex],
          day: targetDay,
          slot: targetSlot,
          sectionId: targetSectionId
        };
        assignments[sourceIndex] = {
          ...temp,
          day: draggedData.day,
          slot: draggedData.slot,
          sectionId: draggedData.sectionId
        };
      }
    }
  }
  
  // Save and re-render
  setTimetable(assignments);
  renderTimetableByClass(assignments);
  renderStats();
  renderFloatingUnassignedBox(); // تحديث الصندوق العائم
  
  return false;
}

// Copy-Paste functionality
function copyLesson(assignment, element) {
  copiedLessonData = {
    teacherId: assignment.teacherId,
    subjectId: assignment.subjectId,
    sectionId: assignment.sectionId
  };
  
  // Visual feedback
  showCopyFeedback(element);
  highlightEmptyCells();
  
  console.log('تم نسخ الدرس:', copiedLessonData);
}

function pasteLesson(targetCell, lessonData) {
  if (!lessonData) return;
  
  const targetDay = targetCell.dataset.day;
  const targetSlot = parseInt(targetCell.dataset.slot);
  const targetSectionId = targetCell.dataset.sectionId;
  
  // Get current assignments
  const st = loadState();
  let assignments = getTimetable() || [];
  
  // Check if target cell is empty
  const existingIndex = assignments.findIndex(a => 
    a.day === targetDay && parseInt(a.slot) === targetSlot && a.sectionId === targetSectionId
  );
  
  if (existingIndex !== -1) {
    alert('لا يمكن اللصق! الخلية مشغولة بالفعل.');
    return;
  }
  
  // Add new assignment (نسخة جديدة من الدرس)
  assignments.push({
    teacherId: lessonData.teacherId,
    subjectId: lessonData.subjectId,
    sectionId: targetSectionId,
    day: targetDay,
    slot: targetSlot
  });
  
  // Save and re-render
  setTimetable(assignments);
  renderTimetableByClass(assignments);
  renderStats(); // تحديث الإحصائيات (سيزيد العدد الفعلي)
  renderFloatingUnassignedBox();
  
  // Clear copied data and highlights
  copiedLessonData = null;
  removeEmptyCellsHighlight();
  
  // Show success message
  showPasteFeedback(targetCell);
  
  console.log('تم لصق الدرس في:', targetDay, 'الحصة:', targetSlot + 1);
}

function showCopyFeedback(element) {
  // Add visual indicator
  element.classList.add('copied-lesson');
  
  // Clear previous timeout
  if (copiedIndicatorTimeout) {
    clearTimeout(copiedIndicatorTimeout);
  }
  
  // Remove after 3 seconds
  copiedIndicatorTimeout = setTimeout(() => {
    document.querySelectorAll('.copied-lesson').forEach(el => {
      el.classList.remove('copied-lesson');
    });
  }, 3000);
  
  // Show notification
  showNotification('✅ تم نسخ الدرس! انقر على خلية فارغة للصقه', 'success');
}

function showPasteFeedback(cell) {
  cell.classList.add('paste-animation');
  setTimeout(() => {
    cell.classList.remove('paste-animation');
  }, 600);
  
  showNotification('✅ تم لصق الدرس بنجاح!', 'success');
}

function highlightEmptyCells() {
  document.querySelectorAll('.empty-cell').forEach(cell => {
    cell.classList.add('paste-target');
  });
}

function removeEmptyCellsHighlight() {
  document.querySelectorAll('.paste-target').forEach(cell => {
    cell.classList.remove('paste-target');
  });
}

function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `copy-paste-notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => notification.classList.add('show'), 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Helper: Calculate unassigned lessons from teacher remaining allocations
function calculateUnassignedLessons(state, assignments) {
  const unassigned = [];
  const teachers = state.teachers || [];
  const subjects = new Map((state.subjects || []).map(s => [s.id, s]));
  const classSectionMap = new Map();
  
  // Build section map
  (state.classes || []).forEach(cls => {
    if (cls.sections && cls.sections.length) {
      cls.sections.forEach(sec => classSectionMap.set(sec.id, { classId: cls.id, className: cls.name, ...sec }));
    } else {
      classSectionMap.set(cls.id, { classId: cls.id, className: cls.name, id: cls.id, name: cls.name });
    }
  });
  
  // Count assigned lessons per teacher/subject/section
  const assignedCount = new Map();
  assignments.forEach(a => {
    const key = `${a.teacherId}|${a.subjectId}|${a.sectionId}`;
    assignedCount.set(key, (assignedCount.get(key) || 0) + 1);
  });
  
  // Calculate unassigned from teachers' allocations
  teachers.forEach(teacher => {
    (teacher.subjects || []).forEach(ts => {
      (ts.sections || []).forEach(sectionId => {
        const key = `${teacher.id}|${ts.subjectId}|${sectionId}`;
        const planned = ts.periodsPerWeek || 0;
        const assigned = assignedCount.get(key) || 0;
        const remaining = planned - assigned;
        
        if (remaining > 0) {
          const subject = subjects.get(ts.subjectId);
          const section = classSectionMap.get(sectionId);
          if (subject && section) {
            unassigned.push({
              teacherId: teacher.id,
              teacherName: teacher.name,
              subjectId: ts.subjectId,
              subjectName: subject.name,
              sectionId: sectionId,
              sectionName: section.name,
              count: remaining
            });
          }
        }
      });
    });
  });
  
  return unassigned;
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
        cell.dataset.day = day;
        cell.dataset.slot = slot;
        cell.dataset.sectionId = sec.id;
        
        // Add drop handlers to all cells
        cell.addEventListener('dragover', handleDragOver);
        cell.addEventListener('dragleave', handleDragLeave);
        cell.addEventListener('drop', handleDrop);
        
        const a = assignments.find(x => x.sectionId === sec.id && x.day === day && x.slot === slot);
        if (a) {
          // Wrap content in draggable div
          const wrapper = document.createElement('div');
          wrapper.className = 'lesson-cell-content';
          wrapper.draggable = true;
          wrapper.dataset.teacherId = a.teacherId;
          wrapper.dataset.subjectId = a.subjectId;
          wrapper.dataset.sectionId = a.sectionId;
          wrapper.dataset.day = day;
          wrapper.dataset.slot = slot;
          wrapper.dataset.source = 'table';
          
          // Add copy button
          const copyBtn = document.createElement('button');
          copyBtn.className = 'copy-lesson-btn';
          copyBtn.innerHTML = '📋';
          copyBtn.title = 'نسخ الدرس';
          copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyLesson(a, wrapper);
          };
          
          wrapper.innerHTML = `<div>${subjects.get(a.subjectId)||''}</div><div class="hint">${teachers.get(a.teacherId)||''}</div>`;
          wrapper.appendChild(copyBtn);
          
          wrapper.addEventListener('dragstart', handleDragStart);
          wrapper.addEventListener('dragend', handleDragEnd);
          
          cell.appendChild(wrapper);
        } else {
          // Empty cell - add paste functionality
          cell.innerHTML = '<span class="empty-cell-indicator">—</span>';
          cell.classList.add('empty-cell');
          
          // Add click handler for paste
          cell.addEventListener('click', (e) => {
            if (copiedLessonData && !cell.querySelector('.lesson-cell-content')) {
              pasteLesson(cell, copiedLessonData);
            }
          });
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
            // دمج المادة والمدرس في سطر واحد لتوفير المساحة
            const subjectName = subjects.get(a.subjectId) || '';
            const teacherName = teachers.get(a.teacherId) || '';
            const combinedText = `${subjectName} / ${teacherName}`;
            
            // تطبيق حجم خط ذكي بناءً على طول النص
            const fontSize = getSmartFontSize(combinedText);
            
            td.innerHTML = `<div class="combined-cell" style="font-size: ${fontSize};">${combinedText}</div>`;
            td.classList.add('compact-cell');
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
  
  // Global drop handler: if dragging from table and dropping outside, return to unassigned
  document.body.addEventListener('dragover', (e) => {
    // Allow dropping on body
    const target = e.target;
    if (!target.closest('td[data-day]')) {
      e.preventDefault();
    }
  });
  
  document.body.addEventListener('drop', (e) => {
    const target = e.target;
    // If dropping outside table cells and source is table
    if (!target.closest('td[data-day]') && draggedData && draggedData.source === 'table') {
      e.preventDefault();
      e.stopPropagation();
      
      const st = loadState();
      let assignments = getTimetable() || [];
      
      // Remove assignment from table
      const sourceIndex = assignments.findIndex(a =>
        a.day === draggedData.day && 
        a.slot === draggedData.slot && 
        a.sectionId === draggedData.sectionId
      );
      
      if (sourceIndex !== -1) {
        const removedAssignment = assignments[sourceIndex];
        assignments.splice(sourceIndex, 1);
        
        // Save and re-render
        setTimetable(assignments);
        renderTimetableByClass(assignments);
        renderStats();
        renderFloatingUnassignedBox(); // تحديث الصندوق العائم
      }
    }
  });
  
  genBtn?.addEventListener('click', () => {
    const assignments = generateTimetable();
    if (assignments.length) {
      renderTimetableByClass(assignments);
      renderStats(); // إضافة الإحصائيات
      renderFloatingUnassignedBox(); // عرض الصندوق العائم
      // حفظ نسخة من الجدول المولّد
      saveCurrentTimetableVersion();
    } else {
      container.innerHTML = '';
      // Remove floating box if no assignments
      const floatingBox = document.getElementById('floatingUnassignedBox');
      if (floatingBox) floatingBox.remove();
    }
  });
  document.querySelectorAll('.view-toggle .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const assignments = getTimetable();
      const view = btn.getAttribute('data-view');
      if (view === 'by-class') { 
        renderTimetableByClass(assignments); 
        CURRENT_VIEW = 'by-class';
        renderFloatingUnassignedBox(); // عرض الصندوق العائم في وضع الصف
      }
      else if (view === 'by-teacher') { 
        renderTimetableByTeacher(assignments); 
        CURRENT_VIEW = 'by-teacher';
        renderFloatingUnassignedBox(); // عرض الصندوق العائم في وضع المعلم
      }
      else if (view === 'combined-class') { 
        renderCombinedByClass(assignments); 
        CURRENT_VIEW = 'combined-class';
        renderFloatingUnassignedBox(); // عرض الصندوق العائم في الوضع المجمع
      }
    });
  });

  // Version History Button
  document.getElementById('versionHistoryBtn')?.addEventListener('click', () => {
    openVersionHistoryModal();
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

// --- Print scaling helpers for combined view (optimized for A3) ---
let COMBINED_SCALE_APPLIED = false;
function tryFitCombinedTableToA4() {
  const wrap = document.querySelector('#timetableContainer .table-scroll');
  const table = wrap?.querySelector('table.timetable');
  if (!wrap || !table) return;
  
  // Make sure scroll holder doesn't constrain width at print
  wrap.style.overflow = 'visible';
  
  // A3 landscape printable width approximation (at 96dpi ~ 1587px minus margins)
  // A3 = 297mm × 420mm، في landscape mode العرض = 420mm ≈ 1587px
  const availableWidth = 1550; // A3 landscape width minus margins (~37px margins)
  const tableWidth = table.getBoundingClientRect().width;
  
  if (tableWidth > 0 && tableWidth > availableWidth) {
    // Scale down only if necessary, with minimum scale of 0.7 for readability
    const scale = Math.max(0.7, availableWidth / tableWidth);
    table.style.transformOrigin = 'right top';
    table.style.transform = `scale(${scale})`;
    COMBINED_SCALE_APPLIED = true;
    console.log(`📏 تم تصغير الجدول إلى ${(scale * 100).toFixed(1)}% لملائمة A3`);
  } else {
    COMBINED_SCALE_APPLIED = false;
    console.log('✅ الجدول يناسب A3 بدون تصغير');
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

// Export stats to Excel/Word
function exportStatsToExcel() {
  const statsContainer = document.getElementById('statsContainer');
  if (!statsContainer || !statsContainer.innerHTML.trim()) {
    alert('يرجى توليد الإحصائيات أولاً');
    return;
  }
  
  const st = loadState();
  const schoolName = st.school?.name || 'المدرسة';
  const timestamp = new Date().toLocaleDateString('ar-SA');
  
  // Create HTML for Excel
  let html = `
    <html xmlns:x="urn:schemas-microsoft-com:office:excel" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Arial', 'Tahoma', sans-serif; direction: rtl; }
        h2, h3 { text-align: center; color: #2b6cb0; }
        .teacher-stat { border: 2px solid #e5e7eb; padding: 15px; margin: 20px 0; border-radius: 8px; page-break-inside: avoid; }
        .teacher-stat h4 { color: #1a202c; margin-top: 0; background: #eef2ff; padding: 10px; border-radius: 4px; }
        table { border-collapse: collapse; width: 100%; margin: 10px 0; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: center; }
        th { background-color: #f3f4f6; font-weight: bold; }
        ul { margin: 10px 0; padding-right: 20px; }
        li { margin: 5px 0; }
        .hint { color: #6b7280; font-size: 0.9em; }
        strong { color: #2b6cb0; }
        .unassigned-boxes { display: none; } /* Hide drag boxes in export */
      </style>
    </head>
    <body>
      <h2>${schoolName}</h2>
      <h3>إحصائيات توزيع الحصص</h3>
      <p style="text-align: center; color: #6b7280;">التاريخ: ${timestamp}</p>
      <hr>
  `;
  
  // Clone stats content and remove interactive elements
  const clone = statsContainer.cloneNode(true);
  // Remove drag boxes and buttons
  clone.querySelectorAll('.unassigned-boxes, .unassigned-lesson-box, button, .floating-unassigned-box').forEach(el => el.remove());
  
  html += clone.innerHTML;
  html += `
      <hr>
      <p style="text-align: center; color: #6b7280; font-size: 0.9em;">
        تم إنشاء هذا التقرير بواسطة نظام إدارة الجداول المدرسية
      </p>
    </body>
    </html>
  `;
  
  // Create blob and download
  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `إحصائيات_${schoolName}_${new Date().toISOString().split('T')[0]}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportStatsToWord() {
  const statsContainer = document.getElementById('statsContainer');
  if (!statsContainer || !statsContainer.innerHTML.trim()) {
    alert('يرجى توليد الإحصائيات أولاً');
    return;
  }
  
  const st = loadState();
  const schoolName = st.school?.name || 'المدرسة';
  const timestamp = new Date().toLocaleDateString('ar-SA');
  
  // Create HTML for Word
  let html = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40' dir='rtl'>
    <head>
      <meta charset='UTF-8'>
      <style>
        @page { size: A4; margin: 2cm; }
        body { font-family: 'Arial', 'Tahoma', sans-serif; direction: rtl; font-size: 11pt; }
        h2, h3 { text-align: center; color: #2b6cb0; }
        h2 { font-size: 18pt; margin-bottom: 10pt; }
        h3 { font-size: 14pt; margin-bottom: 15pt; }
        .teacher-stat { border: 2px solid #e5e7eb; padding: 15px; margin: 20px 0; border-radius: 8px; page-break-inside: avoid; }
        .teacher-stat h4 { color: #1a202c; margin-top: 0; background: #eef2ff; padding: 10px; border-radius: 4px; font-size: 12pt; }
        table { border-collapse: collapse; width: 100%; margin: 10px 0; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: center; font-size: 10pt; }
        th { background-color: #f3f4f6; font-weight: bold; }
        ul { margin: 10px 0; padding-right: 20px; }
        li { margin: 5px 0; font-size: 10pt; }
        .hint { color: #6b7280; font-size: 9pt; }
        strong { color: #2b6cb0; }
        p { font-size: 10pt; }
        .unassigned-boxes { display: none; } /* Hide drag boxes in export */
      </style>
    </head>
    <body>
      <h2>${schoolName}</h2>
      <h3>إحصائيات توزيع الحصص الدراسية</h3>
      <p style="text-align: center; color: #6b7280;">التاريخ: ${timestamp}</p>
      <hr>
  `;
  
  // Clone stats content and remove interactive elements
  const clone = statsContainer.cloneNode(true);
  // Remove drag boxes and buttons
  clone.querySelectorAll('.unassigned-boxes, .unassigned-lesson-box, button, .floating-unassigned-box').forEach(el => el.remove());
  
  html += clone.innerHTML;
  html += `
      <hr>
      <p style="text-align: center; color: #6b7280; font-size: 9pt; margin-top: 30pt;">
        تم إنشاء هذا التقرير بواسطة نظام إدارة الجداول المدرسية - ${timestamp}
      </p>
    </body>
    </html>
  `;
  
  // Create blob and download
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `إحصائيات_${schoolName}_${new Date().toISOString().split('T')[0]}.doc`;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------- Stats rendering ----------
function renderStats() {
  const assignments = getTimetable();
  const teachers = getTeachers();
  const st = loadState();
  const workingDays = st.school?.workingDays || [];
  const slotsPerDay = st.school?.slotsPerDay || 6;
  const statsContainer = document.getElementById('statsContainer');
  if (!assignments.length) {
    statsContainer.innerHTML = '<p>يرجى توليد الجدول أولاً لعرض الإحصائيات.</p>';
    return;
  }
  // خرائط أسماء مساعدة
  const classSectionName = new Map();
  const sectionToClass = new Map();
  (st.classes||[]).forEach(c => {
    if (c.sections && c.sections.length) c.sections.forEach(sec => classSectionName.set(sec.id, `${c.name} - ${sec.name}`));
    else classSectionName.set(c.id, c.name);
    if (c.sections && c.sections.length) c.sections.forEach(sec => sectionToClass.set(sec.id, c.id));
    else sectionToClass.set(c.id, c.id);
  });
  const subjectName = new Map((st.subjects||[]).map(s => [s.id, s.name]));
  // حساب فعلي لكل معلم (بعد التوليد)
  const teacherStats = {};
  teachers.forEach(t => {
    teacherStats[t.id] = {
      name: t.name,
      totalPeriods: 0,
      bySlot: Array(slotsPerDay).fill(0),
      byDay: {},
      offDays: t.offDays || [],
      hasLessonsOn: new Set()
    };
    workingDays.forEach(d => teacherStats[t.id].byDay[d] = 0);
  });
  assignments.forEach(a => {
    if (teacherStats[a.teacherId]) {
      teacherStats[a.teacherId].totalPeriods++;
      teacherStats[a.teacherId].bySlot[a.slot]++;
      teacherStats[a.teacherId].byDay[a.day]++;
      teacherStats[a.teacherId].hasLessonsOn.add(a.day);
    }
  });

  // حساب مخطط مسبقاً من واجهة المعلمين (قبل التوليد)
  const teacherPlanned = {};
  teachers.forEach(t => {
    const plannedBySectionSubject = {};
    let plannedTotal = 0;
    (t.subjects||[]).forEach(su => {
      Object.entries(su.perSections || {}).forEach(([secId, count]) => {
        if (!plannedBySectionSubject[secId]) plannedBySectionSubject[secId] = {};
        plannedBySectionSubject[secId][su.subjectId] = (plannedBySectionSubject[secId][su.subjectId] || 0) + (count||0);
        plannedTotal += (count||0);
      });
    });
    teacherPlanned[t.id] = { name: t.name, plannedTotal, plannedBySectionSubject };
  });

  // تفصيل فعلي لكل معلم حسب الشعبة/المادة
  const teacherActualDetail = {};
  teachers.forEach(t => { teacherActualDetail[t.id] = {}; });
  assignments.forEach(a => {
    const bySec = teacherActualDetail[a.teacherId];
    if (!bySec) return;
    if (!bySec[a.sectionId]) bySec[a.sectionId] = {};
    bySec[a.sectionId][a.subjectId] = (bySec[a.sectionId][a.subjectId] || 0) + 1;
  });

  // تحضيرات تشخيص الأسباب (خارج بناء HTML)
  // 1) سعة كل شعبة وأشغالها
  const sectionCapacity = new Map(); // sectionId -> total weekly slots
  const sectionBusy = new Map(); // sectionId -> Map(day->Set(slot))
  const allSectionIds = (st.classes||[]).flatMap(c => (c.sections && c.sections.length) ? c.sections.map(sec => sec.id) : [c.id]);
  allSectionIds.forEach(secId => sectionCapacity.set(secId, workingDays.length * slotsPerDay));
  assignments.forEach(a => {
    if (!sectionBusy.has(a.sectionId)) sectionBusy.set(a.sectionId, new Map());
    const dmap = sectionBusy.get(a.sectionId);
    if (!dmap.has(a.day)) dmap.set(a.day, new Set());
    dmap.get(a.day).add(a.slot);
  });
  // 2) إجمالي المخطط لكل شعبة
  const sectionPlannedTotal = new Map();
  (teachers||[]).forEach(t => {
    (t.subjects||[]).forEach(su => {
      Object.entries(su.perSections||{}).forEach(([secId, cnt]) => {
        sectionPlannedTotal.set(secId, (sectionPlannedTotal.get(secId)||0) + (cnt||0));
      });
    });
  });
  const sectionOverbookInfo = new Map();
  sectionPlannedTotal.forEach((planned, secId) => {
    const cap = sectionCapacity.get(secId) || 0;
    if (planned > cap) sectionOverbookInfo.set(secId, { planned, capacity: cap, overBy: planned - cap });
  });
  // 3) انشغال وتوفر المعلمين
  const teacherBusy = new Map(); // teacherId -> Map(day->Set(slot))
  assignments.forEach(a => {
    if (!teacherBusy.has(a.teacherId)) teacherBusy.set(a.teacherId, new Map());
    const dmap = teacherBusy.get(a.teacherId);
    if (!dmap.has(a.day)) dmap.set(a.day, new Set());
    dmap.get(a.day).add(a.slot);
  });
  function isTeacherAvailableStatic(t, day, slot) {
    if ((t.offDays||[]).includes(day)) return false;
    if ((t.forbiddenSlots||[]).map(Number).includes(slot)) return false;
    if (Array.isArray(t.forbiddenDaySlots) && t.forbiddenDaySlots.length) {
      const rule = t.forbiddenDaySlots.find(r => r.day === day);
      if (rule && Array.isArray(rule.slots) && rule.slots.map(Number).includes(slot)) return false;
    }
    return true;
  }
  const teacherStaticCapacity = new Map();
  teachers.forEach(t => {
    let cap = 0;
    for (const d of workingDays) {
      for (let s=0; s<slotsPerDay; s++) {
        if (isTeacherAvailableStatic(t, d, s)) cap++;
      }
    }
    teacherStaticCapacity.set(t.id, cap);
  });
  // 4) بناء أسباب الفروقات
  const mismatchReasons = new Map(); // teacherId -> Array<{secId, subjectId, delta, reasons: string[]}>
  teachers.forEach(t => mismatchReasons.set(t.id, []));
  teachers.forEach(t => {
    const plan = teacherPlanned[t.id];
    const actual = teacherActualDetail[t.id] || {};
    const tCap = teacherStaticCapacity.get(t.id) || 0;
    if ((plan?.plannedTotal||0) > tCap) {
      const diff = (plan.plannedTotal||0) - tCap;
      mismatchReasons.get(t.id).push({ secId: null, subjectId: null, delta: diff, reasons: [
        `إجمالي الحصص المخطط (${plan.plannedTotal}) يتجاوز سعة وقت المعلم (${tCap}). راجع أيام OFF والقيود الزمنية.`
      ]});
    }
    Object.entries(plan?.plannedBySectionSubject || {}).forEach(([secId, subjMap]) => {
      Object.entries(subjMap).forEach(([subId, cntPlanned]) => {
        const cntActual = (actual[secId]?.[subId]) || 0;
        const delta = (cntPlanned||0) - cntActual;
        if (delta <= 0) return;
        const reasons = [];
        const classId = sectionToClass.get(secId);
        if (!Array.isArray(t.classIds) || !t.classIds.includes(classId)) {
          reasons.push('المعلم غير مربوط بهذه الصف/المرحلة في بطاقة المعلم (قائمة الصفوف).');
        }
        if (sectionOverbookInfo.has(secId)) {
          const info = sectionOverbookInfo.get(secId);
          reasons.push(`الشعبة محجوزة بأكثر من سعتها: مخطط ${info.planned} مقابل سعة ${info.capacity} (زيادة ${info.overBy}). سيتم إسقاط حصص زائدة حتمًا.`);
        }
        let overlapPotential = 0;
        let overlapActuallyFree = 0;
        for (const d of workingDays) {
          for (let s=0; s<slotsPerDay; s++) {
            const secFree = !(sectionBusy.get(secId)?.get(d)?.has(s));
            const tAvail = isTeacherAvailableStatic(t, d, s);
            if (secFree && tAvail) {
              overlapPotential++;
              const tBusySet = teacherBusy.get(t.id)?.get(d);
              const tFreeNow = !(tBusySet && tBusySet.has(s));
              if (tFreeNow) overlapActuallyFree++;
            }
          }
        }
        if (overlapPotential === 0) {
          reasons.push('لا توجد أي نوافذ زمنية مشتركة بين المعلم والشعبة (إما الشعبة ممتلئة أو قيود الوقت لدى المعلم تمنع ذلك).');
        } else if (overlapActuallyFree === 0) {
          reasons.push('كل النوافذ المشتركة المتاحة مشغولة فعليًا بسبب حصص أخرى للمعلم في نفس الأوقات.');
        } else if (overlapActuallyFree < delta) {
          reasons.push(`النوافذ المشتركة الخالية (${overlapActuallyFree}) أقل من العجز المطلوب (${delta}).`);
        }
        mismatchReasons.get(t.id).push({ secId, subjectId: subId, delta, reasons });
      });
    });
  });

  // عرض
  let html = '<h3>إحصائيات المعلمين</h3>';
  html += '<p class="hint">مقارنة بين المخطط (ما أُسند للمعلم قبل التوليد) والفعلي (ما خرج بعد التوليد).</p>';
  teachers.forEach(t => {
    const s = teacherStats[t.id];
    const p = teacherPlanned[t.id];
    const detailActual = teacherActualDetail[t.id] || {};
    const plannedTotal = p?.plannedTotal || 0;
    const actualTotal = s.totalPeriods;
    const remaining = plannedTotal - actualTotal;
    
    html += `<div class="teacher-stat" style="border:1px solid #e5e7eb; padding:12px; margin-bottom:12px; border-radius:8px;">
      <h4 style="margin-top:0;">${s.name}</h4>
      <p><strong>إجمالي الحصص (مخطط):</strong> ${plannedTotal}</p>
      <p><strong>إجمالي الحصص (فعلي):</strong> ${actualTotal}</p>`;
    
    // عرض مربعات الحصص غير الموزعة
    // نجمع كل المواد/الشعب للمعلم من المخطط + الحصص الزائدة غير المخططة
    const allCombinations = new Map(); // key: "secId|subId", value: { secId, subId, planned, actual }
    
    // أولاً: نضيف المخططة
    Object.entries(p?.plannedBySectionSubject || {}).forEach(([secId, subjMap]) => {
      Object.entries(subjMap).forEach(([subId, cntPlanned]) => {
        const key = `${secId}|${subId}`;
        allCombinations.set(key, {
          secId,
          subId,
          planned: cntPlanned || 0,
          actual: (detailActual[secId]?.[subId]) || 0
        });
      });
    });
    
    // ثانياً: نضيف أي حصص فعلية غير مخططة (تم إضافتها يدوياً بالسحب)
    Object.entries(detailActual).forEach(([secId, subjMap]) => {
      Object.entries(subjMap).forEach(([subId, cntActual]) => {
        const key = `${secId}|${subId}`;
        if (!allCombinations.has(key)) {
          allCombinations.set(key, {
            secId,
            subId,
            planned: 0,
            actual: cntActual || 0
          });
        }
      });
    });
    
    // نحسب إجمالي المتبقي الفعلي
    let totalRemaining = 0;
    allCombinations.forEach(combo => {
      const delta = combo.planned - combo.actual;
      if (delta > 0) totalRemaining += delta;
    });
    
    if (totalRemaining > 0) {
      html += `<div style="margin: 10px 0;">
        <p style="margin: 5px 0; font-weight: bold; color: #f59e0b;">⚠️ حصص غير موزعة: ${totalRemaining}</p>
        <div class="unassigned-boxes" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">`;
      
      // إنشاء مربع لكل حصة غير موزعة
      allCombinations.forEach(combo => {
        const delta = combo.planned - combo.actual;
        if (delta > 0) {
          const secName = classSectionName.get(combo.secId) || combo.secId;
          const subName = subjectName.get(combo.subId) || combo.subId;
          for (let i = 0; i < delta; i++) {
            html += `<div class="unassigned-lesson-box" draggable="true" 
              data-teacher-id="${t.id}" 
              data-subject-id="${combo.subId}" 
              data-section-id="${combo.secId}"
              data-source="unassigned"
              style="
                background: #fff;
                border: 2px solid #f59e0b;
                border-radius: 6px;
                padding: 8px 12px;
                cursor: grab;
                font-size: 12px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                transition: all 0.2s;
                min-width: 120px;
                text-align: center;"
              onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(245,158,11,0.3)';"
              onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)';">
              <div style="font-weight: bold; color: #1f2937;">${subName}</div>
              <div style="font-size: 10px; color: #6b7280; margin-top: 2px;">${secName}</div>
            </div>`;
          }
        }
      });
      
      html += `</div></div>`;
    }
    
    html += `
      <div style="display:flex; gap:24px; flex-wrap:wrap;">
        <div style="flex:1; min-width:260px;">
          <h5>تفصيل مخطط</h5>
          ${(() => {
            const pb = p?.plannedBySectionSubject || {};
            if (Object.keys(pb).length === 0) return '<p class="hint">لا توجد بيانات مخططة.</p>';
            let out = '<ul>';
            Object.entries(pb).forEach(([secId, subjMap]) => {
              const secName = classSectionName.get(secId) || secId;
              Object.entries(subjMap).forEach(([subId, cnt]) => {
                out += `<li>${secName} — ${subjectName.get(subId) || subId}: ${cnt} حصص</li>`;
              });
            });
            out += '</ul>';
            return out;
          })()}
        </div>
        <div style="flex:1; min-width:260px;">
          <h5>تفصيل فعلي</h5>
          ${(() => {
            const ab = detailActual;
            if (!ab || Object.keys(ab).length === 0) return '<p class="hint">لا توجد حصص مُسنَدة.</p>';
            let out = '<ul>';
            Object.entries(ab).forEach(([secId, subjMap]) => {
              const secName = classSectionName.get(secId) || secId;
              Object.entries(subjMap).forEach(([subId, cnt]) => {
                out += `<li>${secName} — ${subjectName.get(subId) || subId}: ${cnt} حصص</li>`;
              });
            });
            out += '</ul>';
            return out;
          })()}
        </div>
      </div>
      <p><strong>توزيع الحصص حسب الوقت:</strong></p>
      <ul>`;
    s.bySlot.forEach((count, idx) => {
      if (count > 0) html += `<li>درس ${idx+1}: ${count} حصة</li>`;
    });
    html += `</ul>
      <p><strong>الحصص يوميًا:</strong></p>
      <ul>`;
    workingDays.forEach(d => {
      html += `<li>${d}: ${s.byDay[d]} حصة</li>`;
    });
    html += `</ul>
      <p><strong>أيام الـ OFF:</strong> ${s.offDays.length ? s.offDays.join('، ') : 'لا توجد'}</p>
      ${(() => {
        const diffs = (mismatchReasons.get(t.id) || []).filter(it => it.delta > 0);
        if (diffs.length === 0) return '';
        let out = '<div style="margin-top:8px; background:#fafafa; border:1px dashed #ddd; padding:10px; border-radius:6px;">';
        out += '<h5 style="margin:0 0 6px 0;">أسباب الفروقات</h5>';
        const generalNotes = diffs.filter(d => !d.secId && !d.subjectId);
        generalNotes.forEach(d => {
          out += `<p class=\"hint\">${d.reasons[0]}</p>`;
        });
        const specific = diffs.filter(d => d.secId && d.subjectId);
        if (specific.length) {
          out += '<ul style="margin:6px 0 0 18px;">';
          specific.forEach(d => {
            const secName = classSectionName.get(d.secId) || d.secId;
            const subName = subjectName.get(d.subjectId) || d.subjectId;
            out += `<li><strong>${secName} — ${subName}</strong> (عجز ${d.delta})<ul>`;
            d.reasons.forEach(r => out += `<li class=\"hint\">${r}</li>`);
            out += '</ul></li>';
          });
          out += '</ul>';
        }
        out += '</div>';
        return out;
      })()}
      <p><strong>الأيام التي لديه دروس:</strong> ${Array.from(s.hasLessonsOn).join('، ') || 'لا توجد'}</p>
    </div>`;
  });
  
  // إضافة أزرار التصدير في النهاية
  html += `
    <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
      <h4 style="color: #2b6cb0; margin-bottom: 15px;">📊 تصدير الإحصائيات</h4>
      <button id="exportStatsWord" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; margin: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: all 0.3s;">
        📄 تصدير Word
      </button>
      <button id="exportStatsExcel" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 12px 30px; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; margin: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: all 0.3s;">
        📊 تصدير Excel
      </button>
      <p style="color: #6b7280; font-size: 14px; margin-top: 10px;">سيتم تنزيل ملف يحتوي على جميع الإحصائيات</p>
    </div>
  `;
  
  statsContainer.innerHTML = html;
  
  // إضافة event listeners للمربعات القابلة للسحب
  document.querySelectorAll('.unassigned-lesson-box').forEach(box => {
    box.addEventListener('dragstart', handleDragStart);
    box.addEventListener('dragend', handleDragEnd);
  });
  
  // إضافة event listeners لأزرار التصدير
  const exportWordBtn = document.getElementById('exportStatsWord');
  const exportExcelBtn = document.getElementById('exportStatsExcel');
  
  if (exportWordBtn) {
    exportWordBtn.addEventListener('click', exportStatsToWord);
    exportWordBtn.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-2px)';
      this.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)';
    });
    exportWordBtn.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0)';
      this.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    });
  }
  
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener('click', exportStatsToExcel);
    exportExcelBtn.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-2px)';
      this.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)';
    });
    exportExcelBtn.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0)';
      this.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    });
  }

// ==========================================
// Version History Management
// ==========================================

/**
 * حفظ نسخة من الجدول الحالي مع الطابع الزمني
 */
function saveCurrentTimetableVersion() {
  const st = loadState();
  const assignments = getTimetable() || [];
  
  if (!assignments.length) return; // لا حفظ للجدول الفارغ
  
  // إنشاء الطابع الزمني
  const now = new Date();
  const timestamp = now.getTime();
  
  // تنسيق التاريخ والوقت بالعربية
  const formatter = new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  const formattedDate = formatter.format(now);
  
  // إنشاء كائن الإصدار
  const version = {
    id: `v_${timestamp}`,
    timestamp: timestamp,
    dateLabel: formattedDate,
    assignments: JSON.parse(JSON.stringify(assignments)), // نسخة عميقة
    stats: calculateVersionStats(assignments)
  };
  
  // إضافة الإصدار إلى المصفوفة
  if (!st.savedVersions) {
    st.savedVersions = [];
  }
  
  // إضافة الإصدار الجديد في البداية
  st.savedVersions.unshift(version);
  
  // الاحتفاظ بآخر 20 إصدارًا فقط
  if (st.savedVersions.length > 20) {
    st.savedVersions = st.savedVersions.slice(0, 20);
  }
  
  // حفظ الحالة
  saveState({ savedVersions: st.savedVersions });
  
  // تحديث واجهة سجل الإصدارات
  renderVersionHistory();
  
  // إظهار رسالة نجاح
  showVersionNotification('تم حفظ الجدول بنجاح ✓', 'success');
}

/**
 * حساب إحصائيات الإصدار
 */
function calculateVersionStats(assignments) {
  const st = loadState();
  const sections = st.sections || [];
  const teachers = st.teachers || [];
  
  let totalAssigned = assignments.length;
  let unassignedCount = 0;
  
  // حساب الدروس غير المخصصة
  sections.forEach(sec => {
    (sec.subjects || []).forEach(subj => {
      const assigned = assignments.filter(a =>
        a.sectionId === sec.id &&
        a.subjectId === subj.subjectId &&
        a.teacherId === subj.teacherId
      ).length;
      const needed = subj.lessonsPerWeek || 0;
      if (assigned < needed) {
        unassignedCount += (needed - assigned);
      }
    });
  });
  
  return {
    totalAssigned,
    unassignedCount,
    sectionsCount: sections.length,
    teachersCount: teachers.length
  };
}

/**
 * عرض سجل الإصدارات في واجهة المستخدم
 */
function renderVersionHistory() {
  const st = loadState();
  const versions = st.savedVersions || [];
  
  const container = document.getElementById('versionHistoryContainer');
  if (!container) return;
  
  if (!versions.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #9ca3af;">
        <svg width="64" height="64" style="margin-bottom: 15px; opacity: 0.3;" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z"/>
          <path fill-rule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clip-rule="evenodd"/>
        </svg>
        <p style="font-size: 16px;">لا توجد إصدارات محفوظة بعد</p>
        <p style="font-size: 14px; margin-top: 5px;">قم بتوليد جدول لحفظ أول إصدار</p>
      </div>
    `;
    return;
  }
  
  let html = '<div style="max-height: 400px; overflow-y: auto;">';
  
  versions.forEach((ver, index) => {
    const isLatest = index === 0;
    html += `
      <div class="version-item" data-version-id="${ver.id}" style="
        border: 2px solid ${isLatest ? '#10b981' : '#e5e7eb'};
        background: ${isLatest ? '#f0fdf4' : 'white'};
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 12px;
        transition: all 0.2s;
        cursor: pointer;
      ">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
              ${isLatest ? '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">أحدث</span>' : ''}
              <span style="color: #374151; font-weight: bold; font-size: 15px;">📅 ${ver.dateLabel}</span>
            </div>
            <div style="display: flex; gap: 15px; font-size: 13px; color: #6b7280; margin-top: 8px;">
              <span>✓ ${ver.stats.totalAssigned} درس مخصص</span>
              <span>⏳ ${ver.stats.unassignedCount} غير مخصص</span>
              <span>📚 ${ver.stats.sectionsCount} صف</span>
            </div>
          </div>
          <div style="display: flex; gap: 5px;">
            <button class="load-version-btn" data-version-id="${ver.id}" style="
              background: #3b82f6;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 5px;
              cursor: pointer;
              font-size: 13px;
              transition: all 0.2s;
            " title="تحميل هذا الإصدار">
              📂 تحميل
            </button>
            ${!isLatest ? `<button class="delete-version-btn" data-version-id="${ver.id}" style="
              background: #ef4444;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 5px;
              cursor: pointer;
              font-size: 13px;
              transition: all 0.2s;
            " title="حذف هذا الإصدار">
              🗑️
            </button>` : ''}
          </div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
  
  // إضافة event listeners
  container.querySelectorAll('.load-version-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const versionId = btn.getAttribute('data-version-id');
      loadTimetableVersion(versionId);
    });
    
    btn.addEventListener('mouseenter', function() {
      this.style.background = '#2563eb';
      this.style.transform = 'scale(1.05)';
    });
    btn.addEventListener('mouseleave', function() {
      this.style.background = '#3b82f6';
      this.style.transform = 'scale(1)';
    });
  });
  
  container.querySelectorAll('.delete-version-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const versionId = btn.getAttribute('data-version-id');
      deleteTimetableVersion(versionId);
    });
    
    btn.addEventListener('mouseenter', function() {
      this.style.background = '#dc2626';
      this.style.transform = 'scale(1.05)';
    });
    btn.addEventListener('mouseleave', function() {
      this.style.background = '#ef4444';
      this.style.transform = 'scale(1)';
    });
  });
  
  // نقرة على العنصر لتحميل الإصدار
  container.querySelectorAll('.version-item').forEach(item => {
    item.addEventListener('mouseenter', function() {
      this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
      this.style.transform = 'translateY(-2px)';
    });
    item.addEventListener('mouseleave', function() {
      this.style.boxShadow = 'none';
      this.style.transform = 'translateY(0)';
    });
  });
}

/**
 * تحميل إصدار محفوظ
 */
function loadTimetableVersion(versionId) {
  const st = loadState();
  const versions = st.savedVersions || [];
  const version = versions.find(v => v.id === versionId);
  
  if (!version) {
    showVersionNotification('الإصدار غير موجود!', 'error');
    return;
  }
  
  // تحميل التخصيصات من الإصدار
  const assignments = JSON.parse(JSON.stringify(version.assignments)); // نسخة عميقة
  setTimetable(assignments);
  
  // إعادة عرض الجدول
  renderTimetableByClass(assignments);
  renderStats();
  renderFloatingUnassignedBox();
  
  // إظهار رسالة نجاح
  showVersionNotification(`تم تحميل إصدار ${version.dateLabel} ✓`, 'success');
  
  // إغلاق مربع الحوار إذا كان مفتوحًا
  const modal = document.getElementById('versionHistoryModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * حذف إصدار محفوظ
 */
function deleteTimetableVersion(versionId) {
  if (!confirm('هل أنت متأكد من حذف هذا الإصدار؟')) return;
  
  const st = loadState();
  let versions = st.savedVersions || [];
  versions = versions.filter(v => v.id !== versionId);
  
  saveState({ savedVersions: versions });
  renderVersionHistory();
  
  showVersionNotification('تم حذف الإصدار ✓', 'success');
}

/**
 * إظهار إشعار للإصدارات
 */
function showVersionNotification(message, type = 'success') {
  const existing = document.getElementById('versionNotification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.id = 'versionNotification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 25px;
    background: ${type === 'success' ? '#10b981' : '#ef4444'};
    color: white;
    border-radius: 8px;
    font-size: 15px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * فتح مربع حوار سجل الإصدارات
 */
function openVersionHistoryModal() {
  const st = loadState();
  
  // إنشاء مربع الحوار إذا لم يكن موجودًا
  let modal = document.getElementById('versionHistoryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'versionHistoryModal';
    modal.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 9999;
      align-items: center;
      justify-content: center;
    `;
    
    modal.innerHTML = `
      <div style="
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 700px;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      ">
        <div style="
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <h3 style="margin: 0; font-size: 20px;">📚 سجل إصدارات الجداول</h3>
          <button id="closeVersionModal" style="
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            font-size: 24px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          ">×</button>
        </div>
        <div style="padding: 20px;">
          <p style="color: #6b7280; margin-bottom: 20px; font-size: 14px;">
            يتم حفظ كل جدول تقوم بتوليده تلقائيًا. يمكنك تحميل أي إصدار سابق أو حذفه.
          </p>
          <div id="versionHistoryContainer"></div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // إغلاق عند النقر على الخلفية
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
    
    // زر الإغلاق
    document.getElementById('closeVersionModal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  
  // عرض المربع وتحديث المحتوى
  modal.style.display = 'flex';
  renderVersionHistory();
}
}
