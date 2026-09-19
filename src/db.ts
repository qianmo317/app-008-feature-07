import type { MoveTask, Box, Claim } from './types';
import { uid } from './utils';

const DB_NAME = 'MovingBoxTracker';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
      }
    };
  });
}

export async function getAllTasks(): Promise<MoveTask[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as MoveTask[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getTask(id: string): Promise<MoveTask | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as MoveTask) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTask(task: MoveTask): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.put(task);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTask(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function addBox(taskId: string, box: Box): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.boxes.push(box);
  await saveTask(task);
}

export async function updateBox(taskId: string, box: Box): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const idx = task.boxes.findIndex((b) => b.id === box.id);
  if (idx === -1) throw new Error('Box not found');
  task.boxes[idx] = box;
  await saveTask(task);
}

export async function deleteBox(taskId: string, boxId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  task.boxes = task.boxes.filter((b) => b.id !== boxId);
  // 一并清理该箱的理赔单，避免孤儿数据
  if (task.claims) task.claims = task.claims.filter((c) => c.boxId !== boxId);
  await saveTask(task);
}

export function getOpenClaim(task: MoveTask, boxId: string): Claim | null {
  return (task.claims || []).find((c) => c.boxId === boxId && c.status === 'open') || null;
}

export function getBoxClaims(task: MoveTask, boxId: string): Claim[] {
  return (task.claims || []).filter((c) => c.boxId === boxId);
}

export function getClaim(task: MoveTask, claimId: string): Claim | null {
  return (task.claims || []).find((c) => c.id === claimId) || null;
}

// 为破损箱开一张理赔单：只有破损箱能开，且每只箱只允许有一张没结掉的
export async function createClaim(taskId: string, boxId: string): Promise<Claim> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const box = task.boxes.find((b) => b.id === boxId);
  if (!box) throw new Error('Box not found');
  if (box.status !== 'damaged') throw new Error('只有标记为破损的箱子才能开理赔单');
  if (getOpenClaim(task, boxId)) throw new Error('该箱已有一张未结案的理赔单');
  const claim: Claim = {
    id: uid(),
    taskId,
    boxId,
    boxCode: box.code,
    damageLocation: '',
    severity: null,
    estimatedAmount: null,
    assessor: '',
    photos: [],
    description: '',
    status: 'open',
    amountHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  task.claims = [...(task.claims || []), claim];
  await saveTask(task);
  return claim;
}

// 更新未结案理赔单；金额与上一条记录不同时，另存一条金额记录
export async function updateClaim(taskId: string, claim: Claim): Promise<Claim> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const existing = task.claims?.find((c) => c.id === claim.id);
  if (!existing) throw new Error('Claim not found');
  if (existing.status === 'closed') throw new Error('已结案的理赔单不允许修改');

  const next: Claim = {
    ...claim,
    status: 'open',
    closedAt: undefined,
    updatedAt: Date.now(),
  };

  if (
    next.estimatedAmount !== null &&
    (existing.amountHistory.length === 0 ||
      existing.amountHistory[existing.amountHistory.length - 1].amount !== next.estimatedAmount)
  ) {
    next.amountHistory = [
      ...existing.amountHistory,
      {
        amount: next.estimatedAmount,
        changedAt: Date.now(),
        changedBy: next.assessor.trim(),
      },
    ];
  }

  task.claims = task.claims!.map((c) => (c.id === next.id ? next : c));
  await saveTask(task);
  return next;
}

// 结案：四项都填齐才允许结；结掉后不可再改
export async function closeClaim(taskId: string, claimId: string): Promise<Claim> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  const claim = task.claims?.find((c) => c.id === claimId);
  if (!claim) throw new Error('Claim not found');
  if (claim.status === 'closed') throw new Error('该理赔单已经结案');
  const missing = claimMissingFields(claim);
  if (missing.length > 0) throw new Error(`还缺 ${missing.length} 项未填写，无法结案`);
  const next: Claim = { ...claim, status: 'closed', closedAt: Date.now(), updatedAt: Date.now() };
  task.claims = task.claims!.map((c) => (c.id === claimId ? next : c));
  await saveTask(task);
  return next;
}

// 四样必填项检查，返回缺失项的 key
export function claimMissingFields(claim: Pick<Claim, 'damageLocation' | 'severity' | 'estimatedAmount' | 'assessor' | 'photos' | 'description'>): string[] {
  const missing: string[] = [];
  if (!claim.damageLocation.trim() || claim.severity === null) missing.push('damage');
  if (claim.estimatedAmount === null || Number.isNaN(claim.estimatedAmount)) missing.push('amount');
  if (!claim.assessor.trim()) missing.push('assessor');
  if (claim.photos.length === 0 || !claim.description.trim()) missing.push('evidence');
  return missing;
}
