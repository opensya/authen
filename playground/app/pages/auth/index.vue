<script setup lang="ts">
import * as z from 'zod';
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui';

const CLIENT_ID = 'web';
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const purpose = ref('sign_in');

const toast = useToast();
const config = useRuntimeConfig();

const fields: AuthFormField[] = [
  {
    name: 'email',
    type: 'email',
    label: 'Email',
    placeholder: 'Enter your email',
    required: true,
  },
  {
    name: 'password',
    label: 'Password',
    type: 'password',
    placeholder: 'Enter your password',
    required: true,
  },
  {
    name: 'remember',
    label: 'Remember me',
    type: 'checkbox',
  },
];

const providers = [
  {
    code: 'phone',
    label: 'Avec numéro téléphone',
    icon: 'i-lucide-phone-log',
    onClick: async () => {
      await navigateTo({ name: 'auth-phone' }, { replace: true });
    },
  },
  {
    code: 'google',
    label: 'Avec Google',
    icon: 'i-logos-google-icon',
    onClick: withGoogle,
  },
  {
    code: 'github',
    label: 'Avec GitHub',
    icon: 'i-simple-icons-github',
    onClick: () => {
      toast.add({ title: 'GitHub', description: 'Login with GitHub' });
    },
  },
];

const schema = z.object({
  email: z.email('Invalid email'),
  password: z
    .string('Password is required')
    .min(8, 'Must be at least 8 characters'),
});

type Schema = z.output<typeof schema>;

function onSubmit(payload: FormSubmitEvent<Schema>) {
  console.log('Submitted', payload);
}

async function withGoogle() {
  const result = await $fetch<{ type: string; url?: string }>(
    '/api/auth/begin',
    {
      method: 'POST',
      body: {
        type: 'google',
        purpose: purpose.value,
        clientId: CLIENT_ID,
        input: {},
      },
    },
  );

  if (result.type === 'redirect' && result.url) {
    await navigateTo(result.url, { external: true });
  }
}
</script>

<template>
  <div
    class="flex flex-col items-center justify-center p-4 bg-accented/20 min-h-screen"
  >
    <div class="w-full max-w-md rounded-none bg-default p-10">
      <div class="mb-8">
        <h1 class="text-lg">Welcome to Authen</h1>
        <p class="text-muted text-sm">
          Lorem ipsum dolor sit amet, consectetur adipisicing elit. Libero nam
        </p>
      </div>

      <div class="flex flex-col gap-3">
        <div v-for="provider in providers" :key="provider.code">
          <UButton
            :icon="provider.icon"
            variant="solid"
            color="neutral"
            class="rounded-4xl justify-center w-full gap-3"
            @click="provider.onClick"
          >
            <span class="font- text-md font-light py-1.5">{{
              provider.label
            }}</span>
          </UButton>
        </div>
      </div>

      <UColorModeButton />
      <!-- <UAuthForm
        :schema="schema"
        title="Login"
        description="Enter your credentials to access your account."
        icon="i-lucide-user"
        :fields="fields"
        :providers="providers"
        @submit="onSubmit"
      /> -->
    </div>
  </div>
</template>
