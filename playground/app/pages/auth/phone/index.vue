<script setup lang="ts">
import * as z from 'zod';
import type { FormSubmitEvent } from '@nuxt/ui';
import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

type AuthResult =
  | {
      type: 'challenge';
      transactionId: string;
      publicData: { phoneNumber?: string; codeLength?: number };
    }
  | {
      type: 'authenticated';
      userId: string;
      isNewUser: boolean;
      sessionId: string;
      tokens: Tokens;
    }
  | { type: 'rejected'; code: string; retryable: boolean };

const CLIENT_ID = 'web';
const CODE_LENGTH = 6;

const MESSAGES: Record<string, string> = {
  invalid_phone_number: 'Invalid phone number.',
  invalid_code: 'Incorrect code.',
  challenge_expired: 'The code has expired. Request a new one.',
  too_many_attempts: 'Too many attempts. Request a new code.',
  registration_required: 'No account for this number. Switch to Sign up.',
  identity_already_registered:
    'This number already has an account. Switch to Sign in.',
  identity_disabled: 'This account is disabled.',
  account_not_allowed: 'This account is not allowed to sign in.',
  registration_closed: 'Sign up is currently closed.',
};

const toast = useToast();
const config = useRuntimeConfig();
const auth = useState<{ userId: string; tokens: Tokens } | null>(
  'auth',
  () => null,
);

const step = ref<'phone' | 'code'>('phone');
const purpose = ref('sign_in');
const loading = ref(false);
const transactionId = ref<string | null>(null);
const phoneNumber = ref('');

const phoneSchema = z.object({
  phone: z.string('Phone number is required').refine((value) => {
    const asYouType = new AsYouType();
    asYouType.input(value);

    return asYouType.isValid(); //parsePhoneNumber(value, countryCode.value)?.isValid() === true
  }, 'Enter a valid number in international format, e.g. +221 77 706 30 25'),
  // .transform((value) => parsePhoneNumber(value)?.number ?? value),
});

const codeSchema = z.object({
  code: z
    .array(z.string().regex(/^\d$/, `Enter the ${CODE_LENGTH}-digit code`))
    .length(CODE_LENGTH, `Enter the ${CODE_LENGTH}-digit code`),
});

type PhoneSchema = z.output<typeof phoneSchema>;
type CodeSchema = z.output<typeof codeSchema>;

const phoneState = reactive({ phone: '+221777063025' });
const codeState = reactive<{ code: string[] }>({ code: [] });

const title = computed(() =>
  step.value === 'phone' ? 'Welcome to Authen' : 'Check your messages',
);
const subtitle = computed(() =>
  step.value === 'phone'
    ? 'Enter your phone number to receive a verification code.'
    : `We sent a ${CODE_LENGTH}-digit code to ${
        parsePhoneNumberFromString(phoneNumber.value)?.formatInternational() ??
        phoneNumber.value
      }.`,
);

function notify(title: string) {
  console.log(title);

  toast.add({ title, color: 'error' });
}

function post(path: 'begin' | 'continue', body: object) {
  return $fetch<AuthResult>(`/api/auth/${path}`, {
    method: 'POST',
    body,
  });
}

async function run(task: () => Promise<void>) {
  loading.value = true;
  try {
    await task();
  } catch (e) {
    const data = (
      e as { data?: { code?: string; message?: string | string[] } }
    ).data;

    const message = Array.isArray(data?.message)
      ? data.message.join(' ')
      : data?.message;

    notify(
      (data?.code && MESSAGES[data.code]) ||
        message ||
        'Unable to reach the server.',
    );
  } finally {
    loading.value = false;
  }
}

async function handle(result: AuthResult) {
  switch (result.type) {
    case 'challenge':
      transactionId.value = result.transactionId;
      codeState.code = [];
      step.value = 'code';

      toast.add({
        title: 'Code envoyé',
        description: 'Consultez vos messages pour récupérer le code.',
        color: 'success',
      });

      startResendCooldown();
      break;

    case 'authenticated':
      auth.value = { userId: result.userId, tokens: result.tokens };
      await navigateTo('/', { replace: true });
      break;

    case 'rejected':
      notify(MESSAGES[result.code] ?? `Rejected (${result.code}).`);
      if (!result.retryable) step.value = 'phone';
      break;
  }
}

function sendCode() {
  return run(async () => {
    await handle(
      await post('begin', {
        type: 'phone',
        purpose: purpose.value,
        clientId: CLIENT_ID,
        input: { phoneNumber: phoneNumber.value },
      }),
    );
  });
}

