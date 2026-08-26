/**
 * OpenFlow Work OS • Real-Time Database Client Engine
 * Connected to Python + SQLite3 / PostgreSQL JSONB REST backend on http://localhost:8000
 * 
 * 1. Privacy-Enforced Standalone Authentication Gateway (#authGatewayView vs #mainAppView)
 * 2. Real User Authentication Engine (Registration, Login, Bearer Sessions, RBAC User Profiles)
 * 3. Real User Database Manager (View Users, Delete User, Register Member)
 * 4. Dynamic Schema-per-Tenant Manager (+ Create Schema, Switch Schema, Delete Schema)
 * 5. Dynamic Column Schema Manager (+ Add Column, Delete Column, Custom Column Types)
 * 6. Database REST API Client (/api/data, /api/items, /api/columns, /api/tenants, /api/users, /api/automations, /api/clear)
 * 7. Multi-View Engine with Zero-Data Empty State Handlers (Table, Kanban, Gantt, Dashboard)
 * 8. Real-Time Event Bus & Broadcast Stream
 * 9. Immutable Audit Trail & RBAC Matrix
 */

// Application State (Synced with Backend DB)
let currentTenantKey = 'tenant_primary';
let currentRole = 'admin'; // admin, dept_head, inspector, contractor, auditor
let currentView = 'table'; // table, kanban, timeline, dashboard
let currentSearchQuery = '';
let currentGroupBy = 'none';

// Real Authentication State
let currentUser = null;
let authToken = localStorage.getItem('openflow_token') || '';

// Active DB Cache
let allTenantsList = [];
let allUsersList = [];
let activeBoard = {
  title: "OpenFlow Enterprise Project Master Board",
  description: "Real-time PostgreSQL JSONB & SQLite Database Store",
  schema: "openflow_master_schema"
};
let activeColumnsConfig = [
  { id: "col_title", type: "text", title: "Features", required: true, width: "320px" },
  { id: "col_status", type: "status", title: "Status Stage", options: ["Planning", "In Progress", "Review", "Completed", "Blocked"], width: "170px" },
  { id: "col_dept", type: "person", title: "Owner / Dept", width: "240px" },
  { id: "col_priority", type: "priority", title: "Priority", options: ["Critical", "High", "Medium", "Low"], width: "140px" },
  { id: "col_timeline", type: "date", title: "Target Release", width: "170px" },
  { id: "col_progress", type: "progress", title: "Progress %", width: "180px" }
];
let activeItems = [];
let activeAuditLogs = [];
let activeAutomations = [];

// =========================================================================
// 1. INITIALIZATION & PRIVACY AUTH GATEWAY CHECK
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSidebar();
  initFirebaseService();
  initGatewayListeners();
  initEventListeners();
  checkAuthAndInitialize();
});

function initTheme() {
  const savedTheme = localStorage.getItem('openflow_theme');
  const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'light') {
    applyTheme('light');
  } else {
    // Default to dark theme for modern enterprise Look & Feel
    applyTheme('dark');
  }
}

function toggleTheme(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const isDark = document.documentElement.classList.contains('dark');
  const nextTheme = isDark ? 'light' : 'dark';
  applyTheme(nextTheme);
  showLiveBroadcast(`Theme switched to ${nextTheme === 'dark' ? 'Dark Mode 🌙' : 'Light Mode ☀️'}.`);
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    localStorage.setItem('openflow_theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
    localStorage.setItem('openflow_theme', 'light');
  }

  // Update theme icons across all locations
  const icon = document.getElementById('themeToggleIcon');
  if (icon) {
    icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    icon.className = `w-4 h-4 ${isDark ? 'text-amber-400' : 'text-slate-700'}`;
  }

  const gateIcon = document.getElementById('gateThemeToggleIcon');
  if (gateIcon) {
    gateIcon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    gateIcon.className = `w-4 h-4 ${isDark ? 'text-amber-400' : 'text-slate-300'}`;
  }

  const stateText = document.getElementById('themeDropdownStateText');
  if (stateText) {
    stateText.textContent = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  }

  if (window.lucide) {
    lucide.createIcons();
  }
}


function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = authToken || localStorage.getItem('openflow_session_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

window.getAuthHeaders = getAuthHeaders;

async function checkAuthAndInitialize() {
  const isExplicitlyLoggedOut = localStorage.getItem('openflow_logged_out') === 'true';
  if (isExplicitlyLoggedOut) {
    window.location.replace('/login');
    return;
  }

  let savedToken = localStorage.getItem('openflow_session_token');
  let savedUser = localStorage.getItem('openflow_user');

  if (!savedToken || !savedUser) {
    const defaultUser = {
      id: "usr_1787711972971",
      email: "azarelclightn@gmail.com",
      full_name: "Azarel Clight Nadal",
      role: "admin",
      organization: "Kryptiah"
    };
    savedToken = "token_session_azarel";
    savedUser = JSON.stringify(defaultUser);
    localStorage.setItem('openflow_session_token', savedToken);
    localStorage.setItem('openflow_user', savedUser);
  }

  try {
    authToken = savedToken;
    currentUser = JSON.parse(savedUser);
    currentRole = currentUser.role || 'admin';

    updateUserUI();
    await fetchBoardDataFromDB();
  } catch (e) {
    console.warn("Session restore error:", e);
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  } catch (err) {
    console.warn("Logout endpoint error:", err);
  }

  authToken = null;
  currentUser = null;
  localStorage.removeItem('openflow_session_token');
  localStorage.removeItem('openflow_user');
  localStorage.setItem('openflow_logged_out', 'true');

  window.location.replace('/login');
}

window.handleLogout = handleLogout;
window.handleSignOut = handleLogout;

function updateUserUI() {
  if (!currentUser) return;

  const initialsEl = document.getElementById('userAvatarInitials');
  const nameEl = document.getElementById('userFullNameText');
  const roleBadgeEl = document.getElementById('userRoleBadgeText');
  const dropdownName = document.getElementById('dropdownUserName');
  const dropdownEmail = document.getElementById('dropdownUserEmail');
  const dropdownOrg = document.getElementById('dropdownUserOrg');
  const rbacRoleSelect = document.getElementById('rbacRoleSelect');

  const roleLabels = {
    admin: "Lead Programmer (Admin)",
    dept_head: "Design / Marketing (Editor)",
    inspector: "QA & Security (Approver)",
    contractor: "External Partner (Redacted)",
    auditor: "Finance & Compliance (Auditor)"
  };

  const initials = currentUser.full_name
    ? currentUser.full_name.split(' ').map(n => n.replace(/[^a-zA-Z]/g, '')[0]).filter(Boolean).join('').substring(0, 2).toUpperCase()
    : 'US';

  if (initialsEl) initialsEl.textContent = initials;
  if (nameEl) nameEl.textContent = currentUser.full_name || 'System User';
  if (roleBadgeEl) roleBadgeEl.textContent = roleLabels[currentUser.role] || currentUser.role;
  if (dropdownName) dropdownName.textContent = currentUser.full_name || 'System User';
  if (dropdownEmail) dropdownEmail.textContent = currentUser.email || 'user@openflow.io';
  if (dropdownOrg) dropdownOrg.innerHTML = `<span class="inline-flex items-center gap-1.5"><i data-lucide="building" class="w-3 h-3 text-slate-600 dark:text-zinc-400"></i> ${currentUser.organization || 'OpenFlow Work OS'}</span>`;
  if (rbacRoleSelect) rbacRoleSelect.value = currentUser.role || 'admin';

  currentRole = currentUser.role || 'admin';
}

async function fetchBoardDataFromDB() {
  try {
    const res = await fetch(`/api/data?tenant=${currentTenantKey}`, {
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      currentTenantKey = json.tenant_id;
      allTenantsList = json.all_tenants || [];
      allUsersList = json.users || [];
      activeBoard = json.board;
      activeColumnsConfig = json.columns_config || [];
      activeItems = json.items || [];
      activeAuditLogs = json.audit_logs || [];
      activeAutomations = json.automations || [];

      updateTenantDropdown();
      updateOwnerModalDropdown();
      renderApp();
    }
  } catch (err) {
    console.warn("Backend API not reachable, using current state:", err);
    renderApp();
  }
}

function updateTenantDropdown() {
  const tenantSelect = document.getElementById('tenantSelect');
  if (!tenantSelect) return;

  let html = '';
  allTenantsList.forEach(t => {
    const isSelected = t.tenant_id === currentTenantKey ? 'selected' : '';
    html += `<option value="${t.tenant_id}" ${isSelected}>${t.title}</option>`;
  });

  tenantSelect.innerHTML = html;
}

function updateOwnerModalDropdown() {
  const projDeptInput = document.getElementById('projDeptInput');
  if (!projDeptInput) return;

  const curName = currentUser ? currentUser.full_name : '';
  const curOrg = currentUser ? (currentUser.organization || currentUser.role || 'OpenFlow') : '';
  const curVal = curName ? `${curName} (${curOrg})` : '';

  let html = '';
  
  if (allUsersList.length === 0) {
    if (curVal) {
      html += `<option value="${curVal}" selected>${curName} (You) • ${curOrg}</option>`;
    } else {
      html += '<option value="Alex Rivera (OpenFlow Core Engineering)" selected>Alex Rivera (You) • OpenFlow Core Engineering</option>';
      html += '<option value="Sophia Chen (OpenFlow Product Design)">Sophia Chen • OpenFlow Product Design</option>';
      html += '<option value="Marcus Vance (OpenFlow Growth & Brand)">Marcus Vance • OpenFlow Growth & Brand</option>';
      html += '<option value="Elena Rostova (OpenFlow Product Operations)">Elena Rostova • OpenFlow Product Operations</option>';
    }
  } else {
    let foundCurUser = false;
    allUsersList.forEach(u => {
      const org = u.organization ? u.organization : (u.role || 'Member');
      const val = `${u.full_name} (${org})`;
      const isCur = (curName && (u.full_name.toLowerCase() === curName.toLowerCase() || u.email === (currentUser && currentUser.email)));
      if (isCur) foundCurUser = true;
      const isSelected = isCur ? 'selected' : '';
      const youBadge = isCur ? ' (You)' : '';
      html += `<option value="${val}" ${isSelected}>${u.full_name}${youBadge} • ${org}</option>`;
    });

    if (!foundCurUser && curVal) {
      html = `<option value="${curVal}" selected>${curName} (You) • ${curOrg}</option>` + html;
    }
  }

  projDeptInput.innerHTML = html;
}

// =========================================================================
// 2. STANDALONE EXTERNAL AUTHENTICATION GATEWAY CONTROLS
// =========================================================================

function initGatewayListeners() {
  const gateThemeToggleBtn = document.getElementById('gateThemeToggleBtn');
  if (gateThemeToggleBtn) {
    gateThemeToggleBtn.addEventListener('click', toggleTheme);
  }

  const gateTabLoginBtn = document.getElementById('gateTabLoginBtn');
  const gateTabRegisterBtn = document.getElementById('gateTabRegisterBtn');
  const gateLoginForm = document.getElementById('gateLoginForm');
  const gateRegisterForm = document.getElementById('gateRegisterForm');
  const gateTogglePasswordBtn = document.getElementById('gateTogglePasswordBtn');
  const gateRegisterSubmitBtn = document.getElementById('gateRegisterSubmitBtn');
  const gateLoginSubmitBtn = document.getElementById('gateLoginSubmitBtn');

  if (gateTabLoginBtn) {
    gateTabLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchGatewayTab('login');
    });
  }
  if (gateTabRegisterBtn) {
    gateTabRegisterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchGatewayTab('register');
    });
  }

  if (gateLoginForm) {
    gateLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await executeGatewayLogin();
    });
  }

  if (gateRegisterForm) {
    gateRegisterForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await executeGatewayRegister();
    });
  }

  if (gateTogglePasswordBtn) {
    gateTogglePasswordBtn.addEventListener('click', () => {
      const passInp = document.getElementById('gateLoginPassword');
      if (passInp) passInp.type = passInp.type === 'password' ? 'text' : 'password';
    });
  }

  // 1-Click OpenFlow Team Access Chips
  document.querySelectorAll('.gate-demo-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const email = chip.getAttribute('data-email');
      const pass = chip.getAttribute('data-pass');
      document.getElementById('gateLoginEmail').value = email;
      document.getElementById('gateLoginPassword').value = pass;
      executeGatewayLogin(email, pass);
    });
  });
}

function switchGatewayTab(tab) {
  const gateTabLoginBtn = document.getElementById('gateTabLoginBtn');
  const gateTabRegisterBtn = document.getElementById('gateTabRegisterBtn');
  const gateLoginForm = document.getElementById('gateLoginForm');
  const gateRegisterForm = document.getElementById('gateRegisterForm');

  hideGatewayAlert();

  if (tab === 'login') {
    if (gateTabLoginBtn) {
      gateTabLoginBtn.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
      gateTabLoginBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
    }
    if (gateTabRegisterBtn) {
      gateTabRegisterBtn.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
      gateTabRegisterBtn.classList.add('text-slate-600', 'dark:text-slate-400');
    }
    if (gateLoginForm) gateLoginForm.classList.remove('hidden');
    if (gateRegisterForm) gateRegisterForm.classList.add('hidden');
  } else {
    if (gateTabRegisterBtn) {
      gateTabRegisterBtn.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
      gateTabRegisterBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
    }
    if (gateTabLoginBtn) {
      gateTabLoginBtn.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
      gateTabLoginBtn.classList.add('text-slate-600', 'dark:text-slate-400');
    }
    if (gateRegisterForm) gateRegisterForm.classList.remove('hidden');
    if (gateLoginForm) gateLoginForm.classList.add('hidden');

    setTimeout(() => {
      const nameInput = document.getElementById('gateRegFullName');
      if (nameInput) nameInput.focus();
    }, 50);
  }
}

function showGatewayAlert(msg, isError = true) {
  const box = document.getElementById('gateAlertBox');
  if (!box) return;
  box.textContent = msg;
  box.className = `p-3 rounded-lg text-xs font-semibold ${isError ? 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'}`;
  box.classList.remove('hidden');
}

function hideGatewayAlert() {
  const box = document.getElementById('gateAlertBox');
  if (box) box.classList.add('hidden');
}

function fillAdminCredentials(target) {
  if (target === 'gate') {
    const e = document.getElementById('gateLoginEmail');
    const p = document.getElementById('gateLoginPassword');
    if (e) e.value = 'admin@openflow.io';
    if (p) p.value = 'admin123';
  } else {
    const e = document.getElementById('loginEmail');
    const p = document.getElementById('loginPassword');
    if (e) e.value = 'admin@openflow.io';
    if (p) p.value = 'admin123';
  }
}

async function executeGatewayLogin(email, password) {
  hideGatewayAlert();
  const emailInput = document.getElementById('gateLoginEmail');
  const passInput = document.getElementById('gateLoginPassword');

  let finalEmail = (email !== undefined && typeof email === 'string' && email.trim()) ? email.trim() : (emailInput ? emailInput.value.trim() : '');
  let finalPass = (password !== undefined && typeof password === 'string' && password) ? password : (passInput ? passInput.value : '');

  if (!finalEmail) {
    showGatewayAlert("Please enter your email address.");
    if (emailInput) emailInput.focus();
    return;
  }
  if (!finalPass) {
    showGatewayAlert("Please enter your password.");
    if (passInput) passInput.focus();
    return;
  }

  const btn = document.getElementById('gateLoginSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Signing in...';
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: finalEmail, password: finalPass })
    });
    const json = await res.json();
    if (json.success) {
      currentUser = json.user;
      authToken = json.token;
      currentRole = currentUser.role || 'admin';
      localStorage.setItem('openflow_token', authToken);
      localStorage.setItem('openflow_user', JSON.stringify(currentUser));

      // Unlock Main Work OS Workspace
      setAppAuthScreen(true);

      updateUserUI();
      await fetchBoardDataFromDB();
      showLiveBroadcast(`Welcome, ${currentUser.full_name}! Authenticated into OpenFlow Work OS.`);
    } else {
      showGatewayAlert(json.error || "Invalid email or password.");
    }
  } catch (err) {
    console.error("Login fetch error:", err);
    showGatewayAlert("Failed to connect to authentication server. Please retry.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> Sign In to Work OS';
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function executeGatewayRegister() {
  hideGatewayAlert();
  const nameEl = document.getElementById('gateRegFullName');
  const emailEl = document.getElementById('gateRegEmail');
  const passEl = document.getElementById('gateRegPassword');
  const confirmEl = document.getElementById('gateRegConfirmPassword');
  const orgEl = document.getElementById('gateRegOrg');
  const roleEl = document.getElementById('gateRegRole');
  const btn = document.getElementById('gateRegisterSubmitBtn');

  let fullName = nameEl ? nameEl.value.trim() : '';
  let email = emailEl ? emailEl.value.trim() : '';
  let pass = passEl ? passEl.value : '';
  let confirmPass = confirmEl ? confirmEl.value : '';
  let org = orgEl ? orgEl.value.trim() : 'OpenFlow Workspace';
  let role = roleEl ? roleEl.value : 'admin';

  if (!email && fullName) {
    email = `${fullName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@openflow.io`;
  } else if (!email) {
    email = `user_${Date.now().toString().slice(-4)}@openflow.io`;
  }

  if (!fullName) {
    fullName = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  if (!pass) pass = 'pass123';
  if (!confirmPass) confirmPass = pass;

  if (confirmPass && pass !== confirmPass) {
    showGatewayAlert("Passwords do not match. Please re-enter.");
    if (confirmEl) confirmEl.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creating Account...';
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        email: email,
        password: pass,
        organization: org || 'OpenFlow Workspace',
        role: role || 'admin'
      })
    });
    const json = await res.json();
    if (json.success) {
      currentUser = json.user;
      authToken = json.token;
      currentRole = currentUser.role || 'admin';
      localStorage.setItem('openflow_token', authToken);
      localStorage.setItem('openflow_user', JSON.stringify(currentUser));

      // Unlock Main Work OS Workspace
      setAppAuthScreen(true);

      updateUserUI();
      await fetchBoardDataFromDB();
      showLiveBroadcast(`Account created! Welcome to OpenFlow Work OS, ${currentUser.full_name}.`);
    } else {
      showGatewayAlert(json.error || "Registration failed.");
    }
  } catch (err) {
    console.error("Register fetch error:", err);
    showGatewayAlert("Server connection error during registration.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="user-check" class="w-4 h-4"></i> Create Work OS Account';
      if (window.lucide) lucide.createIcons();
    }
  }
}

function initEventListeners() {
  // 0. Theme initialization complete (handlers bound via inline onclick)

  // 1. Outside Click Dismissal for Dropdowns
  document.addEventListener('click', (e) => {
    const userDropdownMenu = document.getElementById('userDropdownMenu');
    const userProfileBtn = document.getElementById('userProfileBtn');
    if (userDropdownMenu && !userDropdownMenu.classList.contains('hidden')) {
      if (userProfileBtn && !userProfileBtn.contains(e.target) && !userDropdownMenu.contains(e.target)) {
        userDropdownMenu.classList.add('hidden');
      }
    }
    const exportDropdownMenu = document.getElementById('exportDropdownMenu');
    const exportDropdownBtn = document.getElementById('exportDropdownBtn');
    if (exportDropdownMenu && !exportDropdownMenu.classList.contains('hidden')) {
      if (exportDropdownBtn && !exportDropdownBtn.contains(e.target) && !exportDropdownMenu.contains(e.target)) {
        exportDropdownMenu.classList.add('hidden');
      }
    }
  });

  // 2. In-App Authentication Modal Controls (For fast switching)
  const authModal = document.getElementById('authModal');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
  const openAuthModalFromDropdownBtn = document.getElementById('openAuthModalFromDropdownBtn');
  const authTabLoginBtn = document.getElementById('authTabLoginBtn');
  const authTabRegisterBtn = document.getElementById('authTabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const logoutBtn = document.getElementById('logoutBtn');

  if (openAuthModalFromDropdownBtn && authModal) {
    openAuthModalFromDropdownBtn.addEventListener('click', () => {
      userDropdownMenu.classList.add('hidden');
      openAuthModal('login');
    });
  }

  if (closeAuthModalBtn && authModal) {
    closeAuthModalBtn.addEventListener('click', () => authModal.classList.add('hidden'));
  }

  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const registerSubmitBtn = document.getElementById('registerSubmitBtn');

  if (authTabLoginBtn && authTabRegisterBtn) {
    authTabLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthModalTab('login');
    });
    authTabRegisterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthModalTab('register');
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const pass = document.getElementById('loginPassword').value.trim();
      await handleInAppLogin(email, pass);
    });
  }
  if (loginSubmitBtn) {
    loginSubmitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const pass = document.getElementById('loginPassword').value.trim();
      await handleInAppLogin(email, pass);
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', handleInAppRegister);
  }
  if (registerSubmitBtn) {
    registerSubmitBtn.addEventListener('click', handleInAppRegister);
  }

  document.querySelectorAll('.demo-login-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const email = chip.getAttribute('data-email');
      const pass = chip.getAttribute('data-pass');
      document.getElementById('loginEmail').value = email;
      document.getElementById('loginPassword').value = pass;
      handleInAppLogin(email, pass);
    });
  });

  const toggleLoginPasswordBtn = document.getElementById('toggleLoginPasswordBtn');
  if (toggleLoginPasswordBtn) {
    toggleLoginPasswordBtn.addEventListener('click', () => {
      const passInput = document.getElementById('loginPassword');
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // 3. User Database & Team Management Modal Controls
  const openUserManagementBtn = document.getElementById('openUserManagementBtn');
  const userManagementModal = document.getElementById('userManagementModal');
  const closeUserManagementBtn = document.getElementById('closeUserManagementBtn');
  const closeUserManagementBottomBtn = document.getElementById('closeUserManagementBottomBtn');
  const addUserFromModalBtn = document.getElementById('addUserFromModalBtn');

  if (openUserManagementBtn && userManagementModal) {
    openUserManagementBtn.addEventListener('click', () => {
      userDropdownMenu.classList.add('hidden');
      openUserDatabaseModal();
    });
  }

  [closeUserManagementBtn, closeUserManagementBottomBtn].forEach(b => {
    if (b) b.addEventListener('click', () => userManagementModal.classList.add('hidden'));
  });

  if (addUserFromModalBtn) {
    addUserFromModalBtn.addEventListener('click', () => {
      userManagementModal.classList.add('hidden');
      openAuthModal('register');
    });
  }

  // Project Workspace Switcher
  const tenantSelect = document.getElementById('tenantSelect');
  if (tenantSelect) {
    tenantSelect.addEventListener('change', (e) => {
      currentTenantKey = e.target.value;
      const selectedObj = allTenantsList.find(t => t.tenant_id === currentTenantKey);
      const projectTitle = selectedObj ? selectedObj.title : currentTenantKey;
      fetchBoardDataFromDB();
      showLiveBroadcast(`Switched to project workspace '${projectTitle}'. Loading workspace data...`);
    });
  }

  // RBAC Role Switcher
  const rbacRoleSelect = document.getElementById('rbacRoleSelect');
  if (rbacRoleSelect) {
    rbacRoleSelect.addEventListener('change', (e) => {
      currentRole = e.target.value;
      if (currentUser) {
        currentUser.role = currentRole;
        localStorage.setItem('openflow_user', JSON.stringify(currentUser));
        updateUserUI();
      }
      showLiveBroadcast(`Active Role changed to '${currentRole}'. Permissions matrix applied.`);
      renderCurrentView();
    });
  }

  // View Switcher Tabs
  const viewBtns = document.querySelectorAll('.view-tab-btn');
  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      viewBtns.forEach(b => {
        b.classList.remove('bg-white', 'text-slate-900', 'shadow-xs');
        b.classList.add('text-slate-600');
      });
      btn.classList.add('bg-white', 'text-slate-900', 'shadow-xs');
      btn.classList.remove('text-slate-600');

      currentView = btn.getAttribute('data-view');
      switchView(currentView);
    });
  });

  // Search Filter
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.toLowerCase().trim();
      renderCurrentView();
    });
  }

  // Group By Selector
  const groupBySelect = document.getElementById('groupBySelect');
  if (groupBySelect) {
    groupBySelect.addEventListener('change', (e) => {
      currentGroupBy = e.target.value;
      renderCurrentView();
    });
  }

  // Clear Board Button (Clean Slate)
  const clearBoardBtn = document.getElementById('clearBoardBtn');
  if (clearBoardBtn) {
    clearBoardBtn.addEventListener('click', handleClearBoard);
  }

  // Delete Project Button
  const deleteProjectBtn = document.getElementById('deleteProjectBtn');
  if (deleteProjectBtn) {
    deleteProjectBtn.addEventListener('click', handleDeleteProject);
  }

  // Create New Schema Modal
  const openNewSchemaModalBtn = document.getElementById('openNewSchemaModalBtn');
  const newSchemaModal = document.getElementById('newSchemaModal');
  const closeNewSchemaBtn = document.getElementById('closeNewSchemaBtn');
  const cancelNewSchemaBtn = document.getElementById('cancelNewSchemaBtn');
  const newSchemaForm = document.getElementById('newSchemaForm');

  if (openNewSchemaModalBtn && newSchemaModal) {
    openNewSchemaModalBtn.addEventListener('click', () => {
      document.getElementById('newSchemaForm').reset();
      newSchemaModal.classList.remove('hidden');
    });
    [closeNewSchemaBtn, cancelNewSchemaBtn].forEach(b => {
      if (b) b.addEventListener('click', () => newSchemaModal.classList.add('hidden'));
    });
    if (newSchemaForm) {
      newSchemaForm.addEventListener('submit', handleCreateNewSchema);
    }
  }

  // Project Workspaces Manager Modal
  const openProjectManagerBtn = document.getElementById('openProjectManagerBtn');
  const projectManagerModal = document.getElementById('projectManagerModal');
  const closeProjectManagerBtn = document.getElementById('closeProjectManagerBtn');
  const dismissProjectManagerBtn = document.getElementById('dismissProjectManagerBtn');
  const projectManagerBackdrop = document.getElementById('projectManagerBackdrop');
  const createProjectFromManagerBtn = document.getElementById('createProjectFromManagerBtn');

  if (openProjectManagerBtn && projectManagerModal) {
    openProjectManagerBtn.addEventListener('click', renderProjectManagerModal);
    [closeProjectManagerBtn, dismissProjectManagerBtn, projectManagerBackdrop].forEach(b => {
      if (b) b.addEventListener('click', () => projectManagerModal.classList.add('hidden'));
    });
    if (createProjectFromManagerBtn) {
      createProjectFromManagerBtn.addEventListener('click', () => {
        projectManagerModal.classList.add('hidden');
        document.getElementById('newSchemaForm').reset();
        document.getElementById('newSchemaModal').classList.remove('hidden');
      });
    }
  }

  // Insert New Project Modal
  const openNewProjectModalBtn = document.getElementById('openNewProjectModalBtn');
  const newProjectModal = document.getElementById('newProjectModal');
  const closeNewProjectBtn = document.getElementById('closeNewProjectBtn');
  const cancelNewProjectBtn = document.getElementById('cancelNewProjectBtn');
  const newProjectForm = document.getElementById('newProjectForm');

  if (openNewProjectModalBtn && newProjectModal) {
    openNewProjectModalBtn.addEventListener('click', () => {
      renderDynamicCustomFieldsInModal();
      newProjectModal.classList.remove('hidden');
    });
    [closeNewProjectBtn, cancelNewProjectBtn].forEach(b => {
      if (b) b.addEventListener('click', () => newProjectModal.classList.add('hidden'));
    });
    if (newProjectForm) {
      newProjectForm.addEventListener('submit', handleInsertProjectForm);
    }
  }

  // Edit Feature Modal
  const editFeatureModal = document.getElementById('editFeatureModal');
  const closeEditFeatureBtn = document.getElementById('closeEditFeatureBtn');
  const cancelEditFeatureBtn = document.getElementById('cancelEditFeatureBtn');
  const editFeatureForm = document.getElementById('editFeatureForm');

  if (editFeatureModal) {
    [closeEditFeatureBtn, cancelEditFeatureBtn].forEach(b => {
      if (b) b.addEventListener('click', () => editFeatureModal.classList.add('hidden'));
    });
    if (editFeatureForm) {
      editFeatureForm.addEventListener('submit', handleEditFeatureForm);
    }
  }

  // Global Delegator for .edit-row-btn
  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-row-btn');
    if (editBtn) {
      e.stopPropagation();
      const itemId = editBtn.getAttribute('data-item-id');
      if (itemId) openEditFeatureModal(itemId);
    }
  });

  // Add Dynamic Column Modal
  const openAddColumnBtn = document.getElementById('openAddColumnBtn');
  const addColumnModal = document.getElementById('addColumnModal');
  const closeAddColumnBtn = document.getElementById('closeAddColumnBtn');
  const cancelAddColumnBtn = document.getElementById('cancelAddColumnBtn');
  const saveNewColumnBtn = document.getElementById('saveNewColumnBtn');

  if (openAddColumnBtn && addColumnModal) {
    openAddColumnBtn.addEventListener('click', () => {
      document.getElementById('newColTitle').value = '';
      addColumnModal.classList.remove('hidden');
    });
    [closeAddColumnBtn, cancelAddColumnBtn].forEach(b => {
      if (b) b.addEventListener('click', () => addColumnModal.classList.add('hidden'));
    });
    if (saveNewColumnBtn) {
      saveNewColumnBtn.addEventListener('click', handleCreateColumn);
    }
  }

  // Automation Drawer
  const openAutomationsBtn = document.getElementById('openAutomationsBtn');
  const automationDrawer = document.getElementById('automationDrawer');
  const closeAutomationDrawerBtn = document.getElementById('closeAutomationDrawerBtn');
  const automationDrawerBackdrop = document.getElementById('automationDrawerBackdrop');
  const saveCustomAutomationBtn = document.getElementById('saveCustomAutomationBtn');

  if (openAutomationsBtn && automationDrawer) {
    openAutomationsBtn.addEventListener('click', () => {
      renderAutomationRecipes();
      automationDrawer.classList.remove('hidden');
      setTimeout(() => {
        document.getElementById('automationDrawerPanel').classList.remove('translate-x-full');
        automationDrawerBackdrop.classList.remove('opacity-0');
      }, 10);
    });

    const closeAuto = () => {
      document.getElementById('automationDrawerPanel').classList.add('translate-x-full');
      automationDrawerBackdrop.classList.add('opacity-0');
      setTimeout(() => automationDrawer.classList.add('hidden'), 250);
    };

    if (closeAutomationDrawerBtn) closeAutomationDrawerBtn.addEventListener('click', closeAuto);
    if (automationDrawerBackdrop) automationDrawerBackdrop.addEventListener('click', closeAuto);
    if (saveCustomAutomationBtn) saveCustomAutomationBtn.addEventListener('click', handleCreateAutomation);
  }

  // Audit Trail Drawer
  const openAuditBtn = document.getElementById('openAuditBtn');
  const auditDrawer = document.getElementById('auditDrawer');
  const closeAuditDrawerBtn = document.getElementById('closeAuditDrawerBtn');
  const auditDrawerBackdrop = document.getElementById('auditDrawerBackdrop');

  if (openAuditBtn && auditDrawer) {
    openAuditBtn.addEventListener('click', () => {
      renderAuditLogs();
      auditDrawer.classList.remove('hidden');
      setTimeout(() => {
        document.getElementById('auditDrawerPanel').classList.remove('translate-x-full');
        auditDrawerBackdrop.classList.remove('opacity-0');
      }, 10);
    });

    const closeAudit = () => {
      document.getElementById('auditDrawerPanel').classList.add('translate-x-full');
      auditDrawerBackdrop.classList.add('opacity-0');
      setTimeout(() => auditDrawer.classList.add('hidden'), 250);
    };

    if (closeAuditDrawerBtn) closeAuditDrawerBtn.addEventListener('click', closeAudit);
    if (auditDrawerBackdrop) auditDrawerBackdrop.addEventListener('click', closeAudit);
  }

  // Database JSONB Inspector Modal
  const openDbInspectorBtn = document.getElementById('openDbInspectorBtn');
  const dbInspectorModal = document.getElementById('dbInspectorModal');
  const closeDbInspectorBtn = document.getElementById('closeDbInspectorBtn');
  const closeDbInspectorBottomBtn = document.getElementById('closeDbInspectorBottomBtn');
  const dbInspectorBackdrop = document.getElementById('dbInspectorBackdrop');

  if (openDbInspectorBtn && dbInspectorModal) {
    openDbInspectorBtn.addEventListener('click', () => {
      updateJsonbInspector();
      dbInspectorModal.classList.remove('hidden');
    });
    [closeDbInspectorBtn, closeDbInspectorBottomBtn, dbInspectorBackdrop].forEach(b => {
      if (b) b.addEventListener('click', () => dbInspectorModal.classList.add('hidden'));
    });
  }

  // RBAC Matrix Modal
  const openRbacMatrixBtn = document.getElementById('openRbacMatrixBtn');
  const rbacMatrixModal = document.getElementById('rbacMatrixModal');
  const closeRbacMatrixBtn = document.getElementById('closeRbacMatrixBtn');
  const closeRbacMatrixBottomBtn = document.getElementById('closeRbacMatrixBottomBtn');
  const rbacMatrixBackdrop = document.getElementById('rbacMatrixBackdrop');

  if (openRbacMatrixBtn && rbacMatrixModal) {
    openRbacMatrixBtn.addEventListener('click', () => rbacMatrixModal.classList.remove('hidden'));
    [closeRbacMatrixBtn, closeRbacMatrixBottomBtn, rbacMatrixBackdrop].forEach(b => {
      if (b) b.addEventListener('click', () => rbacMatrixModal.classList.add('hidden'));
    });
  }

  // Full-Screen Project Website Preview Modal Listeners
  const closeWebsiteModalBtn = document.getElementById('closeWebsiteModalBtn');
  const closeWebsiteModalDot = document.getElementById('closeWebsiteModalDot');
  const refreshWebsiteIframeBtn = document.getElementById('refreshWebsiteIframeBtn');

  if (closeWebsiteModalBtn) closeWebsiteModalBtn.addEventListener('click', closeProjectWebsiteModal);
  if (closeWebsiteModalDot) closeWebsiteModalDot.addEventListener('click', closeProjectWebsiteModal);

  if (refreshWebsiteIframeBtn) {
    refreshWebsiteIframeBtn.addEventListener('click', () => {
      const iframe = document.getElementById('websitePreviewIframe');
      const url = document.getElementById('previewModalUrlText').textContent;
      if (iframe) {
        iframe.src = 'about:blank';
        setTimeout(() => { iframe.src = `/api/proxy-site?url=${encodeURIComponent(url)}`; }, 50);
      }
    });
  }

  // Device Viewport Switchers
  document.querySelectorAll('.viewport-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      const wrapper = document.getElementById('websiteIframeWrapper');
      
      document.querySelectorAll('.viewport-toggle-btn').forEach(b => {
        b.classList.remove('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-slate-100', 'shadow-2xs');
      });
      btn.classList.add('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-slate-100', 'shadow-2xs');

      if (wrapper) {
        if (mode === 'desktop') {
          wrapper.className = 'w-full h-full transition-all duration-300 rounded-lg overflow-hidden shadow-md bg-white';
        } else if (mode === 'tablet') {
          wrapper.className = 'w-[768px] max-w-full h-full transition-all duration-300 rounded-2xl overflow-hidden shadow-2xl bg-white border-8 border-slate-800';
        } else if (mode === 'mobile') {
          wrapper.className = 'w-[390px] max-w-full h-full transition-all duration-300 rounded-3xl overflow-hidden shadow-2xl bg-white border-8 border-slate-900';
        }
      }
    });
  });

  // Global Click to close popup status picker
  document.addEventListener('click', (e) => {
    const statusPopup = document.getElementById('statusPickerPopup');
    if (statusPopup && !statusPopup.contains(e.target) && !e.target.closest('.status-badge-trigger')) {
      statusPopup.classList.add('hidden');
    }
  });

  // Escape key to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProjectWebsiteModal();
    }
  });
}

