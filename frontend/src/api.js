/**
 * XAI Risk Sentinel - API Service
 * Handles all backend communication including authentication, data fetching, and WebSocket
 */

// In dev:  Vite proxies /api → http://localhost:8000  (no CORS, no env var needed)
// In prod: set VITE_API_URL=https://your-backend.com  and remove the /api prefix logic
const _ENV_URL    = import.meta.env.VITE_API_URL || '';
// Use the env URL only if it's a full external URL (starts with http).
// In dev, always route through the Vite /api proxy so CORS is never an issue.
const API_PREFIX  = _ENV_URL.startsWith('http') ? _ENV_URL : '/api';
const TOKEN_KEY = 'xai_token';
const USER_KEY  = 'xai_user';

// ── Auth helpers ──────────────────────────────────────────────────────────────

export function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

export function isAuthenticated() {
  return !!getStoredToken();
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function authenticatedFetch(url, options = {}) {
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    logout();
    throw new Error('Session expired');
  }

  return response;
}

// ── Authentication ────────────────────────────────────────────────────────────

export async function login(username, password, role) {
  try {
    const response = await fetch(`${API_PREFIX}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: err.detail || `Login failed (${response.status})` };
    }

    const data = await response.json();

    try {
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify({ username, role }));
    } catch {}

    return {
      success: true,
      token: data.access_token,
      name: data.name || username,
      role: data.role || role,
      roleLabel: data.roleLabel || role,
      username: data.username || username,
      data,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Students ──────────────────────────────────────────────────────────────────

export async function fetchStudents(params = {}) {
  try {
    const qs = new URLSearchParams();
    if (params.page)       qs.set('page',   params.page);
    if (params.limit)      qs.set('limit',  params.limit);
    if (params.tier)       qs.set('tier',   params.tier);
    if (params.department) qs.set('department', params.department);
    if (params.search)     qs.set('search', params.search);
    const url = `${API_PREFIX}/students${qs.toString() ? '?' + qs.toString() : ''}`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch students');
    const data = await response.json();
    // Server returns { students, total, page, limit, pages }
    if (Array.isArray(data)) {
      return { success: true, students: data, total: data.length, page: 1, pages: 1 };
    }
    return { success: true, students: data.students || [], total: data.total || 0,
             page: data.page || 1, pages: data.pages || 1 };
  } catch (error) {
    return { success: false, error: error.message, students: [], total: 0, page: 1, pages: 1 };
  }
}

export async function fetchStudent(studentId) {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/students/${studentId}`);
    if (!response.ok) throw new Error('Failed to fetch student');
    const student = await response.json();
    return { success: true, student };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateStudent(studentId, updates) {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/students/${studentId}`, {
      method: 'POST',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update student');
    const student = await response.json();
    return { success: true, student };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function fetchStats() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    const data = await response.json();
    return { success: true, ...data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function fetchAnalytics() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/analytics`);
    if (!response.ok) throw new Error('Failed to fetch analytics');
    const data = await response.json();
    return { success: true, analytics: data };
  } catch (error) {
    return { success: false, error: error.message, analytics: null };
  }
}

export async function assessStudent(assessmentData) {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/students/assess`, {
      method: 'POST',
      body: JSON.stringify(assessmentData),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to assess student');
    }
    const data = await response.json();
    return { success: true, result: data };
  } catch (error) {
    return { success: false, error: error.message, result: null };
  }
}

export const getRiskLevel = (riskPercent) => {
  const percent = parseFloat(riskPercent) || 0;
  if (percent >= 75) return { level: 'high', color: '#ef4444', bgColor: 'bg-red-500/10', label: 'HIGH RISK' };
  if (percent >= 50) return { level: 'medium', color: '#eab308', bgColor: 'bg-yellow-500/10', label: 'MEDIUM RISK' };
  return { level: 'low', color: '#22c55e', bgColor: 'bg-green-500/10', label: 'LOW RISK' };
};

export const formatRisk = (riskPercent) => (parseFloat(riskPercent) || 0).toFixed(1) + '%';

// ── Roles & Tier ──────────────────────────────────────────────────────────────

export async function fetchRoles() {
  try {
    const response = await fetch(`${API_PREFIX}/roles`);
    if (!response.ok) throw new Error('Failed to fetch roles');
    const roles = await response.json();
    return { success: true, roles };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function fetchTierConfig() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/tier`);
    if (!response.ok) throw new Error('Failed to fetch tier config');
    const tier = await response.json();
    return { success: true, tier };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Audit logs ────────────────────────────────────────────────────────────────

