// app.js — 主控制器
const App = {
  _mode: 'plan',       // plan | ride | summary
  _rideActive: false,
  _ridePaused: false,
  _rideTimer: null,
  _rideStartTime: null,
  _rideData: {
    positions: [],
    speeds: [],
    hrs: [],
    cadences: [],
  },

  // ===== 初始化 =====
  async init() {
    // 加载设置到UI
    this._loadSettingsUI();

    // 初始化语音
    Voice.init();
    Voice.preload();

    // 初始化地图（可能失败，不影响其他功能）
    try {
      const mapReady = await MapCtrl.init();
      if (!mapReady) {
        this._showToast('地图加载失败，请在设置中配置API Key后刷新');
      }
    } catch (e) {
      console.warn('地图初始化异常:', e);
    }

    // 解锁 iOS 音频（需要用户交互）
    document.addEventListener('touchstart', () => {
      Voice.unlock();
    }, { once: true });

    console.log('骑行AI教练已启动');
  },

  // ===== 事件绑定 =====
  _bindEvents() {
    // 模式切换
    document.querySelectorAll('#mode-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._switchMode(tab.dataset.mode);
      });
    });

    // 搜索目的地
    const btnSearch = document.getElementById('btn-search-end');
    const inputEnd = document.getElementById('input-end');
    btnSearch.addEventListener('click', () => this._searchDestination());
    inputEnd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._searchDestination();
    });

    // 开始骑行
    document.getElementById('btn-start-ride').addEventListener('click', () => {
      this._startRide();
    });

    // 骑行控制
    document.getElementById('btn-pause-ride').addEventListener('click', () => {
      this._togglePause();
    });
    document.getElementById('btn-voice-toggle').addEventListener('click', () => {
      const on = Voice.toggle();
      document.getElementById('btn-voice-toggle').textContent = on ? '🔊 语音' : '🔇 静音';
    });
    document.getElementById('btn-stop-ride').addEventListener('click', () => {
      this._stopRide();
    });

    // 传感器面板
    document.getElementById('btn-sensors').addEventListener('click', () => {
      document.getElementById('sensor-panel').classList.remove('hidden');
    });
    document.getElementById('btn-connect-hr').addEventListener('click', async () => {
      try {
        await Sensor.connectHR();
        document.getElementById('sensor-hr-status').textContent = '已连接';
        document.getElementById('sensor-hr-status').classList.add('connected');
        this._showToast('心率带已连接');
      } catch (err) {
        this._showToast('连接失败: ' + err.message);
      }
    });
    document.getElementById('btn-connect-cadence').addEventListener('click', async () => {
      try {
        await Sensor.connectCadence();
        document.getElementById('sensor-cadence-status').textContent = '已连接';
        document.getElementById('sensor-cadence-status').classList.add('connected');
        this._showToast('踏频器已连接');
      } catch (err) {
        this._showToast('连接失败: ' + err.message);
      }
    });

    // 设置面板
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('settings-panel').classList.remove('hidden');
    });
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      this._saveSettings();
      document.getElementById('settings-panel').classList.add('hidden');
      this._showToast('设置已保存');
    });

    // 侧边栏
    document.getElementById('btn-menu').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('hidden');
      document.getElementById('sidebar-overlay').classList.remove('hidden');
    });
    document.getElementById('btn-close-sidebar').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('hidden');
      document.getElementById('sidebar-overlay').classList.add('hidden');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('hidden');
      document.getElementById('sidebar-overlay').classList.add('hidden');
    });

    // 模态框关闭
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal').classList.add('hidden');
      });
    });

    // 传感器回调
    Sensor.onHeartRate((hr) => {
      if (hr !== null) {
        document.getElementById('val-hr').textContent = hr;
      }
    });
    Sensor.onCadence((cad) => {
      if (cad !== null) {
        document.getElementById('val-cadence').textContent = cad;
      }
    });

    // 页面可见性变化 — 后台保活
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this._rideActive) {
        console.log('进入后台，保活模式启动');
      }
    });
  },

  // ===== 模式切换 =====
  _switchMode(mode) {
    this._mode = mode;

    // 标签
    document.querySelectorAll('#mode-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });

    // 面板
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${mode}`).classList.add('active');

    // body class
    document.body.className = mode === 'ride' ? 'mode-ride' : '';
  },

  // ===== 搜索目的地 =====
  async _searchDestination() {
    const keyword = document.getElementById('input-end').value.trim();
    if (!keyword) return;

    try {
      const results = await MapCtrl.searchPlace(keyword);
      this._showSearchResults(results);
    } catch (err) {
      this._showToast('搜索失败: ' + err.message);
    }
  },

  _showSearchResults(results) {
    const container = document.getElementById('route-results');
    const list = document.getElementById('route-list');
    list.innerHTML = '';

    if (!results || results.length === 0) {
      list.innerHTML = '<p style="color:var(--text-dim);padding:12px;">未找到结果</p>';
      container.classList.remove('hidden');
      return;
    }

    results.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'route-item';
      div.innerHTML = `
        <div class="route-item-info">
          <div style="font-weight:600;">${item.name}</div>
          <div class="route-item-meta">${item.address || ''}</div>
        </div>
      `;
      div.addEventListener('click', () => {
        // 选中这个地点，规划路线
        document.querySelectorAll('.route-item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        this._planToDestination(item);
      });
      list.appendChild(div);
    });

    container.classList.remove('hidden');
  },

  async _planToDestination(place) {
    const endLoc = place.location;
    if (!endLoc) {
      this._showToast('无法获取地点坐标');
      return;
    }

    try {
      // 获取当前位置作为起点
      let start = MapCtrl._currentPos;
      if (!start) {
        start = await MapCtrl._getCurrentPosition();
      }
      if (!start) {
        this._showToast('无法获取当前位置');
        return;
      }

      const result = await MapCtrl.planRoute(start, endLoc);
      const summary = MapCtrl.showRoute(result, 0);

      if (summary) {
        document.getElementById('route-distance').textContent = summary.distance;
        document.getElementById('route-duration').textContent = summary.duration;
        document.getElementById('route-ascent').textContent = summary.ascent;
        document.getElementById('route-summary').classList.remove('hidden');
        document.getElementById('btn-start-ride').classList.remove('hidden');

        // 保存路线结果
        this._plannedRoute = result;
      }
    } catch (err) {
      this._showToast('路线规划失败: ' + err.message);
    }
  },

  // ===== 开始骑行 =====
  _startRide() {
    this._rideActive = true;
    this._ridePaused = false;
    this._rideStartTime = Date.now();
    this._rideData = { positions: [], speeds: [], hrs: [], cadences: [] };

    // 初始化AI教练
    AICoach.init();

    // 开始GPS追踪
    Sensor.startGPS((speedKmh) => {
      document.getElementById('val-speed').textContent = speedKmh.toFixed(1);
    });

    // 开始导航（如果有路线）
    if (this._plannedRoute) {
      MapCtrl.startNavigation((navInfo) => {
        if (navInfo.type === 'navigate') {
          document.getElementById('nav-info').classList.remove('hidden');
          document.getElementById('nav-next-maneuver').textContent = navInfo.instruction;
          document.getElementById('nav-distance').textContent = navInfo.distance;

          // 语音播报导航
          if (Config.get('navVoice') === 'on') {
            Voice.speakNavigation(navInfo.instruction, navInfo.distance);
          }
        } else if (navInfo.type === 'arrived') {
          document.getElementById('nav-info').classList.add('hidden');
          Voice.speak('您已到达目的地');
        }
      });
    }

    // 地图跟随
    MapCtrl.followPosition();

    // 切换到骑行模式
    this._switchMode('ride');

    // 开始数据采集循环
    this._rideTimer = setInterval(() => this._rideLoop(), 1000);

    // 语音提示开始
    Voice.speak('骑行开始，祝你骑行愉快');
    document.getElementById('btn-start-ride').classList.add('hidden');
  },

  // ===== 骑行数据循环 =====
  _rideLoop() {
    if (!this._rideActive || this._ridePaused) return;

    const speedKmh = Sensor.getGPSSpeedKmh();
    const hr = Sensor.getHR();
    let cadence = Sensor.getCadence();

    // 无踏频传感器时用速度估算
    if (cadence === null && speedKmh > 2) {
      cadence = Sensor.estimateCadence(speedKmh);
    }

    // 更新UI
    document.getElementById('val-speed').textContent = speedKmh.toFixed(1);
    if (cadence !== null) document.getElementById('val-cadence').textContent = cadence;
    if (hr !== null) document.getElementById('val-hr').textContent = hr;

    // 记录数据
    this._rideData.speeds.push(speedKmh);
    if (hr) this._rideData.hrs.push(hr);
    if (cadence) this._rideData.cadences.push(cadence);

    // AI分析
    const result = AICoach.analyze({ speed: speedKmh, cadence, hr });
    if (result) {
      // 更新区间显示
      if (result.zone) {
        const badge = document.getElementById('ai-zone-badge');
        badge.textContent = `${result.zone.emoji} ${result.zone.name}`;
        badge.className = 'zone-badge ' + result.zone.class;
      }

      // 更新建议文字
      if (result.advice) {
        document.getElementById('ai-coach-text').textContent = result.advice;
        Voice.speakCoach(result.advice);
      }

      // 紧急警报
      if (result.alerts) {
        result.alerts.forEach(alert => {
          Voice.speakWarning(alert.message);
          document.getElementById('ai-coach-text').textContent = '⚠️ ' + alert.message;
        });
      }

      // 更新指标卡片状态
      this._updateMetricCards(hr, cadence, speedKmh, result.zone);
    }
  },

  // ===== 更新指标卡片样式 =====
  _updateMetricCards(hr, cadence, speedKmh, zone) {
    const mcHR = document.getElementById('mc-hr');
    mcHR.className = 'metric-card';
    if (zone) {
      if (zone.zone >= 4) mcHR.classList.add('danger');
      else if (zone.zone >= 3) mcHR.classList.add('warning');
      else if (zone.zone === 2) mcHR.classList.add('optimal');
    }

    const mcCad = document.getElementById('mc-cadence');
    mcCad.className = 'metric-card';
    if (cadence !== null) {
      if (cadence < 60) mcCad.classList.add('warning');
      else if (cadence > 110) mcCad.classList.add('warning');
      else mcCad.classList.add('optimal');
    }

    const mcSpeed = document.getElementById('mc-speed');
    mcSpeed.className = 'metric-card';
    if (speedKmh > 35) mcSpeed.classList.add('warning');
    else if (speedKmh > 20) mcSpeed.classList.add('optimal');
  },

  // ===== 暂停/恢复 =====
  _togglePause() {
    this._ridePaused = !this._ridePaused;
    const btn = document.getElementById('btn-pause-ride');
    if (this._ridePaused) {
      btn.textContent = '▶️ 继续';
      AICoach.pause();
      Voice.speak('骑行已暂停');
    } else {
      btn.textContent = '⏸️ 暂停';
      AICoach.resume();
      Voice.speak('继续骑行');
    }
  },

  // ===== 结束骑行 =====
  _stopRide() {
    if (!confirm('确定要结束骑行吗？')) return;

    this._rideActive = false;
    if (this._rideTimer) {
      clearInterval(this._rideTimer);
      this._rideTimer = null;
    }

    AICoach.stop();
    Sensor.stopGPS();
    MapCtrl.stopNavigation();
    MapCtrl.unlockPosition();

    // 生成总结
    const summary = AICoach.getSummary();
    this._showSummary(summary);

    // 保存历史
    this._saveRideHistory(summary);

    // 语音总结
    Voice.speak(`骑行结束。总时长${summary.duration}，平均速度${summary.avgSpeed}公里每小时，消耗约${summary.calories}千卡`);

    this._switchMode('summary');
  },

  // ===== 显示总结 =====
  _showSummary(summary) {
    const content = document.getElementById('summary-content');
    let zoneHTML = '';
    for (const [name, pct] of Object.entries(summary.zonePct)) {
      zoneHTML += `<div class="route-stat"><span class="stat-label">${name}</span><span class="stat-value">${pct}%</span></div>`;
    }

    content.innerHTML = `
      <div class="slide-up">
        <div style="text-align:center;margin-bottom:16px;">
          <div style="font-size:48px;">🎉</div>
          <h3 style="margin-top:8px;">骑行完成！</h3>
        </div>
        <div id="route-summary" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <div class="route-stat"><span class="stat-label">时长</span><span class="stat-value">${summary.duration}</span></div>
          <div class="route-stat"><span class="stat-label">均速</span><span class="stat-value">${summary.avgSpeed} km/h</span></div>
          <div class="route-stat"><span class="stat-label">最高速度</span><span class="stat-value">${summary.maxSpeed} km/h</span></div>
          <div class="route-stat"><span class="stat-label">平均心率</span><span class="stat-value">${summary.avgHR} bpm</span></div>
          <div class="route-stat"><span class="stat-label">最高心率</span><span class="stat-value">${summary.maxHR} bpm</span></div>
          <div class="route-stat"><span class="stat-label">消耗</span><span class="stat-value">${summary.calories} kcal</span></div>
        </div>
        <h4 style="margin:12px 0 8px;">心率区间分布</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${zoneHTML || '<p style="color:var(--text-dim);">无心率数据</p>'}
        </div>
      </div>
    `;
  },

  // ===== 保存骑行历史 =====
  _saveRideHistory(summary) {
    try {
      const history = JSON.parse(localStorage.getItem('cycling-ai-history') || '[]');
      history.unshift({
        date: new Date().toISOString(),
        ...summary,
      });
      // 只保留最近 50 条
      if (history.length > 50) history.length = 50;
      localStorage.setItem('cycling-ai-history', JSON.stringify(history));
      this._loadHistoryList();
    } catch {}
  },

  _loadHistoryList() {
    const list = document.getElementById('ride-history-list');
    try {
      const history = JSON.parse(localStorage.getItem('cycling-ai-history') || '[]');
      if (history.length === 0) {
        list.innerHTML = '<p class="empty-hint">暂无骑行记录</p>';
        return;
      }
      list.innerHTML = history.map((h, i) => `
        <div class="route-item" style="flex-direction:column;align-items:flex-start;">
          <div style="font-weight:600;">${new Date(h.date).toLocaleDateString('zh-CN')}</div>
          <div class="route-item-meta">
            ${h.duration} · ${h.avgSpeed} km/h · ${h.calories} kcal
          </div>
        </div>
      `).join('');
    } catch {
      list.innerHTML = '<p class="empty-hint">暂无骑行记录</p>';
    }
  },

  // ===== 设置 =====
  _loadSettingsUI() {
    const c = Config.getAll();
    document.getElementById('input-amap-key').value = c.amapKey || '';
    document.getElementById('input-ai-key').value = c.aiApiKey || '';
    document.getElementById('input-ai-url').value = c.aiApiUrl || '';
    document.getElementById('input-max-hr').value = c.maxHr || 190;
    document.getElementById('input-age').value = c.age || '';
    document.getElementById('select-voice-interval').value = c.voiceInterval || 60;
    document.getElementById('select-nav-voice').value = c.navVoice || 'on';
  },

  _saveSettings() {
    const age = parseInt(document.getElementById('input-age').value) || 30;
    const maxHr = parseInt(document.getElementById('input-max-hr').value) || (220 - age);

    Config.setAll({
      amapKey: document.getElementById('input-amap-key').value.trim(),
      aiApiKey: document.getElementById('input-ai-key').value.trim(),
      aiApiUrl: document.getElementById('input-ai-url').value.trim() || 'https://api.openai.com/v1/chat/completions',
      maxHr: maxHr,
      age: age,
      voiceInterval: parseInt(document.getElementById('select-voice-interval').value),
      navVoice: document.getElementById('select-nav-voice').value,
    });
  },

  // ===== Toast 提示 =====
  _showToast(msg, duration = 2500) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '120px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.85)',
      color: '#fff',
      padding: '10px 20px',
      borderRadius: '20px',
      fontSize: '14px',
      zIndex: '9999',
      transition: 'opacity 0.3s',
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
};

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', () => {
  // 先绑定基础UI事件（即使地图加载失败也能用）
  App._bindEvents();
  App._loadSettingsUI();
  App._loadHistoryList();

  // 然后异步初始化地图
  App.init().catch(err => {
    console.warn('App init error:', err);
  });
});
