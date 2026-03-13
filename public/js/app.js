const page = document.body.dataset.page;

const state = {
  user: null,
  cards: [],
  rules: [],
  admin: {
    stats: null,
    users: [],
    cards: [],
    logs: []
  },
  dashboard: {
    search: '',
    category: 'all',
    sort: 'newest'
  }
};

function $(selector) {
  return document.querySelector(selector);
}

function showToast(message, type = 'success') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.className = 'toast';
  }, 2600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({ success: false, message: 'حدث خطأ غير متوقع' }));
  if (!response.ok || !data.success) {
    const error = new Error(data.message || 'فشل الطلب');
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function activateCursor() {
  const dot = $('.cursor-dot');
  const ring = $('.cursor-ring');
  if (!dot || !ring) return;

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX;
  let ringY = mouseY;

  window.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    dot.style.left = `${mouseX}px`;
    dot.style.top = `${mouseY}px`;
  });

  const hoverTargets = 'a, button, input, select, textarea, .steam-card, .list-item';
  document.addEventListener('mouseover', (event) => {
    if (event.target.closest(hoverTargets)) {
      document.body.classList.add('cursor-hover');
    }
  });

  document.addEventListener('mouseout', (event) => {
    if (event.target.closest(hoverTargets)) {
      document.body.classList.remove('cursor-hover');
    }
  });

  function animateRing() {
    ringX += (mouseX - ringX) * 0.15;
    ringY += (mouseY - ringY) * 0.15;
    ring.style.left = `${ringX}px`;
    ring.style.top = `${ringY}px`;
    requestAnimationFrame(animateRing);
  }
  animateRing();
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString('ar-SA');
  } catch {
    return value;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function getRoleLabel(role) {
  return role === 'admin' ? 'أدمن' : 'مستخدم';
}

function getInitials(name = '') {
  const cleaned = String(name).trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() : 'S';
}

function toDatetimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderAvatarMarkup(user, className = 'user-avatar-sm') {
  const hasImage = Boolean(user?.avatar);
  const ring = escapeHtml(user?.avatarRingColor || '#1cff8a');
  const safeUrl = hasImage ? escapeHtml(String(user.avatar)) : '';
  const style = hasImage
    ? `style="background-image:url('${safeUrl}'); border-color:${ring}"`
    : `style="border-color:${ring}"`;
  const text = hasImage ? '' : escapeHtml(getInitials(user?.name || 'S'));
  return `<span class="${escapeHtml(className)} ${hasImage ? 'has-image' : ''}" ${style}>${text}</span>`;
}

function renderProfileWidget() {
  const nameNode = $('#profileName');
  const roleNode = $('#profileRole');
  const avatarNode = $('#profileAvatar');
  if (!nameNode || !roleNode || !avatarNode || !state.user) return;

  nameNode.textContent = state.user.name || 'مستخدم';
  roleNode.textContent = getRoleLabel(state.user.role);
  avatarNode.textContent = getInitials(state.user.name);
  if (state.user.avatar) {
    avatarNode.style.backgroundImage = `url('${String(state.user.avatar).replace(/'/g, "\'")}')`;
    avatarNode.style.color = 'transparent';
  } else {
    avatarNode.style.backgroundImage = 'none';
    avatarNode.style.color = '#f0fff7';
  }
}

function attachProfileButton() {
  const btn = $('#profileBtn');
  if (!btn) return;
  btn.onclick = () => {
    if (!state.user) return;
    createFormModal({
      title: 'تعديل الملف الشخصي',
      subtitle: 'يمكنك تعديل الاسم الظاهر والصورة الشخصية العادية أو المتحركة GIF وإضافة حالة قصيرة.',
      submitText: 'حفظ الملف الشخصي',
      fields: [
        { name: 'name', label: 'الاسم الظاهر', value: state.user.name || '', placeholder: 'اسمك الظاهر داخل الموقع' },
        { name: 'avatar', label: 'رابط الصورة الشخصية أو GIF', value: state.user.avatar || '', placeholder: 'https://example.com/avatar.gif', full: true },
        { name: 'statusText', label: 'حالة قصيرة', value: state.user.statusText || '', placeholder: 'مثال: VIP' },
        { name: 'avatarRingColor', label: 'لون دائرة الصورة', value: state.user.avatarRingColor || '#1cff8a', placeholder: '#1cff8a' }
      ],
      onSubmit: async (values) => {
        const result = await api('/api/profile', {
          method: 'PUT',
          body: JSON.stringify(values)
        });
        state.user = result.data.user;
        applySharedUi();
        showToast('تم تحديث الملف الشخصي', 'success');
      }
    });
  };
}

async function closeAllCustomDropdowns(exceptId = null) {
  document.querySelectorAll('.custom-select').forEach((dropdown) => {
    if (!exceptId || dropdown.id !== exceptId) {
      dropdown.classList.remove('open');
    }
  });
}

function createCustomDropdown({ mountSelector, selectSelector, options, value, onChange }) {
  const mount = $(mountSelector);
  const nativeSelect = $(selectSelector);
  if (!mount || !nativeSelect) return;

  const selectedOption = options.find((option) => option.value === value) || options[0];

  nativeSelect.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join('');
  nativeSelect.value = selectedOption.value;

  mount.innerHTML = `
    <div class="custom-select" id="${escapeHtml(nativeSelect.id)}-custom">
      <button type="button" class="custom-select-trigger">
        <span class="custom-select-value">${escapeHtml(selectedOption.label)}</span>
        <span class="custom-select-arrow"></span>
      </button>
      <div class="custom-select-menu">
        ${options.map((option) => `
          <button
            type="button"
            class="custom-select-option ${option.value === selectedOption.value ? 'active' : ''}"
            data-value="${escapeHtml(option.value)}"
          >${escapeHtml(option.label)}</button>
        `).join('')}
      </div>
    </div>
  `;

  const dropdown = mount.querySelector('.custom-select');
  const trigger = mount.querySelector('.custom-select-trigger');
  const valueNode = mount.querySelector('.custom-select-value');
  const optionNodes = mount.querySelectorAll('.custom-select-option');

  trigger.addEventListener('click', () => {
    const isOpen = dropdown.classList.contains('open');
    closeAllCustomDropdowns(dropdown.id);
    dropdown.classList.toggle('open', !isOpen);
  });

  optionNodes.forEach((node) => {
    node.addEventListener('click', () => {
      const nextValue = node.dataset.value;
      const nextOption = options.find((option) => option.value === nextValue);
      if (!nextOption) return;

      nativeSelect.value = nextValue;
      valueNode.textContent = nextOption.label;
      optionNodes.forEach((optionNode) => optionNode.classList.toggle('active', optionNode === node));
      dropdown.classList.remove('open');
      onChange?.(nextValue);
    });
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.custom-select')) {
    closeAllCustomDropdowns();
  }
});

async function getMe(required = true) {
  try {
    const result = await api('/api/auth/me');
    state.user = result.data.user;
    applySharedUi();
    return state.user;
  } catch (error) {
    state.user = null;
    if (required) {
      window.location.href = '/';
    }
    return null;
  }
}

function applySharedUi() {
  document.body.classList.add('has-fixed-topbar');
  const adminLink = $('#adminLink');
  if (adminLink) {
    adminLink.classList.toggle('hidden', state.user?.role !== 'admin');
  }
  const welcomeText = $('#welcomeText');
  if (welcomeText && state.user) {
    welcomeText.textContent = `مرحبًا ${state.user.name} — صلاحيتك الحالية: ${getRoleLabel(state.user.role)}`;
  }
  renderProfileWidget();
  attachProfileButton();
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {}
  window.location.href = '/';
}

function attachLogout() {
  const button = $('#logoutBtn');
  if (button) {
    button.addEventListener('click', () => {
      createModal({
        title: 'تأكيد تسجيل الخروج',
        text: 'هل أنت متأكد من أنك تريد تسجيل الخروج من الحساب الحالي؟',
        confirmText: 'تسجيل الخروج',
        cancelText: 'بقاء',
        onConfirm: async () => {
          await logout();
        }
      });
    });
  }
}

function showLoading(target, text = 'جارٍ التحميل...') {
  if (!target) return;
  target.innerHTML = `<div class="glass inline-loader"><span class="loader"></span><span>${escapeHtml(text)}</span></div>`;
}

async function initLogin() {
  const form = $('#loginForm');
  const emailInput = $('#email');
  const passwordInput = $('#password');
  const toggle = $('#toggleLoginPassword');

  const existing = await getMe(false);
  if (existing) {
    window.location.href = '/dashboard.html';
    return;
  }

  toggle?.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
    toggle.textContent = type === 'password' ? 'إظهار' : 'إخفاء';
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'جارٍ التحقق...';
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: emailInput.value,
          password: passwordInput.value
        })
      });
      showToast(result.message, 'success');
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 700);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'الدخول إلى المنصة';
    }
  });
}