function onPhoneSubmit(event: FormSubmitEvent<PhoneSchema>) {
  phoneNumber.value = event.data.phone;
  return sendCode();
}

function onCodeSubmit(event: FormSubmitEvent<CodeSchema>) {
  return run(async () => {
    await handle(
      await post('continue', {
        transactionId: transactionId.value,
        input: { code: event.data.code.join('') },
      }),
    );
  });
}

let cooldownTimer: ReturnType<typeof setInterval> | undefined;
const resendCooldown = ref(0);

function startResendCooldown(seconds = 60) {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }

  resendCooldown.value = seconds;

  cooldownTimer = setInterval(() => {
    if (resendCooldown.value <= 1) {
      resendCooldown.value = 0;
      clearInterval(cooldownTimer);
      cooldownTimer = undefined;
      return;
    }

    resendCooldown.value -= 1;
  }, 1000);
}

async function resendCode() {
  if (resendCooldown.value > 0 || loading.value) return;

  // Réutilise la même opération d'envoi.
  await onPhoneSubmit({
    data: phoneSchema.parse(phoneState),
  } as FormSubmitEvent<PhoneSchema>);
}

function changePhone() {
  step.value = 'phone';
  transactionId.value = null;
  codeState.code = Array.from({ length: CODE_LENGTH }, () => '');

  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = undefined;
  }

  resendCooldown.value = 0;
}

function goBack() {
  if (step.value === 'code') {
    changePhone();
    return;
  }

  navigateTo({ name: 'auth', replace: true });
}

onBeforeUnmount(() => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }
});
</script>

<template>
  <div
    class="flex flex-col items-center justify-center p-4 bg-accented/20 min-h-screen"
  >
    <section class="w-full max-w-md bg-default">
      <header class="bg-accented/10 px-3 border-b border-default py-1">
        <UButton
          v-if="step === 'code'"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          class="rounded-full"
          aria-label="Retour"
          @click="goBack"
        >
          Modifier le numéro
        </UButton>
        <UButton
          v-else
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          class="rounded-full"
          square
          aria-label="Retour"
          @click="goBack"
        />
      </header>

      <div class="p-8 sm:p-10">
        <div class="mb-8">
          <h1 class="text-xl font-semibold">
            {{
              step === 'phone'
                ? 'Bienvenue sur Authen'
                : 'Vérifiez votre numéro'
            }}
          </h1>

          <p class="mt-2 text-sm text-muted">
            {{
              step === 'phone'
                ? 'Saisissez votre numéro de téléphone pour recevoir un code de vérification.'
                : `Un code de vérification a été demandé pour ${phoneState.phone}.`
            }}
          </p>
        </div>

        <UForm
          v-if="step === 'phone'"
          :schema="phoneSchema"
          :state="phoneState"
          class="space-y-5"
          @submit="onPhoneSubmit"
        >
          <UFormField label="Numéro de téléphone" name="phone" required>
            <Phone
              v-model="phoneState.phone"
              name="phone"
              class="w-full"
              size="xl"
            />
          </UFormField>

          <UButton type="submit" block size="xl" :loading="loading">
            Continuer
          </UButton>
        </UForm>

        <UForm
          v-else
          :schema="codeSchema"
          :state="codeState"
          class="space-y-4"
          @submit="onCodeSubmit"
        >
          <UFormField :ui="{ error: 'text-center' }" name="code" required>
            <div class="flex justify-center">
              <UPinInput
                v-model="codeState.code"
                :length="CODE_LENGTH"
                otp
                type="text"
                placeholder="○"
                size="xl"
                autocomplete="one-time-code"
              >
                <template #separator>
                  <UIcon name="i-lucide-minus" class="size-4 text-muted" />
                </template>
              </UPinInput>
            </div>
          </UFormField>

          <div class="flex justify-center">
            <UButton type="submit" size="xl" :loading="loading">
              Vérifier le code
            </UButton>
          </div>

          <div class="text-center text-sm mt-5">
            <p class="text-muted">Vous n'avez pas reçu le code ?</p>

            <UButton
              variant="link"
              color="primary"
              :disabled="resendCooldown > 0 || loading"
              @click="resendCode"
            >
              {{
                resendCooldown > 0
                  ? `Renvoyer dans ${resendCooldown} s`
                  : 'Renvoyer le code'
              }}
            </UButton>
          </div>
        </UForm>
      </div>
    </section>
  </div>
</template>
