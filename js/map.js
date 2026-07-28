// map.js — 高德地图集成（路线规划 + 实时导航）
const MapCtrl = {
  map: null,
  _driving: null,      // 驾车路线规划
  _riding: null,       // 骑行路线规划
  _geocoder: null,
  _autoComplete: null,
  _placeSearch: null,
  _geolocation: null,

  // 路线
  _routePlan: null,    // 当前路线方案
  _routeLine: null,    // 地图上的路线覆盖物
  _routeMarkers: [],

  // 导航状态
  _navigating: false,
  _navRoute: null,     // 导航路线步骤
  _navStepIndex: 0,
  _navPosition: null,
  _navTimer: null,
  _navCallback: null,

  // 位置
  _currentPos: null,

  // ===== 初始化 =====
  async init() {
    if (!window.AMap) {
      console.error('高德地图JS API 未加载');
      return false;
    }

    const key = Config.get('amapKey');
    if (!key) {
      console.warn('未配置高德地图 Key');
    }

    // 创建地图
    this.map = new AMap.Map('amap', {
      zoom: 14,
      viewMode: '2D',
      mapStyle: 'amap://styles/dark',
      features: ['bg', 'road', 'building'],
    });

    // 初始化服务
    this._geocoder = new AMap.Geocoder();
    this._geolocation = new AMap.Geolocation({
      enableHighAccuracy: true,
      timeout: 10000,
      buttonPosition: 'RB',
      showCircle: true,
      showMarker: true,
      panToLocation: true,
      zoomToAccuracy: true,
    });
    this.map.addControl(this._geolocation);

    // 自动补全
    try {
      this._autoComplete = new AMap.AutoComplete({ city: '全国' });
    } catch {}

    // 默认使用骑行路线规划
    this._riding = new AMap.Riding({
      map: this.map,
      policy: 0, // 推荐方案
    });

    // 备用驾车规划
    this._driving = new AMap.Driving({
      map: this.map,
      policy: AMap.DrivingPolicy.LEAST_TIME,
    });

    // 定位
    this._getCurrentPosition();

    return true;
  },

  // ===== 获取当前位置 =====
  _getCurrentPosition() {
    return new Promise((resolve) => {
      this._geolocation.getCurrentPosition((status, result) => {
        if (status === 'complete') {
          this._currentPos = result.position;
          resolve(result.position);
        } else {
          // fallback: navigator.geolocation
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const p = new AMap.LngLat(pos.coords.longitude, pos.coords.latitude);
              this._currentPos = p;
              resolve(p);
            },
            () => resolve(null),
            { enableHighAccuracy: true }
          );
        }
      });
    });
  },

  // ===== 搜索地点 =====
  async searchPlace(keyword) {
    return new Promise((resolve, reject) => {
      if (!this._autoComplete) {
        reject(new Error('搜索服务未初始化'));
        return;
      }
      this._autoComplete.search(keyword, (status, result) => {
        if (status === 'complete' && result.tips) {
          resolve(result.tips);
        } else {
          // 备用：PlaceSearch
          if (!this._placeSearch) {
            this._placeSearch = new AMap.PlaceSearch({ city: '全国', pageSize: 10 });
          }
          this._placeSearch.search(keyword, (s, r) => {
            if (s === 'complete' && r.poiList) {
              resolve(r.poiList.pois.map(poi => ({
                name: poi.name,
                address: poi.address,
                location: poi.location,
                id: poi.id,
              })));
            } else {
              reject(new Error('搜索失败'));
            }
          });
        }
      });
    });
  },

  // ===== 路线规划 =====
  async planRoute(start, end) {
    // start/end: AMap.LngLat 或 [lng, lat]
    const startLngLat = Array.isArray(start) ? new AMap.LngLat(start[0], start[1]) : start;
    const endLngLat = Array.isArray(end) ? new AMap.LngLat(end[0], end[1]) : end;

    return new Promise((resolve, reject) => {
      // 优先骑行路线
      this._riding.search(startLngLat, endLngLat, (status, result) => {
        if (status === 'complete' && result.routes && result.routes.length > 0) {
          const routes = result.routes.map((r, i) => ({
            index: i,
            distance: r.distance,         // 米
            time: r.time,                 // 秒
            steps: r.rides || r.steps || [],
            policy: r.policy || '骑行',
          }));
          this._clearRoute();
          resolve({ type: 'riding', routes });
        } else {
          // fallback 到驾车
          this._driving.search(startLngLat, endLngLat, (s, r) => {
            if (s === 'complete' && r.routes && r.routes.length > 0) {
              const routes = r.routes.map((r, i) => ({
                index: i,
                distance: r.distance,
                time: r.time,
                steps: r.steps || [],
                policy: r.policy || '驾车',
              }));
              this._clearRoute();
              resolve({ type: 'driving', routes });
            } else {
              reject(new Error('路线规划失败'));
            }
          });
        }
      });
    });
  },

  // ===== 显示路线 =====
  showRoute(routeData, routeIndex = 0) {
    this._clearRoute();
    const route = routeData.routes[routeIndex];
    if (!route) return;

    this._routePlan = { ...routeData, selected: route };

    // 绘制路线
    const path = [];
    route.steps.forEach(step => {
      if (step.path) {
        step.path.forEach(p => path.push(p));
      }
    });

    if (path.length > 0) {
      this._routeLine = new AMap.Polyline({
        path: path,
        strokeColor: '#e94560',
        strokeWeight: 6,
        strokeOpacity: 0.8,
        lineJoin: 'round',
        lineCap: 'round',
      });
      this.map.add(this._routeLine);

      // 起终点标记
      const startMarker = new AMap.Marker({
        position: path[0],
        content: '<div style="background:#00d2ff;width:16px;height:16px;border-radius:50%;border:3px solid #fff;"></div>',
        offset: new AMap.Pixel(-8, -8),
      });
      const endMarker = new AMap.Marker({
        position: path[path.length - 1],
        content: '<div style="background:#e94560;width:16px;height:16px;border-radius:50%;border:3px solid #fff;"></div>',
        offset: new AMap.Pixel(-8, -8),
      });
      this.map.add([startMarker, endMarker]);
      this._routeMarkers.push(startMarker, endMarker);

      // 调整视野
      this.map.setFitView([this._routeLine], false, [60, 60, 60, 60]);
    }

    return {
      distance: (route.distance / 1000).toFixed(1) + ' km',
      duration: this._formatTime(route.time),
      ascent: route.ascent ? route.ascent + ' m' : '--',
    };
  },

  // ===== 清除路线 =====
  _clearRoute() {
    if (this._routeLine) {
      this.map.remove(this._routeLine);
      this._routeLine = null;
    }
    this._routeMarkers.forEach(m => this.map.remove(m));
    this._routeMarkers = [];
    this._routePlan = null;
  },

  // ===== 开始导航 =====
  startNavigation(onUpdate) {
    if (!this._routePlan) return false;

    this._navigating = true;
    this._navRoute = this._routePlan.selected;
    this._navStepIndex = 0;
    this._navCallback = onUpdate;

    // 使用 GPS 追踪位置
    this._startNavTracking();

    // 发出第一条指令
    this._emitNavUpdate();

    return true;
  },

  _startNavTracking() {
    if (this._navTimer) clearInterval(this._navTimer);

    this._navTimer = setInterval(() => {
      if (!this._navigating) return;

      // 获取当前位置
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this._navPosition = new AMap.LngLat(pos.coords.longitude, pos.coords.latitude);
            this._checkNavProgress(pos.coords);
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 3000 }
        );
      }
    }, 3000);
  },

  _checkNavProgress(coords) {
    if (!this._navRoute || !this._navPosition) return;

    const steps = this._navRoute.steps;
    if (!steps || this._navStepIndex >= steps.length) return;

    const currentStep = steps[this._navStepIndex];
    if (!currentStep || !currentStep.path || currentStep.path.length === 0) return;

    // 找到当前步骤的终点
    const stepEnd = currentStep.path[currentStep.path.length - 1];
    const distToEnd = this._navPosition.distance(stepEnd);

    // 如果接近步骤终点（50米内），进入下一步
    if (distToEnd < 50) {
      this._navStepIndex++;
      this._emitNavUpdate();
    }
  },

  _emitNavUpdate() {
    const steps = this._navRoute.steps;
    if (!steps || this._navStepIndex >= steps.length) {
      // 导航结束
      this._navigating = false;
      if (this._navCallback) {
        this._navCallback({
          type: 'arrived',
          message: '您已到达目的地',
        });
      }
      return;
    }

    const step = steps[this._navStepIndex];
    const instruction = step.instruction || step.action || '继续前行';
    const road = step.road || '';
    const distance = step.distance ? this._formatDistance(step.distance) : '';

    if (this._navCallback) {
      this._navCallback({
        type: 'navigate',
        instruction,
        road,
        distance,
        stepIndex: this._navStepIndex,
        totalSteps: steps.length,
        maneuver: step.action || '',
      });
    }
  },

  // ===== 停止导航 =====
  stopNavigation() {
    this._navigating = false;
    if (this._navTimer) {
      clearInterval(this._navTimer);
      this._navTimer = null;
    }
    this._navCallback = null;
    this._clearRoute();
  },

  isNavigating() {
    return this._navigating;
  },

  // ===== 地图跟随模式 =====
  followPosition() {
    this.map.setStatus({ dragEnable: false });
  },

  unlockPosition() {
    this.map.setStatus({ dragEnable: true });
  },

  // ===== 工具函数 =====
  _formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}小时${m}分钟`;
    return `${m}分钟`;
  },

  _formatDistance(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(1) + '公里';
    return Math.round(meters) + '米';
  },

  // ===== 清理 =====
  destroy() {
    this.stopNavigation();
    this._clearRoute();
    if (this.map) {
      this.map.destroy();
    }
  }
};
