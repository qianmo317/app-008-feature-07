<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getTask } from '../db';
import { estimateVehicle, roomProgress, statusColor, statusLabel, claimMissingLabels } from '../utils';
import type { MoveTask, Claim } from '../types';

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

const vehicle = computed(() => {
  if (!task.value || task.value.boxes.length === 0) return null;
  return estimateVehicle(task.value.boxes.length);
});

const roomStats = computed(() => {
  if (!task.value) return [];
  return task.value.rooms.map((r) => ({ room: r, ...roomProgress(task.value!, r) }));
});

// 理赔跟进：破损箱没开单 / 理赔单四样缺项，都在这里点名
const claimFollowup = computed(() => {
  if (!task.value) return [] as { claim: Claim | null; boxCode: string; missing: string[]; key: string }[];
  const items: { claim: Claim | null; boxCode: string; missing: string[]; key: string }[] = [];
  const seenKeys = new Set<string>();

  // 破损箱：没开单要点名；开了单缺项也要点名
  for (const b of task.value.boxes) {
    if (b.status !== 'damaged') continue;
    const open = task.value.claims!.find((c) => c.boxId === b.id && c.status === 'open');
    if (!open) {
      items.push({ claim: null, boxCode: b.code, missing: ['未开理赔单'], key: b.id });
      seenKeys.add(b.id);
    } else if (claimMissingLabels(open).length > 0) {
      items.push({ claim: open, boxCode: b.code, missing: claimMissingLabels(open), key: open.id });
      seenKeys.add(open.id);
    }
  }

  // 箱子状态被改走但理赔单还没结，同样点名（按箱号快照展示）
  for (const c of task.value.claims!) {
    if (c.status === 'open' && !seenKeys.has(c.id)) {
      const missing = claimMissingLabels(c);
      if (missing.length > 0) {
        items.push({ claim: c, boxCode: c.boxCode, missing, key: c.id });
      }
    }
  }
  return items;
});

const settledClaims = computed(() =>
  (task.value?.claims ?? [])
    .filter((c) => c.status === 'settled')
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0)),
);

async function load() {
  task.value = await getTask(route.params.id as string);
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

      <div v-if="claimFollowup.length" class="card no-print" style="border-left:4px solid var(--danger);">
        <div style="font-weight:700;color:var(--danger);margin-bottom:8px;">
          破损理赔待跟进（{{ claimFollowup.length }}）
        </div>
        <div
          v-for="item in claimFollowup"
          :key="item.key"
          class="card"
          style="background:var(--bg);margin-bottom:8px;cursor:pointer;"
          @click="item.claim
            ? router.push(`/task/${task.id}/claim/${item.claim.id}`)
            : router.push(`/task/${task.id}/box/${item.boxCode}`)"
        >
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:700;">{{ item.boxCode }}</span>
            <span style="font-size:12px;color:var(--danger);">待处理</span>
          </div>
          <div style="font-size:13px;color:var(--danger);margin-top:6px;">缺：{{ item.missing.join('、') }}</div>
        </div>
      </div>

      <div v-if="settledClaims.length" class="card no-print">
        <div style="font-weight:700;margin-bottom:8px;">已结理赔（{{ settledClaims.length }}）</div>
        <div
          v-for="c in settledClaims"
          :key="c.id"
          style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;cursor:pointer;"
          @click="router.push(`/task/${task.id}/claim/${c.id}`)"
        >
          <span>{{ c.boxCode }} · {{ c.assessor }}</span>
          <span style="font-weight:700;">¥{{ (c.estimatedAmount ?? 0).toFixed(2) }}</span>
        </div>
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
