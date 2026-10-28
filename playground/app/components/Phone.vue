<script setup lang="ts">
import { vMaska } from "maska/vue";
import {
  AsYouType,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

type PhoneCode = {
  name: string;
  code: string;
  emoji: string;
  dialCode: string;
  mask: string;
};

const phone = defineModel<string>({});

// Initialisation depuis la valeur existante
const parsed = phone.value
  ? parsePhoneNumberFromString(phone.value)
  : undefined;

const countryCode = ref<CountryCode>(parsed?.country ?? "SN");
const _phone = ref(parsed?.nationalNumber ?? "");

const {
  data: phoneCodes,
  status,
  execute,
} = await useLazyFetch<PhoneCode[]>("/api/phone-code", {
  key: "api-phone-codes",
  immediate: false,
});

// Si une valeur existe, on charge les pays tout de suite
// pour avoir le bon dialCode / mask / emoji
if (parsed) {
  await execute();
}

const country = computed(() =>
  phoneCodes.value?.find((c) => c.code === countryCode.value),
);
const dialCode = computed(() => country.value?.dialCode || "+221");
const mask = computed(() => country.value?.mask || "## ### ## ##");

function onOpen() {
  if (!phoneCodes.value?.length) {
    execute();
  }
}

// Changement de pays par l'utilisateur => on vide le champ
watch(countryCode, () => {
  _phone.value = "";
});

watch(_phone, (value) => {
  const asYouType = new AsYouType(countryCode.value);
  asYouType.input(value);
  phone.value = asYouType.getNumber()?.number;
});
</script>

<template>
  <UFieldGroup>
    <USelectMenu
      v-model="countryCode"
      :items="phoneCodes"
      value-key="code"
      :search-input="{
        placeholder: 'Search country...',
        icon: 'i-lucide-search',
        loading: status === 'pending',
      }"
      :filter-fields="['name', 'code', 'dialCode']"
      :content="{ align: 'start' }"
      :ui="{
        base: 'pe-8',
        content: 'w-48',
        placeholder: 'hidden',
        trailingIcon: 'size-4',
      }"
      trailing-icon="i-lucide-chevrons-up-down"
      @update:open="onOpen"
    >
      <span class="size-5 flex items-center text-lg">
        {{ country?.emoji || "\u{1F1F8}\u{1F1F3}" }}
      </span>

      <template #item-leading="{ item }">
        <span class="size-5 flex items-center text-lg">
          {{ item.emoji }}
        </span>
      </template>

      <template #item-label="{ item }">
        {{ item.name }} ({{ item.dialCode }})
      </template>
    </USelectMenu>

    <UInput
      v-model="_phone"
      v-maska="mask"
      :placeholder="mask.replaceAll('#', '_')"
      :style="{ '--dial-code-length': `${dialCode.length + 1.5}ch` }"
      :ui="{
        base: 'ps-(--dial-code-length)',
        leading: 'pointer-events-none text-base md:text-sm text-muted',
      }"
      class="w-full"
    >
      <template #leading>
        {{ dialCode }}
      </template>
    </UInput>
  </UFieldGroup>
</template>
