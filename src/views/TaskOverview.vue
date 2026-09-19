<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask, getBoxClaims, claimMissingFields } from '../db';
import { estimateVehicle, roomProgress, statusColor, statusLabel, CLAIM_FIELD_LABELS } from '../utils';
import type { MoveTask } from '../types';

const route = useRoute();
const router = useRouter();
const task = ref<MoveTask | null>(null);

const stats = computed(() => {
  if (!task.value) return { total: 0, loaded: 0, unpacked: 0, damaged: 0 };
  const boxes = task.value.boxes;
  return {
    total: boxes.length,
    loaded: boxes.filter((b) => b.status === 'loaded').length,
    unpacked: boxes.filter((b) => b.status === 'unpacked').length,
    damaged: boxes.filter((b) => b.status === 'damaged').length,
  };
});

// 破损箱的理赔跟进：点名每只箱缺四样中的哪几样
const claimTracking = computed(() => {
  if (!task.value) return { pending: [] as { boxCode: string; claimId: string | null; missing: string[] }[], closedCount: 0 };
  const pending: { boxCode: string; claimId: string | null; missing: string[] }[] = [];
  let closedCount = 0;
  for (const b of task.value.boxes.filter((x) => x.status === 'damaged')) {
    const claims = getBoxClaims(task.value, b.id);
    const open = claims.find((c) => c.status === 'open');
    if (open) {
      const missing = claimMissingFields(open);
      if (missing.length > 0) pending.push({ boxCode: b.code, claimId: open.id, missing });
      else pending.push({ boxCode: b.code, claimId: open.id, missing: [] });
    } else if (claims.some((c) => c.status === 'closed')) {
      closedCount++;
    } else {
      pending.push({ boxCode: b.code, claimId: null, missing: ['damage', 'amount', 'assessor', 'evidence'] });
    }
  }
  return { pending, closedCount };
});

const vehicle = computed(() => {
  if (!task.value || task.value.boxes.length === 0) return null;
  return estimateVehicle(task.value.boxes.length);
});

const roomStats = computed(() => {
  if (!task.value) return [];
  return task.value.rooms.map((r) => ({ room: r, ...roomProgress(task.value!, r) }));
});

async function load() {
  task.value = await getTask(route.params.id as string);
}

function openClaim(row: { boxCode: string; claimId: string | null }) {
  if (!task.value) return;
  const base = `/task/${task.value.id}/box/${row.boxCode}/claim`;
  router.push(row.claimId ? `${base}/${row.claimId}` : base);
}

onMounted(load);
</script>

<template>
  <div v-if="task">
    <div class="header">
      <router-link to="/" class="back">←</router-link>
      <h1>{{ task.title }}</h1>
    </div>
    <div class="page">
      <div class="grid-2">
        <div class="card" style="text-align:center;">
          <div style="font-size:28px;font-weight:800;">{{ stats.total }}</div>
          <div style="font-size:12px;color:var(--text-secondary);">总箱数</div>
        </div>
        <div class="card" style="text-align:center;">
          <div style="font-size:28px;font-weight:800;color:var(--info);">{{ stats.loaded }}</div>
          <div style="font-size:12px;color:var(--text-secondary);">已装车</div>
        </div>
        <div class="card" style="text-align:center;">
          <div style="font-size:28px;font-weight:800;color:var(--success);">{{ stats.unpacked }}</div>
          <div style="font-size:12px;color:var(--text-secondary);">已拆箱</div>
        </div>
        <div class="card" style="text-align:center;">
          <div style="font-size:28px;font-weight:800;color:var(--danger);">{{ stats.damaged }}</div>
          <div style="font-size:12px;color:var(--text-secondary);">破损</div>
        </div>
      </div>

      <div v-if="claimTracking.pending.length" class="card" style="border-left:4px solid var(--danger);">
        <div style="font-weight:700;color:var(--danger);margin-bottom:4px;">
          理赔跟进（{{ claimTracking.pending.length }} 箱未结案<template v-if="claimTracking.closedCount"> · {{ claimTracking.closedCount }} 箱已结案</template>）
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">必填四项：损坏位置与程度 / 预估赔偿金额 / 定损人 / 现场照片与说明</div>
        <div
          v-for="row in claimTracking.pending"
          :key="row.boxCode"
          class="card"
          style="margin-bottom:8px;cursor:pointer;"
          @click="openClaim(row)"
        >
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:700;">{{ row.boxCode }}</span>
            <span v-if="row.missing.length === 0" style="font-size:12px;color:var(--success);font-weight:600;">✓ 四项齐全，待结案 ›</span>
            <span v-else style="font-size:12px;color:var(--danger);font-weight:600;">去填写 ›</span>
          </div>
          <div v-if="row.claimId === null" style="font-size:13px;color:var(--danger);margin-top:4px;">
            还没有理赔单，四项均未填
          </div>
          <div v-else-if="row.missing.length" style="font-size:13px;color:var(--danger);margin-top:4px;">
            缺：<strong>{{ row.missing.map((k) => CLAIM_FIELD_LABELS[k]).join('、') }}</strong>
          </div>
        </div>
      </div>

      <div v-else-if="stats.damaged > 0" class="card" style="border-left:4px solid var(--success);">
        <div style="font-weight:700;color:var(--success);">理赔跟进：{{ claimTracking.closedCount }} 只破损箱的理赔单均已结案</div>
      </div>

      <div v-if="vehicle" class="card">
        <div style="font-weight:700;">车型建议</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-top:4px;">
          {{ vehicle.vehicle }} · {{ vehicle.suggestion }}
        </div>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:8px;">拆箱进度</div>
        <div v-for="rs in roomStats" :key="rs.room" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:14px;">
            <span>{{ rs.room }}</span>
            <span>{{ rs.unpacked }}/{{ rs.total }}</span>
          </div>
          <div style="height:8px;background:var(--border);border-radius:999px;overflow:hidden;margin-top:4px;">
            <div :style="{width: rs.total ? `${(rs.unpacked/rs.total)*100}%` : '0%', height:'100%', background:'var(--success)', borderRadius:'999px'}"></div>
          </div>
        </div>
      </div>

      <div class="toolbar no-print">
        <button class="btn" @click="router.push(`/task/${task.id}/register`)">封箱登记</button>
        <button class="btn" @click="router.push(`/task/${task.id}/scan`)">扫码查箱</button>
        <button class="btn" @click="router.push(`/task/${task.id}/check`)">卸货核对</button>
        <button class="btn" @click="router.push(`/task/${task.id}/labels`)">标签打印</button>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:8px;">最近封箱</div>
        <div v-if="task.boxes.length === 0" class="empty" style="padding:12px 0;">还没有箱子，去封箱登记吧</div>
        <div v-for="b in [...task.boxes].reverse().slice(0,10)" :key="b.id" class="card" @click="router.push(`/task/${task.id}/box/${b.code}`)" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <span class="status-dot" :style="{background: statusColor(b.status)}"></span>
          <div style="flex:1;">
            <div style="font-weight:700;">{{ b.code }}</div>
            <div style="font-size:12px;color:var(--text-secondary);">{{ b.roomTo }} · {{ b.tags.join(', ') || '无标签' }}</div>
          </div>
          <span style="font-size:12px;color:var(--text-secondary);">{{ statusLabel(b.status) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