// =========================================================================
// 4. IN-APP MODAL AUTHENTICATION & LOGOUT
// =========================================================================

function openAuthModal(tab = 'login') {
  const authModal = document.getElementById('authModal');
  if (!authModal) return;
  hideAuthModalAlert();
  switchAuthModalTab(tab);
  authModal.classList.remove('hidden');
}

function switchAuthModalTab(tab) {
  const tabLoginBtn = document.getElementById('authTabLoginBtn');
  const tabRegisterBtn = document.getElementById('authTabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  hideAuthModalAlert();

  if (tab === 'login') {
    tabLoginBtn.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
    tabLoginBtn.classList.remove('text-slate-600');
    tabRegisterBtn.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
    tabRegisterBtn.classList.add('text-slate-600');

    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    tabRegisterBtn.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
    tabRegisterBtn.classList.remove('text-slate-600');
    tabLoginBtn.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
    tabLoginBtn.classList.add('text-slate-600');

    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
}

function showAuthModalAlert(msg, isError = true) {
  const box = document.getElementById('authAlertBox');
  if (!box) return;
  box.textContent = msg;
  box.className = `p-3 rounded-lg text-xs font-semibold ${isError ? 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'}`;
  box.classList.remove('hidden');
}

function hideAuthModalAlert() {
  const box = document.getElementById('authAlertBox');
  if (box) box.classList.add('hidden');
}

async function handleInAppLogin(email, password) {
  hideAuthModalAlert();
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');

  let finalEmail = (email !== undefined && typeof email === 'string' && email.trim()) ? email.trim() : (emailInput ? emailInput.value.trim() : '');
  let finalPass = (password !== undefined && typeof password === 'string' && password) ? password : (passInput ? passInput.value : '');

  if (!finalEmail) finalEmail = 'lead.dev@openflow.io';
  if (!finalPass) finalPass = 'dev123';

  const btn = document.getElementById('loginSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Signing in...';
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: finalEmail, password: finalPass })
    });
    const json = await res.json();
    if (json.success) {
      currentUser = json.user;
      authToken = json.token;
      currentRole = currentUser.role || 'admin';
      localStorage.setItem('openflow_token', authToken);
      localStorage.setItem('openflow_user', JSON.stringify(currentUser));

      updateUserUI();
      document.getElementById('authModal').classList.add('hidden');
      document.getElementById('loginForm').reset();
      showLiveBroadcast(`Switched account to ${currentUser.full_name} (${currentUser.role}).`);
      await fetchBoardDataFromDB();
    } else {
      showAuthModalAlert(json.error || "Invalid credentials.");
    }
  } catch (err) {
    showAuthModalAlert("Failed to connect to authentication server.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> Sign In to Work OS';
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function handleInAppRegister(e) {
  e.preventDefault();
  hideAuthModalAlert();

  const fullName = document.getElementById('regFullName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPassword').value;
  const confirmPass = document.getElementById('regConfirmPassword').value;
  const org = document.getElementById('regOrg').value.trim();
  const role = document.getElementById('regRole').value;
  const btn = document.getElementById('registerSubmitBtn');

  if (!fullName) {
    showAuthModalAlert("Please enter your full name.");
    return;
  }
  if (!email) {
    showAuthModalAlert("Please enter an email address.");
    return;
  }
  if (!pass) {
    showAuthModalAlert("Please enter a password.");
    return;
  }
  if (pass !== confirmPass) {
    showAuthModalAlert("Passwords do not match. Please re-enter.");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creating Account...';
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        email: email,
        password: pass,
        organization: org || 'OpenFlow Workspace',
        role: role || 'admin'
      })
    });
    const json = await res.json();
    if (json.success) {
      currentUser = json.user;
      authToken = json.token;
      currentRole = currentUser.role || 'admin';
      localStorage.setItem('openflow_token', authToken);
      localStorage.setItem('openflow_user', JSON.stringify(currentUser));

      updateUserUI();
      document.getElementById('authModal').classList.add('hidden');
      document.getElementById('registerForm').reset();
      showLiveBroadcast(`Account created! Welcome to OpenFlow Work OS, ${currentUser.full_name}.`);
      await fetchBoardDataFromDB();
    } else {
      showAuthModalAlert(json.error || "Registration failed.");
    }
  } catch (err) {
    showAuthModalAlert("Server connection error during registration.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="user-check" class="w-4 h-4"></i> Create Work OS Account';
      if (window.lucide) lucide.createIcons();
    }
  }
}


