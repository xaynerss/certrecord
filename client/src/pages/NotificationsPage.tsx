import { useEffect, useState } from 'react';
import { Send, Plus, X } from 'lucide-react';
import api from '../lib/api';
import { NOTIF_TYPE_RU } from '../lib/types';
import Checkbox from '../components/ui/Checkbox';

const DEFAULT_TH = [60, 30, 14, 7, 1];

export default function NotificationsPage() {
  const [thresholds, setThresholds] = useState<number[]>(DEFAULT_TH);
  const [channels, setChannels] = useState<any>({ emailEnabled: false, telegramEnabled: false, email: '', telegramChatId: '', telegramToken: '' });
  const [list, setList] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [custom, setCustom] = useState('');
  const [tgNick, setTgNick] = useState('');
  const [tgToken, setTgToken] = useState('');

  const load = async () => {
    const s = await api.get('/notifications/settings');
    setThresholds(s.data.thresholds || DEFAULT_TH);
    setChannels(s.data.channels || {});
    setTgNick(s.data.channels?.telegramUsername || '');
    const l = await api.get('/notifications');
    setList(l.data);
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const removeTh = (v: number) => setThresholds((t) => t.filter((x) => x !== v));

  const addCustom = () => {
    const v = Math.round(Number(custom));
    if (!v || v < 1 || v > 365) return;
    setThresholds((t) => (t.includes(v) ? t : [...t, v].sort((a, b) => b - a)));
    setCustom('');
  };

  const save = async () => {
    await api.patch('/notifications/settings', { thresholds, channels: { emailEnabled: channels.emailEnabled, telegramEnabled: channels.telegramEnabled, email: channels.email } });
    setMsg('Сохранено');
    setTimeout(() => setMsg(''), 2000);
  };

  const linkTelegram = async () => {
    try {
      const r = await api.post('/notifications/telegram/link', { username: tgNick, botToken: tgToken || undefined });
      setMsg(r.data.message);
      await load();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'ошибка привязки'); }
    setTimeout(() => setMsg(''), 5000);
  };

  const checkTelegram = async () => {
    try {
      const r = await api.post('/notifications/telegram/check');
      setMsg(r.data.message);
      await load();
    } catch (e: any) { setMsg(e?.response?.data?.error || 'ошибка проверки'); }
    setTimeout(() => setMsg(''), 5000);
  };
  const test = async (channel: string) => {
    try { const r = await api.post('/notifications/test', { channel }); setMsg(`Тест ${channel}: OK`); }
    catch (e: any) { setMsg(`Тест ${channel}: ${e?.response?.data?.error || 'ошибка'}`); }
    setTimeout(() => setMsg(''), 3000);
  };
  const check = async () => { const r = await api.post('/notifications/check'); setMsg(`Создано уведомлений: ${r.data.created}`); load(); setTimeout(() => setMsg(''), 2500); };

  return (
    <div className="max-w-[900px] anim-page">
      <h1 className="text-[38px] font-extrabold">Уведомления</h1>
      <div className="card mt-5 p-6">
        <div className="font-bold">Пороги (дней до истечения)</div>
        <p className="text-white/40 text-[12.5px] mt-1">Значения по умолчанию: 60 · 30 · 14 · 7 · 1. Лишнее удаляется крестиком, своё добавляется ниже.</p>
        <div className="flex gap-2.5 mt-3 flex-wrap">
          {thresholds.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 pl-4 pr-2.5 py-2 rounded-full font-bold text-[14px] text-white" style={{ background: '#206EF4' }}>
              {t} дн.
              <button onClick={() => removeTh(t)} title="Убрать порог" className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-black/25"><X size={13} strokeWidth={3} /></button>
            </span>
          ))}
          {!thresholds.length && <span className="text-white/40 text-[13px]">Пороги не выбраны — сработают только истёкшие</span>}
        </div>
        <div className="flex gap-2.5 mt-3 items-center flex-wrap">
          <input type="number" min={1} max={365} className="input !w-32 !py-2" placeholder="Дней" value={custom}
            onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} />
          <button className="btn-ghost !py-2 !text-[13px]" onClick={addCustom}><Plus size={15} /> Добавить порог</button>
          <button className="text-white/40 text-[13px] hover:text-white font-semibold" onClick={() => setThresholds(DEFAULT_TH)}>Сбросить</button>
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <div className="card !bg-white/[.04] p-4">
            <Checkbox checked={!!channels.emailEnabled} onChange={(v) => setChannels({ ...channels, emailEnabled: v })}
              label="Email" hint="письма уходят с нашего сервиса" />
            <input className="input mt-3 !py-2 text-[13px]" placeholder="куда слать (по умолчанию — твоя почта)" value={channels.email || ''} onChange={(e) => setChannels({ ...channels, email: e.target.value })} />
          </div>
          <div className="card !bg-white/[.04] p-4">
            <Checkbox checked={!!channels.telegramEnabled} onChange={(v) => setChannels({ ...channels, telegramEnabled: v })}
              label="Telegram" hint="привязка по нику, без ID чата" />
            <div className="flex items-center gap-2 mt-3">
              <span className={`badge ${channels.telegramStatus === 'linked' ? '' : 'opacity-70'}`}
                style={{ background: channels.telegramStatus === 'linked' ? 'rgba(34,197,94,.9)' : 'rgba(234,179,8,.85)' }}>
                {channels.telegramStatus === 'linked' ? 'Подключён' : 'Ожидание'}
              </span>
              {channels.telegramUsername && <span className="text-white/50 text-[12.5px]">@{channels.telegramUsername}</span>}
            </div>
            <input className="input mt-3 !py-2 text-[13px]" placeholder="Токен бота (от @BotFather)"
              value={tgToken} onChange={(e) => setTgToken(e.target.value)} />
            <input className="input mt-2 !py-2 text-[13px]" placeholder="Твой ник в Telegram (без @ можно)"
              value={tgNick} onChange={(e) => setTgNick(e.target.value)} />
            <div className="flex gap-2 mt-3 flex-wrap">
              <button className="btn-ghost !py-2 !text-[12.5px]" onClick={linkTelegram}>Привязать</button>
              <button className="btn-ghost !py-2 !text-[12.5px]" onClick={checkTelegram}>Я написал боту, проверить</button>
            </div>
            <p className="text-white/35 text-[11.5px] mt-2.5">Telegram не отдаёт ID по нику, поэтому: впиши ник → напиши боту любое сообщение → нажми «проверить». Дальше сервер сам подхватит твой чат.</p>
          </div>
        </div>
        <div className="flex gap-3 mt-5 flex-wrap">
          <button className="btn-primary" onClick={save}><Plus size={17} /> Сохранить</button>
          <button className="btn-ghost" onClick={() => test('telegram')}><Send size={16} /> Тест Telegram</button>
          <button className="btn-ghost" onClick={() => test('email')}><Send size={16} /> Тест Email</button>
          <button className="btn-ghost" onClick={check}>Проверить сейчас</button>
          {msg && <span className="text-[13px] text-white/60 self-center">{msg}</span>}
        </div>
      </div>
      <h2 className="font-bold text-[18px] mt-8 mb-3">Последние уведомления</h2>
      <div className="flex flex-col gap-2.5">
        {list.map((n) => (
          <div key={n.id} className="card p-4 flex gap-3 items-start">
            <span className="badge shrink-0" style={{ background: 'rgba(32,110,244,.25)', color: '#8db4ff' }}>{NOTIF_TYPE_RU[n.type] || n.type}</span>
            <div><div className="font-bold text-[14px]">{n.subject}</div><div className="text-white/55 text-[13px]">{n.body}</div>
            <div className="text-white/30 text-[11px] mt-1">{new Date(n.sentAt).toLocaleString('ru-RU')}</div></div>
          </div>
        ))}
        {!list.length && <div className="text-white/40 text-[14px]">Пока нет уведомлений</div>}
      </div>
    </div>
  );
}
