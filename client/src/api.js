// 与 FrameMold API 之间的薄封装。所有请求自动带上访客身份；
// 401 时清掉本地身份并刷新，由首屏重新领取访客。
export const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export const ORIGIN = API.replace(/\/api\/?$/, '');

const USER_KEY = 'animation-atlas-user';

export const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
};
export const setStoredUser = (user) => localStorage.setItem(USER_KEY, JSON.stringify(user));
export const clearStoredUser = () => localStorage.removeItem(USER_KEY);

async function parse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function api(path, { method = 'GET', body, headers, raw = false } = {}) {
  const user = getStoredUser();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(user ? { 'x-user-id': user.id } : {}), ...(headers || {}) },
    body: raw ? body : (body instanceof FormData ? body : body ? JSON.stringify(body) : undefined)
  });
  if (response.status === 401) {
    // 启动时的 /auth/me 会在 App 引导流程里被捕获并重新领取访客；其他调用仅抛出。
    clearStoredUser();
  }
  return parse(response);
}

export const mediaUrl = (url) => (url?.startsWith('http') ? url : `${ORIGIN}${url}`);

// 帧图片上传：统一走 multipart，可选附带拍摄端计算的时长。
export function uploadFrame(projectId, blob, { durationMs, signal } = {}) {
  const form = new FormData();
  form.append('frame', blob, 'frame.jpg');
  if (durationMs) form.append('durationMs', String(durationMs));
  return api(`/projects/${projectId}/frames`, { method: 'POST', body: form, signal });
}
