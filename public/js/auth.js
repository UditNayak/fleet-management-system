import { api, session } from './api.js';
import { $ } from './ui.js';

// Demo accounts created by `docker compose --profile tools run --rm seed` (and by the Postman auto-setup).
// The admin is deliberately not listed: its credentials stay in .env.
const DEMO_ACCOUNTS = {
  manager: { email: 'demo.manager@fleet.dev', password: 'Manager@123' },
  driver: { email: 'demo.driver@fleet.dev', password: 'Driver@123' },
};

export function initLogin(onLoggedIn) {
  const form = $('#login-form');
  const error = $('#login-error');

  form.querySelectorAll('[data-demo]').forEach((button) => {
    button.addEventListener('click', () => {
      const account = DEMO_ACCOUNTS[button.dataset.demo];
      form.email.value = account.email;
      form.password.value = account.password;
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;

    const apiKey = form.apiKey.value.trim();
    try {
      const { token, user } = await api('/api/users/login', {
        method: 'POST',
        auth: false,
        apiKey,
        body: { email: form.email.value.trim(), password: form.password.value },
      });
      session.save({ token, apiKey, user });
      form.password.value = '';
      onLoggedIn();
    } catch (err) {
      error.textContent =
        err.code === 'MISSING_API_KEY' || err.code === 'INVALID_API_KEY'
          ? `API key rejected (${err.code})`
          : err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

export function showLogin(message) {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  const error = $('#login-error');
  error.textContent = message ?? '';
  error.hidden = !message;
}
