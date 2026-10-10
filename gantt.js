'use strict';

/* ===== 定数 ===== */
const STORAGE_KEY  = 'task_management_data';
const GANTT_KEY    = 'gantt_entries';
const LABEL_W      = 268; // 左ラベル幅（px）
const MONTH_H      = 28;
const DAY_H_HEADER = 24;
const GROUP_H      = 32;
const SUBTASK_H    = 36;
const PADDING_DAYS = 7; // 前後余白日数

const ZOOM_LEVELS = [16, 20, 28, 36, 48]; // DAY_W候補
const ZOOM_NAMES  = ['最小', '小', '標準', '大', '最大'];
let zoomIndex     = 2;
function dayW() { return ZOOM_LEVELS[zoomIndex]; }

const SUBTASK_COLORS = [
  '#4f46e5','#0ea5e9','#10b981','#f59e0b',
  '#ef4444','#8b5cf6','#ec4899','#14b8a6',
];

// ステータス別のタスク期間バー色
const STATUS_COLORS = {
  '未実施': '#94a3b8',
  '進行中': '#3b82f6',
  '保留':   '#8b5cf6',
  '完了':   '#22c55e',
};

function tsToDateStr(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ===== データ ===== */
function loadTasks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function loadGanttEntries() {
  try { return JSON.parse(localStorage.getItem(GANTT_KEY)) || []; }
  catch { return []; }
}

function saveTasks(t) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

function saveGanttEntries(entries) {
  localStorage.setItem(GANTT_KEY, JSON.stringify(entries));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ===== グローバル状態 ===== */
let tasks        = loadTasks();
let ganttEntries = loadGanttEntries();
let rangeStart   = null; // Date
let totalDays    = 0;
let modalTaskId  = null;
let modalEntryId = null;
let subtaskRowSeq = 0;

/* ===== ユーティリティ ===== */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function parseDate(str) {
  if (!str) return null;
  const [y,m,d] = str.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setHours(0,0,0,0);
  return dt;
}

function dateToStr(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const d = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function addDays(dt, n) {
  const d = new Date(dt);
  d.setDate(d.getDate() + n);
  return d;
}

function diffDays(a, b) {
  return Math.round((b - a) / 86400000);
}

function today() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
}

function statusClass(status) {
  if (status === '未実施') return 'badge-status-未実施';
  if (status === '進行中') return 'badge-status-進行中';
  if (status === '保留')   return 'badge-status-保留';
  if (status === '完了')   return 'badge-status-完了';
  return '';
}

/* ===== レンジ計算 ===== */
function computeRange() {
  const pairs = [];

  // ガントエントリの全体期間・工程日付
  ganttEntries.forEach(e => {
    const linkedTask  = tasks.find(t => t.id === e.taskId);
    const effectiveEnd = (linkedTask && linkedTask.deadline) ? linkedTask.deadline : e.endDate;
    if (e.startDate && effectiveEnd) {
      pairs.push({ s: parseDate(e.startDate), e: parseDate(effectiveEnd) });
    }
    (e.subTasks || []).forEach(st => {
      if (st.startDate && st.endDate) {
        pairs.push({ s: parseDate(st.startDate), e: parseDate(st.endDate) });
      }
    });
  });

  let minDate, maxDate;
  if (pairs.length === 0) {
    minDate = today();
    maxDate = addDays(minDate, 30);
  } else {
    minDate = pairs.reduce((a,b) => b.s < a ? b.s : a, pairs[0].s);
    maxDate = pairs.reduce((a,b) => b.e > a ? b.e : a, pairs[0].e);
  }

  rangeStart = addDays(minDate, -PADDING_DAYS);
  const rangeEnd = addDays(maxDate, PADDING_DAYS);
  totalDays = diffDays(rangeStart, rangeEnd) + 1;
}

/* ===== フィルタ済みタスク ===== */
function getFilteredTasks() {
  const assigneeFilter = document.getElementById('filterAssigneeGantt').value;
  const statusFilter   = document.getElementById('filterStatusGantt').value;
  const search         = document.getElementById('ganttSearchInput').value.trim().toLowerCase();

  return tasks.filter(t => {
    if (assigneeFilter && t.assignee !== assigneeFilter) return false;
    if (statusFilter   && t.status   !== statusFilter)   return false;
    if (search && !(
      t.title.toLowerCase().includes(search) ||
      (t.assignee||'').toLowerCase().includes(search)
    )) return false;
    return true;
  });
}

/* ===== 担当者フィルタ更新 ===== */
function updateAssigneeFilter() {
  const names = [...new Set(tasks.map(t=>t.assignee).filter(Boolean))].sort();
  const sel = document.getElementById('filterAssigneeGantt');
  const cur = sel.value;
  sel.innerHTML = '<option value="">すべての担当者</option>';
  names.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    if (n === cur) o.selected = true;
    sel.appendChild(o);
  });
}

