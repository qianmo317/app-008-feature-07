export type BoxStatus = 'packed' | 'loaded' | 'arrived' | 'unpacked' | 'damaged' | 'missing';

export type Box = {
  id: string;
  code: string; // e.g. A-014
  roomFrom: string;
  roomTo: string;
  tags: string[];
  fragile: boolean;
  liquid: boolean;
  photo?: string; // compressed dataURL
  weightKg?: number;
  status: BoxStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export type DamageSeverity = 'light' | 'medium' | 'severe';

export type ClaimStatus = 'open' | 'closed';

// 金额每改过一次，另存一条记录
export type ClaimAmountEntry = {
  amount: number;
  changedAt: number;
  changedBy: string; // 改动时填写的定损人
};

// 破损箱理赔单：四样必填——损坏位置与程度 / 预估赔偿金额 / 定损人 / 现场照片与说明
export type Claim = {
  id: string;
  taskId: string;
  boxId: string;
  boxCode: string;
  damageLocation: string; // 损坏位置
  severity: DamageSeverity | null; // 损坏程度
  estimatedAmount: number | null; // 预估赔偿金额（元）
  assessor: string; // 定损人
  photos: string[]; // 现场照片（压缩后的 dataURL）
  description: string; // 损坏说明
  status: ClaimStatus;
  amountHistory: ClaimAmountEntry[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
};

export type MoveTask = {
  id: string;
  title: string;
  from: string;
  to: string;
  date: string;
  rooms: string[];
  boxes: Box[];
  claims?: Claim[];
  createdAt: number;
};
