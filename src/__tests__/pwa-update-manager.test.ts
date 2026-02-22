import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateManager } from '../lib/pwa-update-manager.js';

type ListenerMap = Record<string, EventListener>;

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

function mockServiceWorkerEnvironment() {
  const listeners: ListenerMap = {};
  const update = vi.fn(async () => undefined);

  const registration = {
    update,
  } as unknown as ServiceWorkerRegistration;

  const register = vi.fn(async () => registration);

  const serviceWorker = {
    register,
    addEventListener: vi.fn((name: string, cb: EventListener) => {
      listeners[name] = cb;
    }),
    removeEventListener: vi.fn(),
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    value: serviceWorker,
    configurable: true,
  });

  return { listeners, register, update };
}

function mockCacheStorage() {
  const keys = vi.fn(async () => ['cache-a', 'cache-b']);
  const del = vi.fn(async (_key: string) => true);

  Object.defineProperty(globalThis, 'caches', {
    value: {
      keys,
      delete: del,
    },
    configurable: true,
  });

  return { keys, del };
}

describe('PwaUpdateManager', () => {
  beforeEach(() => {
    setVisibility('visible');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with updateViaCache none and checks updates on startup', async () => {
    const sw = mockServiceWorkerEnvironment();
    mockCacheStorage();

    const manager = new PwaUpdateManager();
    await manager.init('sw.js');

    expect(sw.register).toHaveBeenCalledWith('sw.js', { updateViaCache: 'none' });
    expect(sw.update).toHaveBeenCalledTimes(1);
  });

  it('checks for updates when page becomes visible', async () => {
    const sw = mockServiceWorkerEnvironment();
    mockCacheStorage();

    const manager = new PwaUpdateManager();
    await manager.init('sw.js');

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sw.update).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sw.update).toHaveBeenCalledTimes(2);
  });

  it('defers reload when controller changes during active playback', async () => {
    const sw = mockServiceWorkerEnvironment();
    mockCacheStorage();
    const reloadSpy = vi.fn();

    const onStatus = vi.fn();
    const manager = new PwaUpdateManager({
      onStatus,
      isPlaybackActive: () => true,
      reload: reloadSpy,
    });

    await manager.init('sw.js');
    sw.listeners.controllerchange(new Event('controllerchange'));

    expect(manager.hasPendingReload()).toBe(true);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('Update ready. Pause playback to apply.');
  });

  it('applies deferred reload once playback is idle', async () => {
    const sw = mockServiceWorkerEnvironment();
    mockCacheStorage();
    const reloadSpy = vi.fn();

    let isPlaying = true;
    const manager = new PwaUpdateManager({
      isPlaybackActive: () => isPlaying,
      reload: reloadSpy,
    });

    await manager.init('sw.js');
    sw.listeners.controllerchange(new Event('controllerchange'));

    isPlaying = false;
    const result = manager.applyDeferredReloadIfIdle();

    expect(result).toBe('reloaded');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh updates SW, clears caches, and reloads', async () => {
    const sw = mockServiceWorkerEnvironment();
    const cacheStorage = mockCacheStorage();
    const reloadSpy = vi.fn();

    const manager = new PwaUpdateManager({ reload: reloadSpy });
    await manager.init('sw.js');

    const result = await manager.forceRefresh();

    expect(result).toBe('reloaded');
    expect(sw.update).toHaveBeenCalledTimes(2); // startup + forceRefresh
    expect(cacheStorage.keys).toHaveBeenCalledTimes(1);
    expect(cacheStorage.del).toHaveBeenCalledWith('cache-a');
    expect(cacheStorage.del).toHaveBeenCalledWith('cache-b');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
