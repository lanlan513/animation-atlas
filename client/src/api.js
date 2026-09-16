const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(path, { revision, ...options } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const userId = localStorage.getItem('panel-punch-user');
  if (userId) headers['x-user-id'] = userId;
  if (Number.isInteger(revision)) headers['if-match'] = String(revision);

  const response = await fetch(`${API}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || '请求失败，请稍后重试。', response.status, body);
  return body;
}

export async function getGuest() {
  const stored = localStorage.getItem('panel-punch-user');
  if (stored) {
    try {
      const result = await request('/auth/me');
      return result.user;
    } catch {
      localStorage.removeItem('panel-punch-user');
    }
  }
  const result = await request('/auth/guest', { method: 'POST' });
  localStorage.setItem('panel-punch-user', result.user.id);
  return result.user;
}

export async function listPosters() {
  const result = await request('/posters');
  return result.posters;
}

export async function createPoster(poster) {
  return request('/posters', { method: 'POST', body: JSON.stringify({ poster }) });
}

export async function loadPoster(id) {
  return request(`/posters/${id}`);
}

export async function savePoster(id, poster, revision, { keepalive = false } = {}) {
  return request(`/posters/${id}`, {
    method: 'PUT',
    revision,
    keepalive,
    body: JSON.stringify({ poster })
  });
}