/* ===== レンダリング ===== */
function render() {
  tasks        = loadTasks();
  ganttEntries = loadGanttEntries();
  updateAssigneeFilter();
  computeRange();
  renderTaskPanel();
  renderGanttChart();
}

/* ===== 左パネル ===== */
function renderTaskPanel() {
  const filtered = getFilteredTasks();
  const list     = document.getElementById('ganttPanelList');
  document.getElementById('taskCountLabel').textContent = `${filtered.length}件`;

  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-light);font-size:13px;">作業がありません</div>';
    return;
  }

  list.innerHTML = filtered.map(task => {
    const entry = ganttEntries.find(e => e.taskId === task.id);
    const subTasks = entry ? (entry.subTasks || []) : [];

    const subRows = subTasks.map(st => `
      <div class="gantt-panel-subtask-row" onclick="openEditEntryModal('${entry.id}')">
        <span class="gantt-subtask-dot" style="background:${escapeHTML(st.color)};"></span>
        <span class="gantt-subtask-name">${escapeHTML(st.name)}</span>
        <span class="gantt-subtask-pct">${st.progress}%</span>
      </div>
    `).join('');

    return `
      <div class="gantt-panel-task">
        <div class="gantt-panel-task-row">
          <span class="badge ${statusClass(task.status)}" style="font-size:10px;padding:2px 6px;">${escapeHTML(task.status)}</span>
          <span class="gantt-panel-task-title" title="${escapeHTML(task.title)}">${escapeHTML(task.title)}</span>
          <button class="gantt-panel-add-btn" onclick="${entry ? `openEditEntryModal('${entry.id}')` : `openAddEntryModal('${task.id}')`}" title="${entry ? '編集' : '工程を追加'}">${entry ? '✎' : '＋'}</button>
        </div>
        ${subRows}
      </div>
    `;
  }).join('');
}