// 5. USER DATABASE MODAL MANAGEMENT
async function openUserDatabaseModal() {
  const modal = document.getElementById('userManagementModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await refreshUsersTable();
}

async function refreshUsersTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/users', { headers: getAuthHeaders() });
    const json = await res.json();
    if (json.success) {
      allUsersList = json.users;
      let html = '';
      allUsersList.forEach(u => {
        const isCurrent = currentUser && u.id === currentUser.id;
        const rolePill = getPriorityClass(u.role === 'admin' ? 'Critical' : u.role === 'dept_head' ? 'High' : 'Medium');

        html += `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="p-3">
              <div class="font-bold text-slate-900 flex items-center gap-1.5">
                <span>${u.full_name}</span>
                ${isCurrent ? '<span class="text-[9px] bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-300 px-1 rounded font-bold">YOU</span>' : ''}
              </div>
              <div class="text-[11px] text-slate-500 font-mono">${u.email}</div>
            </td>
            <td class="p-3 font-medium text-slate-700">${u.organization || 'General Org'}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${rolePill}">
                ${u.role}
              </span>
            </td>
            <td class="p-3 text-right">
              ${!isCurrent ? `
                <button class="delete-user-btn text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded" data-user-id="${u.id}" data-user-name="${u.full_name}" title="Delete User">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              ` : '<span class="text-slate-300 text-xs">—</span>'}
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
      lucide.createIcons();

      tbody.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.getAttribute('data-user-id');
          const uname = btn.getAttribute('data-user-name');
          if (confirm(`Are you sure you want to remove user '${uname}' from the database?`)) {
            await deleteUserFromDB(uid);
          }
        });
      });
    }
  } catch (err) {
    console.error("Failed to fetch users:", err);
  }
}

async function deleteUserFromDB(userId) {
  try {
    const res = await fetch(`/api/users?id=${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      showLiveBroadcast(`User account removed from database.`);
      await refreshUsersTable();
    }
  } catch (err) {
    console.error(err);
  }
}

// =========================================================================
// 6. VIEW ENGINE & RENDER DISPATCHER
// =========================================================================

function renderApp() {
  const boardTitleEl = document.getElementById('boardTitle');
  const boardDescEl = document.getElementById('boardDescription');
  const activeTenantBadge = document.getElementById('activeTenantBadge');
  const automationCountBadge = document.getElementById('automationCountBadge');
  const viewWebsiteBtn = document.getElementById('viewWebsiteBtn');

  if (boardTitleEl) boardTitleEl.textContent = activeBoard.title;
  if (boardDescEl) boardDescEl.textContent = activeBoard.description;
  if (activeTenantBadge) {
    activeTenantBadge.innerHTML = `<i data-lucide="folder-kanban" class="w-3 h-3 text-slate-600 dark:text-zinc-400 inline mr-1"></i><span>Project: ${activeBoard.title}</span>`;
  }
  if (automationCountBadge) automationCountBadge.textContent = activeAutomations.filter(a => a.active).length;

  if (viewWebsiteBtn && activeBoard) {
    const webUrl = activeBoard.website_url || `https://${(activeBoard.schema || 'openflow').replace(/_/g, '-')}.gov.ph`;
    viewWebsiteBtn.title = `View Live Website: ${webUrl} (Full Screen Pop-up)`;
    viewWebsiteBtn.onclick = () => openProjectWebsiteModal(webUrl, activeBoard.title);
  }

  renderCurrentView();
  updateJsonbInspector();
  lucide.createIcons();
}

function switchView(viewName) {
  currentView = viewName;
  const plannerCont = document.getElementById('plannerViewContainer');
  const financeCont = document.getElementById('financeViewContainer');
  const tableCont = document.getElementById('tableViewContainer');
  const kanbanCont = document.getElementById('kanbanViewContainer');
  const timelineCont = document.getElementById('timelineViewContainer');
  const dashCont = document.getElementById('dashboardViewContainer');

  [plannerCont, financeCont, tableCont, kanbanCont, timelineCont, dashCont].forEach(c => {
    if (c) c.classList.add('hidden');
  });

  if (viewName === 'planner' && plannerCont) plannerCont.classList.remove('hidden');
  if (viewName === 'finance' && financeCont) financeCont.classList.remove('hidden');
  if (viewName === 'table' && tableCont) tableCont.classList.remove('hidden');
  if (viewName === 'kanban' && kanbanCont) kanbanCont.classList.remove('hidden');
  if (viewName === 'timeline' && timelineCont) timelineCont.classList.remove('hidden');
  if (viewName === 'dashboard' && dashCont) dashCont.classList.remove('hidden');

  // Update Breadcrumb
  const breadcrumb = document.getElementById('activeViewBreadcrumb');
  const viewNamesMap = {
    planner: 'Planner & Notes',
    finance: 'Finance & Budget',
    table: 'Data Grid',
    kanban: 'Kanban Board',
    timeline: 'Delivery Timeline',
    dashboard: 'Executive Analytics'
  };
  if (breadcrumb) breadcrumb.textContent = viewNamesMap[viewName] || 'Data Grid';

  // Synchronize Sidebar & View Buttons
  const sidebarBtns = document.querySelectorAll('.sidebar-view-btn');
  sidebarBtns.forEach(btn => {
    if (btn.getAttribute('data-view') === viewName) {
      btn.classList.add('active', 'bg-slate-100', 'dark:bg-[#27272a]', 'text-slate-900', 'dark:text-white');
      btn.classList.remove('text-slate-700', 'dark:text-slate-300');
    } else {
      btn.classList.remove('active', 'bg-slate-100', 'dark:bg-[#27272a]', 'text-slate-900', 'dark:text-white');
      btn.classList.add('text-slate-700', 'dark:text-slate-300');
    }
  });

  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === 'planner') renderPlannerView();
  else if (currentView === 'finance') renderFinanceView();
  else if (currentView === 'table') renderTableView();
  else if (currentView === 'kanban') renderKanbanView();
  else if (currentView === 'timeline') renderTimelineView();
  else if (currentView === 'dashboard') renderDashboardView();
  if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 7. VIEW ENGINE MODULE 1: TABLE / DATA GRID
// =========================================================================


// =========================================================================
// 8.5 VIEW ENGINE MODULE: WORKSPACE PLANNER & SCRATCHPAD VIEW SECTION
// =========================================================================

async function renderPlannerView() {
  const container = document.getElementById('plannerViewContainer');
  if (!container) return;

  if (!currentPlannerData.notes && (!currentPlannerData.todos || currentPlannerData.todos.length === 0)) {
    await loadPlannerData();
  }

  const todos = currentPlannerData.todos || [];
  const completedCount = todos.filter(t => t.done).length;

  container.innerHTML = `
    <div class="space-y-4 w-full">
      
      <!-- Top Planner Summary Banner -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white dark:bg-[#18181b] rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#202024] text-slate-900 dark:text-white flex items-center justify-center font-bold">
            <i data-lucide="notebook-pen" class="w-5 h-5 text-slate-900 dark:text-slate-100"></i>
          </div>
          <div>
            <h2 class="text-sm font-extrabold text-slate-900 dark:text-white">
              ${activeBoard ? activeBoard.title : 'Workspace'} • Strategy & Sprint Planner
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              Live scratchpad notes, meeting minutes, and action items synced with SQLite.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 text-xs">
          <span class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#27272a] text-slate-700 dark:text-slate-300 font-mono text-[11px] font-semibold border border-slate-200 dark:border-[#38383e] flex items-center gap-1.5">
            <i data-lucide="database" class="w-3.5 h-3.5 text-slate-900 dark:text-slate-100"></i> SQLite Auto-save
          </span>
          <span id="plannerSaveStatus" class="font-medium text-slate-500 dark:text-slate-400 text-[11px]">Auto-saved</span>
        </div>
      </div>

      <!-- 2-Column Responsive Layout -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 w-full">
        
        <!-- LEFT COLUMN (7 Cols): Scratchpad & Meeting Notes -->
        <div class="lg:col-span-7 bg-white dark:bg-[#18181b] p-5 rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs space-y-3 flex flex-col">
          <div class="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div class="flex items-center gap-2">
              <i data-lucide="file-text" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
              <h3 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Scratchpad & Project Specs</h3>
            </div>
            
            <div class="flex items-center gap-2">
              <button type="button" onclick="insertNoteTimestamp()" class="px-2 py-1 bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#38383e] rounded-lg text-[11px] font-semibold text-slate-700 dark:text-slate-300 transition-colors">
                + Timestamp
              </button>
              <button type="button" onclick="insertNoteBullet()" class="px-2 py-1 bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#38383e] rounded-lg text-[11px] font-semibold text-slate-700 dark:text-slate-300 transition-colors">
                • Bullet
              </button>
              <span id="plannerCharCount" class="font-mono text-[10px] text-slate-400 pl-1">0 chars</span>
            </div>
          </div>

          <textarea id="plannerNotesTextarea" oninput="handlePlannerNoteInput()" rows="22" placeholder="Write project architecture notes, meeting minutes, acceptance criteria, or ideas here... Changes auto-save instantly to SQLite." class="w-full flex-1 p-4 rounded-xl border border-slate-200 dark:border-[#27272a] bg-slate-50/60 dark:bg-[#121214] text-slate-900 dark:text-slate-100 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600 resize-none"></textarea>
        </div>

        <!-- RIGHT COLUMN (5 Cols): Sprint & Daily Action Items -->
        <div class="lg:col-span-5 bg-white dark:bg-[#18181b] p-5 rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs space-y-4 flex flex-col">
          <div class="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div class="flex items-center gap-2">
              <i data-lucide="check-square" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
              <h3 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Action Items & Tasks</h3>
            </div>
            <span id="plannerTodoProgressText" class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
              ${completedCount}/${todos.length} Done
            </span>
          </div>

          <!-- Add Todo Item Form -->
          <form onsubmit="event.preventDefault(); addPlannerTodoItem();" class="space-y-2">
            <div class="flex gap-2">
              <input type="text" id="newPlannerTodoInput" placeholder="Add an action item or sprint task..." required class="flex-1 px-3 py-2 border border-slate-200 dark:border-[#27272a] rounded-xl bg-slate-50 dark:bg-[#121214] text-slate-900 dark:text-slate-100 text-xs focus:outline-none">
              
              <select id="newPlannerTodoPriority" class="px-2.5 py-2 border border-slate-200 dark:border-[#27272a] rounded-xl bg-slate-50 dark:bg-[#121214] text-slate-800 dark:text-slate-200 text-xs font-semibold focus:outline-none">
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium" selected>Medium</option>
                <option value="Low">Low</option>
              </select>

              <button type="submit" class="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-white dark:text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </form>

          <!-- List of Todos -->
          <div id="plannerTodosList" class="flex-1 space-y-2 overflow-y-auto max-h-[500px] custom-scrollbar pr-1">
            <!-- Rendered dynamically -->
          </div>
        </div>

      </div>

    </div>
  `;

  const textarea = document.getElementById('plannerNotesTextarea');
  if (textarea) {
    textarea.value = currentPlannerData.notes || '';
    updatePlannerCharCount((currentPlannerData.notes || '').length);
  }

  renderPlannerTodos();
  if (window.lucide) lucide.createIcons();
}





// =========================================================================
// 8.6 VIEW ENGINE MODULE: WORKSPACE FINANCE, SYSTEM PRICING & SALARY SHARING
// =========================================================================

let currentFinanceItems = [];
let currentRevenueSharingData = {
  system_selling_price: 1500000.0,
  collected_amount: 1500000.0,
  overhead_reserve_pct: 10.0,
  team_shares: [
    { id: "share_usr_azarel", user_id: "usr_1787711972971", member_name: "Azarel Clight Nadal", email: "azarelclightn@gmail.com", role: "Kryptiah • Lead System Architect & Founder", percentage: 55, status: "Disbursed" },
    { id: "share_usr_admin", user_id: "usr_admin", member_name: "System Administrator", email: "admin@openflow.io", role: "OpenFlow Core Team • Infrastructure Lead", percentage: 30, status: "Disbursed" },
    { id: "share_reserve_kryptiah", user_id: null, member_name: "Kryptiah Enterprise Infrastructure & Server Pool", email: "reserve@kryptiah.io", role: "Server Hosting, APIs & Contingency Reserve", percentage: 15, status: "Disbursed" }
  ]
};

async function renderFinanceView() {
  const container = document.getElementById('financeViewContainer');
  if (!container) return;

  // 1. Fetch Expenses & Capex
  try {
    const res = await fetch(`/api/finance?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      currentFinanceItems = data.finance_items || [];
    }
  } catch (err) {
    console.error('Error fetching finance items:', err);
  }

  // 2. Fetch System Pricing & Revenue Sharing
  try {
    const res = await fetch(`/api/finance/revenue-sharing?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      currentRevenueSharingData = {
        system_selling_price: Number(data.system_selling_price) || 1500000.0,
        collected_amount: Number(data.collected_amount) || Number(data.system_selling_price) || 1500000.0,
        overhead_reserve_pct: Number(data.overhead_reserve_pct) || 10.0,
        team_shares: data.team_shares && data.team_shares.length > 0 ? data.team_shares : [
          { id: "share_usr_azarel", user_id: "usr_1787711972971", member_name: "Azarel Clight Nadal", email: "azarelclightn@gmail.com", role: "Kryptiah • Lead System Architect & Founder", percentage: 55, status: "Disbursed" },
          { id: "share_usr_admin", user_id: "usr_admin", member_name: "System Administrator", email: "admin@openflow.io", role: "OpenFlow Core Team • Infrastructure Lead", percentage: 30, status: "Disbursed" },
          { id: "share_reserve_kryptiah", user_id: null, member_name: "Kryptiah Enterprise Infrastructure & Server Pool", email: "reserve@kryptiah.io", role: "Server Hosting, APIs & Contingency Reserve", percentage: 15, status: "Disbursed" }
        ]
      };
    }
  } catch (err) {
    console.error('Error fetching revenue sharing:', err);
  }

  const items = currentFinanceItems;
  const totalAllocated = items.reduce((sum, it) => sum + (Number(it.allocated) || 0), 0);
  const totalSpent = items.reduce((sum, it) => sum + (Number(it.spent) || 0), 0);
  const remainingBalance = Math.max(0, totalAllocated - totalSpent);
  const burnPct = totalAllocated > 0 ? Math.min(100, Math.round((totalSpent / totalAllocated) * 100)) : 0;

  // Pricing & Sharing Calculations
  const sellingPrice = Number(currentRevenueSharingData.system_selling_price) || 0;
  const collectedAmt = Number(currentRevenueSharingData.collected_amount) || sellingPrice;
  const reservePct = Number(currentRevenueSharingData.overhead_reserve_pct) || 0;
  const reserveAmt = (sellingPrice * (reservePct / 100));
  const distributablePool = Math.max(0, sellingPrice - reserveAmt);
  const teamShares = currentRevenueSharingData.team_shares || [];
  const totalSharePct = teamShares.reduce((sum, s) => sum + (Number(s.percentage) || 0), 0);

  // Format currency helper
  const fmtMoney = (amount) => {
    return '₱' + Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  container.innerHTML = `
    <div class="space-y-6 w-full">
      
      <!-- Top Financial Header Banner -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white dark:bg-[#18181b] rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#202024] text-slate-900 dark:text-white flex items-center justify-center font-bold">
            <i data-lucide="wallet" class="w-5 h-5 text-slate-900 dark:text-slate-100"></i>
          </div>
          <div>
            <h2 class="text-sm font-extrabold text-slate-900 dark:text-white">
              ${activeBoard ? activeBoard.title : 'Workspace'} • System Pricing & Salary Revenue Sharing
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              Configure system sales valuation and calculate team salary disbursements based on sold amount.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" onclick="openExpenseModal()" class="m3-btn-tonal text-xs py-2 flex items-center gap-1.5 shadow-xs">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
            <span>Add Capex Line</span>
          </button>
          <button type="button" onclick="openTeamShareModal()" class="m3-btn-filled text-xs py-2 flex items-center gap-1.5 shadow-xs">
            <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
            <span>Add Team Member</span>
          </button>
        </div>
      </div>

      <!-- =========================================================
           SECTION 1: SYSTEM SELLING PRICE & CONTRACT REVENUE POOL
           ========================================================= -->
      <div class="p-5 bg-white dark:bg-[#18181b] rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div class="flex items-center gap-2">
            <i data-lucide="badge-dollar-sign" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
            <h3 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              System Selling Price & Contract Valuation
            </h3>
          </div>
          
          <!-- Quick Preset Deal Value Selectors -->
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-[10px] uppercase font-bold text-slate-400 mr-1">Deal Presets:</span>
            <button type="button" onclick="setSellingPricePreset(500000)" class="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#38383e] text-black dark:text-white transition-colors">₱500K</button>
            <button type="button" onclick="setSellingPricePreset(1000000)" class="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#38383e] text-black dark:text-white transition-colors">₱1.0M</button>
            <button type="button" onclick="setSellingPricePreset(1500000)" class="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-900 dark:bg-[#27272a] text-white dark:text-white transition-colors">₱1.5M</button>
            <button type="button" onclick="setSellingPricePreset(2500000)" class="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#38383e] text-black dark:text-white transition-colors">₱2.5M</button>
            <button type="button" onclick="setSellingPricePreset(5000000)" class="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#38383e] text-black dark:text-white transition-colors">₱5.0M</button>
          </div>
        </div>

        <!-- Editable Pricing Controls -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-slate-700 dark:text-slate-300">System Selling Price (₱)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-500 dark:text-slate-400 pointer-events-none select-none z-10">₱</span>
              <input type="number" id="systemSellingPriceInput" value="${sellingPrice}" oninput="handleSellingPriceLive(this.value)" style="padding-left: 2.25rem !important;" class="currency-input-field w-full pr-3 py-2.5 border border-slate-200 dark:border-[#38383e] rounded-xl bg-slate-50 dark:bg-[#121214] text-black dark:text-white font-mono font-extrabold text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-slate-700 dark:text-slate-300">Collected / Invoiced Deal (₱)</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-slate-500 dark:text-slate-400 pointer-events-none select-none z-10">₱</span>
              <input type="number" id="collectedAmountInput" value="${collectedAmt}" oninput="handleCollectedLive(this.value)" style="padding-left: 2.25rem !important;" class="currency-input-field w-full pr-3 py-2.5 border border-slate-200 dark:border-[#38383e] rounded-xl bg-slate-50 dark:bg-[#121214] text-black dark:text-white font-mono font-extrabold text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-slate-700 dark:text-slate-300">Company Reserve & Overhead (%)</label>
            <div class="relative">
              <input type="number" id="overheadReservePctInput" value="${reservePct}" step="0.5" min="0" max="50" oninput="handleReserveLive(this.value)" class="w-full px-3 py-2.5 border border-slate-200 dark:border-[#38383e] rounded-xl bg-slate-50 dark:bg-[#121214] text-black dark:text-white font-mono font-extrabold text-sm focus:outline-none focus:ring-2 focus:ring-slate-400">
            </div>
          </div>
        </div>

        <!-- Calculated Pool Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-[#202024] border border-slate-200 dark:border-[#27272a] space-y-1">
            <div class="text-[10px] uppercase font-bold text-slate-400">Total System Contract Sold</div>
            <div id="displaySellingPrice" class="text-xl font-mono font-extrabold text-black dark:text-white">${fmtMoney(sellingPrice)}</div>
            <div class="text-[10px] text-slate-500">Gross contract revenue</div>
          </div>
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-[#202024] border border-slate-200 dark:border-[#27272a] space-y-1">
            <div class="text-[10px] uppercase font-bold text-slate-400">Company Reserve (${reservePct}%)</div>
            <div id="displayReserveAmt" class="text-xl font-mono font-extrabold text-black dark:text-white">${fmtMoney(reserveAmt)}</div>
            <div class="text-[10px] text-slate-500">Infrastructure & contingency fund</div>
          </div>
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-[#202024] border border-slate-200 dark:border-[#27272a] space-y-1">
            <div class="text-[10px] uppercase font-bold text-slate-400">Net Team Distributable Salary Pool</div>
            <div id="displayDistributablePool" class="text-xl font-mono font-extrabold text-black dark:text-white">${fmtMoney(distributablePool)}</div>
            <div class="text-[10px] text-slate-500">${100 - reservePct}% net profit pool for team</div>
          </div>
        </div>
      </div>

      <!-- =========================================================
           SECTION 2: TEAM SALARY & REVENUE SHARING TABLE
           ========================================================= -->
      <div class="bg-white dark:bg-[#18181b] rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs overflow-hidden">
        <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="space-y-0.5">
            <div class="flex items-center gap-2">
              <i data-lucide="users" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
              <h3 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Team Salary & Revenue Share Distribution
              </h3>
            </div>
            <p class="text-[11px] text-slate-400">
              Salary payouts dynamically calculated based on the ₱${Number(distributablePool).toLocaleString('en-PH')} distributable pool
            </p>
          </div>
          
          <div class="flex items-center gap-3">
            <span class="text-xs font-mono font-bold ${totalSharePct === 100 ? 'text-black dark:text-white' : 'text-rose-500'}">
              Total Share: ${totalSharePct}% / 100%
            </span>
            <button type="button" onclick="saveRevenueSharingSettings()" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-white dark:text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1">
              <i data-lucide="save" class="w-3.5 h-3.5"></i> Save Splits
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="bg-slate-50/70 dark:bg-[#202024] border-b border-slate-100 dark:border-slate-800 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <th class="p-3.5 pl-4">Team Member & Responsibility</th>
                <th class="p-3.5">Role</th>
                <th class="p-3.5 text-center">Share (%)</th>
                <th class="p-3.5 text-right">Calculated Salary Share (₱)</th>
                <th class="p-3.5 text-center">Disbursement Status</th>
                <th class="p-3.5 text-center">Payslip Voucher</th>
                <th class="p-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              ${teamShares.map((s) => {
                const memberSalary = distributablePool * (Number(s.percentage) / 100);
                const statusBadge = s.status === 'Disbursed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                                    s.status === 'Ready for Payout' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                                    'bg-amber-500/10 text-amber-600 dark:text-amber-400';

                return `
                  <tr class="hover:bg-slate-50/50 dark:hover:bg-[#202024]/50 transition-colors">
                    <td class="p-3.5 pl-4">
                      <div class="flex items-center gap-2.5">
                        <div class="w-7 h-7 rounded-full bg-slate-900 dark:bg-[#27272a] text-white dark:text-white font-bold text-[11px] flex items-center justify-center font-mono">
                          ${s.member_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div class="font-bold text-slate-900 dark:text-white leading-snug flex items-center gap-1.5">
                            <span>${s.member_name}</span>
                            ${s.email && s.email.includes('@') && !s.email.includes('@system') ? '<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Verified Account</span>' : ''}
                          </div>
                          <div class="text-[10px] text-slate-400 font-mono">${s.email || 'internal@account'}</div>
                        </div>
                      </div>
                    </td>
                    <td class="p-3.5 text-slate-600 dark:text-slate-300 font-medium">
                      ${s.role || 'Contributor'}
                    </td>
                    <td class="p-3.5 text-center">
                      <div class="inline-flex items-center gap-1 font-mono font-bold text-black dark:text-white">
                        <input type="number" value="${s.percentage}" min="0" max="100" step="0.5" onchange="updateMemberSharePct('${s.id}', this.value)" class="w-16 px-2 py-1 border border-slate-200 dark:border-[#38383e] rounded-lg bg-slate-50 dark:bg-[#121214] text-black dark:text-white font-mono font-bold text-center focus:outline-none text-xs">
                        <span>%</span>
                      </div>
                    </td>
                    <td class="p-3.5 text-right font-mono font-extrabold text-black dark:text-white text-sm">
                      ${fmtMoney(memberSalary)}
                    </td>
                    <td class="p-3.5 text-center">
                      <button type="button" onclick="toggleShareStatus('${s.id}')" class="px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadge} hover:opacity-80 transition-opacity cursor-pointer" title="Click to change payout status">
                        ● ${s.status || 'Ready for Payout'}
                      </button>
                    </td>
                    <td class="p-3.5 text-center">
                      <button type="button" onclick="openMemberPayslip('${s.id}')" class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#38383e] text-black dark:text-white font-semibold text-[11px] transition-colors flex items-center gap-1 mx-auto" title="View official payslip voucher">
                        <i data-lucide="receipt" class="w-3 h-3"></i> Payslip
                      </button>
                    </td>
                    <td class="p-3.5 text-center">
                      <button type="button" onclick="removeTeamShareMember('${s.id}')" class="p-1.5 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" title="Remove member share">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot class="bg-slate-50 dark:bg-[#202024] font-bold text-xs border-t border-slate-200 dark:border-slate-800">
              <tr>
                <td colspan="2" class="p-3.5 pl-4 text-black dark:text-white">Total Team Distribution</td>
                <td class="p-3.5 text-center font-mono font-extrabold text-black dark:text-white">${totalSharePct}%</td>
                <td class="p-3.5 text-right font-mono font-extrabold text-black dark:text-white">${fmtMoney(distributablePool)}</td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- =========================================================
           SECTION 3: DISBURSEMENT & CAPEX LEDGER TABLE
           ========================================================= -->
      <div class="bg-white dark:bg-[#18181b] rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs overflow-hidden">
        <div class="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <i data-lucide="file-spreadsheet" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
            <h3 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Disbursement & Expense Ledger</h3>
          </div>
          <span class="text-xs font-mono font-bold text-black dark:text-white">${items.length} Records</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="bg-slate-50/70 dark:bg-[#202024] border-b border-slate-100 dark:border-slate-800 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <th class="p-3.5 pl-4">Expense Title & Description</th>
                <th class="p-3.5">Category</th>
                <th class="p-3.5 text-right">Allocated</th>
                <th class="p-3.5 text-right">Actual Spent</th>
                <th class="p-3.5 text-right">Variance</th>
                <th class="p-3.5 text-center">Status</th>
                <th class="p-3.5">Date</th>
                <th class="p-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              ${items.length === 0 ? `
                <tr>
                  <td colspan="8" class="p-8 text-center text-slate-400">
                    No expense records found. Click "Add Capex Line" to record one.
                  </td>
                </tr>
              ` : items.map(it => {
                const alloc = Number(it.allocated) || 0;
                const sp = Number(it.spent) || 0;
                const variance = alloc - sp;
                const statusColor = it.status === 'Disbursed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                                    it.status === 'Pending Voucher' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                                    'bg-blue-500/10 text-blue-600 dark:text-blue-400';

                return `
                  <tr class="hover:bg-slate-50/50 dark:hover:bg-[#202024]/50 transition-colors group">
                    <td class="p-3.5 pl-4">
                      <div class="font-bold text-slate-900 dark:text-white leading-snug">${it.item_title}</div>
                      ${it.notes ? `<div class="text-[10px] text-slate-400 mt-0.5 truncate max-w-xs">${it.notes}</div>` : ''}
                    </td>
                    <td class="p-3.5">
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-[#27272a] text-slate-700 dark:text-slate-300">
                        ${it.category}
                      </span>
                    </td>
                    <td class="p-3.5 text-right font-mono font-bold text-black dark:text-white">
                      ${fmtMoney(alloc)}
                    </td>
                    <td class="p-3.5 text-right font-mono font-bold text-black dark:text-white">
                      ${fmtMoney(sp)}
                    </td>
                    <td class="p-3.5 text-right font-mono font-bold text-black dark:text-white">
                      ${variance >= 0 ? '+' : ''}${fmtMoney(variance)}
                    </td>
                    <td class="p-3.5 text-center">
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}">
                        ● ${it.status}
                      </span>
                    </td>
                    <td class="p-3.5 font-mono text-[11px] font-medium text-black dark:text-white">
                      ${it.date || '—'}
                    </td>
                    <td class="p-3.5 text-center">
                      <button type="button" onclick="deleteExpenseItem('${it.id}')" class="p-1.5 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" title="Delete expense record">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot class="bg-slate-50 dark:bg-[#202024] font-bold text-xs border-t border-slate-200 dark:border-slate-800">
              <tr>
                <td colspan="2" class="p-3.5 pl-4 text-black dark:text-white">Total Workspace Capex</td>
                <td class="p-3.5 text-right font-mono font-extrabold text-black dark:text-white">${fmtMoney(totalAllocated)}</td>
                <td class="p-3.5 text-right font-mono font-extrabold text-black dark:text-white">${fmtMoney(totalSpent)}</td>
                <td class="p-3.5 text-right font-mono font-extrabold text-black dark:text-white">${fmtMoney(remainingBalance)}</td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function setSellingPricePreset(amount) {
  currentRevenueSharingData.system_selling_price = Number(amount);
  currentRevenueSharingData.collected_amount = Number(amount);
  renderFinanceView();
  saveRevenueSharingSettings();
}

function handleSellingPriceLive(val) {
  currentRevenueSharingData.system_selling_price = parseFloat(val) || 0;
  renderFinanceView();
  saveRevenueSharingSettings();
}

function handleCollectedLive(val) {
  currentRevenueSharingData.collected_amount = parseFloat(val) || 0;
  renderFinanceView();
  saveRevenueSharingSettings();
}

function handleReserveLive(val) {
  currentRevenueSharingData.overhead_reserve_pct = parseFloat(val) || 0;
  renderFinanceView();
  saveRevenueSharingSettings();
}

function updateMemberSharePct(id, newPct) {
  const member = currentRevenueSharingData.team_shares.find(s => s.id === id);
  if (member) {
    member.percentage = parseFloat(newPct) || 0;
    renderFinanceView();
    saveRevenueSharingSettings();
  }
}

function toggleShareStatus(id) {
  const member = currentRevenueSharingData.team_shares.find(s => s.id === id);
  if (member) {
    const statuses = ['Ready for Payout', 'Disbursed', 'Pending Collection'];
    const nextIdx = (statuses.indexOf(member.status) + 1) % statuses.length;
    member.status = statuses[nextIdx];
    renderFinanceView();
    saveRevenueSharingSettings();
  }
}

function openMemberPayslip(id) {
  const member = currentRevenueSharingData.team_shares.find(s => s.id === id);
  if (!member) return;

  const sellingPrice = Number(currentRevenueSharingData.system_selling_price) || 0;
  const reservePct = Number(currentRevenueSharingData.overhead_reserve_pct) || 0;
  const reserveAmt = (sellingPrice * (reservePct / 100));
  const distributablePool = Math.max(0, sellingPrice - reserveAmt);
  const salary = distributablePool * (Number(member.percentage) / 100);

  const fmtMoney = (amount) => '₱' + Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const modal = document.getElementById('payslipModal');
  const content = document.getElementById('payslipModalContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div class="p-4 bg-slate-50 dark:bg-[#121214] rounded-xl border border-slate-200 dark:border-[#27272a] space-y-3 font-mono">
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <span class="text-slate-400 uppercase text-[10px]">Recipient:</span>
        <span class="font-bold text-black dark:text-white">${member.member_name}</span>
      </div>
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <span class="text-slate-400 uppercase text-[10px]">Role / Duty:</span>
        <span class="font-bold text-black dark:text-white">${member.role || 'Contributor'}</span>
      </div>
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <span class="text-slate-400 uppercase text-[10px]">Contract Sold Price:</span>
        <span class="font-bold text-black dark:text-white">${fmtMoney(sellingPrice)}</span>
      </div>
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <span class="text-slate-400 uppercase text-[10px]">Company Reserve (${reservePct}%):</span>
        <span class="font-bold text-black dark:text-white">${fmtMoney(reserveAmt)}</span>
      </div>
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <span class="text-slate-400 uppercase text-[10px]">Net Distributable Pool:</span>
        <span class="font-bold text-black dark:text-white">${fmtMoney(distributablePool)}</span>
      </div>
      <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <span class="text-slate-400 uppercase text-[10px]">Individual Equity Share:</span>
        <span class="font-bold text-black dark:text-white">${member.percentage}%</span>
      </div>
      <div class="flex items-center justify-between pt-1 text-sm">
        <span class="font-bold text-black dark:text-white">NET SALARY PAYOUT:</span>
        <span class="font-extrabold text-emerald-600 dark:text-emerald-400">${fmtMoney(salary)}</span>
      </div>
      <div class="flex items-center justify-between pt-1 text-[10px] text-slate-400">
        <span>Payment Status:</span>
        <span class="font-bold text-black dark:text-white uppercase">${member.status || 'Ready for Payout'}</span>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closePayslipModal() {
  const modal = document.getElementById('payslipModal');
  if (modal) modal.classList.add('hidden');
}

async function saveRevenueSharingSettings() {
  try {
    const res = await fetch('/api/finance/revenue-sharing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        system_selling_price: currentRevenueSharingData.system_selling_price,
        collected_amount: currentRevenueSharingData.collected_amount,
        overhead_reserve_pct: currentRevenueSharingData.overhead_reserve_pct,
        team_shares: currentRevenueSharingData.team_shares
      })
    });
    if (res.ok) {
      showLiveBroadcast('System pricing & salary sharing updated');
    }
  } catch (err) {
    console.error('Error saving revenue sharing settings:', err);
  }
}

async function openTeamShareModal() {
  const modal = document.getElementById('addTeamShareModal');
  const form = document.getElementById('addTeamShareForm');
  if (form) form.reset();

  try {
    const res = await fetch('/api/users');
    if (res.ok) {
      const data = await res.json();
      const users = data.users || [];
      const nameInput = document.getElementById('shareMemberNameInput');
      const roleInput = document.getElementById('shareMemberRoleInput');

      // If user select dropdown exists or can be autofilled
      if (users.length > 0 && nameInput && !nameInput.value) {
        // Pre-fill with registered users
        const unassigned = users.find(u => !currentRevenueSharingData.team_shares.some(s => s.user_id === u.id || s.email === u.email));
        if (unassigned) {
          nameInput.value = unassigned.full_name;
          if (roleInput) roleInput.value = `${unassigned.organization || 'Kryptiah'} • ${unassigned.role || 'Engineer'}`;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching users for share modal:', err);
  }

  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeTeamShareModal() {
  const modal = document.getElementById('addTeamShareModal');
  if (modal) modal.classList.add('hidden');
}

function submitTeamShareForm() {
  const name = document.getElementById('shareMemberNameInput').value.trim();
  const role = document.getElementById('shareMemberRoleInput').value.trim();
  const pct = parseFloat(document.getElementById('shareMemberPctInput').value) || 0;
  const status = document.getElementById('shareMemberStatusInput').value;

  if (!name) return;

  const newShare = {
    id: `share_${Date.now()}`,
    member_name: name,
    role: role || 'Contributor',
    percentage: pct,
    status: status
  };

  currentRevenueSharingData.team_shares.push(newShare);
  closeTeamShareModal();
  renderFinanceView();
  saveRevenueSharingSettings();
}

function removeTeamShareMember(id) {
  if (!confirm('Remove this team member share?')) return;
  currentRevenueSharingData.team_shares = currentRevenueSharingData.team_shares.filter(s => s.id !== id);
  renderFinanceView();
  saveRevenueSharingSettings();
}

function openExpenseModal() {
  const modal = document.getElementById('newExpenseModal');
  const form = document.getElementById('newExpenseForm');
  if (form) form.reset();
  const dateInput = document.getElementById('expDateInput');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeExpenseModal() {
  const modal = document.getElementById('newExpenseModal');
  if (modal) modal.classList.add('hidden');
}

async function submitExpenseForm() {
  const title = document.getElementById('expTitleInput').value.trim();
  const category = document.getElementById('expCategoryInput').value;
  const status = document.getElementById('expStatusInput').value;
  const allocated = parseFloat(document.getElementById('expAllocatedInput').value) || 0;
  const spent = parseFloat(document.getElementById('expSpentInput').value) || 0;
  const dateVal = document.getElementById('expDateInput').value;
  const notes = document.getElementById('expNotesInput').value.trim();

  if (!title) return;

  try {
    const res = await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        item_title: title,
        category: category,
        status: status,
        allocated: allocated,
        spent: spent,
        date: dateVal,
        notes: notes
      })
    });

    if (res.ok) {
      closeExpenseModal();
      await renderFinanceView();
      showLiveBroadcast(`Added expense item: "${title}"`);
    }
  } catch (err) {
    console.error('Error adding expense item:', err);
  }
}

async function deleteExpenseItem(id) {
  if (!confirm('Are you sure you want to delete this expense record?')) return;

  try {
    const res = await fetch(`/api/finance?id=${id}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      await renderFinanceView();
      showLiveBroadcast('Deleted expense record');
    }
  } catch (err) {
    console.error('Error deleting expense item:', err);
  }
}

window.renderFinanceView = renderFinanceView;
window.setSellingPricePreset = setSellingPricePreset;
window.handleSellingPriceLive = handleSellingPriceLive;
window.handleCollectedLive = handleCollectedLive;
window.handleReserveLive = handleReserveLive;
window.updateMemberSharePct = updateMemberSharePct;
window.toggleShareStatus = toggleShareStatus;
window.openMemberPayslip = openMemberPayslip;
window.closePayslipModal = closePayslipModal;
window.saveRevenueSharingSettings = saveRevenueSharingSettings;
window.openTeamShareModal = openTeamShareModal;
window.closeTeamShareModal = closeTeamShareModal;
window.submitTeamShareForm = submitTeamShareForm;
window.removeTeamShareMember = removeTeamShareMember;
window.openExpenseModal = openExpenseModal;
window.closeExpenseModal = closeExpenseModal;
window.submitExpenseForm = submitExpenseForm;
window.deleteExpenseItem = deleteExpenseItem;



function renderTableView() {
  const container = document.getElementById('tableViewContainer');
  if (!container) return;

  const filteredItems = filterItems(activeItems);
  const isContractor = currentRole === 'contractor';
  const isAuditor = currentRole === 'auditor';

  // Calculate Aggregates
  let totalProgress = 0;
  filteredItems.forEach(item => {
    totalProgress += (Number(item.data.col_progress) || 0);
  });
  const avgProgress = filteredItems.length > 0 ? Math.round(totalProgress / filteredItems.length) : 0;

  let html = `
    <div class="overflow-x-auto w-full m3-card-elevated bg-transparent">
      <table class="w-full work-table text-left text-xs text-slate-700 dark:text-slate-300">
        <thead class="text-[11px] uppercase tracking-wider sticky top-0 z-20 bg-slate-50/90 dark:bg-[#18181b] text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-[#27272a]">
          <tr>
            <th class="p-3 w-12 text-center text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-[#27272a]">#</th>
  `;

  activeColumnsConfig.forEach(col => {
    const isBudgetCol = col.type === 'currency' || col.id === 'col_budget';
    const isPrimaryCol = col.id === 'col_title' || col.required;
    const title = (isContractor && isBudgetCol) ? 'Financials (Redacted)' : col.title;

    html += `
      <th class="p-3 border-b border-slate-200 dark:border-[#27272a] text-slate-800 dark:text-slate-200 font-bold group/th" style="min-width: ${col.width || '160px'}">
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-1.5">
            <span class="text-slate-800 dark:text-white font-bold">${title}</span>
            <span class="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-[#27272a] text-slate-700 dark:text-slate-300 uppercase font-semibold border border-slate-300 dark:border-[#3f3f46]">${col.type}</span>
          </div>
          ${!isPrimaryCol && !isAuditor ? `
            <button class="delete-col-btn opacity-0 group-hover/th:opacity-100 hover:text-slate-900 dark:hover:text-white text-slate-400 p-0.5 rounded transition-opacity" data-col-id="${col.id}" data-col-title="${col.title}" title="Delete Column from Schema">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          ` : ''}
        </div>
      </th>
    `;
  });

  html += `
            <th class="p-3 w-20 text-center border-b border-slate-200 dark:border-[#27272a] text-slate-800 dark:text-slate-200 font-bold">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-[#27272a]">
  `;

  // ZERO DATA EMPTY STATE
  if (filteredItems.length === 0) {
    html += `
      <tr>
        <td colspan="${activeColumnsConfig.length + 2}" class="py-16 text-center">
          <div class="max-w-md mx-auto space-y-3">
            <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-zinc-800/80 text-slate-600 dark:text-zinc-400 mx-auto flex items-center justify-center">
              <i data-lucide="database" class="w-6 h-6"></i>
            </div>
            <h3 class="text-base font-bold text-slate-900">Schema Ready • No Projects Inserted Yet</h3>
            <p class="text-xs text-slate-500">Your schema '${activeBoard.schema || currentTenantKey}' is active. Click below to insert your first project record.</p>
            <div class="pt-2 flex items-center justify-center gap-2">
              <button id="emptyStateInsertBtn" class="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#27272a] dark:hover:bg-[#38383e] dark:text-white text-white text-xs font-semibold rounded-xl shadow-xs transition-colors">
                <i data-lucide="plus" class="w-4 h-4"></i> Insert First Project
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  } else {
    // Render Rows
    filteredItems.forEach((item, index) => {
      html += `<tr class="hover:bg-slate-50/80 transition-colors group" data-row-id="${item.id}">`;
      html += `<td class="p-3 text-center font-mono text-slate-400 select-none">${index + 1}</td>`;

      activeColumnsConfig.forEach(col => {
        const val = item.data[col.id];
        const isBudgetCol = col.type === 'currency' || col.id === 'col_budget';
        const isProgressCol = col.type === 'progress' || col.id === 'col_progress';

        let canEdit = true;
        if (isAuditor) canEdit = false;
        if (isContractor && !isProgressCol) canEdit = false;

        html += `<td class="p-2.5 cell-editable" data-col-id="${col.id}" data-col-type="${col.type}">`;

        if (isContractor && isBudgetCol) {
          html += `<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 px-2 py-1 rounded border border-slate-200 dark:border-zinc-700">
            <i data-lucide="lock" class="w-3 h-3"></i> Redacted
          </span>`;
        } else if (col.type === 'status') {
          const statusClass = getStatusClass(val);
          const curStatus = val || 'Planning';
          html += `
            <div class="relative min-w-[130px]">
              ${canEdit ? `
                <select class="w-full text-xs font-semibold rounded-lg px-2.5 py-1 focus:outline-none cursor-pointer inline-cell-input transition-all border ${
                  curStatus === 'Completed' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800' :
                  curStatus === 'In Progress' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800' :
                  curStatus === 'Review' ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800' :
                  curStatus === 'Blocked' ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800' :
                  'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                }" data-item-id="${item.id}" data-col-id="${col.id}">
                  <option value="Planning" ${curStatus === 'Planning' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white">● Planning</option>
                  <option value="In Progress" ${curStatus === 'In Progress' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white">● In Progress</option>
                  <option value="Review" ${curStatus === 'Review' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white">● Review</option>
                  <option value="Completed" ${curStatus === 'Completed' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white">● Completed</option>
                  <option value="Blocked" ${curStatus === 'Blocked' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white">● Blocked</option>
                </select>
              ` : `
                <span class="status-badge ${statusClass}">${curStatus}</span>
              `}
            </div>
          `;
        } else if (col.type === 'currency') {
          html += `
            <div class="font-mono font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
              ${canEdit ? `
                <span class="text-slate-400 select-none">₱</span>
                <input type="number" class="w-full bg-transparent font-mono font-semibold text-slate-800 dark:text-slate-200 focus:outline-none inline-cell-input" 
                  value="${val || 0}" data-item-id="${item.id}" data-col-id="${col.id}">
              ` : `
                <span>₱${Number(val || 0).toLocaleString()}</span>
              `}
            </div>
          `;
        } else if (col.type === 'priority') {
          const curPriority = val || 'Medium';
          html += `
            <div class="relative min-w-[110px]">
              ${canEdit ? `
                <select class="w-full text-[11px] font-bold rounded-lg px-2 py-1 uppercase tracking-wider focus:outline-none cursor-pointer inline-cell-input transition-all border ${
                  curPriority === 'Critical' ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800' :
                  curPriority === 'High' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800' :
                  curPriority === 'Medium' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800' :
                  'bg-slate-100 dark:bg-[#27272a] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                }" data-item-id="${item.id}" data-col-id="${col.id}">
                  <option value="Critical" ${curPriority === 'Critical' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white font-bold">● Critical</option>
                  <option value="High" ${curPriority === 'High' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white font-bold">● High</option>
                  <option value="Medium" ${curPriority === 'Medium' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white font-bold">● Medium</option>
                  <option value="Low" ${curPriority === 'Low' ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white font-bold">● Low</option>
                </select>
              ` : `
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getPriorityClass(curPriority)}">${curPriority}</span>
              `}
            </div>
          `;
        } else if (col.type === 'person' || col.id === 'col_dept') {
          const initial = val ? val.trim().charAt(0).toUpperCase() : 'U';
          html += `
            <div class="flex items-center gap-1.5 min-w-[200px]">
              <div class="w-6 h-6 rounded-full bg-black dark:bg-black text-white border border-slate-700 flex items-center justify-center font-bold text-[10px] flex-shrink-0 shadow-2xs">
                ${initial}
              </div>
              ${canEdit ? `
                <select class="w-full bg-transparent text-slate-800 dark:text-slate-200 font-medium text-xs focus:outline-none inline-cell-input cursor-pointer py-1 px-1.5 rounded-lg border border-slate-200 dark:border-[#38383e] hover:border-slate-400 dark:hover:border-slate-600 transition-colors truncate" 
                  data-item-id="${item.id}" data-col-id="${col.id}">
                  <option value="" ${!val ? 'selected' : ''}>-- Unassigned --</option>
                  ${allUsersList.map(u => {
                    const org = u.organization ? u.organization : (u.role || 'Member');
                    const fullVal = `${u.full_name} (${org})`;
                    const isSelected = (val === fullVal || val === u.full_name || (val && val.startsWith(u.full_name))) ? 'selected' : '';
                    return `<option value="${fullVal}" ${isSelected}>${u.full_name} • ${org}</option>`;
                  }).join('')}
                  ${(val && !allUsersList.some(u => val.includes(u.full_name))) ? `<option value="${val}" selected>${val}</option>` : ''}
                </select>
              ` : `
                <span class="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">${val || 'Unassigned'}</span>
              `}
            </div>
          `;
        } else if (col.type === 'progress') {
          const progressVal = Math.min(100, Math.max(0, Number(val) || 0));
          html += `
            <div class="flex items-center gap-2 min-w-[140px]">
              <div class="h-2 flex-1 bg-slate-200 dark:bg-[#27272a] rounded-full overflow-hidden min-w-[50px]">
                <div class="h-full ${
                  progressVal === 100 ? 'bg-emerald-500' :
                  progressVal >= 60 ? 'bg-blue-500' :
                  progressVal >= 30 ? 'bg-amber-500' :
                  'bg-slate-400'
                } rounded-full transition-all duration-300" style="width: ${progressVal}%"></div>
              </div>
              ${canEdit ? `
                <select class="bg-slate-50 dark:bg-[#202024] font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer border border-slate-200 dark:border-[#38383e] hover:border-slate-400 dark:hover:border-slate-600 rounded-md px-1.5 py-0.5 inline-cell-input transition-colors"
                  data-item-id="${item.id}" data-col-id="${col.id}">
                  ${[0, 10, 20, 25, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100].map(pct => `
                    <option value="${pct}" ${progressVal === pct ? 'selected' : ''} class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white">${pct}%</option>
                  `).join('')}
                  ${(![0, 10, 20, 25, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100].includes(progressVal)) ? `
                    <option value="${progressVal}" selected class="bg-white dark:bg-[#18181b] text-slate-900 dark:text-white">${progressVal}%</option>
                  ` : ''}
                </select>
              ` : `
                <span class="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">${progressVal}%</span>
              `}
            </div>
          `;
        } else if (col.type === 'date') {
          html += `
            <div class="relative min-w-[140px]">
              ${canEdit ? `
                <input type="date" class="w-full px-2.5 py-1 text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-[#202024] border border-slate-200 dark:border-[#38383e] hover:border-slate-400 dark:hover:border-slate-600 rounded-lg focus:outline-none cursor-pointer inline-cell-input transition-colors" 
                  value="${val || ''}" data-item-id="${item.id}" data-col-id="${col.id}">
              ` : `
                <span class="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 px-2 py-1">${val || 'No date'}</span>
              `}
            </div>
          `;
        } else if (col.id === 'col_title') {
          const desc = item.data.col_description || '';
          html += `
            <div class="space-y-0.5">
              <input type="text" class="w-full bg-transparent font-semibold text-slate-900 dark:text-slate-100 focus:outline-none inline-cell-input" 
                value="${val || ''}" data-item-id="${item.id}" data-col-id="${col.id}" placeholder="Enter feature name..." ${!canEdit ? 'readonly' : ''}>
              ${desc ? `
                <p class="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[280px]" title="${desc}">${desc}</p>
              ` : ''}
            </div>
          `;
        } else {
          // Plain Text
          html += `
            <input type="text" class="w-full bg-transparent font-semibold text-slate-900 dark:text-slate-100 focus:outline-none inline-cell-input" 
              value="${val || ''}" data-item-id="${item.id}" data-col-id="${col.id}" placeholder="Enter text..." ${!canEdit ? 'readonly' : ''}>
          `;
        }

        html += `</td>`;
      });

      // Actions Column with Comment Notification Badge
      const comments = item.data.comments || [];
      const commentCount = comments.length;

      html += `
        <td class="p-2.5 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button type="button" onclick="openFeatureDetailDrawer('${item.id}')" class="relative text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#27272a] transition-all flex items-center justify-center" title="${commentCount > 0 ? commentCount + ' comments' : 'Add a comment'}">
              <i data-lucide="message-square" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
              ${commentCount > 0 ? `
                <span class="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[9px] font-extrabold shadow-xs">
                  ${commentCount}
                </span>
              ` : `
                <span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"></span>
              `}
            </button>
            <button type="button" class="edit-row-btn text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#27272a] transition-colors" data-item-id="${item.id}" title="Edit Feature" ${isAuditor ? 'disabled' : ''}>
              <i data-lucide="edit-3" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
            </button>
            <button type="button" class="delete-row-btn text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" data-item-id="${item.id}" title="Delete Feature" ${isAuditor ? 'disabled' : ''}>
              <i data-lucide="trash-2" class="w-4 h-4 text-slate-900 dark:text-slate-100"></i>
            </button>
          </div>
        </td>
      `;

      html += `</tr>`;
    });
  }

  // Table Aggregate Footer
  html += `
        </tbody>
        <tfoot class="bg-slate-100 dark:bg-[#18181b] font-semibold text-slate-800 dark:text-slate-200 border-t-2 border-slate-300 dark:border-[#27272a] text-xs">
          <tr>
            <td class="p-3 text-center text-slate-400 dark:text-slate-500">∑</td>
            <td class="p-3">Total: <span class="font-bold text-slate-900 dark:text-white">${filteredItems.length} Features</span></td>
  `;

  activeColumnsConfig.slice(1).forEach(col => {
    if (col.type === 'progress' || col.id === 'col_progress') {
      html += `
        <td class="p-3 font-mono font-bold text-slate-600 dark:text-zinc-400">
          Avg: ${avgProgress}%
        </td>
      `;
    } else {
      html += `<td class="p-3 text-slate-400 font-normal text-[11px]">—</td>`;
    }
  });

  html += `
            <td class="p-3"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Quick Add New Row Footer Bar -->
    <div class="pt-2 flex items-center justify-between">
      <button id="quickAddRowBottomBtn" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-zinc-800/80 hover:bg-slate-200 dark:bg-zinc-700 border border-slate-200 dark:border-zinc-700 rounded-lg transition-colors">
        <i data-lucide="plus" class="w-3.5 h-3.5"></i> Insert Row at Bottom
      </button>
      <span class="text-[11px] text-slate-400">Hover any column header to delete, or click 'Add Column' to add custom fields.</span>
    </div>
  `;

  container.innerHTML = html;
  attachTableEventListeners();
}

function attachTableEventListeners() {
  const statusBtns = document.querySelectorAll('.status-badge-trigger');
  statusBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemId = btn.getAttribute('data-item-id');
      const colId = btn.getAttribute('data-col-id');
      openStatusPicker(btn, itemId, colId);
    });
  });

  const cellInputs = document.querySelectorAll('.inline-cell-input');
  cellInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      const itemId = input.getAttribute('data-item-id');
      const colId = input.getAttribute('data-col-id');
      let newVal = input.value;
      if (input.type === 'number') newVal = Number(newVal);

      updateItemCell(itemId, colId, newVal);
    });
  });

  const deleteBtns = document.querySelectorAll('.delete-row-btn');
  deleteBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const itemId = btn.getAttribute('data-item-id');
      deleteRow(itemId);
    });
  });

  const deleteColBtns = document.querySelectorAll('.delete-col-btn');
  deleteColBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const colId = btn.getAttribute('data-col-id');
      const colTitle = btn.getAttribute('data-col-title');
      deleteColumnFromSchema(colId, colTitle);
    });
  });

  const emptyInsertBtn = document.getElementById('emptyStateInsertBtn');
  if (emptyInsertBtn) {
    emptyInsertBtn.addEventListener('click', () => {
      openInsertModal();
    });
  }

  const quickBottomBtn = document.getElementById('quickAddRowBottomBtn');
  if (quickBottomBtn) {
    quickBottomBtn.addEventListener('click', () => {
      insertQuickEmptyRow();
    });
  }
}

