import api from './api';

// Скачивание экспорта через axios (с JWT), а не window.open —
// иначе браузер уходит без токена и получает 401.
export async function downloadExport(kind: 'csv' | 'excel' | 'html') {
  const ext = kind === 'excel' ? 'xlsx' : kind;
  const r = await api.get(`/export/${kind}`, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `certrecord.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
