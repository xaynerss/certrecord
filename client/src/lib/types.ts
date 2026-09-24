export type Status = 'OK' | 'INFO' | 'WARNING' | 'CRITICAL' | 'EXPIRED' | 'UNKNOWN';

export interface Cert {
  id: string;
  host: string;
  port: number;
  cn?: string;
  san?: string[];
  issuer?: string;
  thumbprint?: string;
  validFrom?: string;
  validTo?: string;
  daysLeft?: number | null;
  chainValid?: boolean;
  chainError?: string | null;
  dnsMatch?: boolean;
  selfSigned?: boolean;
  keyAlgo?: string;
  keySize?: number | null;
  tlsVersion?: string | null;
  cipher?: string | null;
  sigAlgo?: string | null;
  weakCrypto?: boolean;
  weakCryptoReasons?: string[];
  status: Status;
  statusLabel?: string;
  riskScore: number;
  riskReasons?: string[];
  recommendations?: string[];
  problems?: { code: string; label: string; detail: string }[];
  owner?: string | null;
  critical?: boolean;
  lastScannedAt?: string;
}

export interface Stats {
  TOTAL: number; OK: number; INFO: number; WARNING: number; CRITICAL: number; EXPIRED: number; NOOWNER: number;
}

export const STATUS_META: Record<Status, { label: string; color: string; bg: string; border: string }> = {
  OK: { label: 'В норме', color: '#22C55E', bg: 'rgba(34,197,94,.9)', border: '#22C55E' },
  INFO: { label: 'Информация', color: '#3B82F6', bg: 'rgba(59,130,246,.9)', border: '#3B82F6' },
  WARNING: { label: 'Предупреждение', color: '#EAB308', bg: 'rgba(234,179,8,.9)', border: '#EAB308' },
  CRITICAL: { label: 'Критично', color: '#EF4444', bg: 'rgba(239,68,68,.9)', border: '#EF4444' },
  EXPIRED: { label: 'Истёк', color: '#6B7280', bg: 'rgba(107,114,128,.9)', border: '#6B7280' },
  UNKNOWN: { label: '—', color: '#6B7280', bg: 'rgba(107,114,128,.9)', border: '#6B7280' }
};

export function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${String(d.getFullYear()).slice(2)}`;
}

export function riskColor(score: number) {
  if (score >= 80) return '#EF4444';
  if (score >= 60) return '#F97316';
  if (score >= 40) return '#EAB308';
  return '#22C55E';
}

// Выявляемые проблемы (ТЗ 3.6): код → цвет чипа
export const PROBLEM_COLORS: Record<string, string> = {
  EXPIRED: 'rgba(107,114,128,.9)',
  EXPIRING_SOON: 'rgba(234,179,8,.9)',
  SELF_SIGNED: 'rgba(239,68,68,.9)',
  CHAIN_ERROR: 'rgba(239,68,68,.9)',
  DNS_MISMATCH: 'rgba(249,115,22,.9)',
  WEAK_CRYPTO: 'rgba(168,85,247,.9)'
};

export const PROBLEM_OPTIONS = [
  { code: '', label: 'Проблема: все' },
  { code: 'EXPIRED', label: 'Истёкшие' },
  { code: 'EXPIRING_SOON', label: 'Скоро истекают' },
  { code: 'SELF_SIGNED', label: 'Self-signed' },
  { code: 'CHAIN_ERROR', label: 'Ошибка цепочки' },
  { code: 'DNS_MISMATCH', label: 'DNS не совпадает' },
  { code: 'WEAK_CRYPTO', label: 'Слабая криптография' }
];

// Типы уведомлений → русский
export const NOTIF_TYPE_RU: Record<string, string> = {
  EXPIRING: 'Истекает',
  EXPIRED: 'Истёк',
  SELF_SIGNED: 'Self-signed',
  CHAIN_ERROR: 'Цепочка',
  DNS_MISMATCH: 'DNS',
  WEAK_CRYPTO: 'Крипто'
};
