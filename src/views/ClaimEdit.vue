<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, updateBox, createClaim, updateClaim, settleClaim } from '../db';
import { compressImage, damageDegreeLabel, claimMissingItems, CLAIM_REQUIRED_ITEMS, formatDateTime } from '../utils';
import type { MoveTask, Box, Claim, DamageDegree, ClaimInput } from '../types';

const route = useRoute();
const router = useRouter();

const task = ref<MoveTask | null>(null);
const box = ref<Box | null>(null);
const claim = ref<Claim | null>(null);
const isNew = ref(false);
const loadError = ref('');

const damageLocation = ref('');
const damageDegree = ref<DamageDegree | ''>('');
const amount = ref<number | null>(null);
const assessor = ref('');
const photos = ref<string[]>([]);
const description = ref('');
const saving = ref(false);

const degreeOptions: DamageDegree[] = ['minor', 'moderate', 'severe'];

const readonly = computed(() => !!claim.value && claim.value.status === 'settled');

const backHref = computed(() => {
  const t = task.value;
  if (!t) return '/';
  const code = box.value?.code || claim.value?.boxCode;
  return code ? `/task/${t.id}/box/${code}` : `/task/${t.id}`;
});

function normalizeAmount(v: number | string | null): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const formShape = computed<ClaimInput>(() => ({
  damageLocation: damageLocation.value,
  damageDegree: damageDegree.value,
  estimatedAmount: normalizeAmount(amount.value),
  assessor: assessor.value,
  photos: photos.value,
  description: description.value,
}));

const missingKeys = computed(() => (claim.value && readonly.value ? [] : claimMissingItems(formShape.value)));
const complete = computed(() => missingKeys.value.length === 0);

function fillForm(c: Claim) {
  damageLocation.value = c.damageLocation;
  damageDegree.value = c.damageDegree;
  amount.value = c.estimatedAmount;
  assessor.value = c.assessor;
  photos.value = [...c.photos];
  description.value = c.description;
}

async function load() {
  const t = await getTask(route.params.id as string);
  task.value = t;
  if (!t) {
    loadError.value = '任务不存在';
    return;
  }
  isNew.value = route.name === 'ClaimNew';
  if (isNew.value) {
    const b = t.boxes.find((x) => x.id === (route.params.boxId as string));
    if (!b) {
      loadError.value = '箱子不存在';
      return;
    }
    box.value = b;
    if (t.claims!.some((c) => c.boxId === b.id && c.status === 'open')) {
      loadError.value = '该箱已有一张未结案的理赔单，每只箱只允许一张';
    }
  } else {
    const c = t.claims!.find((x) => x.id === (route.params.claimId as string));
    if (!c) {
      loadError.value = '理赔单不存在';
      return;
    }
    claim.value = c;
    box.value = t.boxes.find((x) => x.id === c.boxId) ?? null;
    fillForm(c);
  }
}

async function onPhotos(e: Event) {
  if (readonly.value) return;
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  for (const f of files) {
    photos.value.push(await compressImage(f));
  }
  (e.target as HTMLInputElement).value = '';
}

function removePhoto(index: number) {
  if (readonly.value) return;
  photos.value.splice(index, 1);
}

