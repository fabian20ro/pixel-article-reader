import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TTSEngine, selectVoice, type TTSCallbacks } from '../lib/tts-engine.js';

// ── SpeechSynthesis mock ────────────────────────────────────────────

class MockUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function createMockSpeechSynthesis() {
  return {
    speak: vi.fn((utter: MockUtterance) => {
      // Simulate immediate onend for testing
      setTimeout(() => utter.onend?.(), 0);
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    speaking: false,
    paused: false,
    pending: false,
    getVoices: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function makeVoice(name: string, lang: string): SpeechSynthesisVoice {
  return {
    name,
    lang,
    voiceURI: name,
    default: false,
    localService: true,
  } as SpeechSynthesisVoice;
}

let mockSynth: ReturnType<typeof createMockSpeechSynthesis>;

beforeEach(() => {
  mockSynth = createMockSpeechSynthesis();
  (globalThis as Record<string, unknown>).speechSynthesis = mockSynth;
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = MockUtterance;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── selectVoice ─────────────────────────────────────────────────────

describe('selectVoice', () => {
  const voices = [
    makeVoice('Alex', 'en-US'),
    makeVoice('Google US English', 'en-US'),
    makeVoice('Maria', 'ro-RO'),
    makeVoice('Google română', 'ro-RO'),
    makeVoice('Samantha', 'en-GB'),
  ];

  it('prefers enhanced/premium voices for English', () => {
    const v = selectVoice(voices, 'en');
    expect(v?.name).toBe('Google US English');
  });

  it('prefers enhanced/premium voices for Romanian', () => {
    const v = selectVoice(voices, 'ro');
    expect(v?.name).toBe('Google română');
  });

  it('falls back to any matching voice if no enhanced/premium voice exists', () => {
    const limited = [makeVoice('Alex', 'en-US'), makeVoice('Maria', 'ro-RO')];
    expect(selectVoice(limited, 'en')?.name).toBe('Alex');
    expect(selectVoice(limited, 'ro')?.name).toBe('Maria');
  });

  it('returns null if no voices match the language', () => {
    const enOnly = [makeVoice('Alex', 'en-US')];
    expect(selectVoice(enOnly, 'ro')).toBeNull();
  });

  it('returns preferred voice by name if available', () => {
    const v = selectVoice(voices, 'en', 'Samantha');
    expect(v?.name).toBe('Samantha');
  });

  it('falls back to language match if preferred voice not found', () => {
    const v = selectVoice(voices, 'en', 'NonExistent');
    expect(v?.name).toBe('Google US English');
  });

  it('ignores preferred voice when it does not match requested language', () => {
    const v = selectVoice(voices, 'en', 'Maria');
    expect(v?.name).toBe('Google US English');
  });

  it('returns null for empty voice list', () => {
    expect(selectVoice([], 'en')).toBeNull();
  });

  // ── Cross-platform voice selection ──────────────────────────────

  it('prefers Enhanced voices on iOS (no Google voices)', () => {
    const iosVoices = [
      makeVoice('Samantha', 'en-US'),
      makeVoice('Samantha (Enhanced)', 'en-US'),
      makeVoice('Daniel', 'en-GB'),
      makeVoice('Ioana', 'ro-RO'),
    ];
    const v = selectVoice(iosVoices, 'en');
    expect(v?.name).toBe('Samantha (Enhanced)');
  });

  it('prefers Premium voices on Samsung', () => {
    const samsungVoices = [
      makeVoice('Samsung English', 'en-US'),
      makeVoice('Samsung English Premium', 'en-US'),
      makeVoice('Samsung Romanian', 'ro-RO'),
    ];
    const v = selectVoice(samsungVoices, 'en');
    expect(v?.name).toBe('Samsung English Premium');
  });

  it('falls back to any matching voice on iOS when no Enhanced exists', () => {
    const iosVoices = [
      makeVoice('Samantha', 'en-US'),
      makeVoice('Daniel', 'en-GB'),
      makeVoice('Ioana', 'ro-RO'),
    ];
    expect(selectVoice(iosVoices, 'en')?.name).toBe('Samantha');
    expect(selectVoice(iosVoices, 'ro')?.name).toBe('Ioana');
  });

  it('matches Romanian voices across platforms', () => {
    const mixed = [
      makeVoice('Google română', 'ro-RO'),
      makeVoice('Ioana', 'ro-RO'),
    ];
    // Google voice preferred
    expect(selectVoice(mixed, 'ro')?.name).toBe('Google română');

    // Without Google, falls back
    const iosOnly = [makeVoice('Ioana', 'ro-RO')];
    expect(selectVoice(iosOnly, 'ro')?.name).toBe('Ioana');
  });

  it('handles voice.lang variants (en-US, en-GB, en-AU)', () => {
    const multiRegion = [
      makeVoice('Karen', 'en-AU'),
      makeVoice('Daniel', 'en-GB'),
    ];
    // Both should match 'en' prefix
    const v = selectVoice(multiRegion, 'en');
    expect(v).not.toBeNull();
    expect(v!.lang.startsWith('en')).toBe(true);
  });
});

// ── TTSEngine ───────────────────────────────────────────────────────

describe('TTSEngine', () => {
  function createEngine(callbacks: TTSCallbacks = {}) {
    mockSynth.getVoices.mockReturnValue([makeVoice('Google US English', 'en-US')]);
    const engine = new TTSEngine(callbacks);
    // Manually set voices since we can't await init (voiceschanged event)
    (engine as unknown as Record<string, unknown[]>).allVoices = mockSynth.getVoices();
    return engine;
  }

  it('starts in stopped state', () => {
    const engine = createEngine();
    expect(engine.state.isPlaying).toBe(false);
    expect(engine.state.isPaused).toBe(false);
  });

  it('loads paragraphs and splits into sentences', () => {
    const engine = createEngine();
    engine.loadArticle(['First sentence. Second sentence.', 'Third sentence.'], 'en');

    expect(engine.state.totalParagraphs).toBe(2);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('transitions to playing state on play()', () => {
    const onStateChange = vi.fn();
    const engine = createEngine({ onStateChange });

    engine.loadArticle(['Hello world. Testing TTS.'], 'en');
    engine.play();

    expect(engine.state.isPlaying).toBe(true);
    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.speak).toHaveBeenCalled();
  });

  it('calls speechSynthesis.speak with individual sentences, not full paragraphs', () => {
    const engine = createEngine();
    engine.loadArticle(['First sentence. Second sentence.'], 'en');
    engine.play();

    // The first speak call should be for the first sentence only
    const firstUtter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(firstUtter.text).toBe('First sentence.');
  });

  it('sets rate on each utterance', () => {
    const engine = createEngine();
    engine.loadArticle(['Hello world.'], 'en');
    engine.setRate(1.5);
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.rate).toBe(1.5);
  });

  it('clamps rate to valid range', () => {
    const engine = createEngine();
    engine.setRate(5.0);
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.rate).toBe(3.0);
  });

  it('pauses and calls speechSynthesis.pause()', () => {
    const engine = createEngine();
    engine.loadArticle(['Hello world.'], 'en');
    engine.play();
    engine.pause();

    expect(engine.state.isPaused).toBe(true);
    expect(mockSynth.pause).toHaveBeenCalled();
  });

  it('does not pause when not playing', () => {
    const engine = createEngine();
    engine.loadArticle(['Hello.'], 'en');
    engine.pause();
    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.pause).not.toHaveBeenCalled();
  });

  it('resume() calls speechSynthesis.resume()', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle(['Hello world.'], 'en');
    engine.play();
    engine.pause();
    engine.resume();

    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.resume).toHaveBeenCalled();
    vi.runAllTimers();
  });

  it('play() delegates to resume() when paused', () => {
    vi.useFakeTimers();
    const engine = createEngine();
    engine.loadArticle(['Hello.'], 'en');
    engine.play();
    engine.pause();

    expect(engine.state.isPaused).toBe(true);
    engine.play(); // should resume, not restart

    expect(engine.state.isPaused).toBe(false);
    expect(mockSynth.resume).toHaveBeenCalled();
    vi.runAllTimers();
  });

  it('stop() cancels synthesis and resets position', () => {
    const engine = createEngine();
    engine.loadArticle(['First. Second.', 'Third.'], 'en');
    engine.play();
    engine.stop();

    expect(engine.state.isPlaying).toBe(false);
    expect(engine.state.currentParagraph).toBe(0);
    expect(mockSynth.cancel).toHaveBeenCalled();
  });

  it('does not play when no article is loaded', () => {
    const engine = createEngine();
    engine.play();
    expect(engine.state.isPlaying).toBe(false);
    expect(mockSynth.speak).not.toHaveBeenCalled();
  });

  it('skipForward increments paragraph index', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['First paragraph.', 'Second paragraph.', 'Third paragraph.'], 'en');
    engine.play();
    engine.skipForward();

    expect(engine.state.currentParagraph).toBe(1);
    expect(mockSynth.cancel).toHaveBeenCalled();
  });

  it('skipForward does nothing at last paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['Only paragraph.'], 'en');
    engine.play();
    engine.skipForward();

    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipBackward decrements paragraph index', () => {
    const engine = createEngine();
    engine.loadArticle(['First.', 'Second.', 'Third.'], 'en');
    engine.play();
    engine.skipForward(); // go to 1
    engine.skipBackward(); // back to 0

    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipBackward does nothing at first paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['First.', 'Second.'], 'en');
    engine.play();
    engine.skipBackward();

    expect(engine.state.currentParagraph).toBe(0);
  });

  it('jumpToParagraph sets the correct index', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['A.', 'B.', 'C.', 'D.'], 'en');
    engine.play();
    engine.jumpToParagraph(2);

    expect(engine.state.currentParagraph).toBe(2);
  });

  // ── Sentence skip tests ───────────────────────────────────────────

  it('skipSentenceForward advances to next sentence within paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['First sentence. Second sentence. Third sentence.'], 'en');
    engine.play();

    expect(engine.state.currentSentence).toBe(0);
    engine.skipSentenceForward();
    expect(engine.state.currentSentence).toBe(1);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipSentenceForward crosses to next paragraph at end of sentences', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['Only sentence.', 'Next paragraph.'], 'en');
    engine.play();

    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(0);
    engine.skipSentenceForward();
    expect(engine.state.currentParagraph).toBe(1);
    expect(engine.state.currentSentence).toBe(0);
  });

  it('skipSentenceForward does nothing at last sentence of last paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['Only sentence.'], 'en');
    engine.play();

    engine.skipSentenceForward();
    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(0);
  });

  it('skipSentenceBackward goes to previous sentence within paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['First sentence. Second sentence. Third sentence.'], 'en');
    engine.play();

    engine.skipSentenceForward(); // go to sentence 1
    engine.skipSentenceForward(); // go to sentence 2
    expect(engine.state.currentSentence).toBe(2);

    engine.skipSentenceBackward();
    expect(engine.state.currentSentence).toBe(1);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('skipSentenceBackward crosses to previous paragraph at first sentence', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['First. Second.', 'Third.'], 'en');
    engine.play();

    engine.skipForward(); // go to paragraph 1
    expect(engine.state.currentParagraph).toBe(1);
    expect(engine.state.currentSentence).toBe(0);

    engine.skipSentenceBackward();
    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(1); // last sentence of previous paragraph
  });

  it('skipSentenceBackward does nothing at first sentence of first paragraph', () => {
    const engine = createEngine();
    engine.loadArticle(['First sentence. Second sentence.'], 'en');
    engine.play();

    engine.skipSentenceBackward();
    expect(engine.state.currentParagraph).toBe(0);
    expect(engine.state.currentSentence).toBe(0);
  });

  it('jumpToParagraph ignores out-of-range indices', () => {
    const engine = createEngine();
    engine.loadArticle(['A.', 'B.'], 'en');
    engine.play();
    engine.jumpToParagraph(5);
    expect(engine.state.currentParagraph).toBe(0);

    engine.jumpToParagraph(-1);
    expect(engine.state.currentParagraph).toBe(0);
  });

  it('fires onEnd callback when article finishes', async () => {
    const onEnd = vi.fn();
    const engine = createEngine({ onEnd });

    // Single sentence — speak mock fires onend immediately via setTimeout
    engine.loadArticle(['Done.'], 'en');
    engine.play();

    // Wait for the async onend chain
    await new Promise((r) => setTimeout(r, 50));

    expect(onEnd).toHaveBeenCalled();
  });

  it('fires onParagraphChange callback', () => {
    const onParagraphChange = vi.fn();
    const engine = createEngine({ onParagraphChange });
    engine.loadArticle(['First paragraph content.', 'Second paragraph content.'], 'en');
    engine.play();

    expect(onParagraphChange).toHaveBeenCalledWith(0, 'First paragraph content.');
  });

  it('fires onProgress callback', () => {
    const onProgress = vi.fn();
    const engine = createEngine({ onProgress });
    engine.loadArticle(['Hello world.'], 'en');
    engine.play();

    expect(onProgress).toHaveBeenCalledWith(0, 1);
  });

  it('sets the correct language code on utterances', () => {
    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = [makeVoice('Maria', 'ro-RO')];
    engine.loadArticle(['Test text here.'], 'ro');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.lang).toBe('ro');
  });

  it('assigns the selected voice to utterances', () => {
    const voices = [makeVoice('Google US English', 'en-US')];
    mockSynth.getVoices.mockReturnValue(voices);

    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = voices;
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.voice?.name).toBe('Google US English');
  });

  it('setVoice() preference persists across loadArticle()', () => {
    const voices = [
      makeVoice('Samantha', 'en-GB'),
      makeVoice('Google US English', 'en-US'),
    ];
    mockSynth.getVoices.mockReturnValue(voices);

    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = voices;

    engine.setVoice('Samantha');
    engine.loadArticle(['Hello.'], 'en');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.voice?.name).toBe('Samantha');
  });

  it('setVoice() preference persists across setLang()', () => {
    const voices = [
      makeVoice('Ioana', 'ro-RO'),
      makeVoice('Google română', 'ro-RO'),
    ];
    mockSynth.getVoices.mockReturnValue(voices);

    const engine = createEngine();
    (engine as unknown as Record<string, unknown[]>).allVoices = voices;

    engine.setVoice('Ioana');
    engine.loadArticle(['Bună ziua.'], 'ro');
    engine.setLang('ro');
    engine.play();

    const utter = mockSynth.speak.mock.calls[0][0] as MockUtterance;
    expect(utter.voice?.name).toBe('Ioana');
  });
});
