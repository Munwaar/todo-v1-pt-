/*
  TaskFlow v2
  Vanilla JavaScript, local-first persistence, and compatibility-safe migration.
*/
(function () {
  'use strict';

  const STORAGE_KEY = 'taskflow.tasks.v1';
  const SETTINGS_KEY = 'taskflow.settings.v2';
  const THEME_KEY = 'taskflow.theme';
  const DEFAULT_CATEGORIES = ['work', 'study', 'personal'];
  const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

  const state = {
    tasks: [],
    view: 'overview',
    filter: 'all',
    categoryFilter: 'all',
    priorityFilter: 'all',
    sort: 'newest',
    search: '',
    editingId: null,
    pendingDeleteId: null,
    deleted: null,
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: toISODate(new Date()),
    settings: {
      theme: localStorage.getItem(THEME_KEY) || 'system',
      defaultPriority: 'medium',
      defaultCategory: 'work',
      pomodoroMinutes: 25,
      categories: DEFAULT_CATEGORIES.slice(),
    },
    pomodoro: { mode: 'focus', total: 25 * 60, remaining: 25 * 60, running: false, interval: null },
  };

  const el = {};
  const $ = (id) => document.getElementById(id);

  function cacheDom() {
    [
      'toast-container', 'sidebar', 'sidebar-scrim', 'menu-btn', 'theme-toggle', 'breadcrumb-current',
      'greeting', 'date-label', 'task-list', 'empty-state', 'empty-icon', 'empty-title', 'empty-copy',
      'empty-action', 'search', 'sort', 'filter-category', 'filter-priority', 'clear-filters', 'task-form',
      'task-modal', 'task-modal-eyebrow', 'task-modal-title', 'task-submit', 'task-input', 'task-description',
      'task-priority', 'task-category', 'task-due', 'task-recurrence', 'task-tags', 'task-favorite', 'form-error',
      'confirm-modal', 'confirm-ok', 'confirm-cancel', 'shortcuts-modal', 'assistant-modal', 'assistant-btn',
      'assistant-form', 'assistant-input', 'assistant-results', 'stat-total', 'stat-completed', 'stat-pending',
      'stat-overdue', 'stat-rate', 'progress-percent', 'rate-ring', 'stat-streak', 'stat-best-streak',
      'stat-completed-trend', 'stat-overdue-trend', 'count-all', 'count-active', 'count-completed', 'count-today',
      'count-favorites', 'count-high', 'count-overdue', 'category-list', 'add-category-btn', 'pulse-percent',
      'large-ring', 'pulse-title', 'pulse-description', 'today-completed', 'week-completed', 'week-bars',
      'priority-chart', 'category-chart', 'dashboard-today-list', 'pomodoro-time', 'pomodoro-mode', 'pomodoro-ring',
      'pomodoro-start', 'pomodoro-reset', 'pomodoro-switch', 'today-subhead', 'today-overdue-count',
      'today-due-count', 'today-upcoming-count', 'today-overdue-list', 'today-due-list', 'today-upcoming-list',
      'today-completion-heading', 'today-progress-fill', 'today-progress-copy', 'today-focus-btn', 'calendar-prev',
      'calendar-next', 'calendar-today', 'calendar-month', 'calendar-grid', 'selected-date-label',
      'selected-day-list', 'calendar-add', 'setting-theme', 'setting-priority', 'setting-category', 'setting-pomodoro',
      'export-json', 'export-csv', 'import-json', 'import-file', 'clear-data', 'settings-assistant', 'shortcuts-btn',
    ].forEach((id) => { el[id.replaceAll('-', '_')] = $(id); });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toISODate(date) {
    const d = new Date(date);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function fromISODate(value) {
    return value ? new Date(value + 'T00:00:00') : null;
  }

  function addDays(iso, amount) {
    const date = fromISODate(iso);
    date.setDate(date.getDate() + amount);
    return toISODate(date);
  }

  function addMonths(iso, amount) {
    const date = fromISODate(iso);
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + amount);
    const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(originalDay, maxDay));
    return toISODate(date);
  }

  function todayISO() { return toISODate(new Date()); }
  function isToday(iso) { return iso === todayISO(); }
  function isOverdue(task) { return Boolean(task.due && !task.completed && task.due < todayISO()); }
  function isUpcoming(task) { return Boolean(task.due && !task.completed && task.due > todayISO()); }

  function formatDate(iso, options) {
    if (!iso) return '';
    return fromISODate(iso).toLocaleDateString(undefined, options || { month: 'short', day: 'numeric' });
  }

  function formatLongDate(iso) {
    return formatDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim().replace(/^#/, '').toLowerCase()).filter(Boolean).slice(0, 12);
    return String(tags || '').split(/[\s,]+/).map((tag) => tag.trim().replace(/^#/, '').toLowerCase()).filter(Boolean).slice(0, 12);
  }

  function normalizeTask(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title ?? raw.name ?? raw.text ?? '').trim();
    if (!title) return null;
    const priority = ['low', 'medium', 'high', 'urgent'].includes(raw.priority) ? raw.priority : 'medium';
    const recurrence = ['none', 'daily', 'weekly', 'monthly'].includes(raw.recurrence) ? raw.recurrence : (raw.recurring ? 'daily' : 'none');
    const completed = Boolean(raw.completed ?? raw.done);
    const createdAt = Number(raw.createdAt) || Date.now() - index;
    const completionDates = Array.isArray(raw.completionDates) ? raw.completionDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    if (completed && raw.completedAt && !completionDates.includes(toISODate(Number(raw.completedAt)))) completionDates.push(toISODate(Number(raw.completedAt)));
    return {
      ...raw,
      id: String(raw.id || uid()),
      title,
      description: String(raw.description || '').trim(),
      priority,
      category: String(raw.category || 'work').trim().toLowerCase() || 'work',
      tags: normalizeTags(raw.tags),
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.due || '')) ? raw.due : '',
      favorite: Boolean(raw.favorite ?? raw.starred),
      recurrence,
      completed,
      completedAt: completed && raw.completedAt ? Number(raw.completedAt) : (completed ? createdAt : null),
      completionDates,
      createdAt,
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const source = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.tasks) ? parsed.tasks : []);
      state.tasks = source.map(normalizeTask).filter(Boolean);
    } catch (error) {
      console.warn('TaskFlow could not read existing task data.', error);
      state.tasks = [];
      toast('We started with a clean task list because saved data was unreadable.', 'warn');
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      state.settings = {
        ...state.settings,
        ...saved,
        categories: Array.from(new Set([...(saved.categories || []), ...DEFAULT_CATEGORIES])).filter(Boolean),
      };
    } catch (error) {
      console.warn('TaskFlow settings were reset.', error);
    }
    if (!state.settings.categories.includes(state.settings.defaultCategory)) state.settings.defaultCategory = state.settings.categories[0] || 'work';
  }

  function saveTasks() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks)); }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    localStorage.setItem(THEME_KEY, state.settings.theme);
  }

  function getCategoryLabel(category) {
    return String(category || 'work').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function priorityLabel(priority) { return priority.charAt(0).toUpperCase() + priority.slice(1); }

  function toast(message, type = 'success', actionLabel, action) {
    if (!el.toast_container) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    const messageNode = document.createElement('span');
    messageNode.className = 'toast-message';
    messageNode.textContent = message;
    node.appendChild(messageNode);
    if (actionLabel && action) {
      const button = document.createElement('button');
      button.className = 'toast-action';
      button.textContent = actionLabel;
      button.addEventListener('click', () => { action(); node.remove(); });
      node.appendChild(button);
    }
    el.toast_container.appendChild(node);
    window.setTimeout(() => {
      if (!node.isConnected) return;
      node.classList.add('fade-out');
      window.setTimeout(() => node.remove(), 220);
    }, actionLabel ? 5500 : 2500);
  }

  // ---------- CRUD and safe recurring behavior ----------
  function taskPayloadFromForm() {
    return {
      title: el.task_input.value.trim(),
      description: el.task_description.value.trim(),
      priority: el.task_priority.value,
      category: el.task_category.value || state.settings.defaultCategory,
      due: el.task_due.value,
      recurrence: el.task_recurrence.value,
      tags: normalizeTags(el.task_tags.value),
      favorite: el.task_favorite.checked,
    };
  }

  function addTask(data, silent = false) {
    const task = {
      id: uid(), title: data.title.trim(), description: data.description || '', priority: data.priority || state.settings.defaultPriority,
      category: data.category || state.settings.defaultCategory, tags: normalizeTags(data.tags), due: data.due || '',
      favorite: Boolean(data.favorite), recurrence: data.recurrence || 'none', completed: false, completedAt: null,
      completionDates: [], createdAt: Date.now(),
    };
    state.tasks.unshift(task);
    saveTasks();
    render();
    if (!silent) toast('Task added', 'success');
    return task;
  }

  function updateTask(id, patch) {
    const index = state.tasks.findIndex((task) => task.id === id);
    if (index === -1) return;
    state.tasks[index] = { ...state.tasks[index], ...patch };
    saveTasks();
    render();
  }

  function deleteTask(id) {
    const index = state.tasks.findIndex((task) => task.id === id);
    if (index === -1) return;
    state.deleted = { task: state.tasks[index], index };
    state.tasks.splice(index, 1);
    saveTasks();
    render();
    toast('Task deleted', 'danger', 'UNDO', undoDelete);
    window.setTimeout(() => { state.deleted = null; }, 5600);
  }

  function undoDelete() {
    if (!state.deleted) return;
    state.tasks.splice(Math.min(state.deleted.index, state.tasks.length), 0, state.deleted.task);
    state.deleted = null;
    saveTasks();
    render();
    toast('Task restored', 'success');
  }

  function nextOccurrence(task) {
    if (!task.due || task.recurrence === 'none') return '';
    if (task.recurrence === 'daily') return addDays(task.due, 1);
    if (task.recurrence === 'weekly') return addDays(task.due, 7);
    return addMonths(task.due, 1);
  }

  function toggleComplete(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    const completed = !task.completed;
    const dates = Array.isArray(task.completionDates) ? task.completionDates.slice() : [];
    if (completed) {
      if (!dates.includes(todayISO())) dates.push(todayISO());
      updateTask(id, { completed: true, completedAt: Date.now(), completionDates: dates });
      if (task.recurrence !== 'none' && task.due) {
        const due = nextOccurrence(task);
        addTask({ ...task, title: task.title, due, completed: false, completedAt: null, completionDates: [] }, true);
        toast('Task completed · next occurrence scheduled', 'success');
      } else {
        toast('Task completed', 'success');
      }
    } else {
      updateTask(id, { completed: false, completedAt: null, completionDates: dates.filter((date) => date !== todayISO()) });
      toast('Task moved back to active', 'success');
    }
  }

  // ---------- Filtering ----------
  function searchText(task) {
    return [task.title, task.description, task.category, ...(task.tags || [])].join(' ').toLowerCase();
  }

  function getVisibleTasks() {
    const query = state.search.trim().toLowerCase();
    const visible = state.tasks.filter((task) => {
      if (state.filter === 'active' && task.completed) return false;
      if (state.filter === 'completed' && !task.completed) return false;
      if (state.filter === 'favorites' && !task.favorite) return false;
      if (state.filter === 'high' && !['high', 'urgent'].includes(task.priority)) return false;
      if (state.filter === 'overdue' && !isOverdue(task)) return false;
      if (state.categoryFilter !== 'all' && task.category !== state.categoryFilter) return false;
      if (state.priorityFilter !== 'all' && task.priority !== state.priorityFilter) return false;
      if (query && !searchText(task).includes(query)) return false;
      return true;
    });
    visible.sort((a, b) => {
      if (state.sort === 'oldest') return a.createdAt - b.createdAt;
      if (state.sort === 'priority') return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) || (b.createdAt - a.createdAt);
      if (state.sort === 'due') return (a.due || '9999') .localeCompare(b.due || '9999') || (b.createdAt - a.createdAt);
      if (state.sort === 'title') return a.title.localeCompare(b.title);
      return b.createdAt - a.createdAt;
    });
    return visible;
  }

  // ---------- Rendering ----------
  function renderNavCounts() {
    const today = todayISO();
    const total = state.tasks.length;
    const completed = state.tasks.filter((task) => task.completed).length;
    const pending = total - completed;
    const todayCount = state.tasks.filter((task) => !task.completed && task.due === today).length;
    const favorites = state.tasks.filter((task) => task.favorite && !task.completed).length;
    const high = state.tasks.filter((task) => ['high', 'urgent'].includes(task.priority) && !task.completed).length;
    const overdue = state.tasks.filter(isOverdue).length;
    el.count_all.textContent = total; el.count_active.textContent = pending; el.count_completed.textContent = completed;
    el.count_today.textContent = todayCount; el.count_favorites.textContent = favorites; el.count_high.textContent = high; el.count_overdue.textContent = overdue;
  }

  function renderStats() {
    const total = state.tasks.length;
    const completed = state.tasks.filter((task) => task.completed).length;
    const pending = total - completed;
    const overdue = state.tasks.filter(isOverdue).length;
    const rate = total ? Math.round((completed / total) * 100) : 0;
    const streak = calculateStreak();
    el.stat_total.textContent = total;
    el.stat_completed.textContent = completed;
    el.stat_pending.textContent = pending;
    el.stat_overdue.textContent = overdue;
    el.stat_rate.textContent = `${rate}%`;
    el.progress_percent.textContent = `${rate}%`;
    el.stat_streak.textContent = `${streak.current} day${streak.current === 1 ? '' : 's'}`;
    el.stat_best_streak.textContent = `Best: ${streak.best} day${streak.best === 1 ? '' : 's'}`;
    el.stat_completed_trend.textContent = `${rate}%`;
    el.stat_overdue_trend.textContent = overdue ? 'Review' : 'Clear';
    setRing(el.rate_ring, rate);
  }

  function setRing(node, percentage) {
    if (!node) return;
    node.style.background = `conic-gradient(var(--accent) ${percentage * 3.6}deg, var(--surface-soft) 0deg)`;
  }

  function renderCategories() {
    const counts = state.settings.categories.map((category) => ({ category, count: state.tasks.filter((task) => task.category === category).length }));
    el.category_list.innerHTML = counts.map(({ category, count }) => `<button class="category-link" data-view="tasks" data-filter="all" data-category="${escapeHtml(category)}"><span class="category-dot"></span><span>${escapeHtml(getCategoryLabel(category))}</span><span class="category-count">${count}</span></button>`).join('');
    const options = state.settings.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(getCategoryLabel(category))}</option>`).join('');
    const currentTaskCategory = el.task_category.value;
    const currentSettingCategory = el.setting_category.value;
    el.task_category.innerHTML = options;
    el.setting_category.innerHTML = options;
    el.filter_category.innerHTML = `<option value="all">All categories</option>${options}`;
    el.task_category.value = state.settings.categories.includes(currentTaskCategory) ? currentTaskCategory : state.settings.defaultCategory;
    el.setting_category.value = state.settings.categories.includes(currentSettingCategory) ? currentSettingCategory : state.settings.defaultCategory;
    el.filter_category.value = state.categoryFilter;
  }

  function renderDashboard() {
    const today = todayISO();
    const weekStart = toISODate(startOfWeek(new Date()));
    const completedToday = state.tasks.filter((task) => task.completed && task.completedAt && toISODate(task.completedAt) === today).length;
    const weekCompleted = state.tasks.filter((task) => task.completed && task.completedAt && toISODate(task.completedAt) >= weekStart).length;
    const total = state.tasks.length;
    const completed = state.tasks.filter((task) => task.completed).length;
    const rate = total ? Math.round(completed / total * 100) : 0;
    setRing(el.large_ring, rate);
    el.pulse_percent.textContent = `${rate}%`;
    el.today_completed.textContent = completedToday;
    el.week_completed.textContent = weekCompleted;
    el.pulse_title.textContent = completed ? (rate >= 75 ? 'You are in the zone' : 'Keep the momentum') : 'Build your first win';
    el.pulse_description.textContent = completed ? `${completed} task${completed === 1 ? '' : 's'} completed across your workspace. Every finish counts.` : 'Complete a task to start building a visible rhythm.';
    renderWeekBars(); renderBarChart(el.priority_chart, ['urgent', 'high', 'medium', 'low'], (priority) => state.tasks.filter((task) => task.priority === priority).length, priorityLabel);
    renderBarChart(el.category_chart, state.settings.categories.slice(0, 4), (category) => state.tasks.filter((task) => task.category === category).length, getCategoryLabel);
    const focus = state.tasks.filter((task) => !task.completed && ((task.due && task.due <= today) || task.favorite)).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 4);
    el.dashboard_today_list.innerHTML = focus.length ? focus.map(compactTaskTemplate).join('') : '<p class="compact-empty">No urgent focus items. Enjoy the breathing room.</p>';
  }

  function renderWeekBars() {
    const today = new Date();
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(today); date.setDate(today.getDate() - i);
      const iso = toISODate(date);
      const count = state.tasks.filter((task) => task.completed && task.completedAt && toISODate(task.completedAt) === iso).length;
      days.push({ iso, label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), count, today: i === 0 });
    }
    const max = Math.max(1, ...days.map((day) => day.count));
    el.week_bars.innerHTML = days.map((day) => `<div class="week-bar-wrap ${day.today ? 'today' : ''}"><div class="week-bar-track" title="${day.count} completed"><div class="week-bar-fill" style="height:${Math.max(5, day.count / max * 100)}%"></div></div><span class="week-bar-label">${day.label}</span></div>`).join('');
  }

  function renderBarChart(node, items, countFn, labelFn) {
    const max = Math.max(1, ...items.map(countFn));
    node.innerHTML = items.map((item) => { const count = countFn(item); return `<div class="chart-row"><span class="chart-label">${escapeHtml(labelFn(item))}</span><div class="chart-track"><div class="chart-fill" style="width:${count / max * 100}%"></div></div><span class="chart-number">${count}</span></div>`; }).join('');
  }

  function compactTaskTemplate(task) {
    return `<div class="compact-task" data-id="${escapeHtml(task.id)}"><button class="compact-check ${task.completed ? 'checked' : ''}" data-action="toggle" aria-label="${task.completed ? 'Mark active' : 'Complete'} ${escapeHtml(task.title)}">${task.completed ? '✓' : ''}</button><div class="compact-task-content"><span class="compact-task-title ${task.completed ? 'completed' : ''}">${escapeHtml(task.title)}</span><span class="compact-task-date">${task.due ? (isOverdue(task) ? 'Overdue' : (isToday(task.due) ? 'Today' : formatDate(task.due))) : 'No due date'}</span></div><button class="star-btn ${task.favorite ? 'favorited' : ''}" data-action="favorite" aria-label="Toggle favorite">★</button></div>`;
  }

  function taskTemplate(task) {
    const dueLabel = task.due ? formatDate(task.due, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const dueClass = isOverdue(task) ? 'overdue' : (isToday(task.due) ? 'today' : '');
    const tags = (task.tags || []).map((tag) => `<span class="tag-pill">#${escapeHtml(tag)}</span>`).join('');
    return `<article class="task-item ${task.completed ? 'completed' : ''}" data-id="${escapeHtml(task.id)}"><button class="check ${task.completed ? 'checked' : ''}" data-action="toggle" aria-label="${task.completed ? 'Mark task active' : 'Mark task complete'}">${task.completed ? '✓' : ''}</button><div class="task-main"><div class="task-title-line"><span class="task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span><button class="star-btn ${task.favorite ? 'favorited' : ''}" data-action="favorite" aria-label="${task.favorite ? 'Remove from favorites' : 'Add to favorites'}">★</button></div>${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ''}<div class="task-meta"><span class="meta-tag prio-${task.priority}">${priorityLabel(task.priority)}</span><span class="meta-tag">${escapeHtml(getCategoryLabel(task.category))}</span>${dueLabel ? `<span class="meta-due ${dueClass}">▣ ${dueLabel}${isOverdue(task) ? ' · overdue' : (isToday(task.due) ? ' · today' : '')}</span>` : ''}${task.recurrence !== 'none' ? `<span class="meta-repeat">↻ ${task.recurrence}</span>` : ''}${tags}</div></div><div class="task-actions"><button class="act-btn" data-action="edit" title="Edit task" aria-label="Edit task">✎</button><button class="act-btn delete" data-action="delete" title="Delete task" aria-label="Delete task">⌫</button></div></article>`;
  }

  function renderTaskList(node, tasks, emptyText) {
    node.innerHTML = tasks.length ? tasks.map(taskTemplate).join('') : `<div class="compact-empty">${emptyText}</div>`;
  }

  function renderTaskView() {
    const visible = getVisibleTasks();
    el.task_list.innerHTML = visible.map(taskTemplate).join('');
    if (visible.length) { el.empty_state.classList.add('hidden'); return; }
    el.empty_state.classList.remove('hidden');
    const hasFilters = state.search || state.filter !== 'all' || state.categoryFilter !== 'all' || state.priorityFilter !== 'all';
    el.empty_icon.textContent = hasFilters ? '⌕' : '✦';
    el.empty_title.textContent = hasFilters ? 'No matching tasks' : 'Your plan starts here';
    el.empty_copy.textContent = hasFilters ? 'Try adjusting your search or filters.' : 'Create a task to make your plan visible.';
    el.empty_action.textContent = hasFilters ? 'Clear filters' : 'Create a task';
    el.empty_action.dataset.clearEmpty = hasFilters ? 'true' : '';
  }

  function renderToday() {
    const today = todayISO();
    const overdue = state.tasks.filter(isOverdue).sort((a, b) => a.due.localeCompare(b.due));
    const dueToday = state.tasks.filter((task) => task.due === today).sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt);
    const upcoming = state.tasks.filter(isUpcoming).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 10);
    el.today_overdue_count.textContent = overdue.length; el.today_due_count.textContent = dueToday.length; el.today_upcoming_count.textContent = upcoming.length;
    renderTaskList(el.today_overdue_list, overdue, 'No overdue tasks. Everything is under control.');
    renderTaskList(el.today_due_list, dueToday, dueToday.length ? '' : 'No tasks due today. You have some breathing room.');
    renderTaskList(el.today_upcoming_list, upcoming, 'No upcoming tasks scheduled yet.');
    const doneToday = dueToday.filter((task) => task.completed).length;
    const todayTotal = dueToday.length;
    el.today_completion_heading.textContent = `${doneToday} task${doneToday === 1 ? '' : 's'} completed today`;
    el.today_progress_fill.style.width = `${todayTotal ? doneToday / todayTotal * 100 : 0}%`;
    el.today_progress_copy.textContent = todayTotal ? `${doneToday} of ${todayTotal} due today finished.` : 'No tasks completed today yet.';
    el.today_subhead.textContent = `${formatLongDate(today)} · ${todayTotal} task${todayTotal === 1 ? '' : 's'} due today`;
  }

  function renderCalendar() {
    const month = state.calendarMonth;
    el.calendar_month.textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start); date.setDate(start.getDate() + i);
      const iso = toISODate(date);
      const tasks = state.tasks.filter((task) => task.due === iso);
      const taskChips = tasks.slice(0, 2).map((task) => `<span class="cell-task ${task.completed ? 'done' : ''}">${escapeHtml(task.title)}</span>`).join('');
      cells.push(`<button class="calendar-cell ${date.getMonth() !== month.getMonth() ? 'other-month' : ''} ${isToday(iso) ? 'today' : ''} ${iso === state.selectedDate ? 'selected' : ''}" data-calendar-date="${iso}"><span class="day-number">${date.getDate()}</span><span class="cell-tasks">${taskChips}${tasks.length > 2 ? `<span class="cell-more">+${tasks.length - 2} more</span>` : ''}</span></button>`);
    }
    el.calendar_grid.innerHTML = cells.join('');
    renderSelectedDay();
  }

  function renderSelectedDay() {
    el.selected_date_label.textContent = isToday(state.selectedDate) ? 'Today' : formatDate(state.selectedDate, { weekday: 'short', month: 'short', day: 'numeric' });
    const tasks = state.tasks.filter((task) => task.due === state.selectedDate).sort((a, b) => Number(a.completed) - Number(b.completed));
    el.selected_day_list.innerHTML = tasks.length ? tasks.map(compactTaskTemplate).join('') : '<p class="compact-empty">No tasks assigned to this date.</p>';
  }

  function renderSettings() {
    el.setting_theme.value = state.settings.theme;
    el.setting_priority.value = state.settings.defaultPriority;
    el.setting_category.value = state.settings.defaultCategory;
    el.setting_pomodoro.value = String(state.settings.pomodoroMinutes);
  }

  function render() {
    renderNavCounts(); renderStats(); renderCategories(); renderDashboard(); renderTaskView(); renderToday(); renderCalendar(); renderSettings(); syncNav();
  }

  // ---------- Streaks ----------
  function completionDateSet() {
    const dates = new Set();
    state.tasks.forEach((task) => {
      (task.completionDates || []).forEach((date) => dates.add(date));
      if (task.completed && task.completedAt) dates.add(toISODate(task.completedAt));
    });
    return dates;
  }

  function calculateStreak() {
    const dates = completionDateSet();
    let current = 0; let cursor = todayISO();
    while (dates.has(cursor)) { current += 1; cursor = addDays(cursor, -1); }
    const sorted = Array.from(dates).sort();
    let best = 0; let run = 0; let previous = '';
    sorted.forEach((date) => { if (previous && addDays(previous, 1) === date) run += 1; else run = 1; previous = date; best = Math.max(best, run); });
    return { current, best };
  }

  // ---------- Navigation and modal helpers ----------
  function syncNav() {
    document.querySelectorAll('[data-view]').forEach((button) => {
      const isActive = button.dataset.view === state.view && (!button.dataset.filter || button.dataset.filter === state.filter) && (!button.dataset.category || button.dataset.category === state.categoryFilter);
      button.classList.toggle('active', isActive);
    });
    const labels = { overview: 'Overview', today: 'Today', tasks: state.filter === 'all' ? 'All tasks' : `${state.filter.charAt(0).toUpperCase() + state.filter.slice(1)} tasks`, calendar: 'Calendar', settings: 'Settings' };
    el.breadcrumb_current.textContent = labels[state.view] || 'Overview';
  }

  function setView(view, filter) {
    state.view = view;
    if (view === 'tasks' && filter) state.filter = filter;
    document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active-view', section.dataset.page === view));
    syncNav();
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openModal(modal) { modal.classList.remove('hidden'); document.body.classList.add('modal-open'); }
  function closeModal(modal) { modal.classList.add('hidden'); document.body.classList.remove('modal-open'); }
  function closeAllModals() { document.querySelectorAll('.modal-backdrop').forEach((modal) => modal.classList.add('hidden')); document.body.classList.remove('modal-open'); state.pendingDeleteId = null; }

  function populateTaskForm(task) {
    renderCategories();
    el.task_input.value = task?.title || '';
    el.task_description.value = task?.description || '';
    el.task_priority.value = task?.priority || state.settings.defaultPriority;
    el.task_category.value = task?.category || state.settings.defaultCategory;
    el.task_due.value = task?.due || (state.selectedDate !== todayISO() && state.view === 'calendar' ? state.selectedDate : '');
    el.task_recurrence.value = task?.recurrence || 'none';
    el.task_tags.value = task?.tags?.join(', ') || '';
    el.task_favorite.checked = Boolean(task?.favorite);
    el.form_error.textContent = '';
  }

  function openTaskModal(id) {
    state.editingId = id || null;
    const task = id ? state.tasks.find((item) => item.id === id) : null;
    populateTaskForm(task);
    el.task_modal_eyebrow.textContent = task ? 'Edit task' : 'Create a task';
    el.task_modal_title.textContent = task ? 'Refine your plan' : 'What needs your attention?';
    el.task_submit.textContent = task ? 'Save changes' : 'Create task';
    openModal(el.task_modal);
    window.setTimeout(() => el.task_input.focus(), 40);
  }

  function handleTaskSubmit(event) {
    event.preventDefault();
    const data = taskPayloadFromForm();
    if (!data.title) { el.form_error.textContent = 'Give this task a short, clear title.'; el.task_input.focus(); return; }
    if (state.editingId) {
      updateTask(state.editingId, data);
      toast('Task updated', 'success');
    } else {
      addTask(data);
    }
    closeModal(el.task_modal); state.editingId = null;
  }

  function openConfirm(id) { state.pendingDeleteId = id; openModal(el.confirm_modal); }
  function closeConfirm() { state.pendingDeleteId = null; closeModal(el.confirm_modal); }

  function closeSidebar() { el.sidebar.classList.remove('open'); el.sidebar_scrim.classList.remove('visible'); }
  function toggleSidebar() { el.sidebar.classList.toggle('open'); el.sidebar_scrim.classList.toggle('visible'); }

  // ---------- Theme and settings ----------
  function resolvedTheme(mode) {
    return mode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
  }
  function applyTheme(mode) {
    document.body.classList.toggle('dark', resolvedTheme(mode) === 'dark');
    el.theme_toggle.textContent = resolvedTheme(mode) === 'dark' ? '☀' : '☾';
    el.theme_toggle.title = `Theme: ${mode}`;
  }
  function setTheme(mode) { state.settings.theme = mode; saveSettings(); applyTheme(mode); renderSettings(); }
  function toggleTheme() { setTheme(resolvedTheme(state.settings.theme) === 'dark' ? 'light' : 'dark'); }

  // ---------- Pomodoro ----------
  function setPomodoroMode(mode) {
    state.pomodoro.mode = mode;
    state.pomodoro.total = (mode === 'focus' ? state.settings.pomodoroMinutes : 5) * 60;
    state.pomodoro.remaining = state.pomodoro.total;
    renderPomodoro();
  }
  function renderPomodoro() {
    const minutes = Math.floor(state.pomodoro.remaining / 60).toString().padStart(2, '0');
    const seconds = (state.pomodoro.remaining % 60).toString().padStart(2, '0');
    el.pomodoro_time.textContent = `${minutes}:${seconds}`;
    el.pomodoro_mode.textContent = state.pomodoro.mode === 'focus' ? 'Focus' : 'Break';
    el.pomodoro_start.textContent = state.pomodoro.running ? 'Pause' : (state.pomodoro.remaining === state.pomodoro.total ? 'Start focus' : 'Resume');
    const progress = state.pomodoro.total ? (state.pomodoro.total - state.pomodoro.remaining) / state.pomodoro.total : 0;
    el.pomodoro_ring.style.background = `conic-gradient(var(--accent) ${Math.max(0, progress * 360)}deg, var(--surface-soft) 0deg)`;
  }
  function togglePomodoro() {
    state.pomodoro.running = !state.pomodoro.running;
    if (state.pomodoro.running) {
      state.pomodoro.interval = window.setInterval(() => {
        if (state.pomodoro.remaining > 0) state.pomodoro.remaining -= 1;
        else { state.pomodoro.running = false; window.clearInterval(state.pomodoro.interval); toast(`${state.pomodoro.mode === 'focus' ? 'Focus' : 'Break'} session complete`, 'success'); setPomodoroMode(state.pomodoro.mode === 'focus' ? 'break' : 'focus'); return; }
        renderPomodoro();
      }, 1000);
    } else { window.clearInterval(state.pomodoro.interval); }
    renderPomodoro();
  }
  function resetPomodoro() { state.pomodoro.running = false; window.clearInterval(state.pomodoro.interval); setPomodoroMode(state.pomodoro.mode); }

  // ---------- Import and export ----------
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  function exportJson() { downloadFile(`taskflow-backup-${todayISO()}.json`, JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tasks: state.tasks }, null, 2), 'application/json'); toast('JSON backup exported', 'success'); }
  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function exportCsv() {
    const headers = ['title', 'description', 'priority', 'category', 'tags', 'due', 'favorite', 'recurrence', 'completed', 'createdAt'];
    const lines = [headers.join(',')].concat(state.tasks.map((task) => [task.title, task.description, task.priority, task.category, (task.tags || []).join('|'), task.due, task.favorite, task.recurrence, task.completed, new Date(task.createdAt).toISOString()].map(csvCell).join(',')));
    downloadFile(`taskflow-tasks-${todayISO()}.csv`, lines.join('\n'), 'text/csv;charset=utf-8'); toast('CSV export downloaded', 'success');
  }
  function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const source = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null;
        if (!source) throw new Error('Expected an array of tasks.');
        const imported = source.map(normalizeTask).filter(Boolean);
        if (!imported.length) throw new Error('No valid tasks found.');
        const existingIds = new Set(state.tasks.map((task) => task.id));
        imported.forEach((task) => { if (existingIds.has(task.id)) task.id = uid(); });
        state.tasks = [...imported, ...state.tasks]; saveTasks(); render(); toast(`${imported.length} task${imported.length === 1 ? '' : 's'} imported`, 'success');
      } catch (error) { toast(`Import failed: ${error.message}`, 'danger'); }
    };
    reader.readAsText(file);
  }

  // ---------- AI assistant demo boundary ----------
  function parseAssistantSuggestions(text) {
    const parts = text.split(/\n|,|;|\s+and\s+|\s+then\s+/i).map((part) => part.trim()).filter((part) => part.length > 2);
    return Array.from(new Set(parts)).slice(0, 8).map((part) => {
      const lower = part.toLowerCase();
      return { title: part.replace(/^(i have|need to|remember to|also)\s+/i, '').trim(), priority: /urgent|asap|deadline|important/.test(lower) ? 'high' : 'medium', due: /today|tonight|this evening/.test(lower) ? todayISO() : '' };
    }).filter((item) => item.title.length > 2);
  }
  function handleAssistantSubmit(event) {
    event.preventDefault();
    const suggestions = parseAssistantSuggestions(el.assistant_input.value);
    if (!suggestions.length) { toast('Add a few things you want to remember.', 'warn'); return; }
    el.assistant_results.classList.remove('hidden');
    el.assistant_results.innerHTML = `<h3>Local suggestions</h3>${suggestions.map((item, index) => `<div class="suggestion"><span class="suggestion-text">${escapeHtml(item.title)}</span><span class="meta-tag prio-${item.priority}">${priorityLabel(item.priority)}</span><button class="btn btn-secondary" data-suggest-add="${index}">Add</button></div>`).join('')}`;
    el.assistant_results._suggestions = suggestions;
  }

  // ---------- Event binding ----------
  function handleGlobalClick(event) {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { setView(viewButton.dataset.view, viewButton.dataset.filter); if (viewButton.dataset.category) { state.categoryFilter = viewButton.dataset.category; el.filter_category.value = state.categoryFilter; } render(); return; }
    const openButton = event.target.closest('[data-open-task]');
    if (openButton) { openTaskModal(); return; }
    const clearButton = event.target.closest('[data-clear-empty]');
    if (clearButton && clearButton.dataset.clearEmpty === 'true') { state.search = ''; state.filter = 'all'; state.categoryFilter = 'all'; state.priorityFilter = 'all'; el.search.value = ''; render(); return; }
    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) { closeAllModals(); return; }
    const calendarCell = event.target.closest('[data-calendar-date]');
    if (calendarCell) { state.selectedDate = calendarCell.dataset.calendarDate; renderCalendar(); return; }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const item = actionButton.closest('[data-id]'); if (!item) return;
      const id = item.dataset.id; const action = actionButton.dataset.action;
      if (action === 'toggle') toggleComplete(id);
      else if (action === 'favorite') { const task = state.tasks.find((taskItem) => taskItem.id === id); if (task) { updateTask(id, { favorite: !task.favorite }); toast(task.favorite ? 'Removed from favorites' : 'Added to favorites', 'success'); } }
      else if (action === 'edit') openTaskModal(id);
      else if (action === 'delete') openConfirm(id);
      return;
    }
    const suggestion = event.target.closest('[data-suggest-add]');
    if (suggestion) { const suggestions = el.assistant_results._suggestions || []; const item = suggestions[Number(suggestion.dataset.suggestAdd)]; if (item) { addTask(item); suggestion.textContent = 'Added'; suggestion.disabled = true; } }
  }

  function bindEvents() {
    el.task_form.addEventListener('submit', handleTaskSubmit);
    el.task_input.addEventListener('input', () => { el.form_error.textContent = ''; });
    el.menu_btn.addEventListener('click', toggleSidebar); el.sidebar_scrim.addEventListener('click', closeSidebar);
    el.theme_toggle.addEventListener('click', toggleTheme);
    el.search.addEventListener('input', (event) => { state.search = event.target.value; renderTaskView(); });
    el.sort.addEventListener('change', (event) => { state.sort = event.target.value; renderTaskView(); });
    el.filter_category.addEventListener('change', (event) => { state.categoryFilter = event.target.value; renderTaskView(); });
    el.filter_priority.addEventListener('change', (event) => { state.priorityFilter = event.target.value; renderTaskView(); });
    el.clear_filters.addEventListener('click', () => { state.search = ''; state.filter = 'all'; state.categoryFilter = 'all'; state.priorityFilter = 'all'; el.search.value = ''; el.filter_category.value = 'all'; el.filter_priority.value = 'all'; render(); });
    el.confirm_ok.addEventListener('click', () => { if (state.pendingDeleteId) deleteTask(state.pendingDeleteId); closeConfirm(); });
    el.confirm_cancel.addEventListener('click', closeConfirm);
    el.add_category_btn.addEventListener('click', () => { const name = window.prompt('Category name'); const value = String(name || '').trim().toLowerCase().replace(/\s+/g, '-'); if (value && !state.settings.categories.includes(value)) { state.settings.categories.push(value); saveSettings(); render(); toast('Category added', 'success'); } });
    el.calendar_prev.addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); renderCalendar(); });
    el.calendar_next.addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); renderCalendar(); });
    el.calendar_today.addEventListener('click', () => { const now = new Date(); state.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1); state.selectedDate = todayISO(); renderCalendar(); });
    el.calendar_add.addEventListener('click', () => openTaskModal());
    el.today_focus_btn.addEventListener('click', () => { setView('overview'); window.setTimeout(() => el.pomodoro_start.click(), 100); });
    el.pomodoro_start.addEventListener('click', togglePomodoro); el.pomodoro_reset.addEventListener('click', resetPomodoro); el.pomodoro_switch.addEventListener('click', () => { state.pomodoro.running = false; window.clearInterval(state.pomodoro.interval); setPomodoroMode(state.pomodoro.mode === 'focus' ? 'break' : 'focus'); });
    el.setting_theme.addEventListener('change', (event) => setTheme(event.target.value));
    el.setting_priority.addEventListener('change', (event) => { state.settings.defaultPriority = event.target.value; saveSettings(); });
    el.setting_category.addEventListener('change', (event) => { state.settings.defaultCategory = event.target.value; saveSettings(); });
    el.setting_pomodoro.addEventListener('change', (event) => { state.settings.pomodoroMinutes = Number(event.target.value); saveSettings(); resetPomodoro(); });
    el.export_json.addEventListener('click', exportJson); el.export_csv.addEventListener('click', exportCsv); el.import_json.addEventListener('click', () => el.import_file.click()); el.import_file.addEventListener('change', (event) => { if (event.target.files[0]) importJsonFile(event.target.files[0]); event.target.value = ''; });
    el.clear_data.addEventListener('click', () => { if (state.tasks.length && window.confirm('Clear all TaskFlow tasks? This cannot be undone.')) { state.tasks = []; saveTasks(); render(); toast('All tasks cleared', 'danger'); } });
    el.assistant_btn.addEventListener('click', () => openModal(el.assistant_modal)); el.settings_assistant.addEventListener('click', () => openModal(el.assistant_modal)); el.assistant_form.addEventListener('submit', handleAssistantSubmit);
    el.shortcuts_btn.addEventListener('click', () => openModal(el.shortcuts_modal));
    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeAllModals(); closeSidebar(); return; }
      if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); openTaskModal(); }
      if (event.key === '/') { event.preventDefault(); setView('tasks', state.filter); window.setTimeout(() => el.search.focus(), 50); }
      if (event.key === '?') { event.preventDefault(); openModal(el.shortcuts_modal); }
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.settings.theme === 'system') applyTheme('system'); });
  }

  function updateHeader() {
    const now = new Date(); const hour = now.getHours();
    el.greeting.innerHTML = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}<span class="wave">✦</span>`;
    el.date_label.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function init() {
    cacheDom(); loadData(); applyTheme(state.settings.theme); bindEvents(); updateHeader(); setPomodoroMode('focus'); render();
    window.setInterval(updateHeader, 30000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
