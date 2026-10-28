<script setup lang="ts">
interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

type ContinueResult =
  | {
      type: 'authenticated';
      userId: string;
      isNewUser: boolean;
      sessionId: string;
      tokens: Tokens;
    }
  | { type: 'rejected'; code: string; retryable: boolean }
  | { type: string };

const MESSAGES: Record<string, string> = {
  access_denied: 'Connexion annulée.',
  provider_error: 'Google a refusé la connexion.',
  invalid_callback: 'Réponse de Google invalide.',
  invalid_state: 'La connexion a expiré ou a été altérée. Réessaie.',
  challenge_expired: 'La connexion a expiré. Réessaie.',
  invalid_grant: 'Le code Google est invalide ou déjà utilisé. Réessaie.',
  invalid_id_token: "L'identité renvoyée par Google n'a pas pu être vérifiée.",
  registration_required:
    "Aucun compte n'est lié à ce compte Google. Utilise « Inscription ».",
  identity_already_registered:
    'Ce compte Google a déjà un compte. Utilise « Connexion ».',
  identity_disabled: 'Ce compte est désactivé.',
  account_not_allowed: "Ce compte n'est pas autorisé à se connecter.",
  registration_closed: 'Les inscriptions sont fermées.',
};

const route = useRoute();
const config = useRuntimeConfig();
const auth = useState<{ userId: string; tokens: Tokens } | null>(
  'auth',
  () => null,
);
const error = ref<string | null>(null);

const first = (value: unknown): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

onMounted(async () => {
  const code = first(route.query.code);
  const state = first(route.query.state);
  const providerError = first(route.query.error);

  // Le code est à usage unique : on le retire de l'URL et de l'historique.
  window.history.replaceState({}, '', route.path);

  // `state` = "<transactionId>.<aléa>" (voir GoogleProvider).
  const dot = state?.indexOf('.') ?? -1;
  if (!state || dot <= 0 || (!code && !providerError)) {
    error.value = MESSAGES.invalid_callback!;
    return;
  }

  try {
    const result = await $fetch<ContinueResult>('/api/auth/continue', {
      method: 'POST',
      body: {
        transactionId: state.slice(0, dot),
        input: providerError ? { error: providerError } : { code, state },
      },
    });

    if (result.type === 'authenticated') {
      const { userId, tokens } = result as Extract<
        ContinueResult,
        { type: 'authenticated' }
      >;
      auth.value = { userId, tokens };
      await navigateTo('/', { replace: true });
      return;
    }

    if (result.type === 'rejected') {
      const { code: reason } = result as { code: string };
      error.value = MESSAGES[reason] ?? `Connexion refusée (${reason}).`;
      return;
    }

    error.value = 'Réponse inattendue du serveur.';
  } catch (e) {
    const data = (e as { data?: { code?: string; message?: string } }).data;
    error.value =
      (data?.code && MESSAGES[data.code]) ||
      data?.message ||
      'Impossible de joindre le serveur.';
  }
});
</script>

<template>
  <main class="w-screen h-screen flex items-center justify-center">
    <p v-if="!error">Connexion avec Google en cours…</p>

    <template v-else>
      <UError
        redirect="/auth"
        :clear="{
          color: 'neutral',
          size: 'xl',
          icon: 'i-lucide-arrow-left',
          class: 'rounded-full',
          label: 'Retour à la connexion',
        }"
        :error="{
          statusMessage: 'Error',
          message: error,
        }"
      />
    </template>
  </main>
</template>