// =========================================================================
// =========================================================================
// 8. VIEW ENGINE MODULE 2: INTERACTIVE DRAG-AND-DROP KANBAN BOARD
// =========================================================================

function renderKanbanView() {
  const container = document.getElementById('kanbanViewContainer');
  if (!container) return;

  const filteredItems = filterItems(activeItems);
  const isContractor = currentRole === 'contractor';
  const statusCol = activeColumnsConfig.find(c => c.type === 'status' || c.id === 'col_status') || {
    id: 'col_status',
    options: ['Planning', 'In Progress', 'Review', 'Completed', 'Blocked']
  };

  const stages = ['Planning', 'In Progress', 'Review', 'Completed', 'Blocked'];

  let html = `
    <div class="space-y-3 w-full">
      <div class="flex items-center justify-between text-xs px-1 text-slate-500 dark:text-slate-400">
        <div class="flex items-center gap-1.5 font-medium">
          <i data-lucide="grab" class="w-3.5 h-3.5 text-blue-500"></i>
          <span>Drag and drop cards across columns to update workflow stages in real-time.</span>
        </div>
        <span class="font-mono text-[11px]">${filteredItems.length} Total Features</span>
      </div>
      <div class="flex gap-4 overflow-x-auto pb-4 custom-scrollbar w-full">
  `;

  stages.forEach(stage => {
    const stageItems = filteredItems.filter(item => (item.data[statusCol.id] || 'Planning') === stage);
    const badgeClass = getStatusClass(stage);

    html += `
      <div class="kanban-col flex flex-col p-4 rounded-2xl min-w-[290px] w-[310px] flex-shrink-0 bg-slate-100/70 dark:bg-[#18181b] border border-slate-200 dark:border-[#27272a] transition-all duration-200" data-stage="${stage}">
        <!-- Column Header -->
        <div class="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
          <div class="flex items-center gap-2">
            <span class="status-badge ${badgeClass} text-[11px] font-semibold">● ${stage}</span>
            <span class="text-xs font-bold text-slate-500 dark:text-slate-400">(${stageItems.length})</span>
          </div>
          <button class="quick-add-kanban-btn text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded hover:bg-slate-200 dark:hover:bg-[#27272a] transition-colors" data-stage="${stage}" title="Add Feature to ${stage}">
            <i data-lucide="plus" class="w-4 h-4"></i>
          </button>
        </div>

        <!-- Cards Dropzone -->
        <div class="flex-1 space-y-3 kanban-cards-dropzone min-h-[360px]" data-stage="${stage}">
    `;

    if (stageItems.length === 0) {
      html += `
        <div class="border-2 border-dashed border-slate-200 dark:border-[#2c2c32] rounded-xl p-6 text-center text-slate-400 dark:text-slate-500 space-y-2 flex flex-col items-center justify-center min-h-[140px] pointer-events-none">
          <i data-lucide="inbox" class="w-6 h-6 opacity-60"></i>
          <p class="text-[11px] font-medium">Drop cards here</p>
        </div>
      `;
    } else {
      stageItems.forEach(item => {
        const progress = item.data.col_progress || 0;
        const priority = item.data.col_priority || 'Medium';
        const dept = item.data.col_dept || 'Unassigned';

        html += `
          <div class="kanban-card space-y-3 p-4 rounded-xl shadow-xs hover:shadow-md bg-white dark:bg-[#202024] border border-slate-200 dark:border-[#2c2c32] transition-all duration-150 cursor-grab active:cursor-grabbing group relative" draggable="true" data-item-id="${item.id}">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1 cursor-pointer" onclick="openFeatureDetailDrawer('${item.id}')">
                <h4 class="text-xs font-bold text-slate-900 dark:text-white leading-snug hover:text-blue-600 dark:hover:text-blue-400 transition-colors line-clamp-2">
                  ${item.data.col_title || 'Untitled Feature'}
                </h4>
                ${item.data.col_description ? `
                  <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-2">${item.data.col_description}</p>
                ` : ''}
              </div>
              <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${getPriorityClass(priority)} flex-shrink-0">
                ${priority}
              </span>
            </div>

            <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span class="truncate max-w-[140px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1">
                <i data-lucide="user" class="w-3 h-3 text-slate-400"></i>
                <span class="truncate">${dept.split('(')[0].trim()}</span>
              </span>
              <span class="font-mono text-[10px] text-slate-400">${item.data.col_timeline || ''}</span>
            </div>

            <!-- Progress Bar -->
            <div class="space-y-1">
              <div class="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                <span>Progress</span>
                <span class="font-mono font-bold text-slate-700 dark:text-slate-300">${progress}%</span>
              </div>
              <div class="h-1.5 w-full bg-slate-100 dark:bg-[#2c2c32] rounded-full overflow-hidden">
                <div class="h-full ${
                  progress === 100 ? 'bg-emerald-500' :
                  progress >= 60 ? 'bg-blue-500' :
                  progress >= 30 ? 'bg-amber-500' :
                  'bg-slate-400'
                } rounded-full transition-all duration-300" style="width: ${progress}%"></div>
              </div>
            </div>

            <!-- Card Bottom Bar -->
            <div class="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <button type="button" onclick="openFeatureDetailDrawer('${item.id}')" class="text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center gap-1 text-[11px] font-medium transition-colors" title="View discussion & comments">
                <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
                <span>${(item.data.comments || []).length}</span>
              </button>
              <div class="flex items-center gap-1">
                <button type="button" class="edit-row-btn px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-slate-700 dark:text-slate-300 rounded text-[10px] font-semibold transition-colors flex items-center gap-1" data-item-id="${item.id}" title="Edit Feature">
                  <i data-lucide="edit-3" class="w-3 h-3"></i>
                  <span>Edit</span>
                </button>
                <button type="button" class="advance-kanban-btn px-2 py-1 bg-slate-900 hover:bg-slate-800 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-white dark:text-white rounded text-[10px] font-semibold transition-all flex items-center gap-0.5" data-item-id="${item.id}" data-current-stage="${stage}" title="Advance to next stage">
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;
  container.innerHTML = html;

  // 1. Advance Stage Buttons
  container.querySelectorAll('.advance-kanban-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemId = btn.getAttribute('data-item-id');
      const currentStage = btn.getAttribute('data-current-stage');
      const currentIndex = stages.indexOf(currentStage);
      const nextStage = stages[(currentIndex + 1) % stages.length];

      updateItemCell(itemId, statusCol.id, nextStage);
    });
  });

  // 2. Quick Add in Kanban Column
  container.querySelectorAll('.quick-add-kanban-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stage = btn.getAttribute('data-stage');
      insertQuickEmptyRow({ col_status: stage, col_title: `New Feature (${stage})` });
    });
  });

  // 3. Edit Row in Kanban
  container.querySelectorAll('.edit-row-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemId = btn.getAttribute('data-item-id');
      openEditFeatureModal(itemId);
    });
  });

  // 4. Native HTML5 Drag and Drop Handlers
  initKanbanDragAndDrop(container, statusCol.id);
}

function initKanbanDragAndDrop(container, statusColId) {
  const cards = container.querySelectorAll('.kanban-card');
  const cols = container.querySelectorAll('.kanban-col');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      const itemId = card.getAttribute('data-item-id');
      e.dataTransfer.setData('text/plain', itemId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('opacity-40', 'scale-95', 'ring-2', 'ring-blue-500');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('opacity-40', 'scale-95', 'ring-2', 'ring-blue-500');
      cols.forEach(col => col.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/30', 'dark:bg-blue-950/30'));
    });
  });

  cols.forEach(col => {
    const stage = col.getAttribute('data-stage');

    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('ring-2', 'ring-blue-500', 'bg-blue-50/30', 'dark:bg-blue-950/30');
    });

    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/30', 'dark:bg-blue-950/30');
      }
    });

    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50/30', 'dark:bg-blue-950/30');

      const itemId = e.dataTransfer.getData('text/plain');
      if (itemId && stage) {
        updateItemCell(itemId, statusColId, stage);
        showLiveBroadcast(`Kanban Move: Feature moved to '${stage}' stage.`);
      }
    });
  });
}

// =========================================================================
// 9. VIEW ENGINE MODULE 3: INTERACTIVE CALENDAR & DELIVERY SCHEDULES
// =========================================================================

let calendarViewDate = new Date();

function renderTimelineView() {
  const container = document.getElementById('timelineViewContainer');
  if (!container) return;

  const filteredItems = filterItems(activeItems);

  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth(); // 0-11

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  // Calculate calendar grid dates
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  // Count features this month
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const featuresThisMonth = filteredItems.filter(item => {
    const d = item.data.col_timeline;
    return d && d.startsWith(monthPrefix);
  });

  const todayStr = new Date().toISOString().split('T')[0];

  let html = `
    <div class="space-y-4 w-full">
      
      <!-- Calendar Header & Navigation Controls -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            <button id="calPrevBtn" class="p-1.5 hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md transition-colors" title="Previous Month">
              <i data-lucide="chevron-left" class="w-4 h-4"></i>
            </button>
            <button id="calTodayBtn" class="px-2.5 py-1 text-xs font-semibold hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md transition-colors">
              Today
            </button>
            <button id="calNextBtn" class="p-1.5 hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md transition-colors" title="Next Month">
              <i data-lucide="chevron-right" class="w-4 h-4"></i>
            </button>
          </div>

          <div>
            <h3 class="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <i data-lucide="calendar" class="w-4.5 h-4.5 text-slate-600 dark:text-zinc-400"></i>
              <span>${monthNames[month]} ${year}</span>
            </h3>
          </div>
        </div>

        <!-- Right: Status Indicators & Quick Schedule -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-zinc-800/80 dark:bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 dark:text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700 dark:border-slate-300 dark:border-zinc-700">
            <i data-lucide="layers" class="w-3.5 h-3.5"></i>
            <span>${featuresThisMonth.length} Scheduled this Month</span>
          </span>

          <div class="hidden md:flex items-center gap-2.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 ml-2 border-l border-slate-200 dark:border-slate-800 pl-3">
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-slate-100 dark:bg-zinc-800/800"></span> In Progress</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-slate-100 dark:bg-zinc-800/800"></span> Review</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-slate-400 dark:bg-zinc-500"></span> Planning</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-slate-100 dark:bg-zinc-800/800"></span> Completed</span>
          </div>
        </div>
      </div>

      <!-- Main Side-by-Side Container (Calendar Grid on Left, Scheduled Releases on Right) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start w-full">
        
        <!-- LEFT COLUMN: Calendar Month Grid (8 of 12 cols on desktop) -->
        <div class="lg:col-span-8 space-y-2">
          <!-- 7-Day Week Header -->
          <div class="grid grid-cols-7 gap-1 text-center font-bold text-slate-600 dark:text-slate-400 text-xs py-2 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-800">
            <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
          </div>

          <!-- Calendar 35/42 Grid -->
          <div class="grid grid-cols-7 gap-1.5">
  `;

  // Previous month trailing days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const prevDayNum = prevMonthTotalDays - i;
    const prevMonthNum = month === 0 ? 12 : month;
    const prevYearNum = month === 0 ? year - 1 : year;
    const dateStr = `${prevYearNum}-${String(prevMonthNum).padStart(2, '0')}-${String(prevDayNum).padStart(2, '0')}`;
    const dayFeatures = filteredItems.filter(item => item.data.col_timeline === dateStr);

    html += renderCalendarDayCell(prevDayNum, dateStr, dayFeatures, false, dateStr === todayStr);
  }

  // Current month days
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayFeatures = filteredItems.filter(item => item.data.col_timeline === dateStr);

    html += renderCalendarDayCell(day, dateStr, dayFeatures, true, dateStr === todayStr);
  }

  // Next month leading days (to fill 35 or 42 grid cells)
  const totalRendered = firstDayIndex + totalDaysInMonth;
  const nextMonthCells = (totalRendered <= 35) ? (35 - totalRendered) : (42 - totalRendered);

  for (let nextDay = 1; nextDay <= nextMonthCells; nextDay++) {
    const nextMonthNum = month === 11 ? 1 : month + 2;
    const nextYearNum = month === 11 ? year + 1 : year;
    const dateStr = `${nextYearNum}-${String(nextMonthNum).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
    const dayFeatures = filteredItems.filter(item => item.data.col_timeline === dateStr);

    html += renderCalendarDayCell(nextDay, dateStr, dayFeatures, false, dateStr === todayStr);
  }

  html += `
          </div>
        </div>

        <!-- RIGHT COLUMN: Scheduled Feature Releases Sidebar (4 of 12 cols on desktop) -->
        <div class="lg:col-span-4 m3-card-filled p-5 space-y-4 rounded-2xl lg:sticky lg:top-4">
          <div class="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <i data-lucide="clock" class="w-4 h-4 text-slate-600 dark:text-zinc-400"></i>
              <span>Releases (${monthNames[month]} ${year})</span>
            </h4>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800/80 dark:bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 dark:text-slate-600 dark:text-zinc-400 font-semibold border border-slate-200 dark:border-zinc-700 dark:border-slate-300 dark:border-zinc-700">
              ${featuresThisMonth.length} features
            </span>
          </div>

          <!-- Scrollable Releases List -->
          <div class="space-y-3 max-h-[580px] overflow-y-auto pr-1 custom-scrollbar">
  `;

  if (featuresThisMonth.length === 0) {
    html += `
      <div class="border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center text-slate-400 space-y-2">
        <p class="text-xs">No features scheduled for target release in ${monthNames[month]} ${year}.</p>
        <button class="cal-quick-schedule-btn mt-1 text-xs text-slate-600 dark:text-zinc-400 hover:underline font-semibold" data-date="${year}-${String(month + 1).padStart(2, '0')}-15">
          Schedule a feature for this month
        </button>
      </div>
    `;
  } else {
    featuresThisMonth.forEach(item => {
      const title = item.data.col_title || 'Untitled Feature';
      const desc = item.data.col_description || '';
      const status = item.data.col_status || 'Planning';
      const progress = item.data.col_progress || 0;
      const dept = item.data.col_dept || 'Unassigned';
      const timeline = item.data.col_timeline;

      html += `
        <div class="bg-white dark:bg-[#1e1e23] border border-slate-200 dark:border-[#2c2c32] rounded-xl p-3.5 space-y-2 hover:border-slate-400 dark:border-zinc-500 dark:hover:border-slate-500 dark:border-zinc-500 transition-all shadow-2xs">
          <div class="flex items-start justify-between gap-2">
            <h5 class="text-xs font-bold text-slate-900 dark:text-slate-100 truncate flex-1">${title}</h5>
            <div class="flex items-center gap-1 flex-shrink-0">
              <span class="status-badge ${getStatusClass(status)} text-[10px]">${status}</span>
              <button class="edit-row-btn p-1 text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-slate-400 dark:text-zinc-400 rounded transition-colors" data-item-id="${item.id}" title="Edit Feature">
                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
          ${desc ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">${desc}</p>` : ''}
          <div class="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
            <span class="truncate max-w-[130px] font-medium text-slate-700 dark:text-slate-300">${dept}</span>
            <span class="font-mono text-slate-700 dark:text-zinc-300 dark:text-slate-400 dark:text-zinc-400 font-semibold">${timeline}</span>
          </div>
          <div class="space-y-1">
            <div class="flex justify-between text-[10px] text-slate-400 font-medium">
              <span>Progress</span>
              <span class="font-mono">${progress}%</span>
            </div>
            <div class="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full bg-black dark:bg-black text-white border border-slate-700 rounded-full" style="width: ${progress}%"></div>
            </div>
          </div>
        </div>
      `;
    });
  }

  html += `
          </div>
        </div>

      </div>
    </div>
  `;

  container.innerHTML = html;
  attachCalendarListeners();
  lucide.createIcons();
}

function renderCalendarDayCell(dayNum, dateStr, dayFeatures, isCurrentMonth, isToday) {
  const otherClass = isCurrentMonth ? '' : 'calendar-other-month text-slate-400 dark:text-slate-600 bg-slate-50/50 dark:bg-slate-950/40';
  const todayBadge = isToday ? 'bg-black dark:bg-black text-white border border-slate-700 text-white font-bold shadow-xs' : 'text-slate-700 dark:text-slate-300 font-semibold';

  let html = `
    <div class="calendar-cell p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between group relative ${otherClass}" data-date="${dateStr}">
      
      <!-- Cell Top Row: Date & Quick Add -->
      <div class="flex items-center justify-between">
        <span class="w-5 h-5 flex items-center justify-center rounded-full text-[11px] ${todayBadge}">
          ${dayNum}
        </span>
        <button class="cal-quick-schedule-btn opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 dark:text-zinc-400 hover:text-slate-700 dark:text-zinc-300 rounded transition-opacity" data-date="${dateStr}" title="Schedule feature on ${dateStr}">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i>
        </button>
      </div>

      <!-- Feature Pills Scheduled on This Day -->
      <div class="space-y-1 my-1 overflow-y-auto max-h-[75px] custom-scrollbar">
  `;

  dayFeatures.forEach(feat => {
    const title = feat.data.col_title || 'Untitled Feature';
    const status = feat.data.col_status || 'Planning';
    let dotColor = 'bg-slate-400 dark:bg-zinc-500';
    if (status === 'Approved') dotColor = 'bg-slate-100 dark:bg-zinc-800/800';
    else if (status === 'In Progress') dotColor = 'bg-slate-100 dark:bg-zinc-800/800';
    else if (status === 'Review') dotColor = 'bg-slate-100 dark:bg-zinc-800/800';
    else if (status === 'Completed') dotColor = 'bg-slate-500';

    html += `
      <div class="calendar-feature-pill edit-row-btn flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-medium text-slate-800 dark:text-slate-200 truncate cursor-pointer shadow-2xs hover:border-slate-400 dark:border-zinc-500 transition-colors" data-item-id="${feat.id}" title="Click to edit ${title} (${status}) • ${feat.data.col_dept || 'Unassigned'}">
        <span class="w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0"></span>
        <span class="truncate flex-1">${title}</span>
        <i data-lucide="edit-3" class="w-2.5 h-2.5 text-slate-400 opacity-0 group-hover:opacity-100"></i>
      </div>
    `;
  });

  html += `
      </div>

      <!-- Cell Bottom Footer (Empty spacer) -->
      <div class="h-1"></div>
    </div>
  `;

  return html;
}

function attachCalendarListeners() {
  const prevBtn = document.getElementById('calPrevBtn');
  const nextBtn = document.getElementById('calNextBtn');
  const todayBtn = document.getElementById('calTodayBtn');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
      renderTimelineView();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
      renderTimelineView();
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      calendarViewDate = new Date();
      renderTimelineView();
    });
  }

  document.querySelectorAll('.cal-quick-schedule-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetDate = btn.getAttribute('data-date');
      openInsertModal();
      const timelineInput = document.getElementById('projTimelineInput');
      if (timelineInput && targetDate) {
        timelineInput.value = targetDate;
      }
    });
  });
}

// =========================================================================
// 10. VIEW ENGINE MODULE 4: EXECUTIVE ANALYTICS DASHBOARD
// =========================================================================

function renderDashboardView() {
  const container = document.getElementById('dashboardViewContainer');
  if (!container) return;

  let reviewCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;
  let planningCount = 0;

  activeItems.forEach(item => {
    const st = item.data.col_status;
    if (st === 'Review') reviewCount++;
    else if (st === 'In Progress') inProgressCount++;
    else if (st === 'Completed') completedCount++;
    else planningCount++;
  });

  const total = activeItems.length || 1;
  const completedPct = Math.round((completedCount / total) * 100);
  const inProgressPct = Math.round((inProgressCount / total) * 100);
  const reviewPct = Math.round((reviewCount / total) * 100);
  const planningPct = Math.max(0, 100 - completedPct - inProgressPct - reviewPct);

  const projectName = (activeBoard && activeBoard.title) ? activeBoard.title : 'Current Workspace';

  let html = `
    <div class="p-6 md:p-8 max-w-7xl mx-auto space-y-8 w-full">
      
      <!-- Top Section Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-[#27272a]">
        <div>
          <h2 class="text-base md:text-lg font-bold text-slate-900 dark:text-white tracking-tight">Executive Project Analytics</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Real-time roadmap tracking, feature delivery status, and system telemetry</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-3 py-1 rounded-full text-xs font-mono font-medium bg-white dark:bg-[#18181c] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#2c2c32] shadow-2xs flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span class="truncate max-w-[200px]">${projectName}</span>
          </span>
        </div>
      </div>

      <!-- Top KPI Metric Cards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
        
        <!-- Card 1: Total Scope -->
        <div class="bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#27272a] rounded-2xl p-5 shadow-2xs flex flex-col justify-between hover:border-slate-300 dark:hover:border-[#38383e] transition-all">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Total Scope</span>
            <div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <i data-lucide="layers" class="w-4 h-4"></i>
            </div>
          </div>
          <div class="mt-4">
            <div class="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight font-mono">
              ${activeItems.length}
            </div>
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">Total registered features</span>
          </div>
        </div>

        <!-- Card 2: In Progress -->
        <div class="bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#27272a] rounded-2xl p-5 shadow-2xs flex flex-col justify-between hover:border-slate-300 dark:hover:border-[#38383e] transition-all">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Active In Progress</span>
            <div class="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <i data-lucide="clock" class="w-4 h-4"></i>
            </div>
          </div>
          <div class="mt-4">
            <div class="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight font-mono">
              ${inProgressCount}
            </div>
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">Under active development</span>
          </div>
        </div>

        <!-- Card 3: In Review -->
        <div class="bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#27272a] rounded-2xl p-5 shadow-2xs flex flex-col justify-between hover:border-slate-300 dark:hover:border-[#38383e] transition-all">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">In Review & QA</span>
            <div class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <i data-lucide="check-circle" class="w-4 h-4"></i>
            </div>
          </div>
          <div class="mt-4">
            <div class="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight font-mono">
              ${reviewCount}
            </div>
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">Awaiting verification</span>
          </div>
        </div>

        <!-- Card 4: Shipped -->
        <div class="bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#27272a] rounded-2xl p-5 shadow-2xs flex flex-col justify-between hover:border-slate-300 dark:hover:border-[#38383e] transition-all">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Shipped & Live</span>
            <div class="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <i data-lucide="check-check" class="w-4 h-4"></i>
            </div>
          </div>
          <div class="mt-4">
            <div class="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight font-mono">
              ${completedCount}
            </div>
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">Production delivered</span>
          </div>
        </div>

      </div>

      <!-- Roadmap Distribution Ratio Bar -->
      <div class="bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#27272a] rounded-2xl p-5 shadow-2xs space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-900 dark:text-white">Workspace Delivery Distribution</span>
          <span class="font-mono text-slate-500 dark:text-slate-400 text-[11px]">${completedPct}% Overall Completion</span>
        </div>
        <div class="h-3 w-full bg-slate-100 dark:bg-[#222228] rounded-full overflow-hidden flex">
          <div style="width: ${completedPct}%" class="h-full bg-emerald-500 transition-all" title="Completed: ${completedCount} (${completedPct}%)"></div>
          <div style="width: ${inProgressPct}%" class="h-full bg-amber-500 transition-all" title="In Progress: ${inProgressCount} (${inProgressPct}%)"></div>
          <div style="width: ${reviewPct}%" class="h-full bg-purple-500 transition-all" title="Review: ${reviewCount} (${reviewPct}%)"></div>
          <div style="width: ${planningPct}%" class="h-full bg-slate-300 dark:bg-slate-700 transition-all" title="Planning: ${planningCount} (${planningPct}%)"></div>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Completed (${completedCount})</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-500"></span> In Progress (${inProgressCount})</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-purple-500"></span> Review (${reviewCount})</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-600"></span> Planning (${planningCount})</span>
        </div>
      </div>

      <!-- Charts & Health Breakdown Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
        
        <!-- Left: Feature Scope & Progress Breakdown (7 Cols) -->
        <div class="lg:col-span-7 bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#27272a] rounded-2xl p-6 shadow-2xs space-y-5">
          <div class="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 class="text-sm font-bold text-slate-900 dark:text-white">Feature Delivery & Progress Breakdown</h3>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Live execution progress per feature item</p>
            </div>
            <span class="text-xs font-mono font-medium text-slate-400 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#202024]">Top 8</span>
          </div>
  
          ${activeItems.length === 0 ? `
            <div class="border border-dashed border-slate-200 dark:border-[#2c2c32] rounded-xl p-8 text-center text-slate-400">
              <i data-lucide="layers" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
              <p class="text-xs">No features registered in this workspace yet. Add records in Data Grid or Kanban to see telemetry.</p>
            </div>
          ` : `
            <div class="space-y-4 text-xs">
              ${activeItems.slice(0, 8).map(item => {
                const title = item.data.col_title || 'Untitled Feature';
                const progress = item.data.col_progress || 0;
                const dept = item.data.col_dept || 'Core';
                const status = item.data.col_status || 'Planning';
                const stClass = getStatusClass(status);

                return `
                  <div class="space-y-1.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-[#202024] transition-colors">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2 truncate max-w-[280px] sm:max-w-[340px]">
                        <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${title}</span>
                        <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-[#27272a] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#38383e]">${dept}</span>
                      </div>
                      <div class="flex items-center gap-2 font-mono">
                        <span class="text-[10px] status-badge ${stClass}">${status}</span>
                        <span class="text-slate-700 dark:text-slate-300 font-semibold w-10 text-right">${progress}%</span>
                      </div>
                    </div>
                    <div class="h-2 w-full bg-slate-100 dark:bg-[#222228] rounded-full overflow-hidden">
                      <div class="h-full bg-slate-900 dark:bg-slate-100 rounded-full transition-all duration-300" style="width: ${progress}%"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- Right: Event Bus Health & System Telemetry (5 Cols) -->
        <div class="lg:col-span-5 bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#27272a] rounded-2xl p-6 shadow-2xs space-y-5">
          <div class="pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 class="text-sm font-bold text-slate-900 dark:text-white">System & Engine Telemetry</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Database state, triggers, and audit status</p>
          </div>
          
          <div class="space-y-3.5 text-xs">
            <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-[#202024] border border-slate-200/80 dark:border-[#2c2c32] rounded-xl text-slate-700 dark:text-slate-300">
              <span class="flex items-center gap-2.5 font-medium">
                <div class="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <i data-lucide="table" class="w-4 h-4"></i>
                </div>
                <span>Active Schema Columns</span>
              </span>
              <span class="font-mono font-bold text-slate-900 dark:text-white px-2.5 py-1 bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#38383e] rounded-lg">${activeColumnsConfig.length} Fields</span>
            </div>

            <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-[#202024] border border-slate-200/80 dark:border-[#2c2c32] rounded-xl text-slate-700 dark:text-slate-300">
              <span class="flex items-center gap-2.5 font-medium">
                <div class="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <i data-lucide="zap" class="w-4 h-4"></i>
                </div>
                <span>Event Bus Automations</span>
              </span>
              <span class="font-mono font-bold text-slate-900 dark:text-white px-2.5 py-1 bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#38383e] rounded-lg">${activeAutomations.filter(a => a.active).length} Active</span>
            </div>

            <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-[#202024] border border-slate-200/80 dark:border-[#2c2c32] rounded-xl text-slate-700 dark:text-slate-300">
              <span class="flex items-center gap-2.5 font-medium">
                <div class="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <i data-lucide="history" class="w-4 h-4"></i>
                </div>
                <span>Cryptographic Audit Trail</span>
              </span>
              <span class="font-mono font-bold text-slate-900 dark:text-white px-2.5 py-1 bg-white dark:bg-[#18181c] border border-slate-200 dark:border-[#38383e] rounded-lg">${activeAuditLogs.length} Events</span>
            </div>

            <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-[#202024] border border-slate-200/80 dark:border-[#2c2c32] rounded-xl text-slate-700 dark:text-slate-300">
              <span class="flex items-center gap-2.5 font-medium">
                <div class="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <i data-lucide="database" class="w-4 h-4"></i>
                </div>
                <span>Database Engine</span>
              </span>
              <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">Turso Cloud</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  `;

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 11. CRUD & DATABASE MUTATION HANDLERS
// =========================================================================

async function handleCreateNewSchema(e) {
  if (e && e.preventDefault) e.preventDefault();

  const nameInput = document.getElementById('newSchemaName') || document.getElementById('newSchemaNameInput');
  const urlInput = document.getElementById('newSchemaUrl') || document.getElementById('newSchemaWebsiteInput');
  const descInput = document.getElementById('newSchemaDesc') || document.getElementById('newSchemaDescInput');

  const name = nameInput ? nameInput.value.trim() : '';
  const website = urlInput ? urlInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : 'Custom Project Workspace';

  if (!name) {
    alert("Please enter a Project Name.");
    return;
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_');

  try {
    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: name,
        schema_name: slug,
        description: desc,
        website_url: website
      })
    });
    const json = await res.json();
    if (json.success) {
      currentTenantKey = json.tenant.tenant_id;
      closeNewSchemaModal();
      const form = document.getElementById('newSchemaForm');
      if (form) form.reset();
      showLiveBroadcast(`Created new project workspace '${name}'. Loading project data...`);
      await fetchBoardDataFromDB();
      await refreshProjectWorkspacesFromDB();
    } else {
      alert(json.error || "Failed to create project workspace.");
    }
  } catch (err) {
    console.error("Failed to create project workspace:", err);
    alert("Server connection error while creating project workspace.");
  }
}

function openNewSchemaModal() {
  const form = document.getElementById('newSchemaForm');
  if (form) form.reset();
  const m = document.getElementById('newSchemaModal');
  if (m) {
    m.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function closeNewSchemaModal() {
  const m = document.getElementById('newSchemaModal');
  if (m) m.classList.add('hidden');
}

window.handleCreateNewSchema = handleCreateNewSchema;
window.openNewSchemaModal = openNewSchemaModal;
window.closeNewSchemaModal = closeNewSchemaModal;


async function handleInsertProjectForm(e) {
  e.preventDefault();

  const title = document.getElementById('projTitleInput').value.trim();
  const desc = document.getElementById('projDescInput') ? document.getElementById('projDescInput').value.trim() : '';
  const status = document.getElementById('projStatusInput').value;
  const dept = document.getElementById('projDeptInput').value.trim();
  const priority = document.getElementById('projPriorityInput').value;
  const timeline = document.getElementById('projTimelineInput').value;
  const progress = Number(document.getElementById('projProgressInput').value) || 0;

  const rowData = {
    col_title: title,
    col_description: desc,
    col_status: status,
    col_dept: dept,
    col_priority: priority,
    col_timeline: timeline,
    col_progress: progress
  };

  activeColumnsConfig.forEach(col => {
    if (rowData[col.id] === undefined) {
      const customInp = document.getElementById(`custom_inp_${col.id}`);
      if (customInp) {
        rowData[col.id] = customInp.type === 'number' ? Number(customInp.value) : customInp.value;
      }
    }
  });

  const newId = `row_${Date.now()}`;
  const payload = {
    id: newId,
    tenant_id: currentTenantKey,
    board_id: activeBoard.id,
    data: rowData,
    user: currentUser ? currentUser.full_name : "System User",
    role: currentRole
  };

  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) {
      activeItems.unshift(json.item);
      showLiveBroadcast(`Added feature '${title}' to project workspace.`);
      document.getElementById('newProjectModal').classList.add('hidden');
      document.getElementById('newProjectForm').reset();
      renderCurrentView();
      updateJsonbInspector();
      fetchBoardDataFromDB();
    }
  } catch (err) {
    console.error("Failed to insert item into DB:", err);
    activeItems.unshift(payload);
    renderCurrentView();
  }
}

function openEditFeatureModal(itemId) {
  const item = activeItems.find(i => i.id === itemId);
  if (!item) return;

  const modal = document.getElementById('editFeatureModal');
  const form = document.getElementById('editFeatureForm');
  if (!modal || !form) return;

  document.getElementById('editFeatureIdInput').value = item.id;
  document.getElementById('editFeatureTitleInput').value = item.data.col_title || '';
  document.getElementById('editFeatureDescInput').value = item.data.col_description || '';
  document.getElementById('editFeatureStatusInput').value = item.data.col_status || 'Planning';
  document.getElementById('editFeaturePriorityInput').value = item.data.col_priority || 'Medium';
  document.getElementById('editFeatureTimelineInput').value = item.data.col_timeline || '';
  document.getElementById('editFeatureProgressInput').value = item.data.col_progress || 0;

  // Populate registered users in editFeatureDeptInput
  const deptSelect = document.getElementById('editFeatureDeptInput');
  if (deptSelect) {
    let html = '<option value="">-- Select Registered User / Dept --</option>';
    allUsersList.forEach(u => {
      const org = u.organization ? u.organization : (u.role || 'Member');
      const val = `${u.full_name} (${org})`;
      const isSelected = (item.data.col_dept === val || item.data.col_dept === u.full_name || (item.data.col_dept && item.data.col_dept.startsWith(u.full_name))) ? 'selected' : '';
      html += `<option value="${val}" ${isSelected}>${u.full_name} • ${org}</option>`;
    });
    if (item.data.col_dept && !allUsersList.some(u => item.data.col_dept.includes(u.full_name))) {
      html += `<option value="${item.data.col_dept}" selected>${item.data.col_dept}</option>`;
    }
    deptSelect.innerHTML = html;
  }

  modal.classList.remove('hidden');
}

async function handleEditFeatureForm(e) {
  e.preventDefault();

  const itemId = document.getElementById('editFeatureIdInput').value;
  const item = activeItems.find(i => i.id === itemId);
  if (!item) return;

  const title = document.getElementById('editFeatureTitleInput').value.trim();
  const desc = document.getElementById('editFeatureDescInput').value.trim();
  const status = document.getElementById('editFeatureStatusInput').value;
  const priority = document.getElementById('editFeaturePriorityInput').value;
  const dept = document.getElementById('editFeatureDeptInput').value;
  const timeline = document.getElementById('editFeatureTimelineInput').value;
  const progress = Number(document.getElementById('editFeatureProgressInput').value) || 0;

  const updatedData = {
    ...item.data,
    col_title: title,
    col_description: desc,
    col_status: status,
    col_priority: priority,
    col_dept: dept,
    col_timeline: timeline,
    col_progress: progress
  };

  try {
    const res = await fetch('/api/items', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: itemId,
        data: updatedData,
        user: currentUser ? currentUser.full_name : "System User",
        role: currentRole
      })
    });

    const json = await res.json();
    if (json.success) {
      item.data = updatedData;
      document.getElementById('editFeatureModal').classList.add('hidden');
      showLiveBroadcast(`Updated feature '${title}' successfully.`);
      renderCurrentView();
      updateJsonbInspector();
    }
  } catch (err) {
    item.data = updatedData;
    document.getElementById('editFeatureModal').classList.add('hidden');
    renderCurrentView();
  }
}

async function insertQuickEmptyRow(customData = {}) {
  const newId = `row_${Date.now()}`;
  const rowData = {
    col_title: "New Feature",
    col_status: "Planning",
    col_dept: (currentUser && currentUser.organization) ? currentUser.organization : "Core Module",
    col_priority: "Medium",
    col_timeline: "2026-12-31",
    col_progress: 0,
    ...customData
  };

  const payload = {
    id: newId,
    tenant_id: currentTenantKey,
    board_id: activeBoard.id,
    data: rowData,
    user: currentUser ? currentUser.full_name : "System User",
    role: currentRole
  };

  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) {
      activeItems.push(json.item);
      if (isFirebaseActive && firestoreDb) {
        firestoreDb.collection('workspaces').doc(currentTenantKey).collection('items').doc(newId).set(rowData);
      }
      showLiveBroadcast(`Database Insert: New row #${newId} persisted.`);
      renderCurrentView();
      updateJsonbInspector();
    }
  } catch (err) {
    activeItems.push(payload);
    renderCurrentView();
  }
}

async function updateItemCell(itemId, colId, newVal) {
  const item = activeItems.find(i => i.id === itemId);
  if (!item) return;

  const oldVal = item.data[colId];
  if (oldVal === newVal) return;

  item.data[colId] = newVal;
  const colDef = activeColumnsConfig.find(c => c.id === colId) || { title: colId };

  try {
    // If Firebase Cloud is active, write directly to Firestore
    if (isFirebaseActive && firestoreDb) {
      const itemDoc = firestoreDb.collection('workspaces').doc(currentTenantKey).collection('items').doc(itemId);
      await itemDoc.set({ [colId]: newVal, updated_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    const res = await fetch('/api/items', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: itemId,
        tenant_id: currentTenantKey,
        col_id: colId,
        new_val: newVal,
        col_title: colDef.title,
        user: currentUser ? currentUser.full_name : "System User",
        role: currentRole
      })
    });
    const json = await res.json();
    if (json.success) {
      showLiveBroadcast(`Synced: '${colDef.title}' updated to '${newVal}' ${isFirebaseActive ? '(Cloud Firestore)' : '(SQLite)'}.`);
      if (json.triggered_automation) {
        showLiveBroadcast(`Automation Fired: [${json.triggered_automation}] -> Push webhook dispatched.`);
      }
      renderCurrentView();
      updateJsonbInspector();
    }
  } catch (err) {
    renderCurrentView();
  }
}

async function deleteRow(itemId) {
  try {
    const res = await fetch(`/api/items?id=${itemId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      if (isFirebaseActive && firestoreDb) {
        firestoreDb.collection('workspaces').doc(currentTenantKey).collection('items').doc(itemId).delete();
      }
      const idx = activeItems.findIndex(i => i.id === itemId);
      if (idx !== -1) activeItems.splice(idx, 1);
      showLiveBroadcast(`Deleted item #${itemId} from database.`);
      renderCurrentView();
      updateJsonbInspector();
    }
  } catch (err) {
    const idx = activeItems.findIndex(i => i.id === itemId);
    if (idx !== -1) activeItems.splice(idx, 1);
    renderCurrentView();
  }
}

async function deleteColumnFromSchema(colId, colTitle) {
  if (!confirm(`Are you sure you want to delete column '${colTitle}' from the schema? All row values for this column will be removed.`)) return;

  try {
    const res = await fetch(`/api/columns?tenant_id=${currentTenantKey}&col_id=${colId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      activeColumnsConfig = activeColumnsConfig.filter(c => c.id !== colId);
      activeItems.forEach(i => { delete i.data[colId]; });
      showLiveBroadcast(`Schema Mutation: Column '${colTitle}' removed from columns_config JSONB.`);
      renderApp();
    }
  } catch (err) {
    activeColumnsConfig = activeColumnsConfig.filter(c => c.id !== colId);
    renderApp();
  }
}

async function handleClearBoard() {
  if (!confirm("Are you sure you want to clear all project records from this board for a fresh clean slate?")) return;

  try {
    const res = await fetch('/api/clear', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ tenant_id: currentTenantKey })
    });
    const json = await res.json();
    if (json.success) {
      activeItems = [];
      activeAuditLogs = [];
      showLiveBroadcast(`Clean Slate: All project records cleared from database.`);
      renderCurrentView();
      updateJsonbInspector();
    }
  } catch (err) {
    activeItems = [];
    renderCurrentView();
  }
}


function openDeleteProjectModal(tenantId, projectTitle) {
  const targetId = tenantId || currentTenantKey;
  const targetTitle = projectTitle || (activeBoard && activeBoard.title ? activeBoard.title : 'Current Project');
  
  const nameEl = document.getElementById('deleteProjectTargetName');
  if (nameEl) nameEl.textContent = `'${targetTitle}'`;

  const btn = document.getElementById('confirmDeleteProjectBtn');
  if (btn) {
    btn.setAttribute('data-tenant-id', targetId);
    btn.setAttribute('data-project-title', targetTitle);
  }

  const modal = document.getElementById('deleteProjectModal');
  if (modal) {
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function closeDeleteProjectModal() {
  const modal = document.getElementById('deleteProjectModal');
  if (modal) modal.classList.add('hidden');
}

async function executeDeleteCurrentProject() {
  const btn = document.getElementById('confirmDeleteProjectBtn');
  const targetId = (btn && btn.getAttribute('data-tenant-id')) ? btn.getAttribute('data-tenant-id') : currentTenantKey;
  const targetTitle = (btn && btn.getAttribute('data-project-title')) ? btn.getAttribute('data-project-title') : (activeBoard ? activeBoard.title : 'Project');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Deleting...';
  }

  try {
    const res = await fetch(`/api/tenants?tenant_id=${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      closeDeleteProjectModal();
      currentTenantKey = json.next_tenant_id || 'tenant_primary';
      showLiveBroadcast(`Project '${targetTitle}' was permanently deleted.`);
      await fetchBoardDataFromDB();
    } else {
      alert(json.error || "Failed to delete project.");
    }
  } catch (err) {
    console.error("Failed to delete project:", err);
    showLiveBroadcast(`Error deleting project workspace.`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i> <span>Permanently Delete</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

function handleDeleteProject() {
  const title = (activeBoard && activeBoard.title) ? activeBoard.title : 'Current Project';
  openDeleteProjectModal(currentTenantKey, title);
}


async function handleCreateColumn() {
  const title = document.getElementById('newColTitle').value.trim();
  const type = document.getElementById('newColType').value;
  if (!title) return;

  const colId = `col_${Date.now().toString().slice(-4)}`;
  const newCol = {
    id: colId,
    type: type,
    title: title,
    width: "180px",
    options: type === 'status' ? ["Planning", "In Progress", "Approved", "Completed"] : undefined
  };

  try {
    const res = await fetch('/api/columns', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ tenant_id: currentTenantKey, column: newCol })
    });
    const json = await res.json();
    if (json.success) {
      activeColumnsConfig.push(newCol);
      activeItems.forEach(item => {
        item.data[colId] = type === 'progress' ? 0 : type === 'currency' ? 0 : '';
      });
      document.getElementById('addColumnModal').classList.add('hidden');
      showLiveBroadcast(`Dynamic Schema Mutation: Added column '${title}' (${type}) to columns_config JSONB.`);
      renderApp();
    }
  } catch (err) {
    activeColumnsConfig.push(newCol);
    renderApp();
  }
}

async function handleCreateAutomation() {
  const trigger = document.getElementById('autoTriggerField').value;
  const action = document.getElementById('autoActionField').value;

  try {
    const res = await fetch('/api/automations', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        tenant_id: currentTenantKey,
        name: `Custom Rule (${trigger})`,
        trigger: `When ${trigger}`,
        action: action
      })
    });
    const json = await res.json();
    if (json.success) {
      activeAutomations.push(json.automation);
      renderAutomationRecipes();
      showLiveBroadcast(`Added new automation rule to the Event Bus.`);
    }
  } catch (err) {
    console.error(err);
  }
}

// =========================================================================
// 12. STATUS PICKER POPUP & MODAL HELPERS
// =========================================================================

function renderDynamicCustomFieldsInModal() {
  const container = document.getElementById('dynamicCustomFieldsContainer');
  if (!container) return;

  const defaultKeys = ['col_title', 'col_status', 'col_dept', 'col_priority', 'col_timeline', 'col_progress'];
  const customCols = activeColumnsConfig.filter(c => !defaultKeys.includes(c.id));

  if (customCols.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="border-t border-slate-100 pt-2"><span class="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Custom Schema Fields</span></div>`;
  customCols.forEach(col => {
    html += `
      <div>
        <label class="block font-semibold text-slate-700 mb-1">${col.title} (${col.type})</label>
        <input id="custom_inp_${col.id}" type="${col.type === 'currency' || col.type === 'progress' ? 'number' : col.type === 'date' ? 'date' : 'text'}" 
          placeholder="Enter ${col.title}..." class="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 focus:ring-2 focus:ring-slate-400 dark:ring-zinc-600 focus:outline-none">
      </div>
    `;
  });

  container.innerHTML = html;
}

function openStatusPicker(targetBtn, itemId, colId) {
  const popup = document.getElementById('statusPickerPopup');
  const optionsList = document.getElementById('statusOptionsList');
  if (!popup || !optionsList) return;

  const colDef = activeColumnsConfig.find(c => c.id === colId) || { options: ["Planning", "In Progress", "Review", "Completed", "Blocked"] };
  const rawOptions = colDef.options || ["Planning", "In Progress", "Review", "Completed", "Blocked"];
  const options = rawOptions.filter(o => o !== 'Mayor Review' && o !== 'Approved');

  const rect = targetBtn.getBoundingClientRect();
  popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
  popup.style.left = `${rect.left + window.scrollX}px`;

  let html = '';
  options.forEach(opt => {
    const badgeClass = getStatusClass(opt);
    html += `
      <button class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 flex items-center justify-between transition-colors status-option-select" data-val="${opt}">
        <span class="status-badge ${badgeClass} text-[11px]">${opt}</span>
      </button>
    `;
  });

  optionsList.innerHTML = html;
  popup.classList.remove('hidden');

  optionsList.querySelectorAll('.status-option-select').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedStatus = btn.getAttribute('data-val');
      updateItemCell(itemId, colId, selectedStatus);
      popup.classList.add('hidden');
    });
  });
}

function renderAutomationRecipes() {
  const list = document.getElementById('automationRecipesList');
  if (!list) return;

  let html = '';
  activeAutomations.forEach(rule => {
    html += `
      <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-bold text-slate-900 text-xs">${rule.name}</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${rule.active ? 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400' : 'bg-slate-200 text-slate-600'}">
            ${rule.active ? 'Active' : 'Disabled'}
          </span>
        </div>

        <div class="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 bg-white dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 font-mono">
          <div class="text-slate-600 dark:text-zinc-400 dark:text-slate-600 dark:text-zinc-400 flex items-center gap-1.5"><i data-lucide="zap" class="w-3.5 h-3.5"></i> <span>IF: ${rule.trigger}</span></div>
          <div class="text-slate-600 dark:text-zinc-400 dark:text-slate-600 dark:text-zinc-400 flex items-center gap-1.5"><i data-lucide="arrow-right-circle" class="w-3.5 h-3.5"></i> <span>THEN: ${rule.action}</span></div>
        </div>

        <div class="flex items-center justify-between text-[10px] text-slate-400">
          <span>Triggered: <b>${rule.count} times</b></span>
          <button class="test-automation-trigger text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white font-semibold" data-rule-id="${rule.id}">
            Simulate Event Trigger →
          </button>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;
  lucide.createIcons();

  list.querySelectorAll('.test-automation-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const ruleId = btn.getAttribute('data-rule-id');
      const rule = activeAutomations.find(r => r.id === ruleId);
      if (rule) {
        rule.count++;
        showLiveBroadcast(`Event Bus Simulation: Triggered [${rule.name}] successfully.`);
        renderAutomationRecipes();
      }
    });
  });
}

function renderAuditLogs() {
  const container = document.getElementById('auditLogsContainer');
  if (!container) return;

  let html = '';
  if (activeAuditLogs.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400">No cell mutations logged yet.</p>`;
    return;
  }

  activeAuditLogs.forEach(log => {
    html += `
      <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 font-bold text-slate-900">
            <i data-lucide="user" class="w-3.5 h-3.5 text-slate-500"></i>
            <span>${log.user}</span>
            <span class="text-[10px] font-normal text-slate-500 font-mono">(${log.role})</span>
          </div>
          <span class="font-mono text-[10px] text-slate-400">${log.timestamp}</span>
        </div>

        <div class="text-[11px] text-slate-700">
          Modified <span class="font-semibold text-slate-700 dark:text-zinc-300">${log.field}</span> on <i>"${log.item_title}"</i>
        </div>

        <div class="bg-white p-2 rounded-lg border border-slate-100 flex items-center gap-2 font-mono text-[11px]">
          <span class="text-slate-600 dark:text-zinc-400 line-through">${log.old_val || '(empty)'}</span>
          <span class="text-slate-400">→</span>
          <span class="text-slate-600 dark:text-zinc-400 font-semibold">${log.new_val}</span>
        </div>

        <div class="text-[9px] font-mono text-slate-400 flex items-center justify-between">
          <span>Schema: ${activeBoard.schema || currentTenantKey}</span>
          <span>Hash: ${log.hash}</span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons();
}

function updateJsonbInspector() {
  const jsonCols = document.getElementById('jsonColumnsConfig');
  const jsonItems = document.getElementById('jsonItemsData');
  if (!jsonCols || !jsonItems) return;

  jsonCols.textContent = JSON.stringify(activeColumnsConfig, null, 2);
  jsonItems.textContent = JSON.stringify(activeItems.map(i => ({ id: i.id, data: i.data })), null, 2);
}

// =========================================================================
// 13. HELPER UTILITIES
// =========================================================================

function showLiveBroadcast(message) {
  const banner = document.getElementById('liveEventBanner');
  const bannerText = document.getElementById('liveEventText');
  if (!banner || !bannerText) return;

  bannerText.textContent = message;
  banner.classList.remove('hidden');
  banner.classList.add('flex');

  banner.classList.add('ring-2', 'ring-slate-400 dark:ring-zinc-600');
  setTimeout(() => banner.classList.remove('ring-2', 'ring-slate-400 dark:ring-zinc-600'), 1000);
}

function filterItems(items) {
  if (!currentSearchQuery) return items;
  return items.filter(item => {
    return Object.values(item.data).some(val => 
      String(val).toLowerCase().includes(currentSearchQuery)
    );
  });
}

function getStatusClass(status) {
  const map = {
    'Planning': 'status-planning',
    'In Procurement': 'status-procurement',
    'Mayor Review': 'status-mayor-review',
    'Review': 'status-mayor-review',
    'In Progress': 'status-in-progress',
    'Approved': 'status-approved',
    'On Hold': 'status-on-hold',
    'Completed': 'status-completed',
    'Blocked': 'status-blocked'
  };
  return map[status] || 'status-planning';
}

function getPriorityClass(priority) {
  const map = {
    'Critical': 'priority-critical',
    'High': 'priority-high',
    'Medium': 'priority-medium',
    'Low': 'priority-low'
  };
  return map[priority] || 'priority-medium';
}

// =========================================================================

// =========================================================================
// 14. FULL-SCREEN PROJECT WEBSITE VIEWER ENGINE
// =========================================================================

function openProjectWebsiteModal(url, title) {
  const modal = document.getElementById('websitePreviewModal');
  const titleEl = document.getElementById('previewModalTitle') || document.getElementById('previewModalProjectTitle');
  const iframe = document.getElementById('websiteIframe') || document.getElementById('websitePreviewIframe');

  if (!modal || !iframe) return;

  const validUrl = (url && url.startsWith('http')) ? url : `https://${(url || 'openflow.io').replace(/_/g, '-')}`;

  if (titleEl) titleEl.textContent = title ? `${title} • Live Preview` : 'Live Website Preview';

  // Set desktop viewport by default
  setWebsiteViewport('desktop');

  // Load via proxy endpoint to bypass X-Frame-Options
  iframe.src = `/api/proxy-site?url=${encodeURIComponent(validUrl)}`;
  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function setWebsiteViewport(mode) {
  const container = document.getElementById('websiteIframeContainer') || document.getElementById('websiteIframeWrapper');
  const btns = document.querySelectorAll('.viewport-toggle-btn');
  
  btns.forEach(btn => {
    btn.classList.remove('active', 'bg-white', 'dark:bg-zinc-700', 'text-slate-800', 'dark:text-white');
    btn.classList.add('text-slate-400', 'hover:text-white');
  });

  if (container) {
    if (mode === 'desktop') {
      container.className = 'w-full h-full max-w-full rounded-xl overflow-hidden border border-slate-800 bg-white shadow-2xl transition-all duration-300';
    } else if (mode === 'tablet') {
      container.className = 'w-[768px] max-w-full h-full rounded-2xl overflow-hidden border-8 border-slate-800 bg-white shadow-2xl transition-all duration-300';
    } else if (mode === 'mobile') {
      container.className = 'w-[390px] max-w-full h-full rounded-3xl overflow-hidden border-8 border-slate-800 bg-white shadow-2xl transition-all duration-300';
    }
  }

  // Highlight active button
  const activeBtn = document.querySelector(`.viewport-toggle-btn[onclick*="${mode}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active', 'bg-white', 'dark:bg-zinc-700', 'text-slate-800', 'dark:text-white');
    activeBtn.classList.remove('text-slate-400');
  }
}

function closeProjectWebsiteModal() {
  const modal = document.getElementById('websitePreviewModal');
  const iframe = document.getElementById('websiteIframe') || document.getElementById('websitePreviewIframe');
  if (modal) modal.classList.add('hidden');
  if (iframe) iframe.src = 'about:blank';
}

function openProjectWebsiteModalDirect() {
  const url = (activeBoard && activeBoard.website_url) ? activeBoard.website_url : 'https://openflow.io';
  const title = (activeBoard && activeBoard.title) ? activeBoard.title : 'Project Website';
  openProjectWebsiteModal(url, title);
}

window.openProjectWebsiteModal = openProjectWebsiteModal;
window.closeProjectWebsiteModal = closeProjectWebsiteModal;
window.openProjectWebsiteModalDirect = openProjectWebsiteModalDirect;
window.setWebsiteViewport = setWebsiteViewport;

// =========================================================================
// 15. PROJECT WORKSPACES MANAGER & SCHEMA CREATION ENGINE
// =========================================================================

async function refreshProjectWorkspacesFromDB() {
  try {
    const res = await fetch('/api/tenants', { headers: getAuthHeaders() });
    if (res.ok) {
      const json = await res.json();
      allTenantsList = json.tenants || [];
      populateWorkspaceDropdown();
    }
  } catch (err) {
    console.error("Failed to refresh tenants:", err);
  }
}

async function openProjectManagerModal() {
  await refreshProjectWorkspacesFromDB();
  renderProjectManagerModal();
}

function closeProjectManagerModal() {
  const modal = document.getElementById('projectManagerModal');
  if (modal) modal.classList.add('hidden');
}

function renderProjectManagerModal() {
  const modal = document.getElementById('projectManagerModal');
  const listCont = document.getElementById('projectWorkspacesList') || document.getElementById('projectManagerList');
  if (!modal) return;

  if (listCont) {
    if (!allTenantsList || allTenantsList.length === 0) {
      listCont.innerHTML = `
        <div class="p-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-zinc-800 rounded-xl">
          No project workspaces found. Click 'Create New Project' below to start one.
        </div>
      `;
    } else {
      let html = '';
      allTenantsList.forEach(t => {
        const isActive = t.tenant_id === currentTenantKey;
        const activeBadge = isActive ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 dark:bg-[#27272a] text-white dark:text-white">Active</span>' : '';
        const webUrl = t.website_url || `https://${(t.schema_name || 'openflow').replace(/_/g, '-')}.gov.ph`;

        html += `
          <div class="p-3.5 rounded-xl border ${isActive ? 'border-slate-400 dark:border-zinc-500 bg-slate-50 dark:bg-[#18181b]' : 'border-slate-200 dark:border-[#27272a] bg-white dark:bg-[#161619]'} flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs hover:border-slate-400 dark:hover:border-zinc-600 transition-all">
            <div class="space-y-1 flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">${t.title}</h4>
                ${activeBadge}
                <span class="text-[10px] font-mono text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-700">${t.schema_name}</span>
              </div>
              ${t.description ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${t.description}</p>` : ''}
              <div class="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                <i data-lucide="globe" class="w-3 h-3 text-slate-400"></i>
                <span class="truncate">${webUrl}</span>
              </div>
            </div>

            <div class="flex items-center gap-1.5 self-end sm:self-auto flex-shrink-0">
              ${!isActive ? `
                <button type="button" class="switch-to-project-btn px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors" data-tenant-id="${t.tenant_id}">
                  Switch To
                </button>
              ` : `
                <span class="px-2.5 py-1 text-[11px] font-semibold text-slate-400 italic">Current Workspace</span>
              `}

              <button type="button" class="delete-project-row-btn p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-lg transition-colors" data-tenant-id="${t.tenant_id}" data-project-title="${t.title}" title="Delete Project Workspace">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        `;
      });
      listCont.innerHTML = html;

      // Attach switch listeners
      listCont.querySelectorAll('.switch-to-project-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tid = btn.getAttribute('data-tenant-id');
          currentTenantKey = tid;
          modal.classList.add('hidden');
          fetchBoardDataFromDB();
          showLiveBroadcast(`Switched to project workspace.`);
        });
      });

      // Attach delete listeners
      listCont.querySelectorAll('.delete-project-row-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tid = btn.getAttribute('data-tenant-id');
          const title = btn.getAttribute('data-project-title');
          await deleteProjectById(tid, title);
        });
      });
    }
  }

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function createProjectFromManager() {
  closeProjectManagerModal();
  openNewSchemaModal();
}

function openNewSchemaModal() {
  const modal = document.getElementById('newSchemaModal');
  const form = document.getElementById('newSchemaForm');
  if (form) form.reset();
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeNewSchemaModal() {
  const modal = document.getElementById('newSchemaModal');
  if (modal) modal.classList.add('hidden');
}

async function handleCreateNewSchema(e) {
  if (e && e.preventDefault) e.preventDefault();

  const nameInput = document.getElementById('newSchemaName') || document.getElementById('newSchemaNameInput');
  const urlInput = document.getElementById('newSchemaUrl') || document.getElementById('newSchemaWebsiteInput');
  const descInput = document.getElementById('newSchemaDesc') || document.getElementById('newSchemaDescInput');

  const name = nameInput ? nameInput.value.trim() : '';
  let website = urlInput ? urlInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : 'Custom Project Workspace';

  if (!name) {
    alert("Please enter a Project Name.");
    return;
  }

  if (website && !website.startsWith('http://') && !website.startsWith('https://')) {
    website = `https://${website}`;
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_') || `workspace_${Date.now()}`;

  try {
    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: name,
        schema_name: slug,
        description: desc,
        website_url: website
      })
    });
    
    const json = await res.json();
    if (res.ok && json.success) {
      currentTenantKey = json.tenant.tenant_id;
      closeNewSchemaModal();
      const form = document.getElementById('newSchemaForm');
      if (form) form.reset();
      showLiveBroadcast(`Created new project workspace '${name}'.`);
      await fetchBoardDataFromDB();
      await refreshProjectWorkspacesFromDB();
    } else {
      alert(json.error || "Failed to create project workspace.");
    }
  } catch (err) {
    console.error("Failed to create project:", err);
    alert("Server error: " + (err.message || "Failed to create project workspace."));
  }
}

async function deleteProjectById(tenantId, projectTitle) {
  if (!confirm(`Are you sure you want to permanently delete project '${projectTitle}'?

This will remove all features, columns, automations, and audit logs for this project workspace.`)) return;

  try {
    const res = await fetch(`/api/tenants?tenant_id=${encodeURIComponent(tenantId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      if (currentTenantKey === tenantId) {
        currentTenantKey = json.next_tenant_id || 'tenant_primary';
      }
      showLiveBroadcast(`Project '${projectTitle}' was permanently deleted.`);
      await fetchBoardDataFromDB();
      await refreshProjectWorkspacesFromDB();
      renderProjectManagerModal();
    } else {
      alert(json.error || "Failed to delete project.");
    }
  } catch (err) {
    console.error("Failed to delete project:", err);
    showLiveBroadcast(`Error deleting project workspace.`);
  }
}

window.openProjectManagerModal = openProjectManagerModal;
window.closeProjectManagerModal = closeProjectManagerModal;
window.createProjectFromManager = createProjectFromManager;
window.openNewSchemaModal = openNewSchemaModal;
window.closeNewSchemaModal = closeNewSchemaModal;
window.handleCreateNewSchema = handleCreateNewSchema;
window.deleteProjectById = deleteProjectById;

// Global Window Exports for Inline HTML Handlers
window.switchGatewayTab = switchGatewayTab;
window.switchAuthModalTab = switchAuthModalTab;
window.executeGatewayRegister = executeGatewayRegister;
window.executeGatewayLogin = executeGatewayLogin;
window.handleInAppRegister = handleInAppRegister;
window.handleInAppLogin = handleInAppLogin;
window.openProjectWebsiteModal = openProjectWebsiteModal;
window.closeProjectWebsiteModal = closeProjectWebsiteModal;


// =========================================================================
// GLOBAL MODAL & ACTION HELPERS (DIRECT DISPATCH ON WINDOW)
// =========================================================================

function openInsertModal() {
  updateOwnerModalDropdown();
  renderDynamicCustomFieldsInModal();
  const m = document.getElementById('newProjectModal');
  if (m) m.classList.remove('hidden');
}

function openAddColumnModalDirect() {
  const colTitle = document.getElementById('newColTitle');
  if (colTitle) colTitle.value = '';
  const m = document.getElementById('addColumnModal');
  if (m) m.classList.remove('hidden');
}

function openAutomationsDrawer() {
  renderAutomationRecipes();
  const drawer = document.getElementById('automationDrawer');
  if (drawer) {
    drawer.classList.remove('hidden');
    setTimeout(() => {
      const panel = document.getElementById('automationDrawerPanel');
      const backdrop = document.getElementById('automationDrawerBackdrop');
      if (panel) panel.classList.remove('translate-x-full');
      if (backdrop) backdrop.classList.remove('opacity-0');
    }, 10);
  }
}

function closeAutomationsDrawer() {
  const panel = document.getElementById('automationDrawerPanel');
  const backdrop = document.getElementById('automationDrawerBackdrop');
  if (panel) panel.classList.add('translate-x-full');
  if (backdrop) backdrop.classList.add('opacity-0');
  setTimeout(() => {
    const drawer = document.getElementById('automationDrawer');
    if (drawer) drawer.classList.add('hidden');
  }, 250);
}

function openAuditTrailDrawer() {
  renderAuditLogs();
  const drawer = document.getElementById('auditDrawer');
  if (drawer) {
    drawer.classList.remove('hidden');
    setTimeout(() => {
      const panel = document.getElementById('auditDrawerPanel');
      const backdrop = document.getElementById('auditDrawerBackdrop');
      if (panel) panel.classList.remove('translate-x-full');
      if (backdrop) backdrop.classList.remove('opacity-0');
    }, 10);
  }
}

function closeAuditTrailDrawer() {
  const panel = document.getElementById('auditDrawerPanel');
  const backdrop = document.getElementById('auditDrawerBackdrop');
  if (panel) panel.classList.add('translate-x-full');
  if (backdrop) backdrop.classList.add('opacity-0');
  setTimeout(() => {
    const drawer = document.getElementById('auditDrawer');
    if (drawer) drawer.classList.add('hidden');
  }, 250);
}

function openDbInspectorModalDirect() {
  updateJsonbInspector();
  const m = document.getElementById('dbInspectorModal');
  if (m) m.classList.remove('hidden');
}

function openRbacMatrixModalDirect() {
  const m = document.getElementById('rbacMatrixModal');
  if (m) m.classList.remove('hidden');
}

function toggleUserDropdown(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const menu = document.getElementById('userDropdownMenu');
  if (menu) {
    menu.classList.toggle('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function switchViewDirect(viewName) {
  const viewBtns = document.querySelectorAll('.view-tab-btn');
  viewBtns.forEach(btn => {
    if (btn.getAttribute('data-view') === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  switchView(viewName);
}

function openNewSchemaModal() {
  const form = document.getElementById('newSchemaForm');
  if (form) form.reset();
  const m = document.getElementById('newSchemaModal');
  if (m) m.classList.remove('hidden');
}

function closeAllModals() {
  const modals = [
    'authModal', 'newProjectModal', 'editFeatureModal', 'newSchemaModal',
    'projectManagerModal', 'addColumnModal', 'dbInspectorModal', 'rbacMatrixModal',
    'websitePreviewModal', 'userManagementModal'
  ];
  modals.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  closeAutomationsDrawer();
  closeAuditTrailDrawer();
  const menu = document.getElementById('userDropdownMenu');
  if (menu) menu.classList.add('hidden');
}

// Bind directly to window for 100% resilient invocation
window.openInsertModal = openInsertModal;
window.openAddColumnModalDirect = openAddColumnModalDirect;
window.openAutomationsDrawer = openAutomationsDrawer;
window.closeAutomationsDrawer = closeAutomationsDrawer;
window.openAuditTrailDrawer = openAuditTrailDrawer;
window.closeAuditTrailDrawer = closeAuditTrailDrawer;
window.openDbInspectorModalDirect = openDbInspectorModalDirect;
window.openRbacMatrixModalDirect = openRbacMatrixModalDirect;
window.toggleUserDropdown = toggleUserDropdown;
window.switchViewDirect = switchViewDirect;
window.openNewSchemaModal = openNewSchemaModal;
window.closeAllModals = closeAllModals;
window.toggleTheme = toggleTheme;
window.openProjectWebsiteModal = openProjectWebsiteModal;
window.closeProjectWebsiteModal = closeProjectWebsiteModal;
window.openUserDatabaseModal = openUserDatabaseModal;
window.renderProjectManagerModal = renderProjectManagerModal;
window.handleClearBoard = handleClearBoard;
window.handleDeleteProject = handleDeleteProject;
window.handleLogout = handleLogout;


window.openDeleteProjectModal = openDeleteProjectModal;
window.closeDeleteProjectModal = closeDeleteProjectModal;
window.executeDeleteCurrentProject = executeDeleteCurrentProject;


// =========================================================================
// 14. ADVANCED DATABASED CAPABILITIES (ROLLBACK, IMPORT, EXPORT, SQL CONSOLE)
// =========================================================================

async function rollbackAuditLog(logId) {
  if (!confirm("Are you sure you want to revert this recorded change in the database?")) return;
  try {
    const res = await fetch('/api/audit/rollback', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ log_id: logId, tenant_id: currentTenantKey })
    });
    const json = await res.json();
    if (json.success) {
      showLiveBroadcast(json.message || "Change successfully reverted in database.");
      await fetchBoardDataFromDB();
      renderAuditLogs();
    } else {
      alert(json.error || "Rollback failed.");
    }
  } catch (err) {
    console.error("Rollback error:", err);
    showLiveBroadcast("Failed to execute database rollback.");
  }
}

const DEFAULT_IMPORT_SAMPLE = `Features,Status,Owner / Dept,Priority,Target Release,Progress
Resident Mobile Self-Service Portal,In Progress,System Administrator (OpenFlow Core Team),Critical,2026-11-30,65
Automated Municipal Tax & Permitting Gateway,Completed,System Administrator (OpenFlow Core Team),High,2026-10-15,100
Smart Streetlight Mesh & Energy Telemetry,Planning,System Administrator (OpenFlow Core Team),Medium,2026-12-31,25
Emergency Dispatch & GIS Responder Map,Review,System Administrator (OpenFlow Core Team),Critical,2026-11-15,85
Public Financial Transparency Portal,Planning,System Administrator (OpenFlow Core Team),Low,2027-01-30,10`;

function openImportModal() {
  const m = document.getElementById('importDataModal');
  const pasteText = document.getElementById('importPasteText');
  if (pasteText && !pasteText.value.trim()) {
    pasteText.value = DEFAULT_IMPORT_SAMPLE;
  }
  if (m) {
    m.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
  switchImportTab('paste');
}

function closeImportModal() {
  const m = document.getElementById('importDataModal');
  if (m) m.classList.add('hidden');
}

function switchImportTab(tab) {
  const pasteTabBtn = document.getElementById('importTabPasteBtn');
  const fileTabBtn = document.getElementById('importTabFileBtn');
  const pasteBox = document.getElementById('importPasteContainer');
  const fileBox = document.getElementById('importFileContainer');

  if (tab === 'paste') {
    if (pasteTabBtn) {
      pasteTabBtn.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
      pasteTabBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
    }
    if (fileTabBtn) {
      fileTabBtn.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
      fileTabBtn.classList.add('text-slate-600', 'dark:text-slate-400');
    }
    if (pasteBox) pasteBox.classList.remove('hidden');
    if (fileBox) fileBox.classList.add('hidden');
  } else {
    if (fileTabBtn) {
      fileTabBtn.classList.add('bg-white', 'text-slate-900', 'shadow-2xs');
      fileTabBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
    }
    if (pasteTabBtn) {
      pasteTabBtn.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs');
      pasteTabBtn.classList.add('text-slate-600', 'dark:text-slate-400');
    }
    if (fileBox) fileBox.classList.remove('hidden');
    if (pasteBox) pasteBox.classList.add('hidden');
  }
}

async function executeImportData() {
  const pasteBox = document.getElementById('importPasteContainer');
  const isPasteMode = pasteBox && !pasteBox.classList.contains('hidden');
  let itemsToImport = [];

  const btn = document.getElementById('executeImportBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Importing...';
  }

  try {
    if (isPasteMode) {
      let rawText = document.getElementById('importPasteText').value.trim();
      if (!rawText) {
        rawText = DEFAULT_IMPORT_SAMPLE;
      }
      
      // Try JSON parse first
      if (rawText.startsWith('[') && rawText.endsWith(']')) {
        try {
          itemsToImport = JSON.parse(rawText);
        } catch (e) {
          itemsToImport = parseSmartDataset(rawText);
        }
      } else {
        itemsToImport = parseSmartDataset(rawText);
      }
    } else {
      const fileInput = document.getElementById('importFileInput');
      if (!fileInput.files || fileInput.files.length === 0) {
        alert("Please choose a CSV or JSON file to upload, or switch to 'Paste CSV / Text'.");
        return;
      }
      const file = fileInput.files[0];
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        itemsToImport = JSON.parse(text);
      } else {
        itemsToImport = parseSmartDataset(text);
      }
    }

    if (!itemsToImport || itemsToImport.length === 0) {
      itemsToImport = parseSmartDataset(DEFAULT_IMPORT_SAMPLE);
    }

    const res = await fetch('/api/import', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ tenant_id: currentTenantKey, items: itemsToImport })
    });
    const json = await res.json();
    if (json.success) {
      closeImportModal();
      showLiveBroadcast(`Imported ${json.imported_count} features into active workspace!`);
      await fetchBoardDataFromDB();
    } else {
      alert(json.error || "Import failed.");
    }
  } catch (err) {
    console.error("Import error:", err);
    alert("Error parsing or importing dataset: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> <span>Import Dataset</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}

function parseSmartDataset(text) {
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.includes(';') ? ';' : ',');

  // Check if first line is a header
  const firstCols = splitCSVLine(firstLine, delimiter);
  const isHeader = firstCols.some(c => {
    const cl = c.toLowerCase();
    return cl.includes('feature') || cl.includes('title') || cl.includes('name') || cl.includes('status') || cl.includes('dept') || cl.includes('priority');
  });

  const headers = isHeader ? firstCols : ['col_title'];
  const startIndex = isHeader ? 1 : 0;
  const rows = [];

  const defaultUser = currentUser ? `${currentUser.full_name} (${currentUser.organization || 'OpenFlow Core Team'})` : 'System Administrator (OpenFlow Core Team)';

  for (let i = startIndex; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delimiter);
    if (cols.length === 0 || !cols.some(c => c.length > 0)) continue;

    const item = {
      col_title: '',
      col_status: 'Planning',
      col_dept: defaultUser,
      col_priority: 'Medium',
      col_timeline: '2026-12-31',
      col_progress: 0
    };

    if (!isHeader && cols.length === 1) {
      item.col_title = cols[0];
    } else {
      headers.forEach((h, idx) => {
        const val = cols[idx] !== undefined ? cols[idx].trim() : '';
        const hLow = h.toLowerCase();
        if (hLow.includes('feature') || hLow.includes('title') || hLow.includes('name') || hLow.includes('task')) {
          item.col_title = val;
        } else if (hLow.includes('status') || hLow.includes('stage')) {
          item.col_status = val || 'Planning';
        } else if (hLow.includes('dept') || hLow.includes('lead') || hLow.includes('owner') || hLow.includes('assignee')) {
          item.col_dept = val || defaultUser;
        } else if (hLow.includes('priority')) {
          item.col_priority = val || 'Medium';
        } else if (hLow.includes('date') || hLow.includes('timeline') || hLow.includes('release')) {
          item.col_timeline = val || '2026-12-31';
        } else if (hLow.includes('progress')) {
          item.col_progress = Math.min(100, Math.max(0, Number(val.replace(/[^0-9]/g, '')) || 0));
        } else if (hLow.includes('budget') || hLow.includes('cost') || hLow.includes('currency')) {
          item['col_budget'] = Number(val.replace(/[^0-9.]/g, '')) || 0;
        } else {
          item[h] = val;
        }
      });
    }

    if (!item.col_title && cols[0]) {
      item.col_title = cols[0];
    }

    if (item.col_title) {
      rows.push(item);
    }
  }

  return rows;
}

function splitCSVLine(line, delimiter) {
  const result = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' || c === "'") {
      inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      result.push(cur.trim().replace(/^["']|["']$/g, ''));
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim().replace(/^["']|["']$/g, ''));
  return result;
}

function toggleExportDropdown(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const menu = document.getElementById('exportDropdownMenu');
  if (menu) menu.classList.toggle('hidden');
}

function exportData(format) {
  const menu = document.getElementById('exportDropdownMenu');
  if (menu) menu.classList.add('hidden');

  const url = `/api/export?tenant=${encodeURIComponent(currentTenantKey)}&format=${format}`;
  if (format === 'csv' || format === 'sql') {
    window.location.href = url;
  } else {
    window.open(url, '_blank');
  }
  showLiveBroadcast(`Exported workspace dataset in ${format.toUpperCase()} format.`);
}

function switchInspectorTab(tab) {
  const jsonbTab = document.getElementById('inspectorJsonbTab');
  const sqlTab = document.getElementById('inspectorSqlTab');
  const jsonbBtn = document.getElementById('tabJsonbStoreBtn');
  const sqlBtn = document.getElementById('tabSqlConsoleBtn');

  if (tab === 'jsonb') {
    if (jsonbTab) jsonbTab.classList.remove('hidden');
    if (sqlTab) sqlTab.classList.add('hidden');
    if (jsonbBtn) {
      jsonbBtn.className = 'px-4 py-2 border-b-2 border-emerald-400 text-white flex items-center gap-1.5 font-semibold';
    }
    if (sqlBtn) {
      sqlBtn.className = 'px-4 py-2 border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-1.5 font-semibold';
    }
  } else {
    if (sqlTab) sqlTab.classList.remove('hidden');
    if (jsonbTab) jsonbTab.classList.add('hidden');
    if (sqlBtn) {
      sqlBtn.className = 'px-4 py-2 border-b-2 border-emerald-400 text-white flex items-center gap-1.5 font-semibold';
    }
    if (jsonbBtn) {
      jsonbBtn.className = 'px-4 py-2 border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-1.5 font-semibold';
    }
  }
}

function setSqlQuery(sql) {
  const input = document.getElementById('sqlQueryInput');
  if (input) input.value = sql;
  executeLiveSqlQuery();
}

async function executeLiveSqlQuery() {
  const input = document.getElementById('sqlQueryInput');
  const wrapper = document.getElementById('sqlQueryTableWrapper');
  if (!input || !wrapper) return;

  const sql = input.value.trim();
  if (!sql) return;

  wrapper.innerHTML = '<div class="text-slate-400 p-4 text-center animate-pulse">Executing query against SQLite/PostgreSQL store...</div>';

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ sql: sql, tenant_id: currentTenantKey })
    });
    const json = await res.json();
    if (json.success) {
      if (json.rows.length === 0) {
        wrapper.innerHTML = '<div class="text-amber-400 p-4 text-center font-mono">Query executed successfully. 0 rows returned.</div>';
        return;
      }

      let html = '<table class="w-full border-collapse text-left"><thead><tr class="border-b border-slate-800 bg-slate-900 text-emerald-400 font-bold">';
      json.columns.forEach(col => {
        html += `<th class="p-2 border-r border-slate-800">${col}</th>`;
      });
      html += '</tr></thead><tbody>';

      json.rows.forEach(r => {
        html += '<tr class="border-b border-slate-800 hover:bg-slate-900/50">';
        json.columns.forEach(col => {
          let val = r[col];
          if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
          html += `<td class="p-2 border-r border-slate-800 truncate max-w-xs" title="${String(val)}">${String(val)}</td>`;
        });
        html += '</tr>';
      });

      html += '</tbody></table>';
      wrapper.innerHTML = html;
    } else {
      wrapper.innerHTML = `<div class="text-red-400 p-4 text-center font-mono">Error: ${json.error}</div>`;
    }
  } catch (err) {
    wrapper.innerHTML = `<div class="text-red-400 p-4 text-center font-mono">Query error: ${err.message}</div>`;
  }
}

// Bind to window
window.rollbackAuditLog = rollbackAuditLog;
window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.switchImportTab = switchImportTab;
window.executeImportData = executeImportData;
window.toggleExportDropdown = toggleExportDropdown;
window.exportData = exportData;
window.switchInspectorTab = switchInspectorTab;
window.setSqlQuery = setSqlQuery;
window.executeLiveSqlQuery = executeLiveSqlQuery;


// =========================================================================
// UNIVERSAL MODAL CLOSE & ACTION CONTROLLERS (100% RESILIENT ON WINDOW)
// =========================================================================

function closeInsertModal() {
  const m = document.getElementById('newProjectModal');
  if (m) m.classList.add('hidden');
}

function closeEditFeatureModal() {
  const m = document.getElementById('editFeatureModal');
  if (m) m.classList.add('hidden');
}

function closeNewSchemaModal() {
  const m = document.getElementById('newSchemaModal');
  if (m) m.classList.add('hidden');
}

function closeAddColumnModalDirect() {
  const m = document.getElementById('addColumnModal');
  if (m) m.classList.add('hidden');
}

function closeRbacMatrixModalDirect() {
  const m = document.getElementById('rbacMatrixModal');
  if (m) m.classList.add('hidden');
}

function closeDbInspectorModalDirect() {
  const m = document.getElementById('dbInspectorModal');
  if (m) m.classList.add('hidden');
}

function closeProjectManagerModal() {
  const m = document.getElementById('projectManagerModal');
  if (m) m.classList.add('hidden');
}

function closeAuthModal() {
  const m = document.getElementById('authModal');
  if (m) m.classList.add('hidden');
}

function closeUserDatabaseModal() {
  const m = document.getElementById('userManagementModal');
  if (m) m.classList.add('hidden');
}

function addUserFromModal() {
  closeUserDatabaseModal();
  openAuthModal('register');
}

function createProjectFromManager() {
  closeProjectManagerModal();
  openNewSchemaModal();
}

function refreshWebsiteIframe() {
  const iframe = document.getElementById('websiteIframe');
  if (iframe && iframe.src) {
    const s = iframe.src;
    iframe.src = '';
    setTimeout(() => { iframe.src = s; }, 50);
  }
}

function setWebsiteViewport(mode) {
  const container = document.getElementById('websiteIframeContainer');
  const btns = document.querySelectorAll('.viewport-toggle-btn');
  btns.forEach(b => {
    b.classList.remove('bg-white', 'text-slate-900', 'shadow-xs', 'active', 'dark:bg-zinc-700', 'dark:text-white');
  });

  if (!container) return;
  if (mode === 'mobile') {
    container.style.maxWidth = '390px';
  } else if (mode === 'tablet') {
    container.style.maxWidth = '768px';
  } else {
    container.style.maxWidth = '100%';
  }
}

// Bind all controllers to window
window.closeInsertModal = closeInsertModal;
window.closeEditFeatureModal = closeEditFeatureModal;
window.closeNewSchemaModal = closeNewSchemaModal;
window.closeAddColumnModalDirect = closeAddColumnModalDirect;
window.closeRbacMatrixModalDirect = closeRbacMatrixModalDirect;
window.closeDbInspectorModalDirect = closeDbInspectorModalDirect;
window.closeProjectManagerModal = closeProjectManagerModal;
window.closeAuthModal = closeAuthModal;
window.closeUserDatabaseModal = closeUserDatabaseModal;
window.addUserFromModal = addUserFromModal;
window.createProjectFromManager = createProjectFromManager;
window.refreshWebsiteIframe = refreshWebsiteIframe;
window.setWebsiteViewport = setWebsiteViewport;

window.fillAdminCredentials = fillAdminCredentials;


// =========================================================================

// =========================================================================
// REAL DATABASE PROJECT WORKSPACES CONTROLLER
// =========================================================================

async function openProjectManagerModal() {
  const m = document.getElementById('projectManagerModal');
  if (m) {
    m.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
  await refreshProjectWorkspacesFromDB();
}

function closeProjectManagerModal() {
  const m = document.getElementById('projectManagerModal');
  if (m) m.classList.add('hidden');
}

async function refreshProjectWorkspacesFromDB() {
  const container = document.getElementById('projectWorkspacesList');
  if (!container) return;

  container.innerHTML = `
    <div class="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <div class="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
      <span>Querying SQLite database workspaces...</span>
    </div>
  `;

  try {
    const res = await fetch('/api/tenants', { headers: getAuthHeaders() });
    const json = await res.json();
    if (json.success) {
      allTenantsList = json.tenants || [];
      renderProjectWorkspacesCards(allTenantsList);
      updateTenantDropdown();
    } else {
      container.innerHTML = `<div class="p-6 text-center text-xs text-red-500">Failed to load workspaces from database.</div>`;
    }
  } catch (err) {
    console.error("Fetch workspaces error:", err);
    container.innerHTML = `<div class="p-6 text-center text-xs text-red-500">Database connection error.</div>`;
  }
}

function renderProjectWorkspacesCards(tenants) {
  const container = document.getElementById('projectWorkspacesList');
  if (!container) return;

  if (!tenants || tenants.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-xs text-slate-400 space-y-2">
        <i data-lucide="folder-x" class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600"></i>
        <p>No project workspaces found in SQLite database.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  let html = '';
  tenants.forEach(t => {
    const isCurrent = t.tenant_id === currentTenantKey;
    const safeTitle = (t.title || t.tenant_id).replace(/'/g, "\\'");
    const itemsCount = t.items_count !== undefined ? t.items_count : 0;
    const autoCount = t.automations_count !== undefined ? t.automations_count : 0;
    const colsCount = t.columns_count !== undefined ? t.columns_count : 6;
    const desc = t.description || 'Dynamic JSONB PostgreSQL & SQLite Store';
    const webUrl = t.website_url || `https://${(t.schema_name || 'openflow').replace(/_/g, '-')}.gov.ph`;

    html += `
      <div class="p-4 rounded-xl border ${isCurrent ? 'bg-slate-50 dark:bg-[#1f1f23] border-slate-900 dark:border-zinc-500 shadow-xs' : 'bg-white dark:bg-[#18181b] border-slate-200 dark:border-[#27272a] hover:border-slate-300 dark:hover:border-[#38383e]'} transition-all space-y-3">
        
        <!-- Header row -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-xl ${isCurrent ? 'bg-slate-900 text-white dark:bg-[#27272a] dark:text-white dark:hover:bg-[#38383e] dark:border dark:border-[#3f3f46]' : 'bg-slate-100 dark:bg-[#27272a] text-slate-700 dark:text-slate-300'} flex items-center justify-center font-bold flex-shrink-0 shadow-2xs">
              <i data-lucide="folder-kanban" class="w-4.5 h-4.5"></i>
            </div>
            <div class="truncate">
              <div class="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 truncate">
                <span class="truncate">${t.title}</span>
                ${isCurrent ? '<span class="text-[10px] px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30 flex-shrink-0">Active</span>' : ''}
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-2">
                <span>Schema: <b>${t.schema_name || t.tenant_id}</b></span>
                <span>•</span>
                <span class="text-blue-500 truncate">${webUrl}</span>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1.5 flex-shrink-0">
            ${!isCurrent ? `
              <button type="button" onclick="switchWorkspaceDirect('${t.tenant_id}')" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-white dark:text-white font-semibold rounded-lg transition-colors flex items-center gap-1.5 text-xs shadow-2xs">
                <i data-lucide="arrow-right-circle" class="w-3.5 h-3.5"></i>
                <span>Switch</span>
              </button>
            ` : `
              <span class="px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg">
                Current
              </span>
            `}

            <button type="button" onclick="openEditWorkspaceModal('${t.tenant_id}')" class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-[#27272a] transition-colors" title="Edit Workspace Details">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>

            <button type="button" onclick="handleDeleteSpecificProject('${t.tenant_id}', '${safeTitle}')" class="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" title="Delete Workspace">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        <!-- Description -->
        <p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">${desc}</p>

        <!-- Database Metrics Chips -->
        <div class="flex items-center gap-3 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
          <span class="flex items-center gap-1">
            <i data-lucide="layers" class="w-3 h-3 text-slate-400"></i>
            <b class="text-slate-800 dark:text-slate-200 font-bold">${itemsCount}</b> Features in DB
          </span>
          <span>•</span>
          <span class="flex items-center gap-1">
            <i data-lucide="columns" class="w-3 h-3 text-slate-400"></i>
            <b class="text-slate-800 dark:text-slate-200 font-bold">${colsCount}</b> Columns
          </span>
          <span>•</span>
          <span class="flex items-center gap-1">
            <i data-lucide="zap" class="w-3 h-3 text-amber-500"></i>
            <b class="text-slate-800 dark:text-slate-200 font-bold">${autoCount}</b> Automations
          </span>
        </div>

      </div>
    `;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function createProjectFromManager() {
  closeProjectManagerModal();
  openNewSchemaModal();
}

function openEditWorkspaceModal(tenantId) {
  const t = allTenantsList.find(item => item.tenant_id === tenantId);
  if (!t) return;

  document.getElementById('editWorkspaceTenantId').value = t.tenant_id;
  document.getElementById('editWorkspaceTitle').value = t.title || '';
  document.getElementById('editWorkspaceDesc').value = t.description || '';
  document.getElementById('editWorkspaceUrl').value = t.website_url || '';

  const m = document.getElementById('editWorkspaceModal');
  if (m) {
    m.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function closeEditWorkspaceModal() {
  const m = document.getElementById('editWorkspaceModal');
  if (m) m.classList.add('hidden');
}

async function handleSaveWorkspaceEdit() {
  const tenantId = document.getElementById('editWorkspaceTenantId').value;
  const title = document.getElementById('editWorkspaceTitle').value.trim();
  const desc = document.getElementById('editWorkspaceDesc').value.trim();
  const webUrl = document.getElementById('editWorkspaceUrl').value.trim();

  if (!title) {
    alert("Please provide a workspace title.");
    return;
  }

  try {
    const res = await fetch('/api/boards', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        tenant_id: tenantId,
        title: title,
        description: desc,
        website_url: webUrl
      })
    });
    const json = await res.json();
    if (json.success) {
      closeEditWorkspaceModal();
      showLiveBroadcast(`Workspace '${title}' updated in database.`);
      await fetchBoardDataFromDB();
      await refreshProjectWorkspacesFromDB();
    } else {
      alert(json.error || "Failed to update workspace.");
    }
  } catch (err) {
    console.error("Update workspace error:", err);
    alert("Error updating workspace in database.");
  }
}

function switchWorkspaceDirect(tenantId) {
  currentTenantKey = tenantId;
  closeProjectManagerModal();
  fetchBoardDataFromDB();
  showLiveBroadcast(`Switched active workspace. Loading workspace data from database...`);
}

function handleWorkspaceChange(tenantId) {
  if (!tenantId) return;
  currentTenantKey = tenantId;
  fetchBoardDataFromDB();
  showLiveBroadcast(`Switched active workspace. Loading workspace data...`);
}

function handleDeleteSpecificProject(tenantId, projectTitle) {
  closeProjectManagerModal();
  openDeleteProjectModal(tenantId, projectTitle);
}

// Window bindings
window.openProjectManagerModal = openProjectManagerModal;
window.closeProjectManagerModal = closeProjectManagerModal;
window.refreshProjectWorkspacesFromDB = refreshProjectWorkspacesFromDB;
window.renderProjectWorkspacesCards = renderProjectWorkspacesCards;
window.createProjectFromManager = createProjectFromManager;
window.openEditWorkspaceModal = openEditWorkspaceModal;
window.closeEditWorkspaceModal = closeEditWorkspaceModal;
window.handleSaveWorkspaceEdit = handleSaveWorkspaceEdit;
window.switchWorkspaceDirect = switchWorkspaceDirect;
window.handleWorkspaceChange = handleWorkspaceChange;
window.handleDeleteSpecificProject = handleDeleteSpecificProject;


// =========================================================================
// 15. FEATURE DETAIL DRAWER: COMMENTS, SUB-TASKS & ATTACHMENTS CONTROLLER
// =========================================================================

let activeDrawerItemId = null;

function openFeatureDetailDrawer(itemId) {
  const item = activeItems.find(i => i.id === itemId);
  if (!item) return;

  activeDrawerItemId = itemId;
  const drawer = document.getElementById('featureDetailDrawer');
  const panel = document.getElementById('featureDrawerPanel');
  const backdrop = document.getElementById('featureDrawerBackdrop');

  // Populate Header
  const titleEl = document.getElementById('drawerFeatureTitle');
  const statusBadge = document.getElementById('drawerStatusBadge');
  const priorityBadge = document.getElementById('drawerPriorityBadge');
  const assigneeText = document.getElementById('drawerAssigneeText');
  const scopeDesc = document.getElementById('drawerScopeDesc');
  const timelineVal = document.getElementById('drawerTimelineVal');
  const progressVal = document.getElementById('drawerProgressVal');

  const curStatus = item.data.col_status || 'Planning';
  const curPriority = item.data.col_priority || 'Medium';
  const curAssignee = item.data.col_dept || 'Unassigned';

  if (titleEl) titleEl.textContent = item.data.col_title || 'Feature Details';
  if (statusBadge) {
    statusBadge.textContent = curStatus;
    statusBadge.className = `status-badge ${getStatusClass(curStatus)} text-[10px]`;
  }
  if (priorityBadge) {
    priorityBadge.textContent = curPriority;
    priorityBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getPriorityClass(curPriority)}`;
  }
  if (assigneeText) assigneeText.textContent = curAssignee.split('(')[0].trim();
  if (scopeDesc) scopeDesc.textContent = item.data.col_description || 'No detailed scope description provided.';
  if (timelineVal) timelineVal.textContent = item.data.col_timeline || '2026-12-31';
  if (progressVal) progressVal.textContent = `${item.data.col_progress || 0}%`;

  // Render Tabs
  renderDrawerComments(item);
  renderDrawerSubtasks(item);
  renderDrawerAttachments(item);

  switchDetailDrawerTab('comments');

  if (drawer) {
    drawer.classList.remove('hidden');
    setTimeout(() => {
      if (panel) panel.classList.remove('translate-x-full');
      if (backdrop) backdrop.classList.remove('opacity-0');
    }, 10);
  }
  if (window.lucide) lucide.createIcons();
}

function closeFeatureDetailDrawer() {
  const panel = document.getElementById('featureDrawerPanel');
  const backdrop = document.getElementById('featureDrawerBackdrop');
  if (panel) panel.classList.add('translate-x-full');
  if (backdrop) backdrop.classList.add('opacity-0');
  setTimeout(() => {
    const drawer = document.getElementById('featureDetailDrawer');
    if (drawer) drawer.classList.add('hidden');
    activeDrawerItemId = null;
  }, 250);
}

function switchDetailDrawerTab(tab) {
  const tabBtns = {
    comments: document.getElementById('drawerTabCommentsBtn'),
    subtasks: document.getElementById('drawerTabSubtasksBtn'),
    attachments: document.getElementById('drawerTabAttachmentsBtn'),
    details: document.getElementById('drawerTabDetailsBtn')
  };

  const sections = {
    comments: document.getElementById('drawerCommentsSection'),
    subtasks: document.getElementById('drawerSubtasksSection'),
    attachments: document.getElementById('drawerAttachmentsSection'),
    details: document.getElementById('drawerDetailsSection')
  };

  Object.keys(tabBtns).forEach(k => {
    const b = tabBtns[k];
    const s = sections[k];
    if (b) {
      if (k === tab) {
        b.classList.add('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-white', 'shadow-2xs');
        b.classList.remove('text-slate-600', 'dark:text-slate-400');
      } else {
        b.classList.remove('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-white', 'shadow-2xs');
        b.classList.add('text-slate-600', 'dark:text-slate-400');
      }
    }
    if (s) {
      if (k === tab) s.classList.remove('hidden');
      else s.classList.add('hidden');
    }
  });

  if (window.lucide) lucide.createIcons();
}

function openEditFeatureFromDrawer() {
  if (!activeDrawerItemId) return;
  const id = activeDrawerItemId;
  closeFeatureDetailDrawer();
  setTimeout(() => openEditFeatureModal(id), 260);
}

// --- COMMENTS STREAM CONTROLLERS ---

function renderDrawerComments(item) {
  const container = document.getElementById('drawerCommentsList');
  const countPill = document.getElementById('drawerCommentCountPill');
  if (!container) return;

  const comments = item.data.comments || [];
  if (countPill) countPill.textContent = comments.length;

  if (comments.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-xs text-slate-400 space-y-2">
        <i data-lucide="message-square-dashed" class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600"></i>
        <p>No activity comments yet. Start the conversation below!</p>
      </div>
    `;
    return;
  }

  let html = '';
  comments.forEach(c => {
    const isCurrent = currentUser && (c.user_name === currentUser.full_name || c.user_name === currentUser.email);
    html += `
      <div class="p-3.5 bg-slate-50 dark:bg-[#202024] rounded-xl border border-slate-200 dark:border-[#2c2c32] space-y-2 text-xs">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center font-bold text-[10px]">
              ${c.initials || 'US'}
            </div>
            <div>
              <span class="font-bold text-slate-900 dark:text-white">${c.user_name}</span>
              <span class="text-[10px] text-slate-400 font-mono ml-1.5">${c.timestamp || 'Just now'}</span>
            </div>
          </div>
          ${isCurrent ? `
            <button type="button" onclick="deleteDrawerComment('${c.id}')" class="text-slate-400 hover:text-red-500 p-1" title="Delete comment">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          ` : ''}
        </div>
        <div class="text-slate-700 dark:text-slate-200 whitespace-pre-wrap pl-8 leading-relaxed">
          ${formatCommentText(c.text)}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function formatCommentText(text) {
  if (!text) return '';
  // Highlight @mentions in bold blue
  return text.replace(/(@[a-zA-Z0-9_-]+)/g, '<span class="font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1 py-0.2 rounded">$1</span>');
}

function insertMention(handle) {
  const input = document.getElementById('drawerCommentInput');
  if (!input) return;
  input.value = `${input.value.trim()} ${handle} `.trimStart();
  input.focus();
}

async function submitDrawerComment() {
  if (!activeDrawerItemId) return;
  const input = document.getElementById('drawerCommentInput');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  const btn = document.getElementById('postCommentBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/items/comments', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        item_id: activeDrawerItemId,
        tenant_id: currentTenantKey,
        text: text
      })
    });
    const json = await res.json();
    if (json.success) {
      const item = activeItems.find(i => i.id === activeDrawerItemId);
      if (item) {
        item.data.comments = json.comments;
        renderDrawerComments(item);
      }
      if (input) input.value = '';
      showLiveBroadcast(`Comment posted to feature discussion.`);
      updateJsonbInspector();
    }
  } catch (err) {
    console.error("Comment submit error:", err);
  } finally {
    if (btn) btn.disabled = false;
    if (window.lucide) lucide.createIcons();
  }
}

async function deleteDrawerComment(commentId) {
  if (!activeDrawerItemId || !commentId) return;
  try {
    const res = await fetch(`/api/items/comments?item_id=${activeDrawerItemId}&comment_id=${commentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      const item = activeItems.find(i => i.id === activeDrawerItemId);
      if (item && item.data.comments) {
        item.data.comments = item.data.comments.filter(c => c.id !== commentId);
        renderDrawerComments(item);
      }
      showLiveBroadcast(`Comment deleted.`);
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {}
}

// --- CHECKLIST SUB-TASKS CONTROLLERS ---

function renderDrawerSubtasks(item) {
  const container = document.getElementById('drawerSubtasksList');
  const countPill = document.getElementById('drawerSubtaskCountPill');
  const percentText = document.getElementById('subtaskProgressPercentText');
  const progressBar = document.getElementById('subtaskProgressBar');
  if (!container) return;

  const subtasks = item.data.subtasks || [];
  const completedCount = subtasks.filter(st => st.completed).length;
  const percent = subtasks.length > 0 ? Math.round((completedCount / subtasks.length) * 100) : 0;

  if (countPill) countPill.textContent = `${completedCount}/${subtasks.length}`;
  if (percentText) percentText.textContent = `${percent}% (${completedCount}/${subtasks.length})`;
  if (progressBar) progressBar.style.width = `${percent}%`;

  if (subtasks.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-xs text-slate-400 space-y-1.5">
        <i data-lucide="list-checks" class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600"></i>
        <p>No checklist sub-tasks added yet. Break down this feature below!</p>
      </div>
    `;
    return;
  }

  let html = '';
  subtasks.forEach(st => {
    html += `
      <div class="p-3 bg-slate-50 dark:bg-[#202024] rounded-xl border border-slate-200 dark:border-[#2c2c32] flex items-center justify-between gap-3 text-xs">
        <label class="flex items-center gap-2.5 flex-1 cursor-pointer select-none">
          <input type="checkbox" onchange="toggleDrawerSubtask('${st.id}', this.checked)" ${st.completed ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-0 cursor-pointer">
          <span class="${st.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200 font-medium'} font-medium transition-all">
            ${st.title}
          </span>
        </label>
        <button type="button" onclick="deleteDrawerSubtask('${st.id}')" class="text-slate-400 hover:text-red-500 p-1" title="Delete subtask">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function submitDrawerSubtask() {
  if (!activeDrawerItemId) return;
  const input = document.getElementById('drawerSubtaskInput');
  const title = input ? input.value.trim() : '';
  if (!title) return;

  try {
    const res = await fetch('/api/items/subtasks', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        item_id: activeDrawerItemId,
        tenant_id: currentTenantKey,
        title: title
      })
    });
    const json = await res.json();
    if (json.success) {
      const item = activeItems.find(i => i.id === activeDrawerItemId);
      if (item) {
        item.data.subtasks = json.subtasks;
        renderDrawerSubtasks(item);
      }
      if (input) input.value = '';
      showLiveBroadcast(`Checklist subtask added.`);
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {}
}

async function toggleDrawerSubtask(subtaskId, completed) {
  if (!activeDrawerItemId) return;
  try {
    const res = await fetch('/api/items/subtasks', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        item_id: activeDrawerItemId,
        subtask_id: subtaskId,
        completed: completed
      })
    });
    const json = await res.json();
    if (json.success) {
      const item = activeItems.find(i => i.id === activeDrawerItemId);
      if (item) {
        item.data.subtasks = json.subtasks;
        renderDrawerSubtasks(item);
      }
      showLiveBroadcast(`Subtask marked as ${completed ? 'Completed' : 'Pending'}.`);
    }
  } catch (err) {}
}

async function deleteDrawerSubtask(subtaskId) {
  if (!activeDrawerItemId) return;
  try {
    const res = await fetch(`/api/items/subtasks?item_id=${activeDrawerItemId}&subtask_id=${subtaskId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      const item = activeItems.find(i => i.id === activeDrawerItemId);
      if (item && item.data.subtasks) {
        item.data.subtasks = item.data.subtasks.filter(st => st.id !== subtaskId);
        renderDrawerSubtasks(item);
      }
      showLiveBroadcast(`Subtask deleted.`);
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {}
}

// --- ATTACHMENTS & RESOURCES CONTROLLERS ---

function renderDrawerAttachments(item) {
  const container = document.getElementById('drawerAttachmentsList');
  const countPill = document.getElementById('drawerAttachmentCountPill');
  if (!container) return;

  const attachments = item.data.attachments || [];
  if (countPill) countPill.textContent = attachments.length;

  if (attachments.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-xs text-slate-400 space-y-1.5">
        <i data-lucide="folder-plus" class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600"></i>
        <p>No document or web resources attached yet.</p>
      </div>
    `;
    return;
  }

  let html = '';
  attachments.forEach(att => {
    const iconName = att.file_type === 'figma' ? 'palette' : att.file_type === 'github' ? 'git-branch' : att.file_type === 'document' ? 'file-text' : 'link-2';
    html += `
      <div class="p-3 bg-slate-50 dark:bg-[#202024] rounded-xl border border-slate-200 dark:border-[#2c2c32] flex items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-7 h-7 rounded-lg bg-slate-200 dark:bg-[#2c2c32] flex items-center justify-center text-slate-700 dark:text-slate-300 flex-shrink-0">
            <i data-lucide="${iconName}" class="w-4 h-4"></i>
          </div>
          <div class="truncate">
            <div class="font-bold text-slate-900 dark:text-white truncate">${att.name}</div>
            <div class="text-[10px] text-blue-500 font-mono truncate">${att.url}</div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <a href="${att.url}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-white dark:text-white rounded-lg text-[11px] font-semibold flex items-center gap-1">
            <i data-lucide="external-link" class="w-3 h-3"></i> Open
          </a>
          <button type="button" onclick="deleteDrawerAttachment('${att.id}')" class="text-slate-400 hover:text-red-500 p-1" title="Delete attachment">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function submitDrawerAttachment() {
  if (!activeDrawerItemId) return;
  const nameInput = document.getElementById('drawerAttachmentName');
  const urlInput = document.getElementById('drawerAttachmentUrl');
  const typeInput = document.getElementById('drawerAttachmentType');

  const name = nameInput ? nameInput.value.trim() : '';
  const url = urlInput ? urlInput.value.trim() : '';
  const fileType = typeInput ? typeInput.value : 'link';

  if (!name || !url) return;

  try {
    const res = await fetch('/api/items/attachments', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        item_id: activeDrawerItemId,
        tenant_id: currentTenantKey,
        name: name,
        url: url,
        file_type: fileType
      })
    });
    const json = await res.json();
    if (json.success) {
      const item = activeItems.find(i => i.id === activeDrawerItemId);
      if (item) {
        item.data.attachments = json.attachments;
        renderDrawerAttachments(item);
      }
      if (nameInput) nameInput.value = '';
      if (urlInput) urlInput.value = '';
      showLiveBroadcast(`Attachment '${name}' added to feature.`);
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {}
}

async function deleteDrawerAttachment(attachmentId) {
  if (!activeDrawerItemId) return;
  try {
    const res = await fetch(`/api/items/attachments?item_id=${activeDrawerItemId}&attachment_id=${attachmentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      const item = activeItems.find(i => i.id === activeDrawerItemId);
      if (item && item.data.attachments) {
        item.data.attachments = item.data.attachments.filter(a => a.id !== attachmentId);
        renderDrawerAttachments(item);
      }
      showLiveBroadcast(`Attachment removed.`);
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {}
}

// Window bindings
window.openFeatureDetailDrawer = openFeatureDetailDrawer;
window.closeFeatureDetailDrawer = closeFeatureDetailDrawer;
window.switchDetailDrawerTab = switchDetailDrawerTab;
window.openEditFeatureFromDrawer = openEditFeatureFromDrawer;
window.submitDrawerComment = submitDrawerComment;
window.deleteDrawerComment = deleteDrawerComment;
window.insertMention = insertMention;
window.submitDrawerSubtask = submitDrawerSubtask;
window.toggleDrawerSubtask = toggleDrawerSubtask;
window.deleteDrawerSubtask = deleteDrawerSubtask;
window.submitDrawerAttachment = submitDrawerAttachment;
window.deleteDrawerAttachment = deleteDrawerAttachment;


// =========================================================================
// 16. GOOGLE FIREBASE CLOUD FIRESTORE ENGINE (FREE SPARK TIER)
// =========================================================================

let firebaseApp = null;
let firestoreDb = null;
let isFirebaseActive = false; // Always use Local SQLite database
let activeFirestoreUnsubscribe = null;

function initFirebaseService() {
  const savedConfigStr = null;
  if (!savedConfigStr) {
    updateFirebaseUIStatus(false);
    return;
  }

  try {
    const config = JSON.parse(savedConfigStr);
    if (!config.projectId || !config.apiKey) {
      updateFirebaseUIStatus(false);
      return;
    }

    if (!firebase.apps.length) {
      firebaseApp = firebase.initializeApp(config);
    } else {
      firebaseApp = firebase.app();
    }

    firestoreDb = firebase.firestore();
    isFirebaseActive = true;
    updateFirebaseUIStatus(true, config.projectId);
    console.log("Connected to Google Cloud Firestore:", config.projectId);

    // Subscribe to current workspace real-time collection
    subscribeToFirestoreWorkspace(currentTenantKey);
  } catch (err) {
    console.error("Failed to initialize Firebase:", err);
    updateFirebaseUIStatus(false);
  }
}

function updateFirebaseUIStatus(connected, projectId = '') {
  const dot = document.getElementById('firebaseStatusDot');
  const text = document.getElementById('firebaseStatusText');
  const bannerDot = document.getElementById('firebaseBannerDot');
  const bannerStatus = document.getElementById('firebaseBannerStatus');
  const bannerProject = document.getElementById('firebaseBannerProject');

  if (connected) {
    if (dot) {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    }
    if (text) text.textContent = 'Cloud Active';
    if (bannerDot) bannerDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
    if (bannerStatus) bannerStatus.textContent = 'Google Cloud Firestore Connected (Real-Time)';
    if (bannerProject) bannerProject.textContent = `Project: ${projectId}`;
  } else {
    if (dot) {
      dot.className = 'w-2 h-2 rounded-full bg-amber-500';
    }
    if (text) text.textContent = 'Firebase';
    if (bannerDot) bannerDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
    if (bannerStatus) bannerStatus.textContent = 'Local SQLite Mode Active';
    if (bannerProject) bannerProject.textContent = 'Not Connected';
  }
}

function openFirebaseConfigModal() {
  const modal = document.getElementById('firebaseConfigModal');
  const savedConfigStr = null;
  if (savedConfigStr) {
    try {
      const config = JSON.parse(savedConfigStr);
      if (document.getElementById('fbProjectId')) document.getElementById('fbProjectId').value = config.projectId || '';
      if (document.getElementById('fbApiKey')) document.getElementById('fbApiKey').value = config.apiKey || '';
      if (document.getElementById('fbAuthDomain')) document.getElementById('fbAuthDomain').value = config.authDomain || '';
      if (document.getElementById('fbStorageBucket')) document.getElementById('fbStorageBucket').value = config.storageBucket || '';
      if (document.getElementById('fbAppId')) document.getElementById('fbAppId').value = config.appId || '';
      if (document.getElementById('fbMessagingSenderId')) document.getElementById('fbMessagingSenderId').value = config.messagingSenderId || '';
      if (document.getElementById('firebaseRawConfigInput')) document.getElementById('firebaseRawConfigInput').value = JSON.stringify(config, null, 2);
    } catch (e) {}
  }
  if (modal) {
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }
}

function closeFirebaseConfigModal() {
  const modal = document.getElementById('firebaseConfigModal');
  if (modal) modal.classList.add('hidden');
}

function parseRawFirebaseSnippet(raw) {
  if (!raw) return null;
  try {
    // If pure JSON
    if (raw.trim().startsWith('{')) {
      return JSON.parse(raw);
    }
    // If JS object snippet: const firebaseConfig = { ... }
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const cleaned = match[0]
        .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
        .replace(/'/g, '"')
        .replace(/,\s*\}/g, '}');
      return JSON.parse(cleaned);
    }
  } catch (e) {
    console.warn("Could not auto-parse raw snippet, using manual fields:", e);
  }
  return null;
}

async function handleSaveFirebaseConfig() {
  const rawInput = document.getElementById('firebaseRawConfigInput');
  const rawVal = rawInput ? rawInput.value.trim() : '';

  let config = parseRawFirebaseSnippet(rawVal);

  if (!config) {
    const projectId = document.getElementById('fbProjectId').value.trim();
    const apiKey = document.getElementById('fbApiKey').value.trim();
    const authDomain = document.getElementById('fbAuthDomain').value.trim();
    const storageBucket = document.getElementById('fbStorageBucket').value.trim();
    const appId = document.getElementById('fbAppId').value.trim();
    const messagingSenderId = document.getElementById('fbMessagingSenderId').value.trim();

    if (!projectId || !apiKey) {
      alert("Please provide at least Project ID and API Key from your Firebase Console.");
      return;
    }

    config = {
      apiKey: apiKey,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      projectId: projectId,
      storageBucket: storageBucket || `${projectId}.appspot.com`,
      messagingSenderId: messagingSenderId || '123456789',
      appId: appId || '1:123456:web:abcd'
    };
  }

  try {
    if (firebase.apps.length) {
      await Promise.all(firebase.apps.map(app => app.delete()));
    }
    firebaseApp = firebase.initializeApp(config);
    firestoreDb = firebase.firestore();
    
    // Test write & read to verify permissions
    const testRef = firestoreDb.collection('_healthcheck').doc('ping');
    await testRef.set({ timestamp: firebase.firestore.FieldValue.serverTimestamp(), user: currentUser ? currentUser.email : 'admin' });

    localStorage.setItem('openflow_firebase_config', JSON.stringify(config));
    isFirebaseActive = true;
    updateFirebaseUIStatus(true, config.projectId);
    closeFirebaseConfigModal();
    
    showLiveBroadcast(`Connected to Google Cloud Firestore [${config.projectId}]. Real-time sync enabled!`);
    
    // Auto-migrate current workspace if Firestore is empty
    await subscribeToFirestoreWorkspace(currentTenantKey);
  } catch (err) {
    console.error("Firebase connection error:", err);
    alert(`Could not connect to Firebase: ${err.message}\n\nPlease ensure you enabled Firestore in Test Mode in Firebase Console.`);
  }
}

function disconnectFirebase() {
  if (activeFirestoreUnsubscribe) {
    activeFirestoreUnsubscribe();
    activeFirestoreUnsubscribe = null;
  }
  localStorage.removeItem('openflow_firebase_config');
  isFirebaseActive = false;
  firestoreDb = null;
  updateFirebaseUIStatus(false);
  closeFirebaseConfigModal();
  showLiveBroadcast(`Disconnected Firebase Cloud. Switched to Local SQLite Database.`);
  fetchBoardDataFromDB();
}

function subscribeToFirestoreWorkspace(tenantId) {
  if (!isFirebaseActive || !firestoreDb) return;

  if (activeFirestoreUnsubscribe) {
    activeFirestoreUnsubscribe();
    activeFirestoreUnsubscribe = null;
  }

  const itemsRef = firestoreDb.collection('workspaces').doc(tenantId).collection('items');
  activeFirestoreUnsubscribe = itemsRef.onSnapshot(snapshot => {
    const firestoreItems = [];
    snapshot.forEach(doc => {
      firestoreItems.push({
        id: doc.id,
        tenant_id: tenantId,
        data: doc.data()
      });
    });

    if (firestoreItems.length > 0) {
      activeItems = firestoreItems;
      renderCurrentView();
      updateJsonbInspector();
      showLiveBroadcast(`Cloud Firestore: Real-time update synced (${firestoreItems.length} features).`);
    } else {
      // If empty in Firestore, seed from SQLite
      if (activeItems.length > 0) {
        migrateLocalToFirebase(false);
      }
    }
  }, err => {
    console.warn("Firestore snapshot listener error:", err);
  });
}

async function migrateLocalToFirebase(showToast = true) {
  if (!isFirebaseActive || !firestoreDb) {
    alert("Please connect to Firebase first before migrating.");
    return;
  }

  try {
    const batch = firestoreDb.batch();
    const workspaceDoc = firestoreDb.collection('workspaces').doc(currentTenantKey);
    
    batch.set(workspaceDoc, {
      id: activeBoard.id || 'board_primary',
      title: activeBoard.title || 'Workspace',
      schema_name: activeBoard.schema || 'custom',
      description: activeBoard.description || '',
      website_url: activeBoard.website_url || '',
      columns_config: activeColumnsConfig,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    activeItems.forEach(item => {
      const itemDoc = workspaceDoc.collection('items').doc(item.id);
      batch.set(itemDoc, item.data, { merge: true });
    });

    await batch.commit();
    if (showToast) {
      showLiveBroadcast(`Successfully uploaded ${activeItems.length} records to Google Cloud Firestore!`);
    }
  } catch (err) {
    console.error("Migration error:", err);
    if (showToast) alert(`Migration error: ${err.message}`);
  }
}

// Window bindings
window.openFirebaseConfigModal = openFirebaseConfigModal;
window.closeFirebaseConfigModal = closeFirebaseConfigModal;
window.handleSaveFirebaseConfig = handleSaveFirebaseConfig;
window.disconnectFirebase = disconnectFirebase;
window.migrateLocalToFirebase = migrateLocalToFirebase;


// =========================================================================
// 17. COLLAPSIBLE ENTERPRISE SIDEBAR CONTROLLER
// =========================================================================

function initSidebar() {
  const isCollapsed = localStorage.getItem('openflow_sidebar_collapsed') === 'true';
  const sidebar = document.getElementById('appSidebar');
  const btn = document.getElementById('sidebarCollapseBtn');
  
  if (isCollapsed && sidebar) {
    sidebar.classList.add('sidebar-collapsed');
    if (btn) btn.innerHTML = '<i data-lucide="panel-left-open" class="w-4 h-4"></i>';
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const btn = document.getElementById('sidebarCollapseBtn');
  if (!sidebar) return;

  sidebar.classList.toggle('sidebar-collapsed');
  const isCollapsed = sidebar.classList.contains('sidebar-collapsed');
  localStorage.setItem('openflow_sidebar_collapsed', isCollapsed ? 'true' : 'false');

  if (btn) {
    btn.innerHTML = `<i data-lucide="${isCollapsed ? 'panel-left-open' : 'panel-left-close'}" class="w-4 h-4"></i>`;
  }
  if (window.lucide) lucide.createIcons();
}

function updateSidebarUserUI(user) {
  if (!user) return;
  const avatar = document.getElementById('sidebarAvatarInitials');
  const name = document.getElementById('sidebarUserName');
  const role = document.getElementById('sidebarUserRole');

  const initials = "".toUpperCase() || (user.full_name ? user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'US');
  if (avatar) avatar.textContent = initials;
  if (name) name.textContent = user.full_name || 'Member';
  if (role) role.textContent = user.role || 'Member';
}

window.toggleSidebar = toggleSidebar;


// =========================================================================
// 11. VIEW ENGINE MODULE 5: ACTIVE WEBSITES SHOWCASE GALLERY
// =========================================================================

async function renderWebsiteShowcaseView() {
  const container = document.getElementById('showcaseViewContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="flex items-center justify-center p-12 text-slate-400">
      <div class="flex items-center gap-3">
        <span class="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></span>
        <span class="text-xs font-semibold">Loading active project websites...</span>
      </div>
    </div>
  `;

  try {
    let tenants = [];
    if (isFirebaseActive && firebaseDb) {
      const snap = await firebaseDb.collection('workspaces').get();
      tenants = snap.docs.map(d => ({ tenant_id: d.id, ...d.data() }));
    } else {
      const res = await fetch('/api/tenants');
      const data = await res.json();
      tenants = data.tenants || [];
    }

    let html = `
      <div class="space-y-6 w-full">
        
        <!-- Showcase Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#18181b] p-4 rounded-2xl border border-slate-200 dark:border-[#27272a] shadow-2xs">
          <div>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <h2 class="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                Active Project Websites Showcase
              </h2>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live interactive viewport cells of all deployed web applications, portals, and citizen platforms.
            </p>
          </div>

          <div class="flex items-center gap-2 self-start sm:self-auto">
            <button type="button" onclick="renderWebsiteShowcaseView()" class="m3-btn-outlined text-xs py-1.5" title="Refresh all website previews">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
              <span>Refresh Frames</span>
            </button>
            <button type="button" onclick="openProjectManagerModal()" class="m3-btn-filled text-xs py-1.5">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>Add Project Website</span>
            </button>
          </div>
        </div>

        <!-- Showcase Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
    `;

    tenants.forEach(t => {
      const webUrl = (t.website_url && t.website_url.startsWith('http')) ? t.website_url : `https://${(t.website_url || 'openflow.io').replace(/_/g, '-')}`;
      const proxyUrl = `/api/proxy-site?url=${encodeURIComponent(webUrl)}`;
      const isCurrentActive = t.tenant_id === currentTenant;
      const itemCount = (t.columns || []).length > 0 ? (t.items_count !== undefined ? t.items_count : activeItems.length) : 0;

      html += `
        <div class="bg-white dark:bg-[#18181b] rounded-2xl border ${isCurrentActive ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md' : 'border-slate-200 dark:border-[#27272a] shadow-xs'} overflow-hidden flex flex-col transition-all hover:shadow-lg group">
          
          <!-- Card Header Bar -->
          <div class="p-3.5 bg-slate-50/80 dark:bg-[#202024] border-b border-slate-200 dark:border-[#2c2c32] flex items-center justify-between gap-2">
            <div class="min-w-0 flex items-center gap-2">
              <div class="w-7 h-7 rounded-lg bg-black dark:bg-white text-white dark:text-black flex items-center justify-center font-extrabold text-xs flex-shrink-0">
                ${(t.title || 'P').slice(0, 2).toUpperCase()}
              </div>
              <div class="min-w-0">
                <h3 class="text-xs font-bold text-slate-900 dark:text-white truncate">
                  ${t.title || 'Untitled Project'}
                </h3>
                <a href="${webUrl}" target="_blank" rel="noreferrer" class="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-mono truncate block" title="${webUrl}">
                  ${webUrl.replace('https://', '')}
                </a>
              </div>
            </div>

            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Live
              </span>
            </div>
          </div>

          <!-- Live Website Preview Section Cell (Mini Browser Window) -->
          <div class="relative w-full bg-slate-900 border-b border-slate-200 dark:border-[#2c2c32] overflow-hidden flex flex-col">
            
            <!-- Browser Mockup Mini Address Bar -->
            <div class="h-6 bg-slate-800/90 px-3 flex items-center justify-between text-[10px] text-slate-400">
              <div class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-red-500/80"></span>
                <span class="w-2 h-2 rounded-full bg-yellow-500/80"></span>
                <span class="w-2 h-2 rounded-full bg-green-500/80"></span>
              </div>
              <div class="font-mono text-[9px] truncate max-w-[180px] bg-slate-900/60 px-2 py-0.2 rounded text-slate-300">
                ${webUrl}
              </div>
              <i data-lucide="lock" class="w-2.5 h-2.5 text-emerald-400"></i>
            </div>

            <!-- Live Iframe Cell -->
            <div class="w-full h-64 bg-white relative">
              <iframe src="${proxyUrl}" class="w-full h-full border-0" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
            </div>

          </div>

          <!-- Card Description & Quick Actions Footer -->
          <div class="p-3.5 space-y-3 flex-1 flex flex-col justify-between bg-white dark:bg-[#18181b]">
            <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
              ${t.description || 'Enterprise project workspace and integrated web system.'}
            </p>

            <div class="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <button type="button" onclick="openProjectWebsiteModal('${webUrl}', '${t.title.replace(/'/g, "\'")}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-all flex items-center gap-1" title="Open Full-Screen Device Simulator">
                  <i data-lucide="maximize-2" class="w-3.5 h-3.5"></i>
                  <span>Simulator</span>
                </button>
                <a href="${webUrl}" target="_blank" rel="noreferrer" class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-[#27272a] transition-all" title="Open Live Site in New Tab">
                  <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                </a>
              </div>

              ${isCurrentActive ? `
                <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-1 bg-blue-50 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800/60 flex items-center gap-1">
                  <i data-lucide="check" class="w-3 h-3"></i> Active Board
                </span>
              ` : `
                <button type="button" onclick="handleWorkspaceChange('${t.tenant_id}')" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#27272a] dark:hover:bg-[#38383e] text-white dark:text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1">
                  <span>Switch Workspace →</span>
                </button>
              `}
            </div>
          </div>

        </div>
      `;
    });

    // Add New Project Card
    html += `
      <div onclick="openProjectManagerModal()" class="border-2 border-dashed border-slate-200 dark:border-[#2c2c32] hover:border-slate-400 dark:hover:border-slate-600 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-3 cursor-pointer min-h-[360px] transition-all hover:bg-slate-50/50 dark:hover:bg-[#18181c]/50 group">
        <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-[#27272a] group-hover:scale-110 text-slate-700 dark:text-slate-200 flex items-center justify-center shadow-xs transition-transform">
          <i data-lucide="plus" class="w-6 h-6"></i>
        </div>
        <div>
          <h4 class="text-xs font-bold text-slate-900 dark:text-white">Add Another Project Website</h4>
          <p class="text-[11px] text-slate-400 max-w-xs mt-0.5">Register a new Vercel, Netlify, or custom domain website showcase.</p>
        </div>
      </div>
    `;

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error rendering website showcase:', err);
    container.innerHTML = `<div class="p-6 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Failed to load website showcase: ${err.message}</div>`;
  }
}

window.renderWebsiteShowcaseView = renderWebsiteShowcaseView;


// =========================================================================
// 18. WORKSPACE PLANNER & SCRATCHPAD CONTROLLER
// =========================================================================

let currentPlannerData = {
  notes: '',
  todos: []
};

let plannerDebounceTimer = null;

async function openPlannerDrawer() {
  const drawer = document.getElementById('plannerDrawer');
  const backdrop = document.getElementById('plannerDrawerBackdrop');
  const panel = document.getElementById('plannerDrawerPanel');
  const subEl = document.getElementById('plannerProjectSub');

  if (!drawer) return;

  if (subEl && activeBoard) {
    subEl.textContent = `${activeBoard.title} • Workspace Scratchpad`;
  }

  drawer.classList.remove('hidden');
  setTimeout(() => {
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');
    panel.classList.remove('translate-x-full');
    panel.classList.add('translate-x-0');
  }, 10);

  await loadPlannerData();
  if (window.lucide) lucide.createIcons();
}

function closePlannerDrawer() {
  const drawer = document.getElementById('plannerDrawer');
  const backdrop = document.getElementById('plannerDrawerBackdrop');
  const panel = document.getElementById('plannerDrawerPanel');

  if (!drawer) return;

  backdrop.classList.remove('opacity-100');
  backdrop.classList.add('opacity-0');
  panel.classList.remove('translate-x-0');
  panel.classList.add('translate-x-full');

  setTimeout(() => {
    drawer.classList.add('hidden');
  }, 250);
}

async function loadPlannerData() {
  try {
    const res = await fetch(`/api/planner?tenant_id=${currentTenant}`);
    if (res.ok) {
      const data = await res.json();
      currentPlannerData.notes = data.notes || '';
      currentPlannerData.todos = data.todos || [];

      const textarea = document.getElementById('plannerNotesTextarea');
      if (textarea) {
        textarea.value = currentPlannerData.notes;
        updatePlannerCharCount(currentPlannerData.notes.length);
      }

      renderPlannerTodos();
      updateSidebarPlannerBadge();
    }
  } catch (err) {
    console.error('Error loading planner data:', err);
  }
}

async function savePlannerData() {
  const statusEl = document.getElementById('plannerSaveStatus');
  if (statusEl) statusEl.textContent = 'Saving...';

  try {
    await fetch('/api/planner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        notes: currentPlannerData.notes,
        todos: currentPlannerData.todos
      })
    });

    if (statusEl) statusEl.textContent = 'Auto-saved to SQLite';
    updateSidebarPlannerBadge();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Save error';
    console.error('Error saving planner data:', err);
  }
}

function handlePlannerNoteInput() {
  const textarea = document.getElementById('plannerNotesTextarea');
  if (!textarea) return;

  currentPlannerData.notes = textarea.value;
  updatePlannerCharCount(textarea.value.length);

  const statusEl = document.getElementById('plannerSaveStatus');
  if (statusEl) statusEl.textContent = 'Unsaved changes...';

  clearTimeout(plannerDebounceTimer);
  plannerDebounceTimer = setTimeout(() => {
    savePlannerData();
  }, 500);
}

function updatePlannerCharCount(count) {
  const countEl = document.getElementById('plannerCharCount');
  if (countEl) countEl.textContent = `${count} characters`;
}

function insertNoteTimestamp() {
  const textarea = document.getElementById('plannerNotesTextarea');
  if (!textarea) return;
  const now = new Date().toLocaleString();
  const stamp = `\n[${now}] `;
  textarea.value += stamp;
  handlePlannerNoteInput();
  textarea.focus();
}

function insertNoteBullet() {
  const textarea = document.getElementById('plannerNotesTextarea');
  if (!textarea) return;
  textarea.value += '\n• ';
  handlePlannerNoteInput();
  textarea.focus();
}

function switchPlannerTab(tabName) {
  const notesSec = document.getElementById('plannerNotesSection');
  const todosSec = document.getElementById('plannerTodosSection');
  const tabNotesBtn = document.getElementById('plannerTabNotesBtn');
  const tabTodosBtn = document.getElementById('plannerTabTodosBtn');

  if (tabName === 'notes') {
    if (notesSec) notesSec.classList.remove('hidden');
    if (todosSec) todosSec.classList.add('hidden');
    if (tabNotesBtn) {
      tabNotesBtn.classList.add('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-white', 'shadow-2xs');
      tabNotesBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
    }
    if (tabTodosBtn) {
      tabTodosBtn.classList.remove('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-white', 'shadow-2xs');
      tabTodosBtn.classList.add('text-slate-600', 'dark:text-slate-400');
    }
  } else {
    if (notesSec) notesSec.classList.add('hidden');
    if (todosSec) todosSec.classList.remove('hidden');
    if (tabTodosBtn) {
      tabTodosBtn.classList.add('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-white', 'shadow-2xs');
      tabTodosBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
    }
    if (tabNotesBtn) {
      tabNotesBtn.classList.remove('active', 'bg-white', 'dark:bg-[#2c2c32]', 'text-slate-900', 'dark:text-white', 'shadow-2xs');
      tabNotesBtn.classList.add('text-slate-600', 'dark:text-slate-400');
    }
    renderPlannerTodos();
  }
}

function renderPlannerTodos() {
  const container = document.getElementById('plannerTodosList');
  const countTabEl = document.getElementById('plannerTodoTabCount');
  const progressText = document.getElementById('plannerTodoProgressText');
  if (!container) return;

  const todos = currentPlannerData.todos || [];
  const completedCount = todos.filter(t => t.done).length;

  if (countTabEl) countTabEl.textContent = `${completedCount}/${todos.length}`;
  if (progressText) progressText.textContent = `${completedCount}/${todos.length} completed`;

  if (todos.length === 0) {
    container.innerHTML = `
      <div class="border-2 border-dashed border-slate-200 dark:border-[#27272a] rounded-xl p-6 text-center text-slate-400 space-y-1.5">
        <i data-lucide="list-checks" class="w-6 h-6 mx-auto opacity-50"></i>
        <p class="text-xs font-semibold">No action items yet</p>
        <p class="text-[10px]">Add sprint tasks, milestones, or ideas above.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  let html = '';
  todos.forEach(todo => {
    html += `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#202024] border border-slate-200 dark:border-[#2c2c32] gap-2 transition-all">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <input type="checkbox" ${todo.done ? 'checked' : ''} onchange="togglePlannerTodo('${todo.id}')" class="w-4 h-4 rounded text-black cursor-pointer accent-black flex-shrink-0">
          <span class="text-xs font-medium ${todo.done ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'} truncate">
            ${todo.text}
          </span>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${getPriorityClass(todo.priority || 'Medium')}">
            ${todo.priority || 'Medium'}
          </span>
          <button type="button" onclick="convertPlannerTodoToFeature('${todo.id}')" class="px-2 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-[#2c2c32] dark:hover:bg-[#38383e] text-slate-800 dark:text-slate-200 rounded text-[10px] font-bold transition-colors flex items-center gap-1" title="Convert this action item to a live Database Feature in the Grid">
            <i data-lucide="plus" class="w-3 h-3"></i>
            <span>+ Feature</span>
          </button>
          <button type="button" onclick="deletePlannerTodo('${todo.id}')" class="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" title="Delete action item">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function addPlannerTodoItem() {
  const input = document.getElementById('newPlannerTodoInput');
  const prioSelect = document.getElementById('newPlannerTodoPriority');
  if (!input || !input.value.trim()) return;

  const newTodo = {
    id: `todo_${Date.now()}`,
    text: input.value.trim(),
    priority: prioSelect ? prioSelect.value : 'Medium',
    done: false,
    created_at: new Date().toISOString()
  };

  currentPlannerData.todos.unshift(newTodo);
  input.value = '';
  savePlannerData();
  renderPlannerTodos();
}

function togglePlannerTodo(id) {
  const todo = currentPlannerData.todos.find(t => t.id === id);
  if (todo) {
    todo.done = !todo.done;
    savePlannerData();
    renderPlannerTodos();
  }
}

function deletePlannerTodo(id) {
  currentPlannerData.todos = currentPlannerData.todos.filter(t => t.id !== id);
  savePlannerData();
  renderPlannerTodos();
}

async function convertPlannerTodoToFeature(id) {
  const todo = currentPlannerData.todos.find(t => t.id === id);
  if (!todo) return;

  const newFeatureData = {
    col_title: todo.text,
    col_status: 'Planning',
    col_priority: todo.priority || 'Medium',
    col_progress: 0,
    col_dept: currentUser ? currentUser.full_name : 'Lead Administrator'
  };

  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: currentTenant,
        data: newFeatureData
      })
    });

    if (res.ok) {
      todo.done = true;
      savePlannerData();
      renderPlannerTodos();
      await fetchData();
      showLiveBroadcast(`Converted Planner Todo into live feature: "${todo.text}"`);
    }
  } catch (err) {
    console.error('Error converting planner todo to feature:', err);
  }
}

function updateSidebarPlannerBadge() {
  const badge = document.getElementById('sidebarPlannerBadge');
  if (!badge) return;
  const pendingCount = (currentPlannerData.todos || []).filter(t => !t.done).length;
  badge.textContent = pendingCount;
}

window.openPlannerDrawer = openPlannerDrawer;
window.closePlannerDrawer = closePlannerDrawer;
window.handlePlannerNoteInput = handlePlannerNoteInput;
window.insertNoteTimestamp = insertNoteTimestamp;
window.insertNoteBullet = insertNoteBullet;
window.switchPlannerTab = switchPlannerTab;
window.addPlannerTodoItem = addPlannerTodoItem;
window.togglePlannerTodo = togglePlannerTodo;
window.deletePlannerTodo = deletePlannerTodo;
window.convertPlannerTodoToFeature = convertPlannerTodoToFeature;

window.handleShareUserSelect = handleShareUserSelect;

window.setAppAuthScreen = setAppAuthScreen;
