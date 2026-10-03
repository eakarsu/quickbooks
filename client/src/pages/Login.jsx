import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const validate = () => {
    const e = {};
    if (!username.trim()) e.username = 'Username is required';
    if (!password) e.password = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await login(username, password);
      toast.success('Login successful!');
      navigate('/');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>QuickBooks Manager</h1>
        <h2>Sign In</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username or Email</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              className={errors.username ? 'input-error' : ''} placeholder="Enter username" />
            {errors.username && <span className="field-error">{errors.username}</span>}
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className={errors.password ? 'input-error' : ''} placeholder="Enter password" />
            {errors.password && <span className="field-error">{errors.password}</span>}
          </div>
          <button
            type="button"
            onClick={() => { setUsername(import.meta.env.VITE_DEMO_EMAIL || ''); setPassword(import.meta.env.VITE_DEMO_PASSWORD || ''); }}
            disabled={!import.meta.env.VITE_DEMO_EMAIL || !import.meta.env.VITE_DEMO_PASSWORD}
            aria-label="Auto Fill Demo Credentials"
            style={{ width: '100%', marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', border: '1px solid currentColor', background: 'transparent', cursor: 'pointer' }}
          >
            Auto Fill Demo Credentials
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-muted">Accounts are provisioned by an administrator. Contact operations if you need access.</p>
      </div>
    </div>
  );
}
