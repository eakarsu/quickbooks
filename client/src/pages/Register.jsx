import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Register() {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '', first_name: '', last_name: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const validatePassword = (pwd) => {
    const errs = [];
    if (pwd.length < 8) errs.push('At least 8 characters');
    if (!/[A-Z]/.test(pwd)) errs.push('One uppercase letter');
    if (!/[a-z]/.test(pwd)) errs.push('One lowercase letter');
    if (!/[0-9]/.test(pwd)) errs.push('One number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) errs.push('One special character');
    return errs;
  };

  const validate = () => {
    const e = {};
    if (!form.username.trim() || form.username.length < 3) e.username = 'Username must be at least 3 characters';
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = 'Valid email required';
    const pwdErrs = validatePassword(form.password);
    if (pwdErrs.length > 0) e.password = pwdErrs.join(', ');
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await register(form);
      toast.success('Registration successful! Please sign in.');
      navigate('/login');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pwdStrength = () => {
    const errs = validatePassword(form.password);
    if (!form.password) return null;
    const strength = 5 - errs.length;
    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['#e74c3c', '#e67e22', '#f39c12', '#27ae60', '#2ecc71'];
    return (
      <div className="password-strength">
        <div className="strength-bar">
          <div className="strength-fill" style={{ width: `${(strength / 5) * 100}%`, backgroundColor: colors[strength - 1] || '#e74c3c' }} />
        </div>
        <span style={{ color: colors[strength - 1] || '#e74c3c' }}>{labels[strength - 1] || 'Very Weak'}</span>
      </div>
    );
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>QuickBooks Manager</h1>
        <h2>Create Account</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input type="text" value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="First name" />
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input type="text" value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Last name" />
            </div>
          </div>
          <div className="form-group">
            <label>Username *</label>
            <input type="text" value={form.username} onChange={e => set('username', e.target.value)} className={errors.username ? 'input-error' : ''} placeholder="Choose a username" />
            {errors.username && <span className="field-error">{errors.username}</span>}
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={errors.email ? 'input-error' : ''} placeholder="your@email.com" />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </div>
          <div className="form-group">
            <label>Password *</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} className={errors.password ? 'input-error' : ''} placeholder="Create a strong password" />
            {pwdStrength()}
            {errors.password && <span className="field-error">{errors.password}</span>}
          </div>
          <div className="form-group">
            <label>Confirm Password *</label>
            <input type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} className={errors.confirmPassword ? 'input-error' : ''} placeholder="Confirm password" />
            {errors.confirmPassword && <span className="field-error">{errors.confirmPassword}</span>}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">Already have an account? Sign in</Link>
        </div>
      </div>
    </div>
  );
}