/* ===== ガントチャート本体 ===== */
function renderGanttChart() {
  const filtered  = getFilteredTasks();
  const inner     = document.getElementById('ganttInner');
  const emptyEl   = document.getElementById('ganttEmpty');
  const ganttScroll = document.getElementById('ganttScroll');

  // ガントに追加済みのタスクのみ表示
  const withEntry = filtered.filter(t => ganttEntries.some(e => e.taskId === t.id));

  if (withEntry.length === 0) {
    inner.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }
  inner.style.display = '';
  emptyEl.style.display = 'none';

  const DW = dayW();
  const totalW = LABEL_W + totalDays * DW;
  inner.style.width  = totalW + 'px';
  inner.style.minHeight = '100%';

  let html = '';

  // === 月ヘッダー ===
  html += `<div class="gantt-header-row month-row">`;
  html += `<div class="gantt-label-space" style="width:${LABEL_W}px;height:${MONTH_H}px;"></div>`;
  let cur = new Date(rangeStart);
  while (cur <= addDays(rangeStart, totalDays-1)) {
    const y = cur.getFullYear(), m = cur.getMonth();
    // 月の最初の日から月末まで（rangeと交差する範囲）
    const monthStart = new Date(y, m, 1);
    const monthEnd   = new Date(y, m+1, 0);
    const cellStart  = cur < rangeStart ? rangeStart : cur;
    const cellEnd    = monthEnd > addDays(rangeStart, totalDays-1) ? addDays(rangeStart, totalDays-1) : monthEnd;
    const days       = diffDays(cellStart, cellEnd) + 1;
    const w          = days * DW;
    html += `<div class="gantt-month-cell" style="width:${w}px;">${y}年${m+1}月</div>`;
    cur = new Date(y, m+1, 1);
  }
  html += '</div>';

  // === 日付ヘッダー ===
  html += `<div class="gantt-header-row day-row">`;
  html += `<div class="gantt-label-space" style="width:${LABEL_W}px;height:${DAY_H_HEADER}px;"></div>`;
  const td = today();
  for (let i = 0; i < totalDays; i++) {
    const d   = addDays(rangeStart, i);
    const dow = d.getDay();
    const isToday   = d.getTime() === td.getTime();
    const isWeekend = dow === 0 || dow === 6;
    let cls = 'gantt-day-cell';
    if (isToday)   cls += ' today';
    else if (isWeekend) cls += ' weekend';
    html += `<div class="${cls}" style="width:${DW}px;">${DW >= 20 ? d.getDate() : ''}</div>`;
  }
  html += '</div>';

  // === 今日ライン ===
  const todayOffset = diffDays(rangeStart, td);
  if (todayOffset >= 0 && todayOffset < totalDays) {
    const todayX = LABEL_W + todayOffset * DW + DW / 2;
    html += `<div class="gantt-today-line" style="left:${todayX}px;"></div>`;
  }

  // === グループ（作業） ===
  withEntry.forEach(task => {
    const entry    = ganttEntries.find(e => e.taskId === task.id);
    const subTasks = entry ? (entry.subTasks || []) : [];

    const color = STATUS_COLORS[task.status] || '#94a3b8';
    html += `<div class="gantt-group">`;

    // グループ行（全体期間バー）
    html += `<div class="gantt-group-row">`;
    html += `<div class="gantt-group-label" style="width:${LABEL_W}px;">
      <span class="gantt-group-title" title="${escapeHTML(task.title)}">${escapeHTML(task.title)}</span>
      <span class="badge ${statusClass(task.status)}" style="font-size:9px;padding:1px 5px;margin-left:auto;">${escapeHTML(task.status)}</span>
    </div>`;

    const effectiveEnd = task.deadline || entry.endDate;
    const ged = effectiveEnd ? parseDate(effectiveEnd) : null;
    // 期限の中央X（グループ行・工程行で共有）
    const msX = ged ? diffDays(rangeStart, ged) * DW + DW / 2 : null;
    // 期限後の幅（背景色用）
    const afterX = msX !== null ? msX + DW / 2 : null;
    const afterW = afterX !== null ? Math.max(0, totalDays * DW - afterX) : 0;

    if (entry.startDate && effectiveEnd) {
      const gsd = parseDate(entry.startDate);

      if (subTasks.length > 0) {
        // 細分化あり → ひし形マーカー + 縦線 + 期限後の背景
        const deadlineLabel = effectiveEnd.slice(5).replace('-', '/');
        html += `<div class="gantt-group-bg" style="width:${totalDays * DW}px;">
          ${afterW > 0 ? `<div class="gantt-deadline-bg" style="left:${afterX}px;width:${afterW}px;"></div>` : ''}
          <div class="gantt-deadline-line" style="left:${msX}px;border-color:${color};"></div>
          <div class="gantt-milestone"
            style="left:${msX}px;background:${color};border-color:${color};"
            onmouseenter="showMilestoneTooltip(event,'${escapeHTML(task.title)}','${effectiveEnd}',${task.progress})"
            onmouseleave="hideTooltip()"
            onclick="openEditEntryModal('${entry.id}')">
          </div>
          <span class="gantt-milestone-label" style="left:${msX + 13}px;color:${color};">${deadlineLabel}</span>
        </div>`;
      } else {
        // 細分化なし → バー
        const gbarX  = diffDays(rangeStart, gsd) * DW;
        const gbarW  = Math.max(diffDays(gsd, ged) * DW + DW, 4);
        const gfillW = (task.progress / 100) * gbarW;
        html += `<div class="gantt-group-bg" style="width:${totalDays * DW}px;">
          <div class="gantt-bar gantt-bar-summary"
            style="left:${gbarX}px;width:${gbarW}px;background:${color};"
            onmouseenter="showTooltip(event,'${escapeHTML(task.title)}','${entry.startDate}','${effectiveEnd}',${task.progress})"
            onmouseleave="hideTooltip()"
            onclick="openEditEntryModal('${entry.id}')">
            <div class="gantt-bar-fill" style="width:${gfillW}px;background:${color};"></div>
            ${gbarW >= 50 ? `<span class="gantt-bar-label">${escapeHTML(task.title)} ${task.progress}%</span>` : ''}
          </div>
        </div>`;
      }
    } else {
      html += `<div class="gantt-group-bg" style="width:${totalDays * DW}px;"></div>`;
    }
    html += `</div>`;

    // 工程行（手動追加した工程）
    subTasks.forEach(st => {
      if (!st.startDate || !st.endDate) return;
      const sd   = parseDate(st.startDate);
      const ed   = parseDate(st.endDate);
      const xStart = diffDays(rangeStart, sd);
      const dur    = diffDays(sd, ed) + 1;
      const barX   = xStart * DW;
      const barW   = Math.max(dur * DW, 4);
      const fillW  = (st.progress / 100) * barW;

      html += `<div class="gantt-subtask-row-chart">`;
      html += `<div class="gantt-subtask-label" style="width:${LABEL_W}px;">
        <span class="gantt-subtask-dot" style="background:${escapeHTML(st.color)};"></span>
        <span class="gantt-subtask-label-name">${escapeHTML(st.name)}</span>
      </div>`;
      html += `<div class="gantt-subtask-bg" style="width:${totalDays * DW}px;">`;

      // 期限後の背景色 + 縦線（細分化タスク共通）
      if (msX !== null) {
        if (afterW > 0) html += `<div class="gantt-deadline-bg" style="left:${afterX}px;width:${afterW}px;"></div>`;
        html += `<div class="gantt-deadline-line" style="left:${msX}px;border-color:${color};"></div>`;
      }

      // バー
      html += `<div class="gantt-bar"
        style="left:${barX}px;width:${barW}px;background:${escapeHTML(st.color)};"
        onmouseenter="showTooltip(event,'${escapeHTML(st.name)}','${escapeHTML(st.startDate)}','${escapeHTML(st.endDate)}',${st.progress})"
        onmouseleave="hideTooltip()"
        onclick="openEditEntryModal('${entry.id}')">
        <div class="gantt-bar-fill" style="width:${fillW}px;background:${escapeHTML(st.color)};"></div>
        ${barW >= 40 ? `<span class="gantt-bar-label">${escapeHTML(st.name)} ${st.progress}%</span>` : ''}
      </div>`;

      html += `</div></div>`;
    });

    html += `</div>`;
  });

  inner.innerHTML = html;
}

