import type { MoveTask, Box, Claim, ClaimInput } from './types';
import { uid, claimMissingItems } from './utils';

const DB_NAME = 'MovingBoxTracker';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';

// 旧数据里没有 claims 字段，读取时补齐
function normalizeTask(task: MoveTask): MoveTask {
  if (!task.claims) task.claims = [];
  return task;
}

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
    req.onsuccess = () => resolve((req.result as MoveTask[]).map(normalizeTask));
    req.onerror = () => reject(req.error);
  });
}

export async function getTask(id: string): Promise<MoveTask | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readonly');
    const store = tx.objectStore(STORE_TASKS);
    const req = store.get(id);
    req.onsuccess = () => {
      const task = req.result as MoveTask | undefined;
      if (!task) {
        resolve(null);
        return;
      }
      const normalized = normalizeTask(task);
      // 首次读到旧任务时补存一次，避免其它视图拿到缺字段的对象
      if (!task.claims) {
        saveTask(normalized).catch(() => undefined);
      }
      resolve(normalized);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveTask(task: MoveTask): Promise<void> {
  normalizeTask(task);
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
  await saveTask(task);
}

// ---------- 理赔单 ----------

// 每只箱只允许有一张没结掉的理赔单
export function getOpenClaim(task: MoveTask, boxId: string): Claim | undefined {
  return task.claims!.find((c) => c.boxId === boxId && c.status === 'open');
}

export function getBoxClaims(task: MoveTask, boxId: string): Claim[] {
  return task.claims!.filter((c) => c.boxId === boxId);
}

export async function createClaim(taskId: string, boxId: string, input: ClaimInput): Promise<Claim> {
  const task = await getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const box = task.boxes.find((b) => b.id === boxId);
  if (!box) throw new Error('箱子不存在');
  if (getOpenClaim(task, boxId)) {
    throw new Error('该箱已有一张未结案的理赔单，每只箱只允许一张');
  }

  const now = Date.now();
  const claim: Claim = {
    id: uid(),
    taskId,
    boxId,
    boxCode: box.code,
    damageLocation: input.damageLocation.trim(),
    damageDegree: input.damageDegree,
    estimatedAmount: input.estimatedAmount,
    assessor: input.assessor.trim(),
    photos: [...input.photos],
    description: input.description.trim(),
    status: 'open',
    amountHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  // 初始估价也算一条金额记录
  if (claim.estimatedAmount !== null) {
    claim.amountHistory.push({ amount: claim.estimatedAmount, changedAt: now, changedBy: claim.assessor || undefined });
  }

  task.claims!.push(claim);
  await saveTask(task);
  return claim;
}

// 已结掉的单子不许再改；金额与上次不同就另存一条记录
export async function updateClaim(taskId: string, claimId: string, input: ClaimInput): Promise<Claim> {
  const task = await getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const claim = task.claims!.find((c) => c.id === claimId);
  if (!claim) throw new Error('理赔单不存在');
  if (claim.status === 'settled') throw new Error('理赔单已结案，不允许修改');

  claim.damageLocation = input.damageLocation.trim();
  claim.damageDegree = input.damageDegree;
  claim.assessor = input.assessor.trim();
  claim.photos = [...input.photos];
  claim.description = input.description.trim();

  const prevAmount = claim.estimatedAmount;
  claim.estimatedAmount = input.estimatedAmount;
  if (input.estimatedAmount !== null && input.estimatedAmount !== prevAmount) {
    claim.amountHistory.push({
      amount: input.estimatedAmount,
      changedAt: Date.now(),
      changedBy: claim.assessor || undefined,
    });
  }
  claim.updatedAt = Date.now();

  await saveTask(task);
  return claim;
}

// 四样都填上之后才允许结案
export async function settleClaim(taskId: string, claimId: string): Promise<Claim> {
  const task = await getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const claim = task.claims!.find((c) => c.id === claimId);
  if (!claim) throw new Error('理赔单不存在');
  if (claim.status === 'settled') throw new Error('理赔单已结案，不允许修改');
  if (claimMissingItems(claim).length > 0) {
    throw new Error('四样资料未填齐，不能结案');
  }

  claim.status = 'settled';
  claim.settledAt = Date.now();
  claim.updatedAt = claim.settledAt;
  await saveTask(task);
  return claim;
}
