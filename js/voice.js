// voice.js — 语音播报系统（iOS后台保活 + TTS）
const Voice = {
  _queue: [],
  _speaking: false,
  _enabled: true,
  _keepAliveEl: null,
  _keepAliveRunning: false,
  _mediaSession: null,
  _audioCtx: null,

  init() {
    // 创建 keep-alive 音频元素引用
    this._keepAliveEl = document.getElementById('keepalive-audio');
    this._setupMediaSession();
    // 监听页面可见性
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._startKeepAlive();
      } else {
        this._stopKeepAlive();
      }
    });
  },

  // ===== iOS 后台保活 =====
  // 原理：播放静音音频 + Media Session API 让系统认为有音频播放
  _startKeepAlive() {
    if (this._keepAliveRunning) return;
    this._keepAliveRunning = true;
    if (this._keepAliveEl) {
      this._keepAliveEl.currentTime = 0;
      this._keepAliveEl.play().catch(() => {});
    }
    // 备用：AudioContext 方式
    this._ensureAudioCtx();
  },

  _stopKeepAlive() {
    this._keepAliveRunning = false;
    // 不停止，让音频继续播放以维持后台
  },

  _ensureAudioCtx() {
    // 不创建振荡器，避免性能问题
    if (this._audioCtx) return;
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  },

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: '骑行AI教练',
      artist: '正在导航',
      album: '骑行中',
    });
    // 设置一个实际的音频用于 Media Session
    // 使用一个短的静音循环
    try {
      const audio = this._keepAliveEl;
      if (audio) {
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch {}
  },

  // ===== 语音播报 =====
  speak(text, priority = 'normal') {
    if (!this._enabled) return;
    if (!text) return;

    // 优先级：high 立即打断，normal 排队，low 忽略（如果队列中有）
    if (priority === 'high') {
      this._queue = [];
      window.speechSynthesis.cancel();
    } else if (priority === 'low' && this._queue.length > 2) {
      return;
    }

    this._queue.push(text);
    this._processQueue();
  },

  _processQueue() {
    if (this._speaking || this._queue.length === 0) return;
    this._speaking = true;

    const text = this._queue.shift();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // 尝试选择中文语音
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v =>
      v.lang.startsWith('zh') && v.name.includes('Ting')
    ) || voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) utterance.voice = zhVoice;

    utterance.onend = () => {
      this._speaking = false;
      // 继续处理队列
      setTimeout(() => this._processQueue(), 200);
    };
    utterance.onerror = () => {
      this._speaking = false;
      setTimeout(() => this._processQueue(), 200);
    };

    // 确保在 iOS 上触发播放
    this._ensureAudioCtx();
    window.speechSynthesis.speak(utterance);

    // iOS bug: 长文本会被截断，用 resume hack
    if (text.length > 100) {
      const interval = setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          clearInterval(interval);
          return;
        }
        window.speechSynthesis.resume();
      }, 5000);
    }
  },

  toggle() {
    this._enabled = !this._enabled;
    if (!this._enabled) {
      this._queue = [];
      window.speechSynthesis.cancel();
    }
    return this._enabled;
  },

  isEnabled() {
    return this._enabled;
  },

  // 播放导航提示
  speakNavigation(instruction, distance) {
    const text = distance ? `${distance}后${instruction}` : instruction;
    this.speak(text, 'high');
  },

  // 播放AI教练提示
  speakCoach(message) {
    this.speak(message, 'normal');
  },

  // 播放警告
  speakWarning(message) {
    this.speak(`注意！${message}`, 'high');
  },

  // 预加载语音列表（iOS 需要）
  preload() {
    window.speechSynthesis.getVoices();
    // iOS 需要用户交互后才能播放
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  },

  // 用户首次交互时调用，解锁 iOS 语音
  unlock() {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    this._ensureAudioCtx();
    // 启动 keep-alive
    if (this._keepAliveEl) {
      this._keepAliveEl.play().catch(() => {});
    }
  }
};
