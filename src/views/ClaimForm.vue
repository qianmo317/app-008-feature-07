<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  getTask,
  createClaim,
  updateClaim,
  closeClaim,
  claimMissingFields,
} from '../db';
import {
  compressImage,
  severityLabel,
  severityColor,
  normalizeAmount,
  formatDateTime,
  CLAIM_FIELD_LABELS,
} from '../utils';
import type { MoveTask, Box, Claim, DamageSeverity } from '../types';

const route = useRoute();
const router = useRouter();

const task = ref<MoveTask | null>(null);
const box = ref<Box | null>(null);
const claim = ref<Claim | null>(null);
const loadError = ref('');
const toast = ref('');

// 表单本地状态
const damageLocation = ref('');
const severity = ref<DamageSeverity | null>(null);
const amountRaw = ref('');
const assessor = ref('');
const photos = ref<string[]>([]);
const description = ref('');

const severities: DamageSeverity[] = ['light', 'medium', 'severe'];
const checklistKeys = ['damage', 'amount', 'assessor', 'evidence'];

const isClosed = computed(() => claim.value?.status === 'closed');

const missingKeys = computed(() =>
  claimMissingFields({
    damageLocation: damageLocation.value,
    severity: severity.value,
    estimatedAmount: normalizeAmount(amountRaw.value),
    assessor: assessor.value,
    photos: photos.value,
    description: description.value,
  }),
);

const completeCount = computed(() => 4 - missingKeys.value.length);
const canClose = computed(() => missingKeys.value.length === 0);

function hydrateForm(c: Claim) {
  damageLocation.value = c.damageLocation;
  severity.value = c.severity;
  amountRaw.value = c.estimatedAmount === null ? '' : String(c.estimatedAmount);
  assessor.value = c.assessor;
  photos.value = [...c.photos];
  description.value = c.description;
}

function showToast(msg: string) {
  toast.value = msg;
  window.setTimeout(() => {
    toast.value = '';
  }, 2000);
}

async function onPhotos(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  for (const file of files) {
    const data = await compressImage(file, 1024, 0.7);
    photos.value.push(data);
  }
  (e.target as HTMLInputElement).value = '';
}

function removePhoto(idx: number) {
  photos.value.splice(idx, 1);
}

async function saveDraft() {
  if (!claim.value || !task.value) return;
  const saved = await updateClaim(task.value.id, {
    ...claim.value,
    damageLocation: damageLocation.value.trim(),
    severity: severity.value,
    estimatedAmount: normalizeAmount(amountRaw.value),
    assessor: assessor.value.trim(),
    photos: photos.value,
    description: description.value.trim(),
  });
  claim.value = saved;
  showToast('草稿已保存');
}

async function saveAndClose() {
  if (!claim.value || !task.value || !canClose.value) return;
  const saved = await updateClaim(task.value.id, {
    ...claim.value,
    damageLocation: damageLocation.value.trim(),
    severity: severity.value,
    estimatedAmount: normalizeAmount(amountRaw.value),
    assessor: assessor.value.trim(),
    photos: photos.value,
    description: description.value.trim(),
  });
  claim.value = await closeClaim(task.value.id, saved.id);
}

onMounted(async () => {
  const t = await getTask(route.params.id as string);
  task.value = t;
  if (!t) {
    loadError.value = '任务不存在';
    return;
  }
  const b = t.boxes.find((x) => x.code === (route.params.code as string));
  if (!b) {
    loadError.value = '箱子不存在';
    return;
  }
  box.value = b;

  const paramClaimId = route.params.claimId as string | undefined;
  let target: Claim | null = null;
  if (paramClaimId) {
    target = (t.claims || []).find((c) => c.id === paramClaimId) || null;
  } else {
    target = (t.claims || []).find((c) => c.boxId === b.id && c.status === 'open') || null;
    if (!target) {
      if (b.status !== 'damaged') {
        loadError.value = '该箱当前不是破损状态，无需开理赔单。';
        return;
      }
      try {
        target = await createClaim(t.id, b.id);
      } catch (err) {
        loadError.value = (err as Error).message;
        return;
      }
    }
  }
  if (!target) {
    loadError.value = '理赔单不存在';
    return;
  }
  claim.value = target;
  hydrateForm(target);
});
</script>

