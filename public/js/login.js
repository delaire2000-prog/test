const form = document.getElementById('login');
const err = document.getElementById('login-error');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ password: form.password.value }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { err.textContent = data.error || 'No se pudo entrar'; return; }
  location.href = data.role === 'editor' ? '/' : '/pantalla';
});
