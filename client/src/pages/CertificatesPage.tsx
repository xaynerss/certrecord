import { useEffect, useState } from 'react';
import { Search, ChevronDown, ChevronUp, ChevronsUpDown, FileDown, RotateCw, Plus, X, Trash2, Upload } from 'lucide-react';
import api from '../lib/api';
import { downloadExport } from '../lib/download';
import type { Cert } from '../lib/types';
import { STATUS_META, PROBLEM_COLORS, PROBLEM_OPTIONS, fmtDate } from '../lib/types';
import RiskCircle from '../components/certificates/RiskCircle';
import CertificateDetailModal from '../components/certificates/CertificateDetailModal';
import Checkbox from '../components/ui/Checkbox';
import ConfirmModal from '../components/ui/ConfirmModal';

export default function CertificatesPage() {
  const [data, setData] = useState<Cert[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [issuer, setIssuer] = useState('');
  const [owner, setOwner] = useState('');
  const [problem, setProblem] = useState('');
  const [selected, setSelected] = useState<Cert | null>(null);
  const [sortKey, setSortKey] = useState('daysLeft');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ targets: '', port: 443, owner: '', critical: false });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; updated: number; failed: { host: string; error: string }[] } | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Cert | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanProg, setScanProg] = useState<{ done: number; total: number } | null>(null);

  // Скан в 1 клик: ничего писать не надо — сканируются сертификаты прямо из таблицы
  const rescanVisible = async () => {
    if (!data.length || scanBusy) return;
    const targets = [...new Set(data.map((c) => `${c.host}:${c.port || 443}`))];
    setScanBusy(true);
    setScanProg({ done: 0, total: targets.length });
    try {
      const r = await api.post('/scanning/start', { targets });
      const jobId = r.data.jobId;
      const poll = setInterval(async () => {
        try {
          const j = await api.get(`/scanning/${jobId}`);
          setScanProg({ done: j.data.processed || 0, total: j.data.total || targets.length });
          if (j.data.status === 'DONE' || j.data.status === 'FAILED') {
            clearInterval(poll);
            setScanBusy(false);
            await load();
            setTimeout(() => setScanProg(null), 3000);
          }
        } catch { clearInterval(poll); setScanBusy(false); }
      }, 1200);
    } catch { setScanBusy(false); setScanProg(null); }
  };

  const load = async () => {
    const r = await api.get('/certificates', { params: { search, status: status || undefined, issuer: issuer || undefined, owner: owner || undefined, problem: problem || undefined, sort: sortKey, order: sortDir, perPage: 100 } });
    setData(r.data.data); setTotal(r.data.total);
  };
  useEffect(() => { load().catch(() => {}); }, [status, problem, sortKey, sortDir]);
  useEffect(() => { const t = setTimeout(() => load().catch(() => {}), 350); return () => clearTimeout(t); }, [search, issuer, owner]);

  const onSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const th = (label: string, key: string) => {
    const active = sortKey === key;
    return (
      <th className={`cursor-pointer select-none transition ${active ? 'text-white' : 'hover:text-white'}`} onClick={() => onSort(key)}>
        <span className="inline-flex items-center gap-1.5">
          {label}
          {active
            ? (sortDir === 'asc' ? <ChevronUp size={15} style={{ color: '#206EF4' }} /> : <ChevronDown size={15} style={{ color: '#206EF4' }} />)
            : <ChevronsUpDown size={15} className="opacity-30" />}
        </span>
      </th>
    );
  };

  const submitAdd = async () => {
    setFormErr('');
    setImportResult(null);
    const list = form.targets.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) { setFormErr('Вставьте список: DNS-имена, IP, URL или host:port — по одному на строку'); return; }
    if (list.length > 50) { setFormErr('Не больше 50 целей за раз'); return; }
    setSaving(true);
    try {
      const r = await api.post('/certificates/import', {
        targets: list, port: Number(form.port) || 443,
        owner: form.owner.trim() || undefined, critical: form.critical
      });
      setImportResult({ added: r.data.added, updated: r.data.updated, failed: r.data.failed || [] });
      await load();
      if (!r.data.failed?.length) {
        setShowAdd(false);
        setForm({ targets: '', port: 443, owner: '', critical: false });
      }
    } catch (e: any) {
      setFormErr(e?.response?.data?.error || 'Не удалось добавить');
    } finally { setSaving(false); }
  };

  // Загрузка файлов сертификатов (.pem/.crt/.cer/.der, 1 или несколько)
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    if (files.length > 10) { setFormErr('Не больше 10 файлов за раз'); return; }
    setFormErr('');
    setImportResult(null);
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      fd.append('port', String(Number(form.port) || 443));
      if (form.owner.trim()) fd.append('owner', form.owner.trim());
      if (form.critical) fd.append('critical', 'true');
      const r = await api.post('/certificates/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult({
        added: r.data.added, updated: r.data.updated,
        failed: (r.data.failed || []).map((f: any) => ({ host: f.file || f.host, error: f.error }))
      });
      await load();
    } catch (e: any) {
      setFormErr(e?.response?.data?.error || 'Не удалось загрузить файлы');
    } finally { setUploading(false); }
  };

  const removeCert = async () => {    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/certificates/${pendingDelete.id}`);
      setPendingDelete(null);
      setSelected(null);
      await load();
    } finally { setDeleting(false); }
  };

  return (
    <div className="anim-page">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-[38px] font-extrabold">Сертификаты</h1>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={19} /> Добавить</button>
          <button className="btn-ghost" onClick={() => downloadExport('csv')}><FileDown size={19} /> Экспорт CSV</button>
          <button className="btn-primary disabled:opacity-60" disabled={scanBusy} onClick={rescanVisible} title="Просканировать всё из таблицы">
            <RotateCw size={19} className={scanBusy ? 'animate-spin' : ''} />
            {scanBusy && scanProg ? `${Math.round((scanProg.done / Math.max(1, scanProg.total)) * 100)}%` : 'Скан'}
          </button>
        </div>
      </div>

      <div className="flex gap-3 mt-6 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-[420px]">
          <Search size={19} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input className="input !pl-11" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {[
          { v: status, set: setStatus, label: 'Статус', opts: ['', 'OK', 'INFO', 'WARNING', 'CRITICAL', 'EXPIRED'] },
          { v: issuer, set: setIssuer, label: 'Издатель', opts: ['', 'DigiCert', 'Sectigo', "Let's Encrypt", 'GlobalSign', 'Internal CA'] },
          { v: owner, set: setOwner, label: 'Владелец', opts: ['', '__none'] }
        ].map((f, i) => (
          <div key={i} className="relative">
            <select value={f.v} onChange={(e) => f.set(e.target.value)} className="input appearance-none !w-auto pr-10 font-semibold cursor-pointer">
              <option value="">{f.label}</option>
              {f.opts.filter(Boolean).map((o) => <option key={o} value={o}>{o === '__none' ? 'Без владельца' : o}</option>)}
            </select>
            <ChevronDown size={17} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/60" />
          </div>
        ))}
        <div className="relative">
          <select value={problem} onChange={(e) => setProblem(e.target.value)} className="input appearance-none !w-auto pr-10 font-semibold cursor-pointer">
            {PROBLEM_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
          <ChevronDown size={17} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/60" />
        </div>
        <span className="text-white/40 text-[13px] self-center ml-auto">Всего: {total}</span>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead className="table-head"><tr>
            {th('Сервис', 'host')}<th className="col-sep">{th('Издатель', 'issuer')}</th><th className="col-sep">{th('Истечение', 'validTo')}</th>
            <th className="col-sep">{th('Осталось дн.', 'daysLeft')}</th><th className="col-sep">{th('Риск', 'riskScore')}</th><th className="col-sep">Статус</th><th className="col-sep">Проблемы</th><th className="col-sep"><span className="sr-only">Действия</span></th>
          </tr></thead>
          <tbody className="table-body">
            {data.map((c) => {
              const m = STATUS_META[c.status] || STATUS_META.UNKNOWN;
              const probs = c.problems || [];
              return (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[.03] cursor-pointer" onClick={() => setSelected(c)}>
                  <td className="font-semibold">{c.host}<span className="text-white/35 font-normal">:{c.port}</span></td>
                  <td className="col-sep">{c.issuer}</td>
                  <td className="col-sep">{fmtDate(c.validTo)}</td>
                  <td className="col-sep font-bold">{c.daysLeft ?? '—'}</td>
                  <td className="col-sep"><div className="relative"><RiskCircle score={c.riskScore} size={46} /></div></td>
                  <td className="col-sep"><span className="badge" style={{ background: m.bg }}>{m.label}</span></td>
                  <td className="col-sep">
                    {!probs.length && <span className="text-white/30 text-[12.5px]">нет</span>}
                    <span className="flex flex-col gap-1 items-start">
                      {probs.slice(0, 2).map((p) => (
                        <span key={p.code} className="badge !text-[11px] !py-1 !px-2.5" style={{ background: PROBLEM_COLORS[p.code] || 'rgba(107,114,128,.9)' }} title={p.detail}>{p.label}</span>
                      ))}
                      {probs.length > 2 && <span className="text-white/40 text-[11.5px] font-bold">+{probs.length - 2}</span>}
                    </span>
                  </td>
                  <td className="col-sep">
                    <button title="Удалить" className="p-2 rounded-lg text-white/35 hover:text-red-400 hover:bg-white/5"
                      onClick={(e) => { e.stopPropagation(); setPendingDelete(c); }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
      <CertificateDetailModal cert={selected} onClose={() => setSelected(null)} onUpdated={(u) => { setSelected(u); load(); }} />
      {scanProg && (
        <div className="card mt-4 p-4">
          <div className="flex justify-between text-[12.5px] text-white/60 mb-2">
            <span>Сканирую таблицу: {scanProg.done}/{scanProg.total}</span>
            <span>{Math.round((scanProg.done / Math.max(1, scanProg.total)) * 100)}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(scanProg.done / Math.max(1, scanProg.total)) * 100}%`, background: '#206EF4' }} />
          </div>
        </div>
      )}
      <ConfirmModal
        open={!!pendingDelete}
        title="Удалить сертификат?"
        text={`${pendingDelete?.host}:${pendingDelete?.port} будет удалён из инвентаря. Сканирование сможет найти его заново.`}
        onConfirm={removeCert}
        onCancel={() => setPendingDelete(null)}
        busy={deleting}
      />

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-auto anim-fade modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="card w-full max-w-[560px] p-7 mt-8 anim-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-[20px] font-bold">Добавить сертификаты</h2>
              <button onClick={() => setShowAdd(false)} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center"><X size={19} /></button>
            </div>
            <p className="text-white/45 text-[13px] mt-1">Вставьте список — сервер сам подключится по TLS и определит издателя, даты, self-signed, цепочку и соответствие DNS.</p>
            <div className="mt-5 text-[13px]">
              <label>Серверы, IP, DNS-имена, URL *
                <textarea className="input mt-1 h-28 font-mono" placeholder={'api.company.kz\n192.168.1.10\nvpn.company.kz:8443\nhttps://portal.company.kz'} value={form.targets} onChange={(e) => setForm({ ...form, targets: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <label>Порт по умолчанию<input type="number" className="input mt-1" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
                <label>Владелец (всем сразу)<input className="input mt-1" placeholder="Имя ответственного" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
              </div>
              <div className="mt-3"><Checkbox checked={form.critical} onChange={(v) => setForm({ ...form, critical: v })} label="Критичные сервисы" hint="флаг и +30% к риску для всех добавленных" /></div>
            </div>
            {importResult && (
              <div className="mt-4 px-4 py-3 rounded-xl text-[13px] font-semibold" style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.35)' }}>
                Добавлено: {importResult.added} · Обновлено: {importResult.updated}
                {!!importResult.failed.length && (
                  <span className="block mt-1.5 font-normal text-white/60">
                    Не удалось ({importResult.failed.length}): {importResult.failed.map((f) => f.host).join(', ')}
                  </span>
                )}
              </div>
            )}
            <div className="mt-4 pt-4 text-[13px]" style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
              <div className="font-bold">Или загрузи файлы сертификатов</div>
              <p className="text-white/40 text-[12px] mt-0.5">.pem / .crt / .cer / .der — один или несколько, всё извлечётся из файла само.</p>
              <label className="btn-ghost cursor-pointer mt-2.5 !py-2.5 text-[13.5px] inline-flex">
                <Upload size={16} /> {uploading ? 'Загружаю…' : 'Выбрать файлы'}
                <input type="file" multiple accept=".pem,.crt,.cer,.der,.p7b" className="hidden"
                  disabled={uploading} onChange={(e) => uploadFiles(e.target.files)} />
              </label>
            </div>
            {formErr && <div className="text-red-400 text-[13px] mt-3">{formErr}</div>}
            <div className="flex gap-3 mt-5">
              <button className="btn-primary flex-1 justify-center disabled:opacity-50" disabled={saving} onClick={submitAdd}><Plus size={18} /> {saving ? 'Сканирую…' : 'Просканировать и добавить'}</button>
              <button className="btn-ghost" onClick={() => setShowAdd(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
