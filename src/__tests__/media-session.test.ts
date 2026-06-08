import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaSessionController } from '../lib/media-session';

// Mocking globals that jsdom doesn't provide
// @ts-expect-error - mocking global
globalThis.MediaMetadata = class {
  constructor(init: any) {
    Object.assign(this, init);
  }
};

describe('MediaSessionController', () => {
  let controller: MediaSessionController;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Mock navigator.mediaSession
    const mockMetadata = {
      title: 'Title',
      artist: 'Artist',
      artwork: [],
    };
    
    const mockMediaSession = {
      metadata: mockMetadata,
      playbackState: 'none' as MediaSessionPlaybackState,
      actionHandlers: new Map(),
      setActionHandler: vi.fn((name: string, handler: () => void) => {
        (mockMediaSession as any).actionHandlers.set(name, handler);
      }),
      setPositionState: vi.fn(),
    };

    // @ts-expect-error - mocking navigator
    Object.defineProperty(navigator, 'mediaSession', {
      value: mockMediaSession,
      configurable: true,
    });

    // Mock visibilityState
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
      writable: true,
    });

    controller = new MediaSessionController();
  });

  it('should activate and start audio', async () => {
    const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
    controller.activate('Test Title');
    
    expect(controller.active).toBe(true);
    expect(playSpy).toHaveBeenCalled();
  });

  it('should deactivate and stop audio', () => {
    const pauseSpy = vi.spyOn(HTMLAudioElement.prototype, 'pause');
    controller.activate();
    controller.deactivate();
    
    expect(controller.active).toBe(false);
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('should update metadata', () => {
    controller.updateMetadata('New Title', 'New Artist');
    expect(navigator.mediaSession.metadata?.title).toBe('New Title');
    expect(navigator.mediaSession.metadata?.artist).toBe('New Artist');
  });

  it('should update position state', () => {
    controller.updatePositionState(100, 50, 1);
    expect(navigator.mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 100,
      position: 50,
      playbackRate: 1,
    });
  });

  it('should dispose properly', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    controller.dispose();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
