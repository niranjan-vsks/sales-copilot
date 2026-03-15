const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const API = `${BACKEND_URL}/api`;

async function apiFetch(path, options = {}) {
  const { body, method = 'GET', ...rest } = options;
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...rest.headers },
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (res.status === 401) {
    window.location.href = '/#/login';
    throw new Error('Not authenticated');
  }

  if (!res.ok) {
    let detail = `Request failed: ${res.status}`;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const api = {
  get:    (path)         => apiFetch(path),
  post:   (path, body)   => apiFetch(path, { method: 'POST',   body }),
  put:    (path, body)   => apiFetch(path, { method: 'PUT',    body }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
};

export default api;
