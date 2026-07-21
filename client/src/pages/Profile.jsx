import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../api';

export default function Profile() {
  const { user, updateProfile, changePassword } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [pwdForm, setPwdForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('profile');

  useEffect(() => {
    if (user) {
      setProfile({ first_name: user.first_name || '', last_name: user.last_name || '', email: user.email || '', phone: user.phone || '' });
    }
  }, [user]);

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateProfile(profile);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!pwdForm.current_password) errs.current_password = 'Required';
    if (pwdForm.new_password.length < 14) errs.new_password = 'At least 14 characters';
    if (pwdForm.new_password !== pwdForm.confirm_password) errs.confirm_password = 'Passwords do not match';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      await changePassword(pwdForm.current_password, pwdForm.new_password);
      toast.success('Password changed successfully');
      setPwdForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Profile & Settings</h1>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Profile</button>
        <button className={`tab ${tab === 'password' ? 'active' : ''}`} onClick={() => setTab('password')}>Change Password</button>
      </div>

      {tab === 'profile' && (
        <div className="card">
          <form onSubmit={handleProfileSave}>
            <div className="form-row">
              <div className="form-group">
                <label>First Name</label>
                <input value={profile.first_name} onChange={e => setProfile(p => ({ ...p, first_name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Last Name</label>
                <input value={profile.last_name} onChange={e => setProfile(p => ({ ...p, last_name: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Role</label>
              <input value={user?.role || ''} disabled />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>
      )}

      {tab === 'password' && (
        <div className="card">
          <form onSubmit={handlePasswordChange}>
            <div className="form-group">
              <label>Current Password</label>
              <input type="password" value={pwdForm.current_password} onChange={e => setPwdForm(p => ({ ...p, current_password: e.target.value }))} className={errors.current_password ? 'input-error' : ''} />
              {errors.current_password && <span className="field-error">{errors.current_password}</span>}
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" value={pwdForm.new_password} onChange={e => setPwdForm(p => ({ ...p, new_password: e.target.value }))} className={errors.new_password ? 'input-error' : ''} />
              {errors.new_password && <span className="field-error">{errors.new_password}</span>}
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" value={pwdForm.confirm_password} onChange={e => setPwdForm(p => ({ ...p, confirm_password: e.target.value }))} className={errors.confirm_password ? 'input-error' : ''} />
              {errors.confirm_password && <span className="field-error">{errors.confirm_password}</span>}
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
