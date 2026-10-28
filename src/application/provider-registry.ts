import {
  ProviderInstanceDisabledError,
  ProviderInstanceNotFoundError,
  ProviderNotRegisteredError,
  type AuthenticationProvider,
  type ProviderInstanceRepository,
  type ProviderManifest,
  type ProviderRegistry,
} from '../domain/provider.js';

export class DefaultProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<string, AuthenticationProvider>();

  constructor(private readonly repository: ProviderInstanceRepository) {}

  register(provider: AuthenticationProvider): void {
    const { type } = provider.manifest;
    if (this.providers.has(type)) {
      throw new Error(`Provider type already registered: ${type}`);
    }
    this.providers.set(type, provider);
  }

  unregister(type: string): void {
    this.providers.delete(type);
  }

  async resolve(instanceId: string): Promise<AuthenticationProvider> {
    const instance = await this.repository.findById(instanceId);
    if (!instance) throw new ProviderInstanceNotFoundError(instanceId);
    if (!instance.enabled) throw new ProviderInstanceDisabledError(instanceId);

    const provider = this.providers.get(instance.type);
    if (!provider) throw new ProviderNotRegisteredError(instance.type);
    return provider;
  }

  list(): ProviderManifest[] {
    return [...this.providers.values()].map((p) => p.manifest);
  }
}
