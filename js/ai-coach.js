// ai-coach.js — AI 骑行分析与教练
const AICoach = {
  // 心率区间（基于最大心率百分比）
  // Zone 1: 热身/恢复  < 60%
  // Zone 2: 燃脂       60-70%
  // Zone 3: 有氧       70-80%
  // Zone 4: 无氧       80-90%
  // Zone 5: 极限       > 90%

  _lastAdviceTime: 0,
  _adviceInterval: 60, // 秒，从配置读取
  _currentZone: null,
  _hrHistory: [],      // 最近60个心率样本
  _speedHistory: [],
  _rideStartTime: null,

  // 骑行状态
  _isRiding: false,
  _isPaused: false,

  init() {
    this._adviceInterval = Config.get('voiceInterval');
    this._rideStartTime = Date.now();
    this._isRiding = true;
    this._isPaused = false;
    this._hrHistory = [];
    this._speedHistory = [];
    this._lastAdviceTime = 0;
    this._currentZone = null;
  },

  pause() { this._isPaused = true; },
  resume() { this._isPaused = false; },
  stop() { this._isRiding = false; },

  // ===== 心率区间计算 =====
  getHRZone(hr) {
    const maxHr = Config.get('maxHr');
    if (!hr || !maxHr) return null;
    const pct = hr / maxHr;
    if (pct < 0.5) return { zone: 0, name: '恢复', class: '', emoji: '😴' };
    if (pct < 0.6) return { zone: 1, name: '热身', class: '', emoji: '🚶' };
    if (pct < 0.7) return { zone: 2, name: '燃脂', class: 'fat-burn', emoji: '🔥' };
    if (pct < 0.8) return { zone: 3, name: '有氧', class: 'aerobic', emoji: '💪' };
    if (pct < 0.9) return { zone: 4, name: '无氧', class: 'anaerobic', emoji: '⚡' };
    return { zone: 5, name: '极限', class: 'extreme', emoji: '🚨' };
  },

  // ===== 核心分析 =====
  analyze(data) {
    // data: { speed, cadence, hr }
    if (!this._isRiding || this._isPaused) return null;

    const { speed, cadence, hr } = data;
    const now = Date.now();

    // 记录历史
    if (hr) this._hrHistory.push({ hr, t: now });
    if (speed) this._speedHistory.push({ speed, t: now });

    // 保留最近 60 个样本
    if (this._hrHistory.length > 60) this._hrHistory.shift();
    if (this._speedHistory.length > 60) this._speedHistory.shift();

    // 当前区间
    const zone = this.getHRZone(hr);
    this._currentZone = zone;

    // 检查是否该给建议了
    const elapsed = (now - this._lastAdviceTime) / 1000;
    if (elapsed < this._adviceInterval) {
      return { zone, advice: null, alerts: this._checkAlerts(data) };
    }

    // 生成建议
    const advice = this._generateAdvice(data, zone);
    if (advice) {
      this._lastAdviceTime = now;
    }

    return {
      zone,
      advice,
      alerts: this._checkAlerts(data),
      stats: this._getStats()
    };
  },

  // ===== 生成建议 =====
  _generateAdvice(data, zone) {
    const { speed, cadence, hr } = data;
    const maxHr = Config.get('maxHr');
    const advices = [];

    if (!zone) return null;

    // 心率区间建议
    if (zone.zone <= 1 && hr) {
      // 心率太低
      advices.push(this._pickRandom([
        '心率偏低，可以适当加速提升训练效果',
        '当前强度不够，建议提高速度或踏频',
        '热身阶段，可以逐步加大强度'
      ]));
    } else if (zone.zone === 2) {
      // 燃脂区 — 最佳
      advices.push(this._pickRandom([
        '当前处于燃脂区，保持这个节奏',
        '燃脂模式，心率控制得很好，继续保持',
        '脂肪正在燃烧！稳定输出'
      ]));
    } else if (zone.zone === 3) {
      // 有氧区
      advices.push(this._pickRandom([
        '有氧区间，训练效果很好',
        '心率在有氧区，适合提升心肺功能',
        '有氧模式，节奏不错'
      ]));
    } else if (zone.zone === 4) {
      // 无氧区 — 提醒降速
      advices.push(this._pickRandom([
        '心率偏高，建议适当减速恢复',
        '进入无氧区了，降低速度避免过度疲劳',
        '强度较大，可以放慢节奏'
      ]));
    } else if (zone.zone >= 5) {
      // 极限区 — 警告
      advices.push(this._pickRandom([
        '心率过高！请立即减速！',
        '危险心率区间，请降低强度',
        '注意安全，尽快降低心率'
      ]));
    }

    // 踏频建议
    if (cadence !== null && cadence !== undefined) {
      if (cadence < 60) {
        advices.push('踏频偏低，建议换到更轻的档位提高踏频');
      } else if (cadence > 110) {
        advices.push('踏频过高，可以换到更重的档位');
      } else if (cadence >= 80 && cadence <= 100) {
        // 踏频理想范围，不额外提示
      }
    }

    // 速度建议（基于历史趋势）
    if (this._speedHistory.length >= 10) {
      const recent = this._speedHistory.slice(-10);
      const avgSpeed = recent.reduce((s, v) => s + v.speed, 0) / recent.length;
      const trend = recent[recent.length - 1].speed - recent[0].speed;

      if (trend < -3) {
        advices.push('速度在下降，保持节奏');
      }
    }

    return advices.length > 0 ? advices[0] : null;
  },

  // ===== 紧急警报 =====
  _checkAlerts(data) {
    const alerts = [];
    const { hr, speed } = data;
    const maxHr = Config.get('maxHr');

    // 心率危险
    if (hr && maxHr && hr > maxHr * 0.95) {
      alerts.push({ type: 'hr-danger', message: '心率接近极限，请立即减速！' });
    }

    // 速度异常（突然降到很低可能摔车）
    if (this._speedHistory.length >= 5) {
      const recent = this._speedHistory.slice(-5);
      const avg = recent.reduce((s, v) => s + v.speed, 0) / recent.length;
      if (avg > 15 && speed < 3) {
        alerts.push({ type: 'speed-drop', message: '速度骤降，注意安全' });
      }
    }

    return alerts;
  },

  // ===== 统计数据 =====
  _getStats() {
    const stats = {};
    if (this._hrHistory.length > 0) {
      const hrs = this._hrHistory.map(h => h.hr);
      stats.avgHR = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
      stats.maxHR = Math.max(...hrs);
    }
    if (this._speedHistory.length > 0) {
      const speeds = this._speedHistory.map(s => s.speed);
      stats.avgSpeed = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1);
      stats.maxSpeed = Math.max(...speeds).toFixed(1);
    }
    stats.rideTime = Date.now() - this._rideStartTime;
    return stats;
  },

  // ===== 骑行总结 =====
  getSummary() {
    const stats = this._getStats();
    const elapsed = stats.rideTime / 1000; // 秒
    const hours = Math.floor(elapsed / 3600);
    const mins = Math.floor((elapsed % 3600) / 60);
    const secs = Math.floor(elapsed % 60);

    // 心率区间分布
    const zoneDistribution = {};
    this._hrHistory.forEach(h => {
      const z = this.getHRZone(h.hr);
      if (z) {
        zoneDistribution[z.name] = (zoneDistribution[z.name] || 0) + 1;
      }
    });

    // 计算各区间占比
    const total = this._hrHistory.length || 1;
    const zonePct = {};
    for (const [name, count] of Object.entries(zoneDistribution)) {
      zonePct[name] = Math.round(count / total * 100);
    }

    // 估算卡路里（粗略）
    // MET 燃脂区约 6-8, 有氧区约 8-12
    const avgHrPct = stats.avgHR ? (stats.avgHR / Config.get('maxHr')) : 0.6;
    const met = avgHrPct < 0.6 ? 5 : avgHrPct < 0.7 ? 7 : avgHrPct < 0.8 ? 9 : 12;
    const weight = 70; // 默认70kg
    const calories = Math.round(met * weight * (elapsed / 3600));

    return {
      duration: `${hours > 0 ? hours + '小时' : ''}${mins}分${secs}秒`,
      durationSeconds: elapsed,
      avgSpeed: stats.avgSpeed || '0',
      maxSpeed: stats.maxSpeed || '0',
      avgHR: stats.avgHR || '--',
      maxHR: stats.maxHR || '--',
      calories,
      zonePct,
    };
  },

  // ===== 工具方法 =====
  _pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  },

  getCurrentZone() {
    return this._currentZone;
  }
};
