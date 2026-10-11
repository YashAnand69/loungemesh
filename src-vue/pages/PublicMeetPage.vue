<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const eventSlug = String(route.params.event || '');
const roomId = String(route.params.room || '');

const loading = ref(true);
const error = ref<string | null>(null);
const meet = ref<{
  title: string;
  is_full: boolean;
  capacity: number;
  guest_link_enabled: boolean;
} | null>(null);

onMounted(async () => {
  try {
    const res = await fetch(`/api/public/meets/${encodeURIComponent(eventSlug)}/${encodeURIComponent(roomId)}`);
    if (res.ok) {
      meet.value = await res.json();
    } else if (res.status === 404) {
      error.value = 'Lounge session not found or not currently active.';
    } else {
      error.value = 'Could not load session information.';
    }
  } catch (err) {
    error.value = 'Network error while checking session status.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="public-shell">
    <div class="public-card">
      <div v-if="loading" class="spinner-wrap">
        <div class="spinner" />
        <p>Loading session information…</p>
      </div>

      <div v-else-if="error" class="error-view">
        <div class="icon-circle error">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2>Session Unavailable</h2>
        <p class="desc">{{ error }}</p>
      </div>

      <div v-else-if="meet" class="meet-info">
        <div class="icon-circle live">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <span class="badge" :class="{ full: meet.is_full }">
          {{ meet.is_full ? 'At Capacity' : 'Live Lounge' }}
        </span>
        <h1 class="meet-title">{{ meet.title }}</h1>
        <p class="capacity-note">
          Max capacity: <strong>{{ meet.capacity }} participants</strong>
        </p>

        <div class="actions">
          <a
            class="join-btn"
            :href="`https://eventyay.com/e/${encodeURIComponent(eventSlug)}`"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on Eventyay to Join
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.public-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0f0c1b 100%);
  font-family: var(--font-body, system-ui, sans-serif);
  padding: 24px;
  box-sizing: border-box;
}

.public-card {
  width: 100%;
  max-width: 480px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 44px 36px;
  text-align: center;
  color: #fff;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4);
}

.icon-circle {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.icon-circle.live {
  background: rgba(79, 110, 247, 0.15);
  border: 2px solid rgba(79, 110, 247, 0.4);
  color: #4f6ef7;
}

.icon-circle.error {
  background: rgba(239, 68, 68, 0.15);
  border: 2px solid rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

.badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
  margin-bottom: 12px;
}

.badge.full {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.meet-title {
  margin: 0 0 12px;
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.capacity-note {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 28px;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.join-btn {
  display: inline-block;
  padding: 14px 24px;
  border-radius: 12px;
  background: #4f6ef7;
  color: #fff;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.2s;
}

.join-btn:hover {
  background: #3b5bdb;
}

.spinner-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: rgba(255, 255, 255, 0.7);
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #4f6ef7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
