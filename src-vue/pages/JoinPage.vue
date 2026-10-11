<script setup lang="ts">
/**
 * Eventyay entry point: /join/:id?token=...&event=...&room=...
 * Exchanges opaque token for Jitsi JWT, then redirects to /session/:id.
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAccessGuard } from '@/composables/useAccessGuard';
import { useConferenceStore } from '@/stores/conferenceStore';
import { formatSphereName } from '@/utils/formatSphereName';
import AccessDeniedPage from '@/pages/AccessDeniedPage.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const { state, check } = useAccessGuard();
const deniedReason = ref<string | undefined>(undefined);
const pinInput = ref('');
const pinError = ref('');
const isSubmittingPin = ref(false);

async function attemptJoin(pin?: string) {
  isSubmittingPin.value = true;
  pinError.value = '';
  const result = pin !== undefined ? await check(props.id, pin) : await check(props.id);
  isSubmittingPin.value = false;
  if (result.status === 'granted') {
    if (result.displayName?.trim()) {
      useConferenceStore().setDisplayName(formatSphereName(result.displayName));
    }
    await router.replace({ name: 'session', params: { id: props.id } });
  } else if (result.status === 'denied') {
    deniedReason.value = result.reason;
    if (result.reason === 'invalid_pin') {
      pinError.value = 'Incorrect meeting PIN. Please check and try again.';
    }
  }
}

onMounted(() => {
  attemptJoin();
});
</script>

<template>
  <template v-if="state.status === 'loading' || state.status === 'idle'">
    <div class="join-loading">
      <div class="join-spinner" aria-label="Verifying access…" />
      <p>Verifying access…</p>
    </div>
  </template>
  <template v-else-if="deniedReason === 'pin_required' || deniedReason === 'invalid_pin'">
    <div class="pin-entry-shell">
      <div class="pin-card">
        <div class="pin-icon-circle">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 class="pin-title">Meeting PIN Required</h2>
        <p class="pin-desc">This meeting requires a security PIN to join. Enter the PIN provided by the organizer.</p>
        <form @submit.prevent="attemptJoin(pinInput)" class="pin-form">
          <input
            v-model="pinInput"
            type="password"
            maxlength="32"
            placeholder="Enter Meeting PIN"
            class="pin-input"
            autofocus
            :disabled="isSubmittingPin"
          />
          <p v-if="pinError" class="pin-error">{{ pinError }}</p>
          <button type="submit" class="btn-join-meeting" :disabled="!pinInput.trim() || isSubmittingPin">
            {{ isSubmittingPin ? 'Verifying PIN…' : 'Enter Meeting' }}
          </button>
        </form>
      </div>
    </div>
  </template>
  <template v-else-if="state.status === 'denied'">
    <AccessDeniedPage :reason="deniedReason" />
  </template>
</template>

<style scoped>
.join-loading {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background: var(--color-bg-page, #eef1ff);
  color: #4b5563;
  font-size: 0.95rem;
}
.join-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #d1d5fa;
  border-top-color: #4f6ef7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.pin-entry-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0f0c1b 100%);
  font-family: var(--font-body, system-ui, sans-serif);
  padding: 24px;
  box-sizing: border-box;
}

.pin-card {
  width: 100%;
  max-width: 420px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 24px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 40px 32px;
  text-align: center;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
}

.pin-icon-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.15);
  border: 2px solid rgba(99, 102, 241, 0.4);
  color: #818cf8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.pin-title {
  color: #ffffff;
  font-size: 1.4rem;
  font-weight: 700;
  margin: 0 0 8px;
}

.pin-desc {
  color: #94a3b8;
  font-size: 0.9rem;
  line-height: 1.4;
  margin: 0 0 24px;
}

.pin-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pin-input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 16px;
  font-size: 1.1rem;
  letter-spacing: 2px;
  text-align: center;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.pin-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.3);
}

.pin-error {
  color: #f87171;
  font-size: 0.85rem;
  margin: 0;
}

.btn-join-meeting {
  padding: 12px 20px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  color: #ffffff;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
}

.btn-join-meeting:hover:not(:disabled) {
  opacity: 0.92;
  transform: translateY(-1px);
}

.btn-join-meeting:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