function buildDashboardStats(cards, filteredCards) {
  const categories = new Set(cards.map((card) => card.category));
  return [
    { label: 'إجمالي البطاقات', value: cards.length },
    { label: 'نتائج الفلترة', value: filteredCards.length },
    { label: 'عدد التصنيفات', value: categories.size }
  ];
}

function sortCards(cards, sort) {
  const cloned = [...cards];
  switch (sort) {
    case 'title-asc':
      return cloned.sort((a, b) => a.title.localeCompare(b.title));
    case 'title-desc':
      return cloned.sort((a, b) => b.title.localeCompare(a.title));
    case 'oldest':
      return cloned.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    default:
      return cloned.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

function getFilteredCards() {
  const query = state.dashboard.search.trim().toLowerCase();
  let cards = [...state.cards];

  if (query) {
    cards = cards.filter((card) => {
      return [card.title, card.category, card.steamUsername, card.notes || '']
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }

  if (state.dashboard.category !== 'all') {
    cards = cards.filter((card) => card.category === state.dashboard.category);
  }

  return sortCards(cards, state.dashboard.sort);
}

function renderDashboard() {
  const cardsGrid = $('#cardsGrid');
  const quickStats = $('#quickStats');
  const filteredCards = getFilteredCards();

  const stats = buildDashboardStats(state.cards, filteredCards)
    .map((item) => `<div class="stat-pill"><small>${item.label}</small><div><strong>${item.value}</strong></div></div>`)
    .join('');
  quickStats.innerHTML = stats;

  if (!filteredCards.length) {
    cardsGrid.innerHTML = `
      <div class="glass empty-box">
        <h3>لا توجد نتائج حالياً</h3>
        <p class="muted">جرب تغيير البحث أو التصفية أو الترتيب للوصول إلى بطاقات أخرى.</p>
      </div>
    `;
    return;
  }

  cardsGrid.innerHTML = filteredCards.map((card) => {
    const maskedPassword = '•'.repeat(Math.max(8, card.steamPassword.length));
    return `
      <article class="steam-card glass" data-card-id="${escapeHtml(card.id)}">
        <div class="steam-card-image-wrap">
          <img class="steam-card-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.title)}" />
          <div class="steam-card-overlay"></div>
          <span class="badge">${escapeHtml(card.category)}</span>
        </div>
        <div class="steam-card-content">
          <div class="steam-card-head">
            <h3>${escapeHtml(card.title)}</h3>
            <small>${escapeHtml(card.id)}</small>
          </div>

          <div class="field-box">
            <label>اسم مستخدم حساب Steam</label>
            <div class="field-row">
              <span>${escapeHtml(card.steamUsername)}</span>
              <button class="secondary-btn copy-btn" data-copy="${escapeHtml(card.steamUsername)}">نسخ</button>
            </div>
          </div>

          <div class="field-box">
            <label>كلمة المرور</label>
            <div class="field-row">
              <span class="password-value" data-real="${escapeHtml(card.steamPassword)}" data-mask="${escapeHtml(maskedPassword)}">${escapeHtml(maskedPassword)}</span>
              <div class="actions-inline">
                <button class="ghost-btn toggle-password-btn">إظهار</button>
                <button class="secondary-btn copy-btn" data-copy="${escapeHtml(card.steamPassword)}">نسخ</button>
              </div>
            </div>
          </div>

          ${card.notes ? `<div class="mini-note"><strong>ملاحظة:</strong><span>${escapeHtml(card.notes)}</span></div>` : ''}
        </div>
      </article>
    `;
  }).join('');

  cardsGrid.querySelectorAll('.copy-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy || '');
        showToast('تم النسخ بنجاح', 'success');
      } catch {
        showToast('تعذر النسخ من هذا المتصفح', 'error');
      }
    });
  });

  cardsGrid.querySelectorAll('.toggle-password-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const wrapper = button.closest('.field-row');
      const valueNode = wrapper.querySelector('.password-value');
      const isMasked = valueNode.textContent === valueNode.dataset.mask;
      valueNode.textContent = isMasked ? valueNode.dataset.real : valueNode.dataset.mask;
      button.textContent = isMasked ? 'إخفاء' : 'إظهار';
    });
  });
}

