// config.js — 配置管理
const Config = {
  _defaults: {
    amapKey: '',
    aiApiKey: '',
    aiApiUrl: 'https://api.openai.com/v1/chat/completions',
    maxHr: 190,
    age: 30,
    voiceInterval: 60,   // 秒
    navVoice: 'on',
  },

  _data: null,

  init() {
    try {
      const saved = localStorage.getItem('cycling-ai-config');
      this._data = saved ? { ...this._defaults, ...JSON.parse(saved) } : { ...this._defaults };
    } catch {
      this._data = { ...this._defaults };
    }
    // 如果有年龄但没有手动设置maxHr，用公式估算
    if (this._data.age && !localStorage.getItem('cycling-ai-config-maxHr')) {
      this._data.maxHr = 220 - this._data.age;
    }
  },

  get(key) {
    return this._data?.[key] ?? this._defaults[key];
  },

  set(key, value) {
    if (!this._data) this.init();
    this._data[key] = value;
    this._save();
  },

  setAll(obj) {
    if (!this._data) this.init();
    Object.assign(this._data, obj);
    this._save();
  },

  getAll() {
    if (!this._data) this.init();
    return { ...this._data };
  },

  _save() {
    try {
      localStorage.setItem('cycling-ai-config', JSON.stringify(this._data));
    } catch {}
  }
};

Config.init();
