'use strict';

/* ===== データ管理 ===== */
const STORAGE_KEY   = 'task_management_data';
const RECURRING_KEY = 'recurring_task_templates';

function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function loadRecurringTemplates() {
  try {
    return JSON.parse(localStorage.getItem(RECURRING_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecurringTemplates(templates) {
  localStorage.setItem(RECURRING_KEY, JSON.stringify(templates));
}

let tasks = loadTasks();
let editingId = null;
let deleteTargetId = null;
let activeStatusFilter = new Set();

/* ===== DOM要素 ===== */
const taskList       = document.getElementById('taskList');
const emptyState     = document.getElementById('emptyState');
const openModalBtn   = document.getElementById('openModalBtn');
const modalOverlay   = document.getElementById('modalOverlay');
const modalClose     = document.getElementById('modalClose');
const cancelBtn      = document.getElementById('cancelBtn');
const taskForm       = document.getElementById('taskForm');
const submitBtn      = document.getElementById('submitBtn');
const modalTitle     = document.getElementById('modalTitle');
const progressInput  = document.getElementById('taskProgress');
const progressValue  = document.getElementById('progressValue');
const searchInput    = document.getElementById('searchInput');
const filterStatus   = document.getElementById('filterStatus');
const filterPriority = document.getElementById('filterPriority');
const filterAssignee = document.getElementById('filterAssignee');
const sortOrder      = document.getElementById('sortOrder');
const detailOverlay  = document.getElementById('detailOverlay');
const detailClose    = document.getElementById('detailClose');
const detailTitle    = document.getElementById('detailTitle');
const detailBody     = document.getElementById('detailBody');
const deleteOverlay  = document.getElementById('deleteOverlay');
const deleteClose    = document.getElementById('deleteClose');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

/* ===== ユーティリティ ===== */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getLastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// ISO週番号（月曜始まり）
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function padTwo(n) {
  return String(n).padStart(2, '0');
}

/* ===== 定期作業の自動生成 ===== */
function checkAndGenerateRecurringTasks() {
  const templates = loadRecurringTemplates();
  if (templates.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year  = today.getFullYear();
  const month = today.getMonth(); // 0-indexed
  const day   = today.getDate();
  const dow   = today.getDay(); // 0=日

  const currentYM = `${year}-${padTwo(month + 1)}`;
  const currentWW = `${year}-${padTwo(getWeekNumber(today))}`;

  let changed = false;
  let tasksChanged = false;

  templates.forEach(tmpl => {
    let shouldGenerate = false;
    let deadlineStr    = '';
    let period         = '';

    if (tmpl.repeatType === 'monthly_end') {
      const lastDay = getLastDayOfMonth(year, month);
      period = currentYM;
      const triggerDay = lastDay - (tmpl.advanceDays || 0);
      shouldGenerate = day >= triggerDay && tmpl.lastGeneratedPeriod !== period;
      const dd = String(lastDay).padStart(2, '0');
      deadlineStr = `${year}-${padTwo(month + 1)}-${dd}`;

    } else if (tmpl.repeatType === 'monthly_day') {
      const targetDay = parseInt(tmpl.repeatValue, 10);
      period = currentYM;
      const triggerDay = targetDay - (tmpl.advanceDays || 0);
      shouldGenerate = day >= triggerDay && tmpl.lastGeneratedPeriod !== period;
      const maxDay = getLastDayOfMonth(year, month);
      const actualDay = Math.min(targetDay, maxDay);
      deadlineStr = `${year}-${padTwo(month + 1)}-${padTwo(actualDay)}`;

    } else if (tmpl.repeatType === 'weekly') {
      const targetDow  = parseInt(tmpl.repeatValue, 10); // 0=日
      const advanceDays = tmpl.advanceDays || 0;
      // 対象曜日のX日前の曜日に生成トリガー
      const triggerDow = ((targetDow - advanceDays) % 7 + 7) % 7;
      period = currentWW;
      shouldGenerate = dow === triggerDow && tmpl.lastGeneratedPeriod !== period;
      // 期限 = 次のtargetDow（今日がtriggerDowなので今日+advanceDays後）
      const daysUntilTarget = ((targetDow - dow) + 7) % 7 || (dow === targetDow ? 0 : 7);
      const deadlineDate = new Date(today);
      deadlineDate.setDate(today.getDate() + daysUntilTarget);
      deadlineStr = `${deadlineDate.getFullYear()}-${padTwo(deadlineDate.getMonth()+1)}-${padTwo(deadlineDate.getDate())}`;
    }

    if (shouldGenerate) {
      const now = Date.now();
      tasks.push({
        id:            generateId(),
        title:         tmpl.title,
        priority:      tmpl.priority,
        deadline:      deadlineStr,
        status:        tmpl.status || '未実施',
        assignee:      tmpl.assignee || '',
        description:   tmpl.description || '',
        notes:         '',
        progress:      0,
        createdAt:     now,
        updatedAt:     now,
        fromRecurring: tmpl.id,
      });
      tmpl.lastGeneratedPeriod = period;
      tasksChanged = true;
      changed      = true;
    }
  });

  if (changed) saveRecurringTemplates(templates);
  if (tasksChanged) saveTasks(tasks);
}

/* ===== 古い完了タスクを自動削除（完了から2ヶ月経過） ===== */
function removeOldCompletedTasks() {
  const twoMonthsAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
  const before = tasks.length;
  tasks = tasks.filter(t => {
    if (t.status !== '完了') return true;
    const doneAt = t.completedAt || t.updatedAt;
    return doneAt > twoMonthsAgo;
  });
  if (tasks.length !== before) saveTasks(tasks);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr + 'T23:59:59') < new Date();
}

function priorityOrder(p) {
  return p === '高' ? 3 : p === '中' ? 2 : 1;
}

/* ===== 担当者フィルタ更新 ===== */
function updateAssigneeFilter() {
  const names = [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort();
  const current = filterAssignee.value;
  filterAssignee.innerHTML = '<option value="">すべての担当者</option>';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === current) opt.selected = true;
    filterAssignee.appendChild(opt);
  });
}

/* ===== フィルタ・ソート適用 ===== */
function getFilteredTasks() {
  const query    = searchInput.value.trim().toLowerCase();
  const statusSelect = activeStatusFilter.size === 0 ? filterStatus.value : '';
  const priority = filterPriority.value;
  const assignee = filterAssignee.value;
  const sort     = sortOrder.value;

  let result = tasks.filter(t => {
    if (query && !(
      t.title.toLowerCase().includes(query) ||
      (t.assignee || '').toLowerCase().includes(query) ||
      (t.description || '').toLowerCase().includes(query)
    )) return false;
    if (activeStatusFilter.size > 0 && !activeStatusFilter.has(t.status)) return false;
    if (statusSelect && t.status !== statusSelect) return false;
    if (priority && t.priority !== priority) return false;
    if (assignee && t.assignee !== assignee) return false;
    return true;
  });

  result.sort((a, b) => {
    switch (sort) {
      case 'created_asc':  return a.createdAt - b.createdAt;
      case 'created_desc': return b.createdAt - a.createdAt;
      case 'deadline_asc': {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      }
      case 'deadline_desc': {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return b.deadline.localeCompare(a.deadline);
      }
      case 'priority_desc': return priorityOrder(b.priority) - priorityOrder(a.priority);
      default: return b.createdAt - a.createdAt;
    }
  });

  return result;
}

/* ===== サマリー更新 ===== */
function updateSummary() {
  document.getElementById('countAll').textContent       = tasks.length;
  document.getElementById('countPending').textContent   = tasks.filter(t => t.status === '未実施').length;
  document.getElementById('countInProgress').textContent = tasks.filter(t => t.status === '進行中').length;
  document.getElementById('countHold').textContent      = tasks.filter(t => t.status === '保留').length;
  document.getElementById('countDone').textContent      = tasks.filter(t => t.status === '完了').length;

  document.querySelectorAll('.summary-card').forEach(card => {
    const s = card.dataset.status;
    if (s === '') {
      card.classList.toggle('active', activeStatusFilter.size === 0 && !filterStatus.value);
    } else {
      card.classList.toggle('active', activeStatusFilter.has(s));
    }
  });
}

/* ===== カードHTML生成 ===== */
function createCardHTML(task) {
  const priorityClass = task.priority === '高' ? 'high' : task.priority === '中' ? 'mid' : 'low';
  const priorityEmoji = task.priority === '高' ? '🔴' : task.priority === '中' ? '🟡' : '🟢';
  const deadlineStr   = task.deadline ? formatDate(task.deadline) : null;
  const overdue       = task.status !== '完了' && isOverdue(task.deadline);
  const isDone        = task.status === '完了';
  const progress      = task.progress || 0;
  const isFull        = progress >= 100;
  const descPreview   = task.description
    ? escapeHTML(task.description.slice(0, 50)) + (task.description.length > 50 ? '…' : '')
    : null;

  return `
    <div class="task-card priority-${priorityClass}${isDone ? ' is-done' : ''}" data-id="${task.id}">
      <div class="task-card-main" onclick="openDetail('${task.id}')">
        <div class="task-card-title-row">
          <div class="task-title">${escapeHTML(task.title)}</div>
          <div class="task-badges">
            <span class="badge badge-status-${task.status}">${task.status}</span>
            <span class="badge badge-priority-${priorityClass}">${priorityEmoji} ${task.priority}</span>
          </div>
        </div>
        <div class="task-meta">
          <span class="task-meta-item">👤 ${escapeHTML(task.assignee || '未設定')}</span>
          ${deadlineStr
            ? `<span class="task-meta-item${overdue ? ' overdue' : ''}">📅 ${deadlineStr}${overdue ? ' ⚠️期限超過' : ''}</span>`
            : ''}
          <span class="task-meta-item">🕐 ${formatDate(new Date(task.createdAt).toISOString().slice(0,10))}</span>
          ${descPreview ? `<span class="task-meta-item task-desc-preview">📝 ${descPreview}</span>` : ''}
        </div>
      </div>
      <div class="task-card-progress">
        <div class="progress-bar-track">
          <div class="progress-bar-fill${isFull ? ' full' : ''}" style="width:${progress}%"></div>
        </div>
        <span class="progress-pct${isFull ? ' full' : ''}">${progress}%</span>
      </div>
      <div class="task-actions">
        <button class="action-btn edit" onclick="openEditModal('${task.id}'); event.stopPropagation();">編集</button>
        <button class="action-btn duplicate" onclick="duplicateTask('${task.id}'); event.stopPropagation();">複製</button>
        <button class="action-btn delete" onclick="openDeleteConfirm('${task.id}'); event.stopPropagation();">削除</button>
      </div>
    </div>
  `;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ===== 一覧レンダリング ===== */
function render() {
  updateSummary();
  updateAssigneeFilter();

  const filtered = getFilteredTasks();
  if (filtered.length === 0) {
    taskList.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  const active = filtered.filter(t => t.status !== '完了');
  const done   = filtered.filter(t => t.status === '完了');

  let html = active.map(createCardHTML).join('');
  if (done.length > 0) {
    html += `<div class="done-divider"><span>✅ 完了済み（${done.length}件）</span></div>`;
    html += done.map(createCardHTML).join('');
  }
  taskList.innerHTML = html;
}

/* ===== モーダル開閉 ===== */
function openAddModal() {
  editingId = null;
  taskForm.reset();
  progressValue.textContent = '0';
  progressInput.value = 0;
  progressInput.disabled = false;
  modalTitle.textContent = '新規作業を追加';
  submitBtn.textContent = '登録する';
  modalOverlay.classList.add('open');
}

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id;

  document.getElementById('taskId').value           = task.id;
  document.getElementById('taskTitle').value        = task.title;
  document.getElementById('taskPriority').value     = task.priority;
  document.getElementById('taskDeadline').value     = task.deadline || '';
  document.getElementById('taskStatus').value       = task.status;
  document.getElementById('taskAssignee').value     = task.assignee || '';
  document.getElementById('taskDescription').value  = task.description || '';
  document.getElementById('taskNotes').value        = task.notes || '';
  progressInput.value                               = task.progress || 0;
  progressValue.textContent                         = task.progress || 0;
  applyStatusToProgress(task.status);

  modalTitle.textContent = '作業を編集';
  submitBtn.textContent  = '更新する';
  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  taskForm.reset();
  editingId = null;
}

/* ===== 詳細モーダル ===== */
function openDetail(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const priorityEmoji = task.priority === '高' ? '🔴' : task.priority === '中' ? '🟡' : '🟢';
  const progress      = task.progress || 0;
  const isFull        = progress >= 100;
  const overdue       = task.status !== '完了' && isOverdue(task.deadline);

  detailTitle.textContent = task.title;
  detailBody.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <label>優先度</label>
        <p>${priorityEmoji} ${task.priority}</p>
      </div>
      <div class="detail-item">
        <label>ステータス</label>
        <p><span class="badge badge-status-${task.status}">${task.status}</span></p>
      </div>
      <div class="detail-item">
        <label>担当者</label>
        <p>👤 ${escapeHTML(task.assignee || '未設定')}</p>
      </div>
      <div class="detail-item">
        <label>期限</label>
        <p style="${overdue ? 'color:#dc2626;font-weight:600;' : ''}">
          ${task.deadline ? '📅 ' + formatDate(task.deadline) + (overdue ? ' ⚠️ 期限超過' : '') : '—'}
        </p>
      </div>
      <div class="detail-item">
        <label>登録日</label>
        <p>🕐 ${formatDate(new Date(task.createdAt).toISOString().slice(0,10))}</p>
      </div>
      <div class="detail-item">
        <label>最終更新</label>
        <p>✏️ ${formatDate(new Date(task.updatedAt).toISOString().slice(0,10))}</p>
      </div>
    </div>
    <hr class="detail-divider">
    <div style="margin-bottom:16px;">
      <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-light);margin-bottom:6px;">進捗</label>
      <div class="detail-progress-wrap">
        <div class="detail-progress-track">
          <div class="detail-progress-fill${isFull ? ' full' : ''}" style="width:${progress}%"></div>
        </div>
        <span class="detail-progress-pct${isFull ? ' full' : ''}">${progress}%</span>
      </div>
    </div>
    ${task.description ? `
    <hr class="detail-divider">
    <div style="margin-bottom:16px;">
      <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-light);margin-bottom:6px;">作業説明</label>
      <p style="font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHTML(task.description)}</p>
    </div>` : ''}
    ${task.notes ? `
    <hr class="detail-divider">
    <div>
      <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-light);margin-bottom:6px;">備考</label>
      <p style="font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHTML(task.notes)}</p>
    </div>` : ''}
    <hr class="detail-divider">
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeDetail()">閉じる</button>
      <button class="btn btn-primary" onclick="closeDetail(); openEditModal('${task.id}')">編集する</button>
    </div>
  `;
  detailOverlay.classList.add('open');
}

function closeDetail() {
  detailOverlay.classList.remove('open');
}

/* ===== 削除確認 ===== */
function openDeleteConfirm(id) {
  deleteTargetId = id;
  deleteOverlay.classList.add('open');
}

function closeDeleteConfirm() {
  deleteOverlay.classList.remove('open');
  deleteTargetId = null;
}

/* ===== イベントリスナー ===== */
openModalBtn.addEventListener('click', openAddModal);
modalClose.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
detailClose.addEventListener('click', closeDetail);
deleteClose.addEventListener('click', closeDeleteConfirm);
deleteCancelBtn.addEventListener('click', closeDeleteConfirm);

// オーバーレイクリックで閉じる
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
detailOverlay.addEventListener('click', e => { if (e.target === detailOverlay) closeDetail(); });
deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) closeDeleteConfirm(); });

// プログレスバー同期
progressInput.addEventListener('input', () => {
  progressValue.textContent = progressInput.value;
});

// ステータス変更で進捗を自動制御
const taskStatusSelect = document.getElementById('taskStatus');
function applyStatusToProgress(status) {
  if (status === '未実施') {
    progressInput.value = 0;
    progressValue.textContent = '0';
    progressInput.disabled = true;
  } else if (status === '完了') {
    progressInput.value = 100;
    progressValue.textContent = '100';
    progressInput.disabled = true;
  } else {
    progressInput.disabled = false;
  }
}
taskStatusSelect.addEventListener('change', () => {
  applyStatusToProgress(taskStatusSelect.value);
});

// フィルター・検索
[searchInput, filterStatus, filterPriority, filterAssignee, sortOrder].forEach(el => {
  el.addEventListener('input', () => {
    if (el === filterStatus) activeStatusFilter.clear();
    render();
  });
  el.addEventListener('change', () => {
    if (el === filterStatus) activeStatusFilter.clear();
    render();
  });
});

// サマリーカードでフィルタ（複数選択対応）
document.querySelectorAll('.summary-card').forEach(card => {
  card.addEventListener('click', () => {
    const status = card.dataset.status;
    if (status === '') {
      activeStatusFilter.clear();
    } else if (activeStatusFilter.has(status)) {
      activeStatusFilter.delete(status);
    } else {
      activeStatusFilter.add(status);
    }
    filterStatus.value = '';
    render();
  });
});

// フォーム送信
taskForm.addEventListener('submit', e => {
  e.preventDefault();

  const title    = document.getElementById('taskTitle').value.trim();
  const priority = document.getElementById('taskPriority').value;
  const deadline = document.getElementById('taskDeadline').value;
  const status   = document.getElementById('taskStatus').value;
  const assignee = document.getElementById('taskAssignee').value.trim();
  const desc     = document.getElementById('taskDescription').value.trim();
  const notes    = document.getElementById('taskNotes').value.trim();
  const progress = parseInt(progressInput.value, 10);

  if (!title || !priority || !status || !assignee) return;

  const now = Date.now();

  if (editingId) {
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx !== -1) {
      const wasDone = tasks[idx].status === '完了';
      const becomingDone = status === '完了';
      tasks[idx] = {
        ...tasks[idx],
        title, priority, deadline, status, assignee,
        description: desc, notes, progress,
        updatedAt: now,
        completedAt: becomingDone ? (wasDone ? tasks[idx].completedAt : now) : undefined,
      };
    }
  } else {
    tasks.push({
      id: generateId(),
      title, priority, deadline, status, assignee,
      description: desc, notes, progress,
      createdAt: now,
      updatedAt: now,
      completedAt: status === '完了' ? now : undefined,
    });
  }

  saveTasks(tasks);
  closeModal();
  render();
});

/* ===== 複製 ===== */
function duplicateTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const now = Date.now();
  tasks.push({
    ...task,
    id: generateId(),
    title: task.title + ' （コピー）',
    status: '未実施',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  });
  saveTasks(tasks);
  render();
}

// 削除実行
deleteConfirmBtn.addEventListener('click', () => {
  if (!deleteTargetId) return;
  tasks = tasks.filter(t => t.id !== deleteTargetId);
  saveTasks(tasks);
  closeDeleteConfirm();
  render();
});

/* ===== 定期作業モーダル ===== */
const recurringOverlay        = document.getElementById('recurringOverlay');
const recurringClose          = document.getElementById('recurringClose');
const openRecurringBtn        = document.getElementById('openRecurringBtn');
const recurringList           = document.getElementById('recurringList');
const recurringEmpty          = document.getElementById('recurringEmpty');
const toggleRecurringFormBtn  = document.getElementById('toggleRecurringFormBtn');
const recurringFormWrap       = document.getElementById('recurringFormWrap');
const cancelRecurringFormBtn  = document.getElementById('cancelRecurringFormBtn');
const recurringForm           = document.getElementById('recurringForm');
const rtRepeatType            = document.getElementById('rtRepeatType');
const rtRepeatValueWrap       = document.getElementById('rtRepeatValueWrap');
const rtRepeatValueLabel      = document.getElementById('rtRepeatValueLabel');
const rtRepeatValue           = document.getElementById('rtRepeatValue');

function openRecurring() {
  renderRecurringList();
  recurringFormWrap.style.display = 'none';
  toggleRecurringFormBtn.textContent = '＋ テンプレートを追加';
  recurringForm.reset();
  document.getElementById('rtAdvanceDays').value = 3;
  rtRepeatValueWrap.style.display = 'none';
  recurringOverlay.classList.add('open');
}

function closeRecurring() {
  recurringOverlay.classList.remove('open');
}

const WEEK_LABELS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];

function repeatTypeLabel(tmpl) {
  if (tmpl.repeatType === 'monthly_end') return '毎月末';
  if (tmpl.repeatType === 'monthly_day') return `毎月 ${tmpl.repeatValue} 日`;
  if (tmpl.repeatType === 'weekly') return `毎週 ${WEEK_LABELS[tmpl.repeatValue]}`;
  return '';
}

function renderRecurringList() {
  const templates = loadRecurringTemplates();
  if (templates.length === 0) {
    recurringList.innerHTML = '';
    recurringEmpty.style.display = 'block';
    return;
  }
  recurringEmpty.style.display = 'none';
  recurringList.innerHTML = templates.map(tmpl => {
    const priorityEmoji = tmpl.priority === '高' ? '🔴' : tmpl.priority === '中' ? '🟡' : '🟢';
    return `
      <div class="recurring-item">
        <div class="recurring-item-main">
          <span class="recurring-item-title">${escapeHTML(tmpl.title)}</span>
          <span class="badge badge-priority-${tmpl.priority === '高' ? 'high' : tmpl.priority === '中' ? 'mid' : 'low'}">${priorityEmoji} ${tmpl.priority}</span>
        </div>
        <div class="recurring-item-meta">
          <span>👤 ${escapeHTML(tmpl.assignee || '未設定')}</span>
          <span>🔄 ${repeatTypeLabel(tmpl)}</span>
          <span>⏰ ${tmpl.advanceDays}日前に生成</span>
        </div>
        <button class="action-btn delete" onclick="deleteTemplate('${tmpl.id}')">削除</button>
      </div>
    `;
  }).join('');
}

function addTemplate(e) {
  e.preventDefault();
  const title      = document.getElementById('rtTitle').value.trim();
  const priority   = document.getElementById('rtPriority').value;
  const assignee   = document.getElementById('rtAssignee').value.trim();
  const status     = document.getElementById('rtStatus').value;
  const repeatType = rtRepeatType.value;
  const advanceDays = parseInt(document.getElementById('rtAdvanceDays').value, 10);
  const desc       = document.getElementById('rtDescription').value.trim();

  if (!title || !priority || !assignee || !repeatType) return;

  let repeatValue = null;
  if (repeatType === 'monthly_day' || repeatType === 'weekly') {
    repeatValue = rtRepeatValue.value;
    if (repeatValue === '') return;
    repeatValue = parseInt(repeatValue, 10);
  }

  const templates = loadRecurringTemplates();
  templates.push({
    id:                   generateId(),
    title,
    priority,
    assignee,
    status,
    description:          desc,
    repeatType,
    repeatValue,
    advanceDays:          isNaN(advanceDays) ? 3 : advanceDays,
    lastGeneratedPeriod:  '',
  });
  saveRecurringTemplates(templates);

  recurringForm.reset();
  document.getElementById('rtAdvanceDays').value = 3;
  rtRepeatValueWrap.style.display = 'none';
  recurringFormWrap.style.display = 'none';
  toggleRecurringFormBtn.textContent = '＋ テンプレートを追加';
  renderRecurringList();
}

function deleteTemplate(id) {
  let templates = loadRecurringTemplates();
  templates = templates.filter(t => t.id !== id);
  saveRecurringTemplates(templates);
  renderRecurringList();
}

// 繰り返しタイプに応じてrepeatValueフィールドを切替
rtRepeatType.addEventListener('change', () => {
  const type = rtRepeatType.value;
  rtRepeatValue.innerHTML = '';
  if (type === 'monthly_day') {
    rtRepeatValueLabel.textContent = '日付（1〜28日）';
    for (let d = 1; d <= 28; d++) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `${d}日`;
      rtRepeatValue.appendChild(opt);
    }
    rtRepeatValueWrap.style.display = 'flex';
  } else if (type === 'weekly') {
    rtRepeatValueLabel.textContent = '曜日';
    WEEK_LABELS.forEach((label, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = label;
      rtRepeatValue.appendChild(opt);
    });
    rtRepeatValueWrap.style.display = 'flex';
  } else {
    rtRepeatValueWrap.style.display = 'none';
  }
});

openRecurringBtn.addEventListener('click', openRecurring);
recurringClose.addEventListener('click', closeRecurring);
recurringOverlay.addEventListener('click', e => { if (e.target === recurringOverlay) closeRecurring(); });

toggleRecurringFormBtn.addEventListener('click', () => {
  const isOpen = recurringFormWrap.style.display !== 'none';
  recurringFormWrap.style.display = isOpen ? 'none' : 'block';
  toggleRecurringFormBtn.textContent = isOpen ? '＋ テンプレートを追加' : '▲ 閉じる';
});

cancelRecurringFormBtn.addEventListener('click', () => {
  recurringFormWrap.style.display = 'none';
  toggleRecurringFormBtn.textContent = '＋ テンプレートを追加';
  recurringForm.reset();
  rtRepeatValueWrap.style.display = 'none';
});

recurringForm.addEventListener('submit', addTemplate);

/* ===== キーボードショートカット ===== */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (deleteOverlay.classList.contains('open')) closeDeleteConfirm();
    else if (detailOverlay.classList.contains('open')) closeDetail();
    else if (modalOverlay.classList.contains('open')) closeModal();
    else if (recurringOverlay.classList.contains('open')) closeRecurring();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openAddModal();
  }
});

/* ===== 初期描画 ===== */
checkAndGenerateRecurringTasks();
removeOldCompletedTasks();
render();