/* ===== スクロール ===== */
function scrollToToday() {
  const DW = dayW();
  const td = today();
  const offset = diffDays(rangeStart, td);
  if (offset < 0) return;
  const scrollEl = document.getElementById('ganttScroll');
  const x = LABEL_W + offset * DW - scrollEl.clientWidth / 2;
  scrollEl.scrollLeft = Math.max(0, x);
}

/* ===== ツールチップ ===== */
function showTooltip(e, name, startDate, endDate, progress) {
  const tip = document.getElementById('ganttTooltip');
  const start = parseDate(startDate);
  const end   = parseDate(endDate);
  const dur   = diffDays(start, end) + 1;
  tip.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">${escapeHTML(name)}</div>
    <div>開始: ${escapeHTML(startDate)}</div>
    <div>終了: ${escapeHTML(endDate)}</div>
    <div>期間: ${dur}日</div>
    <div>進捗: ${progress}%</div>
  `;
  tip.classList.add('visible');
  positionTooltip(e);
}

function hideTooltip() {
  document.getElementById('ganttTooltip').classList.remove('visible');
}

function showMilestoneTooltip(e, title, deadline, progress) {
  const tip = document.getElementById('ganttTooltip');
  tip.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">◆ 期限</div>
    <div style="margin-bottom:4px;">${escapeHTML(title)}</div>
    <div>期限: ${escapeHTML(deadline)}</div>
    <div>進捗: ${progress}%</div>
  `;
  tip.classList.add('visible');
  positionTooltip(e);
}