<template>
  <div v-if="task && box">
    <div class="header">
      <router-link :to="`/task/${task.id}/box/${box.code}`" class="back">←</router-link>
      <h1>理赔单 {{ box.code }}</h1>
    </div>
    <div class="page">
      <div v-if="loadError" class="card" style="border-left:4px solid var(--danger);">
        <div style="color:var(--danger);font-weight:600;">{{ loadError }}</div>
        <button class="btn btn-secondary btn-block" style="margin-top:10px;" @click="router.push(`/task/${task.id}/box/${box.code}`)">
          返回箱子详情
        </button>
      </div>

      <template v-else-if="claim">
        <div v-if="isClosed" class="card" style="border-left:4px solid var(--success);">
          <div style="font-weight:700;color:var(--success);">✓ 已结案（只读，不可再修改）</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
            结案时间：{{ claim.closedAt ? formatDateTime(claim.closedAt) : '—' }}
          </div>
        </div>

        <!-- 四项完成情况 -->
        <div class="card">
          <div style="font-weight:700;margin-bottom:8px;">
            必填四项（{{ completeCount }}/4）{{ isClosed ? '' : '，四项齐全才可结案' }}
          </div>
          <div v-for="key in checklistKeys" :key="key" style="display:flex;align-items:center;gap:8px;font-size:14px;padding:3px 0;">
            <span v-if="!missingKeys.includes(key)" style="color:var(--success);font-weight:700;">✓</span>
            <span v-else style="color:var(--danger);font-weight:700;">✗</span>
            <span :style="missingKeys.includes(key) ? 'color:var(--danger);' : ''">{{ CLAIM_FIELD_LABELS[key] }}</span>
          </div>
        </div>

        <!-- 损坏位置与程度 -->
        <div class="card">
          <label class="label">损坏位置 <span style="color:var(--danger);">*</span></label>
          <input v-if="!isClosed" v-model="damageLocation" class="input" placeholder="例如：箱体左下角、顶盖折痕处" />
          <div v-else style="font-weight:600;">{{ claim.damageLocation || '—' }}</div>

          <label class="label" style="margin-top:12px;">损坏程度 <span style="color:var(--danger);">*</span></label>
          <div v-if="!isClosed" style="display:flex;flex-wrap:wrap;gap:8px;">
            <span
              v-for="s in severities"
              :key="s"
              class="tag"
              :class="{ active: severity === s }"
              :style="severity === s ? { background: severityColor(s), borderColor: severityColor(s) } : {}"
              @click="severity = s"
            >
              {{ severityLabel(s) }}
            </span>
          </div>
          <div v-else style="font-weight:600;">
            <span v-if="claim.severity" :style="{ color: severityColor(claim.severity) }">{{ severityLabel(claim.severity) }}</span>
            <span v-else>—</span>
          </div>
        </div>

        <!-- 预估赔偿金额 -->
        <div class="card">
          <label class="label">预估赔偿金额（元） <span style="color:var(--danger);">*</span></label>
          <input
            v-if="!isClosed"
            v-model="amountRaw"
            type="number"
            min="0"
            step="0.01"
            class="input"
            placeholder="例如：200"
            inputmode="decimal"
          />
          <div v-else style="font-weight:700;font-size:18px;">
            ¥ {{ claim.estimatedAmount === null ? '—' : claim.estimatedAmount.toFixed(2) }}
          </div>

          <div v-if="claim.amountHistory.length > 0" style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px;">
            <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">金额改动记录</div>
            <div v-for="(entry, i) in claim.amountHistory" :key="i" style="font-size:13px;color:var(--text-secondary);padding:2px 0;">
              ¥{{ entry.amount.toFixed(2) }} · {{ entry.changedBy || '未具名' }} · {{ formatDateTime(entry.changedAt) }}
            </div>
          </div>
        </div>

        <!-- 定损人 -->
        <div class="card">
          <label class="label">定损人 <span style="color:var(--danger);">*</span></label>
          <input v-if="!isClosed" v-model="assessor" class="input" placeholder="现场定损人员姓名" />
          <div v-else style="font-weight:600;">{{ claim.assessor || '—' }}</div>
        </div>

        <!-- 现场照片与说明 -->
        <div class="card">
          <label class="label">现场照片 <span style="color:var(--danger);">*</span></label>
          <div v-if="photos.length" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <div v-for="(p, i) in photos" :key="i" style="position:relative;">
              <img :src="p" style="width:100%;height:110px;object-fit:cover;border-radius:8px;" />
              <button
                v-if="!isClosed"
                type="button"
                @click="removePhoto(i)"
                style="position:absolute;top:4px;right:4px;border:none;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;width:24px;height:24px;cursor:pointer;font-size:13px;line-height:1;"
              >×</button>
            </div>
          </div>
          <input
            v-if="!isClosed"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            class="input"
            style="padding:8px;"
            @change="onPhotos"
          />

          <label class="label" style="margin-top:12px;">损坏说明 <span style="color:var(--danger);">*</span></label>
          <textarea
            v-if="!isClosed"
            v-model="description"
            class="textarea"
            rows="3"
            placeholder="描述现场情况：怎么发现的、坏成什么样、箱内物品是否受损等"
          ></textarea>
          <div v-else style="white-space:pre-wrap;">{{ claim.description || '—' }}</div>
        </div>

        <div v-if="!isClosed" class="card" style="font-size:12px;color:var(--text-secondary);">
          开单时间：{{ formatDateTime(claim.createdAt) }} · 最近更新：{{ formatDateTime(claim.updatedAt) }}
        </div>

        <template v-if="!isClosed">
          <button class="btn btn-secondary btn-block" style="margin-bottom:10px;" @click="saveDraft">保存草稿</button>
          <button class="btn btn-success btn-block" :disabled="!canClose" :style="!canClose ? 'opacity:0.5;' : ''" @click="saveAndClose">
            {{ canClose ? '保存并结案' : `还差 ${missingKeys.length} 项，暂不能结案` }}
          </button>
        </template>
      </template>
    </div>

    <div v-if="toast" style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;z-index:50;">
      {{ toast }}
    </div>
  </div>
</template>
