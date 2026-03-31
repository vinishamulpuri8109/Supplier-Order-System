const TOKEN_KEY = 'auth_token';
const EMAIL_KEY = 'auth_email';
const ROLE_KEY = 'auth_role';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export function setAuth(token, email, role) {
  localStorage.setItem(TOKEN_KEY, token);
  if (email) {
    localStorage.setItem(EMAIL_KEY, email);
  }
  if (role) {
    localStorage.setItem(ROLE_KEY, role);
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUserEmail() {
  return localStorage.getItem(EMAIL_KEY);
}

export function getUserRole() {
  return localStorage.getItem(ROLE_KEY);
}

export async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || 'Login failed');
  }

  return data;
}