function positionTooltip(e) {
  const tip = document.getElementById('ganttTooltip');
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + 250 > vw) x = e.clientX - 260;
  if (y + 140 > vh) y = e.clientY - 150;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

document.addEventListener('mousemove', e => {
  const tip = document.getElementById('ganttTooltip');
  if (tip.classList.contains('visible')) positionTooltip(e);
});

/* ===== モーダル ===== */
function openAddEntryModal(taskId) {
  modalTaskId  = taskId;
  modalEntryId = null;
  subtaskRowSeq = 0;

  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('entryModalTitle').textContent = 'ガントチャートに追加';
  document.getElementById('entryStartDate').value = '';
  document.getElementById('entryEndDate').value   = task.deadline || '';
  document.getElementById('entryNote').value = '';
  document.getElementById('subtaskRows').innerHTML = '';
  document.getElementById('entryDeleteBtn').style.display = 'none';
  renderEntryTaskInfo(task);
  document.getElementById('entryFormOverlay').classList.add('open');
}

function openEditEntryModal(entryId) {
  const entry = ganttEntries.find(e => e.id === entryId);
  if (!entry) return;

  const task = tasks.find(t => t.id === entry.taskId);
  if (!task) return;

  modalTaskId  = entry.taskId;
  modalEntryId = entryId;
  subtaskRowSeq = 0;

  document.getElementById('entryModalTitle').textContent = 'ガントチャートを編集';
  document.getElementById('entryStartDate').value = entry.startDate || '';
  document.getElementById('entryEndDate').value   = task.deadline || entry.endDate || '';
  document.getElementById('entryNote').value = entry.note || '';
  document.getElementById('subtaskRows').innerHTML = '';
  document.getElementById('entryDeleteBtn').style.display = '';
  renderEntryTaskInfo(task);

  (entry.subTasks || []).forEach(st => {
    addSubTaskRow(st.name, st.startDate, st.endDate, st.progress, st.color, st.id);
  });

  document.getElementById('entryFormOverlay').classList.add('open');
}

function renderEntryTaskInfo(task) {
  const priorityEmoji = task.priority === '高' ? '🔴' : task.priority === '中' ? '🟡' : '🟢';
  document.getElementById('entryTaskInfo').innerHTML = `
    <div class="entry-task-info-title">${escapeHTML(task.title)}</div>
    <div class="entry-task-info-meta">
      <span class="badge ${statusClass(task.status)}">${escapeHTML(task.status)}</span>
      <span>${priorityEmoji} ${escapeHTML(task.priority)}</span>
      <span>👤 ${escapeHTML(task.assignee || '未設定')}</span>
    </div>
  `;
}

function closeEntryModal() {
  document.getElementById('entryFormOverlay').classList.remove('open');
  modalTaskId  = null;
  modalEntryId = null;
}