export async function fetchAuditLogs() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/audit-logs`);
    if (!response.ok) throw new Error('Failed to fetch audit logs');
    const data = await response.json();
    const logs = Array.isArray(data) ? data : (data.logs || []);
    return { success: true, logs };
  } catch (error) {
    return { success: false, error: error.message, logs: [] };
  }
}

export async function createAuditLog(logData) {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/audit-logs`, {
      method: 'POST',
      body: JSON.stringify(logData),
    });
    if (!response.ok) throw new Error('Failed to create audit log');
    const log = await response.json();
    return { success: true, log };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function fetchUsers() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/users`);
    if (!response.ok) throw new Error('Failed to fetch users');
    const data = await response.json();
    const users = Array.isArray(data) ? data : (data.users || []);
    return { success: true, users };
  } catch (error) {
    return { success: false, error: error.message, users: [] };
  }
}

export async function createUser(userData) {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/users`, {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create user');
    }
    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function getPipelineStatus() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/pipeline/status`);
    if (!response.ok) throw new Error('Failed to get pipeline status');
    const status = await response.json();
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function runPipeline() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/pipeline/run`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to run pipeline');
    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function predictStudent(studentId) {
  try {
    const response = await authenticatedFetch(
      `${API_PREFIX}/pipeline/predict/${studentId}`,
      { method: 'POST' }
    );
    if (!response.ok) throw new Error('Failed to predict student');
    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function batchUpdatePredictions() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/students/batch`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to batch update predictions');
    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

export async function runPreprocessing() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/preprocessing/run`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to run preprocessing');
    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPreprocessingStatus() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/preprocessing/status`);
    if (!response.ok) throw new Error('Failed to get preprocessing status');
    const status = await response.json();
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPreprocessingResults() {
  try {
    const response = await authenticatedFetch(`${API_PREFIX}/preprocessing/results`);
    if (!response.ok) throw new Error('Failed to get preprocessing results');
    const results = await response.json();
    return { success: true, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function healthCheck() {
  try {
    const response = await fetch(`${API_PREFIX}/health`);
    if (!response.ok) throw new Error('Backend unhealthy');
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── WebSocket Manager ─────────────────────────────────────────────────────────

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectTimer = null;
    this.shouldReconnect = false;
  }

  connect() {
    const wsUrl = (_ENV_URL.startsWith('http') ? _ENV_URL : 'ws://localhost:8000').replace(/^http/, 'ws') + '/ws';
    this.shouldReconnect = true;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const { type, data } = message;
          if (type && this.listeners[type]) {
            this.listeners[type].forEach(cb => cb(data));
          }
        } catch {}
      };

      this.ws.onclose = () => {
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        }
      };

      this.ws.onerror = () => {};
    } catch {}
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}

export const wsManager = new WebSocketManager();

// ── Default export ────────────────────────────────────────────────────────────

export default {
  login,
  logout,
  getStoredToken,
  getStoredUser,
  isAuthenticated,
  fetchStudents,
  fetchStudent,
  updateStudent,
  fetchStats,
  fetchRoles,
  fetchTierConfig,
  fetchAuditLogs,
  createAuditLog,
  fetchUsers,
  createUser,
  getPipelineStatus,
  runPipeline,
  predictStudent,
  batchUpdatePredictions,
  runPreprocessing,
  getPreprocessingStatus,
  getPreprocessingResults,
  healthCheck,
  fetchAnalytics,
  assessStudent,
  wsManager,
  API_PREFIX,
};
