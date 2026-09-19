import QRCode from 'qrcode';
import type { MoveTask, BoxStatus, DamageSeverity } from './types';

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export function generateBoxCode(task: MoveTask, roomTo: string): string {
  const prefix = roomTo.charAt(0).toUpperCase();
  const sameRoomBoxes = task.boxes.filter((b) => b.roomTo === roomTo);
  const seq = sameRoomBoxes.length + 1;
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

export async function generateQRDataURL(taskId: string, code: string): Promise<string> {
  const text = `movedoc://${taskId}/${code}`;
  return QRCode.toDataURL(text, { width: 256, margin: 2 });
}

export function compressImage(file: File, maxLongEdge = 1024, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const longEdge = Math.max(width, height);
      if (longEdge > maxLongEdge) {
        const ratio = maxLongEdge / longEdge;
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export function vibrateShort(): void {
  if (navigator.vibrate) navigator.vibrate(50);
}

export function playBeep(): void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch {
    // ignore
  }
}

export function parseQRContent(text: string): { taskId?: string; code?: string } {
  const match = text.match(/^movedoc:\/\/([^/]+)\/(.+)$/);
  if (!match) return {};
  return { taskId: match[1], code: match[2] };
}

export function statusColor(status: BoxStatus): string {
  switch (status) {
    case 'packed':
      return '#9ca3af';
    case 'loaded':
      return '#3b82f6';
    case 'arrived':
      return '#22c55e';
    case 'unpacked':
      return '#10b981';
    case 'damaged':
      return '#ef4444';
    case 'missing':
      return '#f59e0b';
    default:
      return '#9ca3af';
  }
}

export function statusLabel(status: BoxStatus): string {
  const map: Record<BoxStatus, string> = {
    packed: '待打包',
    loaded: '已装车',
    arrived: '已到达',
    unpacked: '已拆箱',
    damaged: '破损',
    missing: '缺失',
  };
  return map[status];
}

export function estimateVehicle(boxCount: number, avgVolumeM3 = 0.08): { vehicle: string; suggestion: string } {
  const totalVolume = boxCount * avgVolumeM3;
  if (totalVolume <= 8) return { vehicle: '面包车/小型货车', suggestion: '建议选用 4.2m 厢式货车或面包车' };
  if (totalVolume <= 18) return { vehicle: '中型货车', suggestion: '建议选用 6.8m 厢式货车' };
  return { vehicle: '大型货车/多车', suggestion: '箱数较多，建议选用 9.6m 货车或分多车运输' };
}

export function roomProgress(task: MoveTask, room: string): { total: number; unpacked: number; damaged: number } {
  const boxes = task.boxes.filter((b) => b.roomTo === room);
  return {
    total: boxes.length,
    unpacked: boxes.filter((b) => b.status === 'unpacked').length,
    damaged: boxes.filter((b) => b.status === 'damaged').length,
  };
}

export function severityLabel(severity: DamageSeverity): string {
  const map: Record<DamageSeverity, string> = {
    light: '轻微（压痕/蹭伤）',
    medium: '中等（变形/开裂）',
    severe: '严重（破损/内物损坏）',
  };
  return map[severity];
}

export function severityColor(severity: DamageSeverity): string {
  const map: Record<DamageSeverity, string> = {
    light: '#f59e0b',
    medium: '#f97316',
    severe: '#ef4444',
  };
  return map[severity];
}

// 理赔单四项必填的展示名
export const CLAIM_FIELD_LABELS: Record<string, string> = {
  damage: '损坏位置与程度',
  amount: '预估赔偿金额',
  assessor: '定损人',
  evidence: '现场照片与说明',
};

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function normalizeAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