async function initDashboard() {
  await getMe(true);
  const result = await api('/api/cards');
  state.cards = result.data.cards;

  const categoryOptions = [
    { value: 'all', label: 'كل التصنيفات' },
    ...[...new Set(state.cards.map((card) => card.category))].map((category) => ({ value: category, label: category }))
  ];
  const sortOptions = [
    { value: 'newest', label: 'الأحدث' },
    { value: 'oldest', label: 'الأقدم' },
    { value: 'title-asc', label: 'A-Z' },
    { value: 'title-desc', label: 'Z-A' }
  ];

  createCustomDropdown({
    mountSelector: '#categoryDropdown',
    selectSelector: '#categoryFilter',
    options: categoryOptions,
    value: state.dashboard.category,
    onChange: (nextValue) => {
      state.dashboard.category = nextValue;
      renderDashboard();
    }
  });

  createCustomDropdown({
    mountSelector: '#sortDropdown',
    selectSelector: '#sortFilter',
    options: sortOptions,
    value: state.dashboard.sort,
    onChange: (nextValue) => {
      state.dashboard.sort = nextValue;
      renderDashboard();
    }
  });

  $('#searchInput')?.addEventListener('input', (event) => {
    state.dashboard.search = event.target.value;
    renderDashboard();
  });

  renderDashboard();
}

