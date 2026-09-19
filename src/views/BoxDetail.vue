<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, updateBox, deleteBox, getBoxClaims, claimMissingFields } from '../db';
import { generateQRDataURL, statusColor, statusLabel, formatDateTime, CLAIM_FIELD_LABELS } from '../utils';
import type { MoveTask, Box, BoxStatus } from '../types';

const route = useRoute();
const router = useRouter();
const task = ref<MoveTask | null>(null);
const box = ref<Box | null>(null);
const qrUrl = ref('');

const statuses: BoxStatus[] = ['packed', 'loaded', 'arrived', 'unpacked', 'damaged', 'missing'];

const claims = computed(() => (task.value && box.value ? getBoxClaims(task.value, box.value.id) : []));
const openClaim = computed(() => claims.value.find((c) => c.status === 'open') || null);
const closedClaims = computed(() => claims.value.filter((c) => c.status === 'closed'));
const openMissing = computed(() => (openClaim.value ? claimMissingFields(openClaim.value) : []));

async function load() {
  const t = await getTask(route.params.id as string);
  task.value = t;
  if (!t) return;
  const b = t.boxes.find((x) => x.code === (route.params.code as string));
  if (!b) return;
  box.value = b;
  qrUrl.value = await generateQRDataURL(t.id, b.code);
}

async function setStatus(s: BoxStatus) {
  if (!box.value || !task.value) return;
  box.value.status = s;
  box.value.updatedAt = Date.now();
  await updateBox(task.value.id, box.value);
}

async function remove() {
  if (!box.value || !task.value) return;
  if (!confirm('确定删除此箱子？')) return;
  await deleteBox(task.value.id, box.value.id);
  router.push(`/task/${task.value.id}`);
}

onMounted(load);
</script>

<template>
  <div v-if="task && box">
    <div class="header">
      <router-link :to="`/task/${task.id}`" class="back">←</router-link>
      <h1>箱子详情 {{ box.code }}</h1>
    </div>
    <div class="page">
      <div class="qr-wrap">
        <img :src="qrUrl" alt="qr" />
        <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;">扫码查看箱内物品</div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span class="status-dot" :style="{background: statusColor(box.status)}"></span>
          <span style="font-weight:700;">{{ statusLabel(box.status) }}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <button v-for="s in statuses" :key="s" class="tag" :class="{active: box.status === s}" @click="setStatus(s)">
            {{ statusLabel(s) }}
          </button>
        </div>
      </div>

      <div class="card">
        <div style="font-size:14px;color:var(--text-secondary);">目标房间</div>
        <div style="font-weight:700;">{{ box.roomTo }}</div>
      </div>
      <div class="card">
        <div style="font-size:14px;color:var(--text-secondary);">标签</div>
        <div>{{ box.tags.join(', ') || '无' }}</div>
      </div>
      <div class="card" v-if="box.fragile || box.liquid">
        <div style="font-size:14px;color:var(--text-secondary);">特殊标记</div>
        <div>{{ box.fragile ? '易碎 ' : '' }}{{ box.liquid ? '液体禁运' : '' }}</div>
      </div>
      <div class="card" v-if="box.weightKg">
        <div style="font-size:14px;color:var(--text-secondary);">重量</div>
        <div>{{ box.weightKg }} kg</div>
      </div>
      <div class="card" v-if="box.photo">
        <img :src="box.photo" style="width:100%;border-radius:10px;" />
      </div>
      <div class="card" v-if="box.note">
        <div style="font-size:14px;color:var(--text-secondary);">备注</div>
        <div>{{ box.note }}</div>
      </div>

      <!-- 破损理赔 -->
      <div v-if="box.status === 'damaged'" class="card" style="border-left:4px solid var(--danger);">
        <div style="font-weight:700;color:var(--danger);margin-bottom:8px;">破损理赔</div>

        <div v-if="openClaim">
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">未结案理赔单</div>
          <div v-if="openMissing.length === 0" style="font-size:14px;color:var(--success);margin-bottom:8px;">
            ✓ 四项已填齐，可以去结案
          </div>
          <div v-else style="font-size:14px;margin-bottom:8px;">
            还缺以下项目：
            <div v-for="key in openMissing" :key="key" style="color:var(--danger);font-weight:600;">· {{ CLAIM_FIELD_LABELS[key] }}</div>
          </div>
          <button class="btn btn-block" @click="router.push(`/task/${task.id}/box/${box.code}/claim/${openClaim.id}`)">
            {{ openMissing.length ? `继续填写理赔单（缺 ${openMissing.length}/4）` : '查看并结案' }}
          </button>
        </div>
        <button v-else class="btn btn-block" @click="router.push(`/task/${task.id}/box/${box.code}/claim`)">
          开一张理赔单
        </button>

        <div v-if="closedClaims.length" style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px;">
          <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">已结案记录（只读）</div>
          <div v-for="c in closedClaims" :key="c.id" style="padding:6px 0;">
            <router-link
              :to="`/task/${task.id}/box/${box.code}/claim/${c.id}`"
              style="display:flex;justify-content:space-between;align-items:center;text-decoration:none;color:inherit;"
            >
              <span style="font-weight:600;">
                ¥{{ c.estimatedAmount === null ? '—' : c.estimatedAmount.toFixed(2) }}
              </span>
              <span style="font-size:12px;color:var(--text-secondary);">
                ✓ 已结案 · {{ c.closedAt ? formatDateTime(c.closedAt) : '' }}
              </span>
            </router-link>
          </div>
        </div>
      </div>

      <button class="btn btn-danger btn-block" @click="remove">删除此箱</button>
    </div>
  </div>
</template>
