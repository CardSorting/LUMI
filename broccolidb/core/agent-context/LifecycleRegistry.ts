// [LAYER: CORE]
// @classification PURE
import { LifecycleStateError } from '../errors.js';
import type { ServiceHealth } from './service-health.js';

export interface OwnedComponent {
  start(): Promise<void>;
  stop(): Promise<void>;
  flush(): Promise<void>;
  health(options?: { deep?: boolean }): Promise<ServiceHealth>;
}

export interface LifecycleRegistryHealth {
  active: boolean;
  services: Record<string, ServiceHealth>;
}

export class LifecycleRegistry {
  private registry = new Map<string, OwnedComponent>();
  private active = false;

  public register(name: string, component: OwnedComponent) {
    this.registry.set(name, component);
  }

  public get(name: string): OwnedComponent | undefined {
    return this.registry.get(name);
  }

  public get isActive(): boolean {
    return this.active;
  }

  public async startAll(): Promise<void> {
    if (this.active) return;
    const started: string[] = [];

    const startOrder = ['db', 'storage', 'cleanup', 'mutex', 'lsp', 'coordinator'];

    for (const name of startOrder) {
      const component = this.registry.get(name);
      if (component) {
        try {
          await component.start();
          started.push(name);
        } catch (err: any) {
          for (const startedName of started.reverse()) {
            const startedComponent = this.registry.get(startedName);
            try {
              await startedComponent?.stop();
            } catch (stopError) {
              console.error(`[LifecycleRegistry] Error unwinding component '${startedName}':`, stopError);
            }
          }
          throw new LifecycleStateError(`Failed to start component '${name}': ${err.message || err}`);
        }
      }
    }
    this.active = true;
  }

  public async stopAll(): Promise<void> {
    if (!this.active) return;
    this.active = false;

    const stopOrder = ['coordinator', 'lsp', 'mutex', 'cleanup', 'storage', 'db'];

    for (const name of stopOrder) {
      const component = this.registry.get(name);
      if (component) {
        try {
          await component.stop();
        } catch (err) {
          console.error(`[LifecycleRegistry] Error stopping component '${name}':`, err);
        }
      }
    }
  }

  public async flushAll(): Promise<void> {
    if (!this.active) {
      throw new LifecycleStateError('Cannot flush registry when stopped.');
    }
    for (const [name, component] of this.registry.entries()) {
      try {
        await component.flush();
      } catch (err) {
        console.error(`[LifecycleRegistry] Error flushing component '${name}':`, err);
      }
    }
  }

  public async healthAll(options?: { deep?: boolean }): Promise<LifecycleRegistryHealth> {
    const services: Record<string, ServiceHealth> = {};
    for (const [name, component] of this.registry.entries()) {
      try {
        services[name] = await component.health(options);
      } catch (error: any) {
        services[name] = {
          name,
          status: 'critical',
          started: false,
          lastError: error?.message || String(error),
        };
      }
    }

    return {
      active: this.active,
      services,
    };
  }
}