/* ===== 工程行 ===== */
function addSubTaskRow(name = '', startDate = '', endDate = '', progress = 0, color = null, id = null) {
  const rowId  = 'strow_' + (++subtaskRowSeq);
  const stId   = id || generateId();
  const colorIndex = document.querySelectorAll('.subtask-row').length % SUBTASK_COLORS.length;
  const rowColor = color || SUBTASK_COLORS[colorIndex];

  const td = today();
  const defaultStart = startDate || dateToStr(td);
  const defaultEnd   = endDate   || dateToStr(addDays(td, 6));

  const row = document.createElement('div');
  row.className = 'subtask-row';
  row.id = rowId;
  row.dataset.stid = stId;
  row.innerHTML = `
    <div class="subtask-row-line1">
      <input type="text" class="form-input st-name" placeholder="工程名" value="${escapeHTML(name)}">
      <button type="button" class="subtask-color-btn" style="background:${rowColor};" data-color="${rowColor}" onclick="cycleColor(this)" title="色を変更"></button>
      <button type="button" class="subtask-remove-btn" onclick="removeSubTaskRow('${rowId}')" title="削除">✕</button>
    </div>
    <div class="subtask-row-line2">
      <div class="subtask-field">
        <span class="subtask-field-label">開始日</span>
        <input type="date" class="form-input st-start" value="${escapeHTML(defaultStart)}">
      </div>
      <div class="subtask-field">
        <span class="subtask-field-label">終了日</span>
        <input type="date" class="form-input st-end" value="${escapeHTML(defaultEnd)}">
      </div>
      <div class="subtask-field">
        <span class="subtask-field-label">進捗 &nbsp;<span class="subtask-pct-label">${progress}%</span></span>
        <input type="range" class="subtask-progress-wrap" min="0" max="100" step="5" value="${progress}"
          oninput="this.closest('.subtask-row').querySelector('.subtask-pct-label').textContent=this.value+'%'">
      </div>
    </div>
  `;
  document.getElementById('subtaskRows').appendChild(row);
}

function removeSubTaskRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
}

function cycleColor(btn) {
  const cur   = SUBTASK_COLORS.indexOf(btn.dataset.color);
  const next  = SUBTASK_COLORS[(cur + 1) % SUBTASK_COLORS.length];
  btn.style.background = next;
  btn.dataset.color    = next;
}

function applyQuickAdd(name) {
  addSubTaskRow(name);
  document.getElementById('subtaskRows').lastElementChild
    ?.querySelector('.st-name')?.focus();
}

/* ===== 保存 ===== */
function saveEntry() {
  const startDate = document.getElementById('entryStartDate').value;
  const endDate   = document.getElementById('entryEndDate').value;
  const note = document.getElementById('entryNote').value.trim();
  const rows  = document.querySelectorAll('#subtaskRows .subtask-row');

  if (!startDate || !endDate) {
    alert('開始日と終了日を入力してください。');
    return;
  }
  if (startDate > endDate) {
    alert('開始日が終了日より後です。');
    return;
  }

  const subTasks = [];
  let valid = true;
  rows.forEach(row => {
    const name  = row.querySelector('.st-name').value.trim();
    const start = row.querySelector('.st-start').value;
    const end   = row.querySelector('.st-end').value;
    const prog  = parseInt(row.querySelector('input[type=range]').value, 10);
    const color = row.querySelector('.subtask-color-btn').dataset.color;
    const stId  = row.dataset.stid;

    if (!name || !start || !end) { valid = false; return; }
    if (start > end) { alert(`「${name}」の開始日が終了日より後です。`); valid = false; return; }

    subTasks.push({ id: stId, name, startDate: start, endDate: end, progress: prog, color });
  });
  if (!valid) return;

  ganttEntries = loadGanttEntries();

  if (modalEntryId) {
    const idx = ganttEntries.findIndex(e => e.id === modalEntryId);
    if (idx !== -1) {
      ganttEntries[idx] = { ...ganttEntries[idx], startDate, endDate, note, subTasks };
    }
  } else {
    ganttEntries.push({
      id:      generateId(),
      taskId:  modalTaskId,
      startDate, endDate,
      note,
      addedAt: Date.now(),
      subTasks,
    });
  }

  saveGanttEntries(ganttEntries);

  // 終了日を作業管理ページの期限に反映（連動）
  const taskIdx = tasks.findIndex(t => t.id === modalTaskId);
  if (taskIdx !== -1 && tasks[taskIdx].deadline !== endDate) {
    tasks[taskIdx] = { ...tasks[taskIdx], deadline: endDate, updatedAt: Date.now() };
    saveTasks(tasks);
  }

  closeEntryModal();
  render();
}

