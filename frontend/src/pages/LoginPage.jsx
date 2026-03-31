import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, setAuth } from '../services/auth';
import '../styles/dashboard.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email.trim(), password);
      setAuth(result.access_token, result.email, result.role);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Supplier Order Automation System</p>
        <h1>Sign in</h1>
        <p className="subtext">Use your account to access the dashboard.</p>
      </header>
      <section className="panel login-panel">
        <h3>Login</h3>
        {error ? <p className="status-text error-text">{error}</p> : null}
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-block">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label className="field-block">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </section>
    </div>
  );
}