async function persist() {
  if (!task.value || saving.value) return;
  if (isNew.value && !box.value) return;
  if (!isNew.value && !claim.value) return;

  saving.value = true;
  try {
    if (isNew.value) {
      // 开理赔单的箱子按破损处理
      const b = box.value!;
      if (b.status !== 'damaged') {
        b.status = 'damaged';
        b.updatedAt = Date.now();
        await updateBox(task.value.id, b);
      }
      const created = await createClaim(task.value.id, b.id, formShape.value);
      claim.value = created;
      isNew.value = false;
      router.replace(`/task/${task.value.id}/claim/${created.id}`);
    } else {
      claim.value = await updateClaim(task.value.id, claim.value!.id, formShape.value);
    }
    alert('理赔单已保存');
  } catch (err) {
    alert(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function settle() {
  if (!task.value || !claim.value || !complete.value) return;
  if (!confirm('结案后理赔单将锁定，不能再修改。确定结案？')) return;
  try {
    claim.value = await settleClaim(task.value.id, claim.value.id);
    fillForm(claim.value);
    alert('理赔单已结案');
  } catch (err) {
    alert(err instanceof Error ? err.message : '结案失败');
  }
}

onMounted(load);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link :to="backHref" class="back">←</router-link>
      <h1>破损理赔单 <span v-if="box || claim">· {{ box ? box.code : claim?.boxCode }}</span></h1>
    </div>

    <div class="page">
      <div v-if="loadError" class="card" style="border-left:4px solid var(--danger);">
        <div style="color:var(--danger);font-weight:700;">{{ loadError }}</div>
        <button class="btn btn-secondary btn-block" style="margin-top:10px;" @click="router.push(`/task/${task.id}`)">
          返回任务概览
        </button>
      </div>

      <template v-else-if="claim || (isNew && box)">
        <!-- 状态与四样检查 -->
        <div
          class="card"
          :style="{ borderLeft: `4px solid ${readonly ? 'var(--text-secondary)' : complete ? 'var(--success)' : 'var(--warning)'}` }"
        >
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:700;font-size:16px;">
              {{ readonly ? '已结案' : complete ? '资料已填齐，可以结案' : '资料未填齐' }}
            </span>
            <span v-if="claim" style="font-size:12px;color:var(--text-secondary);">
              {{ readonly && claim.settledAt ? `结案于 ${formatDateTime(claim.settledAt)}` : `开单于 ${formatDateTime(claim.createdAt)}` }}
            </span>
          </div>
          <div v-if="!readonly" style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
            <div v-for="item in CLAIM_REQUIRED_ITEMS" :key="item.key" style="display:flex;align-items:center;gap:8px;font-size:14px;">
              <span>{{ missingKeys.includes(item.key) ? '⭕' : '✅' }}</span>
              <span :style="{ color: missingKeys.includes(item.key) ? 'var(--danger)' : 'inherit' }">
                {{ item.label }}{{ missingKeys.includes(item.key) ? '（缺）' : '' }}
              </span>
            </div>
          </div>
        </div>

        <!-- 损坏位置 -->
        <div class="card">
          <label class="label">损坏位置 <span style="color:var(--danger);">*</span></label>
          <input
            v-model="damageLocation"
            class="input"
            placeholder="例如：箱体右下角、顶部边角、左侧箱板"
            :disabled="readonly"
          />
        </div>

        <!-- 损坏程度 -->
        <div class="card">
          <label class="label">损坏程度 <span style="color:var(--danger);">*</span></label>
          <select v-model="damageDegree" class="select" :disabled="readonly">
            <option value="">请选择损坏程度</option>
            <option v-for="d in degreeOptions" :key="d" :value="d">{{ damageDegreeLabel(d) }}</option>
          </select>
        </div>

        <!-- 估赔金额 -->
        <div class="card">
          <label class="label">估赔金额（元） <span style="color:var(--danger);">*</span></label>
          <input
            v-model.number="amount"
            type="number"
            min="0"
            step="0.01"
            class="input"
            placeholder="例如：300"
            :disabled="readonly"
          />
          <div v-if="claim && claim.amountHistory.length > 0" style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
            <div style="font-size:13px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">金额变更记录</div>
            <div v-for="(rec, i) in claim.amountHistory" :key="rec.changedAt" style="font-size:13px;color:var(--text-secondary);padding:3px 0;">
              <span>{{ i === 0 ? '初始估价' : `第 ${i + 1} 次调整` }}</span>
              <template v-if="i > 0">
                ：¥{{ claim.amountHistory[i - 1].amount.toFixed(2) }} →
              </template>
              <span style="color:var(--text);font-weight:700;"> ¥{{ rec.amount.toFixed(2) }}</span>
              <span v-if="rec.changedBy"> · {{ rec.changedBy }}</span>
              · {{ formatDateTime(rec.changedAt) }}
            </div>
          </div>
        </div>

        <!-- 定损人 -->
        <div class="card">
          <label class="label">定损人 <span style="color:var(--danger);">*</span></label>
          <input
            v-model="assessor"
            class="input"
            placeholder="现场定损的工作人员姓名"
            :disabled="readonly"
          />
        </div>

        <!-- 现场照片 -->
        <div class="card">
          <label class="label">现场照片 <span style="color:var(--danger);">*</span> <span style="font-weight:400;">（至少一张，可多选）</span></label>
          <input
            v-if="!readonly"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            class="input"
            style="padding:8px;"
            @change="onPhotos"
          />
          <div v-if="photos.length" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
            <div v-for="(p, i) in photos" :key="i" style="position:relative;">
              <img :src="p" style="width:100%;border-radius:8px;display:block;" />
              <button
                v-if="!readonly"
                class="btn btn-danger"
                style="position:absolute;top:4px;right:4px;padding:2px 8px;font-size:12px;"
                @click="removePhoto(i)"
              >删</button>
            </div>
          </div>
          <div v-else style="font-size:13px;color:var(--text-secondary);margin-top:6px;">还没有现场照片</div>
        </div>

        <!-- 损坏说明 -->
        <div class="card">
          <label class="label">损坏说明 <span style="color:var(--danger);">*</span></label>
          <textarea
            v-model="description"
            class="textarea"
            rows="4"
            placeholder="描述坏成什么样、可能的成因、箱内物品是否受影响等"
            :disabled="readonly"
          ></textarea>
        </div>

        <div v-if="!readonly" class="toolbar" style="grid-template-columns:1fr 1fr;">
          <button class="btn btn-secondary" :disabled="saving" @click="persist">
            {{ saving ? '保存中…' : '保存（资料可后补）' }}
          </button>
          <button class="btn btn-success" :disabled="!complete || saving" @click="settle">
            {{ complete ? '结案（锁定）' : '四样填齐后可结案' }}
          </button>
        </div>
        <div v-else class="card" style="text-align:center;color:var(--text-secondary);font-size:14px;">
          该理赔单已结案，内容锁定不可修改
        </div>
      </template>
    </div>
  </div>
</template>
