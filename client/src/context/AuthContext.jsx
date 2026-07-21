import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/auth/profile').then((result) => {
      setUser(result.data);
      localStorage.setItem('user', JSON.stringify(result.data));
    }).catch(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const data = await api.post('/auth/login', { username, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch (e) { /* ignore */ }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const updateProfile = async (profileData) => {
    const data = await api.put('/auth/profile', profileData);
    const updated = { ...user, ...profileData };
    localStorage.setItem('user', JSON.stringify(updated));
    setUser(updated);
    return data;
  };

  const changePassword = async (current_password, new_password) => {
    return await api.post('/auth/change-password', { current_password, new_password });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateProfile, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
