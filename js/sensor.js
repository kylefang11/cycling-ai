// sensor.js — 传感器接入（Web Bluetooth + GPS速度 + 手动输入）
const Sensor = {
  // 心率
  _hrDevice: null,
  _hrChar: null,
  _hr: null,
  _hrCallback: null,

  // 踏频
  _cadDevice: null,
  _cadChar: null,
  _cadence: null,
  _cadCallback: null,

  // GPS 速度
  _gpsSpeed: 0,  // m/s
  _watchId: null,

  // 状态
  connected: { hr: false, cadence: false },

  // ===== 心率连接 =====
  async connectHR() {
    try {
      if (!navigator.bluetooth) {
        throw new Error('此浏览器不支持蓝牙，请使用Safari 16+');
      }

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['heart_rate']
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('heart_rate');
      const char = await service.getCharacteristic('heart_rate_measurement');

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = e.target.value;
        // 解析心率数据 (Flags 字节 + HR值)
        const flags = value.getUint8(0);
        let hr;
        if (flags & 0x01) {
          // 16-bit HR
          hr = value.getUint16(1, true);
        } else {
          // 8-bit HR
          hr = value.getUint8(1);
        }
        this._hr = hr;
        if (this._hrCallback) this._hrCallback(hr);
      });

      this._hrDevice = device;
      this._hrChar = char;
      this.connected.hr = true;

      device.addEventListener('gattserverdisconnected', () => {
        this.connected.hr = false;
        this._hr = null;
        if (this._hrCallback) this._hrCallback(null);
      });

      return true;
    } catch (err) {
      console.warn('心率连接失败:', err);
      throw err;
    }
  },

  // ===== 踏频连接 =====
  async connectCadence() {
    try {
      if (!navigator.bluetooth) {
        throw new Error('此浏览器不支持蓝牙');
      }

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_speed_and_cadence'] }],
        optionalServices: ['cycling_speed_and_cadence']
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('cycling_speed_and_cadence');
      // 0x2A5B = CSC Measurement
      const char = await service.getCharacteristic(0x2a5b);

      let lastCrankTime = null;
      let lastCrankRevs = null;

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const value = e.target.value;
        const flags = value.getUint8(0);

        let offset = 1;
        // Crank data present (bit 1)
        if (flags & 0x02) {
          const cumlCrankRevs = value.getUint16(offset, true);
          offset += 2;
          const lastCrankEventTime = value.getUint16(offset, true); // 1/1024 sec

          if (lastCrankTime !== null) {
            let timeDiff = (lastCrankEventTime - lastCrankTime) / 1024; // seconds
            if (timeDiff < 0) timeDiff += 64; // wrap around
            if (timeDiff > 0) {
              const revDiff = cumlCrankRevs - lastCrankRevs;
              this._cadence = Math.round((revDiff / timeDiff) * 60); // rpm
              if (this._cadence > 200) this._cadence = 200; // sanity cap
              if (this._cadCallback) this._cadCallback(this._cadence);
            }
          }
          lastCrankRevs = cumlCrankRevs;
          lastCrankTime = lastCrankEventTime;
        }
      });

      this._cadDevice = device;
      this._cadChar = char;
      this.connected.cadence = true;

      device.addEventListener('gattserverdisconnected', () => {
        this.connected.cadence = false;
        this._cadence = null;
        if (this._cadCallback) this._cadCallback(null);
      });

      return true;
    } catch (err) {
      console.warn('踏频连接失败:', err);
      throw err;
    }
  },

  // ===== GPS 速度追踪 =====
  startGPS(onSpeed) {
    if (!navigator.geolocation) return;

    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // speed 属性：m/s，可能为 null
        this._gpsSpeed = pos.coords.speed || 0;
        if (onSpeed) onSpeed(this._gpsSpeed * 3.6); // 转 km/h
      },
      (err) => console.warn('GPS 错误:', err),
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000
      }
    );
  },

  stopGPS() {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this._gpsSpeed = 0;
  },

  // ===== 回调注册 =====
  onHeartRate(cb) { this._hrCallback = cb; },
  onCadence(cb) { this._cadCallback = cb; },

  // ===== 获取当前值 =====
  getHR() { return this._hr; },
  getCadence() { return this._cadence; },
  getGPSSpeedKmh() { return this._gpsSpeed * 3.6; },

  // ===== 估算踏频（无传感器时） =====
  // 埇设齿比，用速度估算踏频
  estimateCadence(speedKmh) {
    // 假设 700c 轮胎，齿比约 2.5:1 (42T/16T)
    // 轮周约 2.1m
    // cadence(rpm) = speed(km/h) * 1000 / 60 / 2.1 / gearRatio
    const wheelCirc = 2.1; // 米
    const gearRatio = 2.5;
    const speedMs = speedKmh / 3.6;
    const wheelRps = speedMs / wheelCirc;
    const cadence = Math.round(wheelRps / gearRatio * 60);
    return Math.min(cadence, 150);
  },

  // ===== 全部断开 =====
  disconnectAll() {
    if (this._hrDevice?.gatt.connected) {
      this._hrDevice.gatt.disconnect();
    }
    if (this._cadDevice?.gatt.connected) {
      this._cadDevice.gatt.disconnect();
    }
    this.stopGPS();
  }
};
