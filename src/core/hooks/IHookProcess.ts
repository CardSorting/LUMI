/**
 * Minimal hook-process contract consumed by HookProcessRegistry.
 *
 * NOTE: This leaf interface lets HookProcessRegistry track and terminate
 * processes without importing the concrete HookProcess class — which imports the
 * registry to self-register. Depending on this abstraction breaks the
 * HookProcess ↔ HookProcessRegistry cycle (Dependency Inversion). HookProcess
 * declares `implements IHookProcess`.
 */
export interface IHookProcess {
	/** Terminate the running hook process and release its resources. */
	terminate(): Promise<void>
}
