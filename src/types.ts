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

export type DamageDegree = 'minor' | 'moderate' | 'severe';

// 金额每改过一次就另存一条记录（含初始估价）
export type ClaimAmountRecord = {
  amount: number;
  changedAt: number;
  changedBy?: string;
};

// 破损箱理赔单：位置与程度 / 估赔金额 / 定损人 / 现场照片与说明，四样齐了才算填完
export type Claim = {
  id: string;
  taskId: string;
  boxId: string;
  boxCode: string; // 快照，便于列表展示
  damageLocation: string; // 损坏位置
  damageDegree: DamageDegree | ''; // 损坏程度
  estimatedAmount: number | null; // 估赔金额（元）
  assessor: string; // 定损人
  photos: string[]; // 现场照片（压缩后的 dataURL）
  description: string; // 损坏说明
  status: 'open' | 'settled';
  amountHistory: ClaimAmountRecord[];
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
};

// 可编辑的字段（结案后一律不许再改）
export type ClaimInput = Pick<
  Claim,
  'damageLocation' | 'damageDegree' | 'estimatedAmount' | 'assessor' | 'photos' | 'description'
>;

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