function deleteEntry() {
  if (!modalEntryId) return;
  if (!confirm('この工程データを削除しますか？')) return;
  ganttEntries = loadGanttEntries().filter(e => e.id !== modalEntryId);
  saveGanttEntries(ganttEntries);
  closeEntryModal();
  render();
}

/* ===== ズーム ===== */
function updateZoomLabel() {
  document.getElementById('zoomLabel').textContent = ZOOM_NAMES[zoomIndex];
}

document.getElementById('zoomInBtn').addEventListener('click', () => {
  if (zoomIndex < ZOOM_LEVELS.length - 1) {
    zoomIndex++;
    updateZoomLabel();
    renderGanttChart();
  }
});

document.getElementById('zoomOutBtn').addEventListener('click', () => {
  if (zoomIndex > 0) {
    zoomIndex--;
    updateZoomLabel();
    renderGanttChart();
  }
});

/* ===== 今日・全体表示 ===== */
document.getElementById('todayBtn').addEventListener('click', () => {
  scrollToToday();
});

document.getElementById('fitAllBtn').addEventListener('click', () => {
  const scroll = document.getElementById('ganttScroll');
  const DW = dayW();
  // 全体が入るズームを自動調整
  const availW = scroll.clientWidth - LABEL_W;
  if (totalDays > 0) {
    const targetDW = Math.floor(availW / totalDays);
    // 最も近いズームレベルを選択
    let best = 0;
    for (let i = 0; i < ZOOM_LEVELS.length; i++) {
      if (ZOOM_LEVELS[i] <= targetDW) best = i;
    }
    zoomIndex = best;
    updateZoomLabel();
    renderGanttChart();
  }
  scroll.scrollLeft = 0;
});

/* ===== フィルター ===== */
['filterAssigneeGantt','filterStatusGantt','ganttSearchInput'].forEach(id => {
  document.getElementById(id).addEventListener('input', render);
  document.getElementById(id).addEventListener('change', render);
});

/* ===== モーダルイベント ===== */
document.getElementById('entryModalClose').addEventListener('click', closeEntryModal);
document.getElementById('entryCancelBtn').addEventListener('click', closeEntryModal);
document.getElementById('entryFormOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('entryFormOverlay')) closeEntryModal();
});
document.getElementById('entrySaveBtn').addEventListener('click', saveEntry);
document.getElementById('entryDeleteBtn').addEventListener('click', deleteEntry);

document.getElementById('addSubtaskBtn').addEventListener('click', () => {
  addSubTaskRow();
});

document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => applyQuickAdd(btn.dataset.name));
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeEntryModal();
});

/* ===== 他タブ・ページとの連動 ===== */
// 同一ブラウザの別タブで task_management_data が更新されたら即再描画
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY) {
    tasks = loadTasks();
    render();
  }
});

// ガントチャートタブに戻ってきたとき（非表示→表示）に再読み込み
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    tasks        = loadTasks();
    ganttEntries = loadGanttEntries();
    render();
  }
});

/* ===== 初期化 ===== */
updateZoomLabel();
render();
scrollToToday();