async function initRules() {
  await getMe(true);
  const result = await api('/api/rules');
  state.rules = result.data.rules;
  const root = $('#rulesList');
  root.innerHTML = state.rules.map((rule, index) => `
    <div class="rule-item">
      <div class="rule-number">${index + 1}</div>
      <div>
        <h3>قاعدة ${index + 1}</h3>
        <p class="muted">${escapeHtml(rule)}</p>
      </div>
    </div>
  `).join('');
}

function setAdminTab(tab) {
  document.querySelectorAll('.sidebar-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  document.querySelectorAll('.admin-tab').forEach((panel) => panel.classList.add('hidden'));
  $(`#tab-${tab}`)?.classList.remove('hidden');
}

function closeModal() {
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}

function createModal({ title, text, onConfirm, confirmText = 'تأكيد', cancelText = 'إلغاء' }) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-box glass themed-modal">
        <div class="modal-header-row">
          <div>
            <span class="modal-kicker">Steam Vault Green</span>
            <h3>${escapeHtml(title)}</h3>
          </div>
        </div>
        <p class="muted modal-description">${escapeHtml(text)}</p>
        <div class="modal-actions split-actions">
          <button class="ghost-btn" id="closeModalBtn">${escapeHtml(cancelText)}</button>
          <button class="danger-btn" id="confirmModalBtn">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    </div>
  `;

  $('#closeModalBtn').addEventListener('click', closeModal);
  $('#confirmModalBtn').addEventListener('click', async () => {
    const confirmBtn = $('#confirmModalBtn');
    confirmBtn.disabled = true;
    try {
      await onConfirm();
    } finally {
      closeModal();
    }
  });
}

function createFormModal({ title, subtitle = '', fields = [], submitText = 'حفظ التعديلات', onSubmit }) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-box glass themed-modal large-modal">
        <div class="modal-header-row">
          <div>
            <span class="modal-kicker">Steam Vault Green</span>
            <h3>${escapeHtml(title)}</h3>
            ${subtitle ? `<p class="muted modal-description">${escapeHtml(subtitle)}</p>` : ''}
          </div>
        </div>
        <form id="dynamicModalForm" class="form-stack modal-form-grid">
          ${fields.map((field) => `
            <div class="input-group ${field.full ? 'span-2' : ''}">
              <label>${escapeHtml(field.label)}</label>
              ${field.type === 'textarea'
                ? `<textarea name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(field.value || '')}</textarea>`
                : field.type === 'select'
                  ? `<select name="${escapeHtml(field.name)}">${(field.options || []).map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`
                  : `<input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || 'text')}" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}" />`}
            </div>
          `).join('')}
          <div class="modal-actions span-2 split-actions">
            <button type="button" class="ghost-btn" id="closeModalBtn">إلغاء</button>
            <button type="submit" class="primary-btn">${escapeHtml(submitText)}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  $('#closeModalBtn').addEventListener('click', closeModal);
  $('#dynamicModalForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    const submitBtn = event.currentTarget.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await onSubmit(values);
      closeModal();
    } catch (error) {
      submitBtn.disabled = false;
      showToast(error.message || 'تعذر حفظ البيانات', 'error');
    }
  });
}

function renderStatsTab() {
  const root = $('#tab-stats');
  const stats = state.admin.stats;
  root.innerHTML = `
    <section class="admin-section">
      <div class="stats-grid">
        <div class="glass stat-card"><span>المتصلون الآن</span><strong>${stats.connectedNow}</strong></div>
        <div class="glass stat-card"><span>الحسابات المكررة</span><strong>${stats.duplicateLoginCount}</strong></div>
        <div class="glass stat-card"><span>عدد المستخدمين</span><strong>${stats.totalUsers}</strong></div>
        <div class="glass stat-card"><span>عدد البطاقات</span><strong>${stats.totalCards}</strong></div>
      </div>

      <div class="table-wrap glass">
        <div class="section-head wide-gap">
          <h3>الحسابات النشطة الآن</h3>
          <p>يعرض البريد والدور ونوع الجهاز والـ IP والمتصفح ونظام التشغيل</p>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>البريد</th>
                <th>الدور</th>
                <th>نوع الجهاز</th>
                <th>المتصفح / النظام</th>
                <th>IP</th>
                <th>وقت الدخول</th>
                <th>آخر نشاط</th>
              </tr>
            </thead>
            <tbody>
              ${stats.activeSessions.length ? stats.activeSessions.map((session) => `
                <tr>
                  <td>${escapeHtml(session.email)}</td>
                  <td>${escapeHtml(session.role)}</td>
                  <td>${escapeHtml(session.deviceType || '-')}</td>
                  <td>${escapeHtml(`${session.browser || '-'} / ${session.os || '-'}`)}</td>
                  <td>${escapeHtml(session.ip || '-')}</td>
                  <td>${escapeHtml(formatDate(session.loginAt))}</td>
                  <td>${escapeHtml(formatDate(session.lastSeen))}</td>
                </tr>
              `).join('') : `<tr><td colspan="7" class="muted">لا توجد جلسات أخرى نشطة حاليًا</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="table-wrap glass">
        <div class="section-head wide-gap">
          <h3>جميع الحسابات داخل قائمة الأدمن</h3>
          <p>سترى كل الحسابات الجاهزة في النظام مع عدد الأجهزة ونوعها وعناوين IP الخاصة بكل حساب</p>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البريد</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>عدد الجلسات</th>
                <th>عدد الأجهزة</th>
                <th>عدد الـ IP</th>
                <th>الأجهزة الحالية</th>
                <th>عناوين IP</th>
              </tr>
            </thead>
            <tbody>
              ${stats.allAccountsOverview.length ? stats.allAccountsOverview.map((account) => `
                <tr>
                  <td>${escapeHtml(account.name)}</td>
                  <td>${escapeHtml(account.email)}</td>
                  <td>${escapeHtml(account.role)}</td>
                  <td>
                    <span class="status-pill ${account.isActive !== false ? 'enabled' : 'disabled'}">${account.isActive !== false ? (account.onlineNow ? 'مفعل ومتصل' : 'مفعل') : 'معطل'}</span>
                  </td>
                  <td>${account.connectedDevicesCount}</td>
                  <td>${account.uniqueDevicesCount}</td>
                  <td>${account.uniqueIpsCount}</td>
                  <td>${account.devices.length ? account.devices.map((item) => `<div class="micro-chip">${escapeHtml(item)}</div>`).join('') : '<span class="muted">-</span>'}</td>
                  <td>${account.ips.length ? account.ips.map((item) => `<div class="micro-chip">${escapeHtml(item)}</div>`).join('') : '<span class="muted">-</span>'}</td>
                </tr>
              `).join('') : `<tr><td colspan="9" class="muted">لا توجد حسابات مسجلة</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel-grid two-col">
        <div class="glass panel">
          <div class="section-head wide-gap">
            <h3>الحسابات الداخلة بنفس البريد</h3>
            <p>هذه القائمة تساعدك على اكتشاف مشاركة الحسابات أو تكرار الجلسات</p>
          </div>
          <div class="list-stack">
            ${stats.duplicateAccounts.length ? stats.duplicateAccounts.map((item) => `
              <div class="list-item">
                <div>
                  <strong>${escapeHtml(item.email)}</strong>
                  <small>عدد الجلسات المكررة: ${item.count}</small>
                </div>
              </div>
            `).join('') : `<div class="list-item"><div><strong>ممتاز</strong><small>لا توجد حالات تكرار حالياً</small></div></div>`}
          </div>
        </div>
        <div class="glass panel">
          <div class="section-head wide-gap">
            <h3>أحدث السجلات</h3>
            <p>آخر العمليات التي حدثت داخل النظام</p>
          </div>
          <div class="log-list">
            ${stats.recentLogs.length ? stats.recentLogs.map((log) => `
              <div class="log-item">
                <strong>${escapeHtml(log.action)}</strong>
                <div class="muted">${escapeHtml(log.actorEmail || 'unknown')} — ${escapeHtml(log.actorRole || 'unknown')}</div>
                <small class="muted">${escapeHtml(log.description || '')} — ${escapeHtml(formatDate(log.createdAt))}</small>
              </div>
            `).join('') : `<div class="log-item"><strong>لا توجد سجلات</strong></div>`}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderUsersTab() {
  const root = $('#tab-users');
  root.innerHTML = `
    <section class="panel-grid two-col">
      <div class="glass panel">
        <div class="section-head wide-gap">
          <h3>إضافة مستخدم جديد</h3>
          <p>يمكنك إنشاء حساب جديد مع صورة ومدة محددة أو موعد تعطيل تلقائي.</p>
        </div>
        <form id="createUserForm" class="form-stack">
          <div class="input-group"><label>الاسم</label><input name="name" placeholder="اسم المستخدم" /></div>
          <div class="input-group"><label>البريد</label><input name="email" placeholder="user@example.com" /></div>
          <div class="input-group"><label>كلمة المرور</label><input name="password" placeholder="كلمة مرور قوية" /></div>
          <div class="input-group"><label>الدور</label><select name="role"><option value="user">مستخدم</option><option value="admin">أدمن</option></select></div>
          <div class="input-group"><label>حالة الحساب</label><select name="isActive"><option value="true">مفعل</option><option value="false">معطل</option></select></div>
          <div class="input-group span-2"><label>رابط صورة الحساب</label><input name="avatar" placeholder="https://example.com/avatar.gif" /></div>
          <div class="input-group"><label>حالة قصيرة</label><input name="statusText" placeholder="مثال: VIP" /></div>
          <div class="input-group"><label>لون دائرة الصورة</label><input name="avatarRingColor" value="#1cff8a" placeholder="#1cff8a" /></div>
          <div class="input-group"><label>تعطيل بعد مدة</label><input name="durationValue" type="number" min="0" placeholder="مثال: 5" /></div>
          <div class="input-group"><label>وحدة المدة</label><select name="durationUnit"><option value="">بدون</option><option value="minute">دقيقة</option><option value="hour">ساعة</option><option value="day">يوم</option><option value="month">شهر</option></select></div>
          <div class="input-group span-2"><label>أو تاريخ ووقت التعطيل</label><input name="disableAt" type="datetime-local" /></div>
          <button class="primary-btn" type="submit">إضافة المستخدم</button>
        </form>
      </div>
      <div class="glass panel">
        <div class="section-head wide-gap">
          <h3>جميع مستخدمي الموقع</h3>
          <p>إدارة كاملة للحسابات الجاهزة داخل النظام مع الصورة والمدة والتفعيل والتعطيل.</p>
        </div>
        <div class="list-stack">
          ${state.admin.users.map((user) => `
            <div class="list-item user-row-card">
              <div class="user-row-main">
                ${renderAvatarMarkup(user, 'user-avatar-sm')}
                <div class="user-row-info">
                  <strong>${escapeHtml(user.name)}</strong>
                  <div class="muted">${escapeHtml(user.email)} — ${escapeHtml(user.role)}</div>
                  <div class="muted">
                    <span class="status-pill ${user.isActive !== false ? 'enabled' : 'disabled'}">${user.isActive !== false ? 'مفعل' : 'معطل'}</span>
                    ${user.disableAt ? `<span class="micro-chip">يتعطل: ${escapeHtml(formatDate(user.disableAt))}</span>` : ''}
                  </div>
                  <small class="muted">تاريخ الإنشاء: ${escapeHtml(formatDate(user.createdAt))}</small>
                </div>
              </div>
              <div class="list-actions">
                <button class="secondary-btn edit-user-btn" data-id="${escapeHtml(user.id)}">تعديل</button>
                <button class="${user.isActive !== false ? 'ghost-btn disable-user-btn' : 'primary-btn enable-user-btn'}" data-id="${escapeHtml(user.id)}">${user.isActive !== false ? 'تعطيل' : 'تفعيل'}</button>
                <button class="danger-btn delete-user-btn" data-id="${escapeHtml(user.id)}">حذف</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;

  $('#createUserForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(formData.entries()))
      });
      showToast('تمت إضافة المستخدم', 'success');
      await loadAdminData();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  root.querySelectorAll('.delete-user-btn').forEach((button) => {
    button.addEventListener('click', () => {
      createModal({
        title: 'تأكيد حذف المستخدم',
        text: 'سيتم حذف المستخدم نهائيًا من النظام وإخراجه من أي جلسات مفتوحة.',
        onConfirm: async () => {
          try {
            await api(`/api/admin/users/${button.dataset.id}`, { method: 'DELETE' });
            showToast('تم حذف المستخدم وإخراجه من الحساب', 'success');
            await loadAdminData();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      });
    });
  });

  root.querySelectorAll('.disable-user-btn').forEach((button) => {
    button.addEventListener('click', () => {
      createModal({
        title: 'تعطيل الحساب',
        text: 'سيتم تعطيل الحساب وإخراج صاحبه من أي جلسة حالية.',
        confirmText: 'تعطيل الحساب',
        onConfirm: async () => {
          try {
            await api(`/api/admin/users/${button.dataset.id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ isActive: false })
            });
            showToast('تم تعطيل الحساب', 'success');
            await loadAdminData();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      });
    });
  });

  root.querySelectorAll('.enable-user-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/admin/users/${button.dataset.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: true })
        });
        showToast('تم تفعيل الحساب', 'success');
        await loadAdminData();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  });

  root.querySelectorAll('.edit-user-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const user = state.admin.users.find((item) => item.id === button.dataset.id);
      if (!user) return;
      createFormModal({
        title: 'تعديل المستخدم',
        subtitle: 'يمكنك تعديل صورة الحساب وتحديد مدة أو وقت تعطيل الحساب.',
        submitText: 'حفظ بيانات المستخدم',
        fields: [
          { name: 'name', label: 'اسم المستخدم', value: user.name, placeholder: 'الاسم الكامل' },
          { name: 'email', label: 'البريد الإلكتروني', type: 'email', value: user.email, placeholder: 'name@example.com' },
          { name: 'role', label: 'الدور', type: 'select', value: user.role, options: [{ value: 'user', label: 'مستخدم' }, { value: 'admin', label: 'أدمن' }] },
          { name: 'isActive', label: 'حالة الحساب', type: 'select', value: String(user.isActive !== false), options: [{ value: 'true', label: 'مفعل' }, { value: 'false', label: 'معطل' }] },
          { name: 'avatar', label: 'رابط صورة الحساب', value: user.avatar || '', placeholder: 'https://example.com/avatar.gif', full: true },
          { name: 'statusText', label: 'حالة قصيرة', value: user.statusText || '', placeholder: 'مثال: VIP' },
          { name: 'avatarRingColor', label: 'لون دائرة الصورة', value: user.avatarRingColor || '#1cff8a', placeholder: '#1cff8a' },
          { name: 'durationValue', label: 'إضافة مدة جديدة', type: 'number', value: '', placeholder: 'مثال: 1' },
          { name: 'durationUnit', label: 'الوحدة', type: 'select', value: '', options: [{ value: '', label: 'بدون' }, { value: 'minute', label: 'دقيقة' }, { value: 'hour', label: 'ساعة' }, { value: 'day', label: 'يوم' }, { value: 'month', label: 'شهر' }] },
          { name: 'disableAt', label: 'أو تاريخ ووقت التعطيل', type: 'datetime-local', value: toDatetimeLocal(user.disableAt), full: true },
          { name: 'password', label: 'كلمة مرور جديدة', type: 'text', value: '', placeholder: 'اتركها فارغة بدون تغيير', full: true }
        ],
        onSubmit: async (values) => {
          await api(`/api/admin/users/${user.id}`, {
            method: 'PUT',
            body: JSON.stringify(values)
          });
          showToast('تم تحديث المستخدم', 'success');
          await loadAdminData();
        }
      });
    });
  });
}

function renderCardsTab() {
  const root = $('#tab-cards');
  root.innerHTML = `
    <section class="panel-grid two-col">
      <div class="glass panel">
        <div class="section-head wide-gap">
          <h3>إضافة بطاقة Steam</h3>
          <p>أدخل بيانات اللعبة والحساب لتظهر داخل لوحة المستخدمين</p>
        </div>
        <form id="createCardForm" class="form-stack">
          <div class="input-group"><label>اسم اللعبة</label><input name="title" placeholder="اسم اللعبة" /></div>
          <div class="input-group"><label>التصنيف</label><input name="category" placeholder="مثال: أكشن" /></div>
          <div class="input-group"><label>رابط الصورة</label><input name="image" placeholder="https://..." /></div>
          <div class="input-group"><label>اسم المستخدم</label><input name="steamUsername" placeholder="اسم مستخدم Steam" /></div>
          <div class="input-group"><label>كلمة المرور</label><input name="steamPassword" placeholder="كلمة المرور" /></div>
          <div class="input-group"><label>ملاحظة</label><textarea name="notes" placeholder="ملاحظة إضافية"></textarea></div>
          <button class="primary-btn" type="submit">إضافة البطاقة</button>
        </form>
      </div>
      <div class="glass panel">
        <div class="section-head wide-gap">
          <h3>بطاقات Steam الحالية</h3>
          <p>يمكنك تعديل أو حذف أي بطاقة من هنا</p>
        </div>
        <div class="list-stack">
          ${state.admin.cards.map((card) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(card.title)}</strong>
                <div class="muted">${escapeHtml(card.category)} — ${escapeHtml(card.steamUsername)}</div>
                <small class="muted">آخر تحديث: ${escapeHtml(formatDate(card.updatedAt || card.createdAt))}</small>
              </div>
              <div class="list-actions">
                <button class="secondary-btn edit-card-btn" data-id="${escapeHtml(card.id)}">تعديل</button>
                <button class="danger-btn delete-card-btn" data-id="${escapeHtml(card.id)}">حذف</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;

  $('#createCardForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await api('/api/admin/cards', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(formData.entries()))
      });
      showToast('تمت إضافة البطاقة', 'success');
      await loadAdminData();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  root.querySelectorAll('.delete-card-btn').forEach((button) => {
    button.addEventListener('click', () => {
      createModal({
        title: 'تأكيد حذف البطاقة',
        text: 'سيتم حذف بطاقة Steam نهائيًا من الموقع.',
        onConfirm: async () => {
          try {
            await api(`/api/admin/cards/${button.dataset.id}`, { method: 'DELETE' });
            showToast('تم حذف البطاقة', 'success');
            await loadAdminData();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      });
    });
  });

  root.querySelectorAll('.edit-card-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const card = state.admin.cards.find((item) => item.id === button.dataset.id);
      if (!card) return;
      createFormModal({
        title: 'تعديل بطاقة Steam',
        subtitle: 'كل معلومات البطاقة تظهر داخل مربع واحد واضح ومتكامل لتعديلها مباشرة.',
        submitText: 'حفظ تعديلات البطاقة',
        fields: [
          { name: 'title', label: 'اسم اللعبة', value: card.title, placeholder: 'اسم اللعبة' },
          { name: 'category', label: 'التصنيف', value: card.category, placeholder: 'مثال: رياضة أو أكشن' },
          { name: 'image', label: 'رابط الصورة', value: card.image, placeholder: 'https://...' , full: true},
          { name: 'steamUsername', label: 'اسم مستخدم Steam', value: card.steamUsername, placeholder: 'اسم المستخدم' },
          { name: 'steamPassword', label: 'كلمة المرور', value: card.steamPassword, placeholder: 'كلمة المرور' },
          { name: 'notes', label: 'ملاحظة', type: 'textarea', value: card.notes || '', placeholder: 'أي ملاحظة إضافية', full: true }
        ],
        onSubmit: async (values) => {
          await api(`/api/admin/cards/${card.id}`, {
            method: 'PUT',
            body: JSON.stringify(values)
          });
          showToast('تم تحديث البطاقة', 'success');
          await loadAdminData();
        }
      });
    });
  });
}

function renderRulesTab() {
  const root = $('#tab-rules');
  root.innerHTML = `
    <section class="glass panel">
      <div class="section-head wide-gap">
        <h3>إدارة القوانين</h3>
        <p>ضع كل قانون في سطر مستقل، ثم احفظ التغييرات مباشرة.</p>
      </div>
      <form id="rulesForm" class="form-stack">
        <textarea class="rules-editor" name="rulesText">${escapeHtml(state.rules.join('\n'))}</textarea>
        <button class="primary-btn" type="submit">حفظ القوانين</button>
      </form>
    </section>
  `;

  $('#rulesForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get('rulesText');
    const rules = String(text).split('\n').map((line) => line.trim()).filter(Boolean);
    try {
      const result = await api('/api/rules', {
        method: 'PUT',
        body: JSON.stringify({ rules })
      });
      state.rules = result.data.rules;
      showToast('تم تحديث القوانين', 'success');
      await loadAdminData();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function renderLogsTab() {
  const root = $('#tab-logs');
  root.innerHTML = `
    <section class="glass panel">
      <div class="section-head wide-gap">
        <h3>سجل النشاط الكامل</h3>
        <p>هنا تظهر أهم العمليات التي تمت داخل النظام مؤخرًا.</p>
      </div>
      <div class="log-list">
        ${state.admin.logs.map((log) => `
          <div class="log-item">
            <strong>${escapeHtml(log.action)}</strong>
            <div class="muted">${escapeHtml(log.actorEmail || 'unknown')} — ${escapeHtml(log.actorRole || 'unknown')}</div>
            <p class="muted">${escapeHtml(log.description || '')}</p>
            <small class="muted">${escapeHtml(formatDate(log.createdAt))}</small>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

async function loadAdminData() {
  const [statsResult, usersResult, cardsResult, rulesResult, logsResult] = await Promise.all([
    api('/api/admin/stats'),
    api('/api/admin/users'),
    api('/api/admin/cards'),
    api('/api/rules'),
    api('/api/admin/logs')
  ]);

  state.admin.stats = statsResult.data;
  state.admin.users = usersResult.data.users;
  state.admin.cards = cardsResult.data.cards;
  state.rules = rulesResult.data.rules;
  state.admin.logs = logsResult.data.logs;

  renderStatsTab();
  renderUsersTab();
  renderCardsTab();
  renderRulesTab();
  renderLogsTab();
}

async function initAdmin() {
  const user = await getMe(true);
  if (!user || user.role !== 'admin') {
    showToast('هذه الصفحة مخصصة للأدمن فقط', 'error');
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 600);
    return;
  }

  showLoading($('#tab-stats'), 'جارٍ تحميل لوحة الأدمن...');
  try {
    await loadAdminData();
  } catch (error) {
    showToast(error.message, 'error');
  }

  document.querySelectorAll('.sidebar-btn').forEach((button) => {
    button.addEventListener('click', () => {
      setAdminTab(button.dataset.tab);
    });
  });
}

async function boot() {
  activateCursor();
  attachLogout();

  if (page === 'login') {
    await initLogin();
    return;
  }
  if (page === 'dashboard') {
    await initDashboard();
    return;
  }
  if (page === 'rules') {
    await initRules();
    return;
  }
  if (page === 'admin') {
    await initAdmin();
  }
}

boot();
