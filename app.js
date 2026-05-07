'use strict';

/* ===== データ管理 ===== */
const STORAGE_KEY = 'task_management_data';

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

  return `
    <div class="task-card priority-${priorityClass}${isDone ? ' is-done' : ''}" data-id="${task.id}">
      <div class="task-card-top" onclick="openDetail('${task.id}')">
        <div class="task-card-header">
          <div class="task-title">${escapeHTML(task.title)}</div>
          <div class="task-badges">
            <span class="badge badge-priority-${priorityClass}">${priorityEmoji} ${task.priority}</span>
            <span class="badge badge-status-${task.status}">${task.status}</span>
          </div>
        </div>
        <div class="task-meta">
          <span class="task-meta-item">👤 ${escapeHTML(task.assignee || '未設定')}</span>
          ${deadlineStr
            ? `<span class="task-meta-item${overdue ? ' overdue' : ''}">📅 ${deadlineStr}${overdue ? ' ⚠️期限超過' : ''}</span>`
            : ''}
          <span class="task-meta-item">🕐 ${formatDate(new Date(task.createdAt).toISOString().slice(0,10))}</span>
        </div>
        ${task.description
          ? `<div class="task-description">${escapeHTML(task.description)}</div>`
          : ''}
      </div>
      <div class="task-card-bottom">
        <div class="progress-wrap">
          <div class="progress-bar-track">
            <div class="progress-bar-fill${isFull ? ' full' : ''}" style="width:${progress}%"></div>
          </div>
          <span class="progress-pct${isFull ? ' full' : ''}">${progress}%</span>
        </div>
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
  taskList.innerHTML = filtered.map(createCardHTML).join('');
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
      tasks[idx] = {
        ...tasks[idx],
        title, priority, deadline, status, assignee,
        description: desc, notes, progress,
        updatedAt: now,
      };
    }
  } else {
    tasks.push({
      id: generateId(),
      title, priority, deadline, status, assignee,
      description: desc, notes, progress,
      createdAt: now,
      updatedAt: now,
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

/* ===== キーボードショートカット ===== */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (deleteOverlay.classList.contains('open')) closeDeleteConfirm();
    else if (detailOverlay.classList.contains('open')) closeDetail();
    else if (modalOverlay.classList.contains('open')) closeModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openAddModal();
  }
});

/* ===== 初期描画 ===== */
render();
