import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';

function Shell({ title, children }: any) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-[420px] p-8">
        <div className="text-[24px] font-extrabold mb-1"><span className="text-white">cert</span><span style={{ color: '#206EF4' }}>record</span></div>
        <h1 className="text-[20px] font-bold mb-5">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    try { const r = await api.post('/auth/login', { email, password }); localStorage.setItem('certrecord_token', r.data.token); nav('/'); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Ошибка входа'); }
  };
  return (
    <Shell title="Вход">
      <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input mt-3" type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      {err && <div className="text-red-400 text-[13px] mt-2">{err}</div>}
      <button className="btn-primary w-full justify-center mt-4" onClick={go}>Войти</button>
      <div className="text-[13px] text-white/50 mt-3">Нет аккаунта? <Link to="/register" className="text-[#5b93ff] font-semibold">Регистрация</Link></div>
    </Shell>
  );
}

export function RegisterPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    try { const r = await api.post('/auth/register', { email, password, name }); localStorage.setItem('certrecord_token', r.data.token); nav('/'); }
    catch (e: any) { setErr(e?.response?.data?.error || 'Ошибка регистрации'); }
  };
  return (
    <Shell title="Регистрация">
      <input className="input" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input mt-3" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input mt-3" type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      {err && <div className="text-red-400 text-[13px] mt-2">{err}</div>}
      <button className="btn-primary w-full justify-center mt-4" onClick={go}>Создать аккаунт</button>
      <div className="text-[13px] text-white/50 mt-3">Уже есть? <Link to="/login" className="text-[#5b93ff] font-semibold">Войти</Link></div>
    </Shell>
  );
}
