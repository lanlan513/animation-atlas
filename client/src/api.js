// Thin fetch layer + anonymous guest identity.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const API = env.VITE_API_URL || 'http://localhost:4000/api';

export async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const userId = localStorage.getItem('pixelpulse-user');
  if (userId) headers['x-user-id'] = userId;
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers });
  } catch {
    const network = new Error('网络不可达，操作已保存在本地队列。');
    network.networkError = true;
    throw network;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || '请求失败');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function ensureGuest() {
  const stored = localStorage.getItem('pixelpulse-user');
  if (stored) {
    try {
      await request('/auth/me');
      return stored;
    } catch (error) {
      if (!error.status) throw error; // network down: keep the local identity
      localStorage.removeItem('pixelpulse-user');
    }
  }
  const result = await request('/auth/guest', { method: 'POST' });
  localStorage.setItem('pixelpulse-user', result.user.id);
  return result.user.id;
}

export const api = {
  listProjects: () => request('/projects'),
  createProject: (payload) => request('/projects', { method: 'POST', body: JSON.stringify(payload) }),
  loadProject: (id) => request(`/projects/${id}`),
  commit: (id, payload) => request(`/projects/${id}/commits`, { method: 'POST', body: JSON.stringify(payload) }),
  sync: (id, since) => request(`/projects/${id}/sync?since=${since}`)
};
