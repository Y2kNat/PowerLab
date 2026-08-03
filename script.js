(function() {
  'use strict';

  var DB = {};

  var dbFiles = {
    ampacity: '/data/ampacity.json',
    circuitBreakers: '/data/circuit_breakers.json',
    groupingFactors: '/data/grouping_factors.json',
    loadDatabase: '/data/load_database.json',
    minimumSections: '/data/minimum_sections.json',
    settings: '/data/nbr5410_settings.json',
    neutralConductor: '/data/neutral_conductor.json',
    protectiveConductorPE: '/data/protective_conductor_PE.json',
    temperatureCorrection: '/data/temperature_correction.json',
    voltageDrop: '/data/voltage_drop.json'
  };

  var dbReady = false;

  async function loadAllDatabases() {
    var keys = Object.keys(dbFiles);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      try {
        var resp = await fetch(dbFiles[key]);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        DB[key] = await resp.json();
      } catch (err) {
        console.warn('Falha ao carregar ' + key + ': ' + err.message);
        DB[key] = null;
      }
    }
    dbReady = true;
  }

  function getAmpacity(material, insulation, method, section) {
    if (!DB.ampacity) return 0;
    try {
      return DB.ampacity[material][insulation][method][String(section)].current_capacity_A;
    } catch (e) {
      return 0;
    }
  }

  function getTemperatureFactor(temperature, insulation) {
    if (!DB.temperatureCorrection) return 1;
    var table = DB.temperatureCorrection[insulation] || DB.temperatureCorrection['PVC'];
    if (!table) return 1;
    var temps = Object.keys(table).map(Number).sort(function(a, b) { return a - b; });
    for (var i = 0; i < temps.length; i++) {
      if (temperature <= temps[i]) return table[String(temps[i])].factor;
    }
    return table[String(temps[temps.length - 1])].factor;
  }

  function getGroupingFactor(numCircuits) {
    if (!DB.groupingFactors || !DB.groupingFactors.factors) return 1;
    var n = Math.min(Math.max(1, numCircuits), 20);
    var entry = DB.groupingFactors.factors[String(n)];
    return entry ? entry.factor : 1;
  }

  function getLoadedConductorsFactor(n) {
    if (!DB.groupingFactors || !DB.groupingFactors.loaded_conductors) return 1;
    var entry = DB.groupingFactors.loaded_conductors[String(n)];
    return entry ? entry.factor_multiplier : 1;
  }

  function getBreakerList() {
    if (!DB.circuitBreakers || !DB.circuitBreakers.standard_breakers) return [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100];
    return DB.circuitBreakers.standard_breakers.map(function(b) { return b.rated_current_A; });
  }

  function getStandardSections() {
    if (!DB.settings || !DB.settings.standard_cable_sections_mm2) {
      return [1.5, 2.5, 4, 6, 10, 16, 25, 35];
    }
    return DB.settings.standard_cable_sections_mm2;
  }

  function getMinCableSize(circuitType) {
    if (!DB.minimumSections) {
      if (circuitType === 'tue') return 4;
      if (circuitType === 'tug') return 2.5;
      return 1.5;
    }
    if (circuitType === 'tue') return DB.minimumSections.specific_purpose_outlets.phase_conductor_mm2;
    if (circuitType === 'tug') return DB.minimumSections.general_purpose_outlets.phase_conductor_mm2;
    return DB.minimumSections.lighting.phase_conductor_mm2;
  }

  function getPESection(phaseSection) {
    if (!DB.protectiveConductorPE || !DB.protectiveConductorPE.sizing_table) {
      if (phaseSection <= 16) return phaseSection;
      if (phaseSection <= 35) return 16;
      return Math.floor(phaseSection / 2);
    }
    var table = DB.protectiveConductorPE.sizing_table.common_values;
    for (var i = 0; i < table.length; i++) {
      if (table[i].phase_mm2 === phaseSection) return table[i].PE_mm2;
    }
    if (phaseSection <= 16) return phaseSection;
    if (phaseSection <= 35) return 16;
    return Math.floor(phaseSection / 2);
  }

  function getNeutralSection(phaseSection, connectionType) {
    if (connectionType === 'phase-phase') return null;
    if (!DB.neutralConductor || !DB.neutralConductor.common_values) {
      if (connectionType === 'phase-neutral') return phaseSection;
      if (phaseSection > 25) return Math.max(25, Math.floor(phaseSection / 2));
      return phaseSection;
    }
    if (connectionType === 'phase-neutral') return phaseSection;
    var table = DB.neutralConductor.common_values;
    for (var i = 0; i < table.length; i++) {
      if (table[i].phase_mm2 === phaseSection && table[i].application === 'Trifásico balanceado') {
        return table[i].neutral_mm2;
      }
    }
    if (phaseSection > 25) return Math.max(25, Math.floor(phaseSection / 2));
    return phaseSection;
  }

  function getVoltageDropData(material, section) {
    if (!DB.voltageDrop) return { R: 0, X: 0 };
    try {
      var data = DB.voltageDrop[material][String(section)];
      return { R: data.resistance_ohm_per_km, X: data.reactance_ohm_per_km };
    } catch (e) {
      return { R: 0, X: 0 };
    }
  }

  function getDefaultPowerFactor() {
    if (DB.settings && DB.settings.default_power_factor) return DB.settings.default_power_factor;
    return 0.92;
  }

  var advancedToggle = document.getElementById('advanced-toggle');
  var advancedSection = document.getElementById('advanced-section');

  if (advancedToggle && advancedSection) {
    advancedToggle.addEventListener('click', function() {
      var isOpen = advancedSection.classList.contains('visible');
      if (isOpen) {
        advancedSection.classList.remove('visible');
        advancedToggle.classList.remove('open');
      } else {
        advancedSection.classList.add('visible');
        advancedToggle.classList.add('open');
      }
    });
  }

  var powerFactorSelect = document.getElementById('powerFactorSelect');

  function getUserPowerFactor() {
    if (powerFactorSelect) {
      var val = parseFloat(powerFactorSelect.value);
      if (!isNaN(val) && val > 0 && val <= 1) return val;
    }
    return getDefaultPowerFactor();
  }

  class Particle {
    constructor(baseX, baseY, baseZ, size) {
      this.baseX = baseX;
      this.baseY = baseY;
      this.baseZ = baseZ;
      this.x = baseX;
      this.y = baseY;
      this.z = baseZ;
      this.size = size;
    }
    reset() {
      this.x = this.baseX;
      this.y = this.baseY;
      this.z = this.baseZ;
    }
  }

  class Camera {
    constructor() {
      this.z = 0;
      this.fov = 60;
      this.focalLength = 1.0 / Math.tan((this.fov * 0.5) * Math.PI / 180.0);
      this.near = 0.1;
    }
    project(px, py, pz, sw, sh) {
      var dz = pz - this.z;
      if (dz < this.near) return null;
      var scale = this.focalLength / dz;
      return {
        x: (px - 0) * scale * (sw / 2) + sw / 2,
        y: -py * scale * (sh / 2) + sh / 2,
        z: dz,
        scale: scale
      };
    }
  }

  class SpiralAnimation {
    constructor(canvas, textElement, onComplete) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.textElement = textElement;
      this.onComplete = onComplete;
      this.particles = [];
      this.camera = new Camera();
      this.animationId = null;
      this.startTime = null;
      this.isFinished = false;
      this.fadeOutStart = null;
      this.holdStart = null;
      this.textOpacity = 0;
      this.animDuration = 4000;
      this.fadeOutDuration = 400;
      this.holdDuration = 150;
      this.textFadeDelay = 1000;
      this.textFadeDuration = 600;
      this.spiralLoops = 5;
      this.spiralRadius = 4.5;
      this.spiralHeight = 14.0;
      this.particleCount = 2000;
      this.baseSize = 2.0;
      this.sizeVar = 0.8;
      this.initParticles();
      this.resize();
      window.addEventListener('resize', this.resize.bind(this));
    }

    initParticles() {
      for (var i = 0; i < this.particleCount; i++) {
        var t = i / (this.particleCount - 1);
        var angle = t * Math.PI * 2 * this.spiralLoops;
        var radiusVar = 0.3 * Math.sin(t * 30) + 0.2;
        var radius = this.spiralRadius * (0.7 + t * 0.3) + (Math.random() - 0.5) * radiusVar;
        var x = Math.cos(angle) * radius;
        var y = Math.sin(angle) * radius;
        var z = -t * this.spiralHeight + (Math.random() - 0.5) * 0.8;
        var size = this.baseSize + (Math.random() - 0.5) * this.sizeVar;
        this.particles.push(new Particle(x, y, z, Math.max(0.6, size)));
      }
      this.camera.z = 2.5;
      this.initialZ = this.camera.z;
      this.finalZ = -this.spiralHeight - 2.0;
    }

    resize() {
      var dpr = window.devicePixelRatio || 1;
      var dw = window.innerWidth;
      var dh = window.innerHeight;
      this.canvas.width = dw * dpr;
      this.canvas.height = dh * dpr;
      this.canvas.style.width = dw + 'px';
      this.canvas.style.height = dh + 'px';
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
      this.dw = dw;
      this.dh = dh;
    }

    start() {
      if (this.animationId) return;
      this.startTime = performance.now();
      this.holdStart = null;
      this.fadeOutStart = null;
      this.isFinished = false;
      this.textOpacity = 0;
      this.textElement.style.opacity = '0';
      this.particles.forEach(function(p) { p.reset(); });
      this.camera.z = this.initialZ;
      this.animate(performance.now());
    }

    animate(timestamp) {
      if (this.isFinished) return;
      var elapsed = timestamp - this.startTime;
      var self = this;

      if (elapsed < this.animDuration) {
        this.update(elapsed / this.animDuration);
      } else if (!this.holdStart) {
        this.holdStart = timestamp;
        this.update(1.0);
      } else if (elapsed < this.animDuration + this.holdDuration + this.fadeOutDuration) {
        if (!this.fadeOutStart) this.fadeOutStart = timestamp;
        var fe = timestamp - this.fadeOutStart;
        var fp = Math.min(1.0, fe / this.fadeOutDuration);
        var ef = this.easeInOutQuad(fp);
        var co = 1.0 - ef;
        this.ctx.clearRect(0, 0, this.dw, this.dh);
        if (co > 0.01) {
          this.ctx.globalAlpha = co;
          this.render(1.0);
          this.ctx.globalAlpha = 1.0;
        }
        this.textElement.style.opacity = Math.max(0, this.textOpacity - ef);
      } else {
        this.finish();
        return;
      }

      if (elapsed < this.animDuration + this.holdDuration) {
        this.updateText(elapsed);
      }

      this.animationId = requestAnimationFrame(function(t) { self.animate(t); });
    }

    update(progress) {
      var ep = this.easeInOutCubic(progress);
      this.camera.z = this.initialZ + (this.finalZ - this.initialZ) * ep;
      var ef = 1.0 + progress * 0.5;
      this.particles.forEach(function(p) {
        p.x = p.baseX * ef;
        p.y = p.baseY * ef;
      });
      this.ctx.clearRect(0, 0, this.dw, this.dh);
      this.ctx.globalAlpha = 1.0;
      this.render(progress);
    }

    render(progress) {
      var ctx = this.ctx;
      var cam = this.camera;
      var w = this.dw;
      var h = this.dh;
      var projected = [];

      for (var i = 0; i < this.particles.length; i++) {
        var p = this.particles[i];
        var proj = cam.project(p.x, p.y, p.z, w, h);
        if (proj) {
          projected.push({
            x: proj.x,
            y: proj.y,
            z: proj.z,
            size: p.size * proj.scale * 0.9,
            origSize: p.size
          });
        }
      }

      projected.sort(function(a, b) { return b.z - a.z; });

      for (var j = 0; j < projected.length; j++) {
        var pt = projected[j];
        var df = Math.min(1.0, Math.max(0.2, 1.0 - (pt.z / 18.0)));
        var br = 0.7 + (pt.origSize / (this.baseSize + this.sizeVar)) * 0.3;
        var alpha = df * br * 0.9;
        ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha + ')';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(0.4, pt.size * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    updateText(elapsed) {
      if (elapsed >= this.textFadeDelay) {
        var fp = Math.min(1.0, (elapsed - this.textFadeDelay) / this.textFadeDuration);
        var ef = this.easeInOutQuad(fp);
        var bp = 3200;
        var bph = (elapsed - this.textFadeDelay) / bp;
        var br = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(bph * Math.PI * 2));
        this.textOpacity = ef * br;
        this.textElement.style.opacity = this.textOpacity;
      }
    }

    finish() {
      this.isFinished = true;
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      this.ctx.clearRect(0, 0, this.dw, this.dh);
      this.textElement.style.opacity = '0';

      var overlay = document.getElementById('loading-overlay');
      var mainWrapper = document.getElementById('main-wrapper');

      overlay.style.filter = 'blur(30px)';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';

      mainWrapper.classList.add('blur-in');

      setTimeout(function() {
        mainWrapper.classList.remove('blur-in');
      }, 100);

      setTimeout(function() {
        overlay.style.display = 'none';
        document.body.classList.add('loaded');
        if (this.onComplete) this.onComplete();
      }.bind(this), 1000);
    }

    easeInOutQuad(t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    }
  }

  var form = document.getElementById('calc-form');
  var resultContainer = document.getElementById('result-container');
  var calcReport = document.getElementById('calculation-report');
  var reportAlternative = document.getElementById('report-alternative');
  var navLinks = document.querySelectorAll('.nav-links a');
  var menuToggle = document.getElementById('menu-toggle');
  var navLinksContainer = document.getElementById('nav-links');
  var voltageInput = document.getElementById('voltage');
  var powerInput = document.getElementById('power');
  var lengthInput = document.getElementById('length');
  var connectionTypeSelect = document.getElementById('connectionType');
  var circuitTypeSelect = document.getElementById('circuitType');
  var installMethodSelect = document.getElementById('installMethod');
  var safetyMarginSelect = document.getElementById('safetyMargin');
  var materialSelect = document.getElementById('material');
  var ambientConditionSelect = document.getElementById('ambientCondition');
  var groupedCircuitsInput = document.getElementById('groupedCircuits');
  var loadedConductorsSelect = document.getElementById('loadedConductors');
  var maxDropInput = document.getElementById('maxDrop');
  var powerErrorEl = document.getElementById('power-error');
  var lengthErrorEl = document.getElementById('length-error');

  var allInputs = [voltageInput, powerInput, lengthInput, connectionTypeSelect, circuitTypeSelect, installMethodSelect, safetyMarginSelect, materialSelect, ambientConditionSelect, groupedCircuitsInput, loadedConductorsSelect, maxDropInput];
  if (powerFactorSelect) allInputs.push(powerFactorSelect);

  function getAmbientTemperature(condition) {
    if (condition === 'hot') return 40;
    if (condition === 'veryHot') return 50;
    return 30;
  }

  function calculateVoltageDrop(current, length, material, section, voltage, connectionType, pf) {
    var vdData = getVoltageDropData(material, section);
    var R = (vdData.R * length) / 1000;
    var X = (vdData.X * length) / 1000;
    var sinPhi = Math.sin(Math.acos(pf));
    if (connectionType === 'three-phase') {
      return Math.sqrt(3) * current * (R * pf + X * sinPhi);
    }
    return 2 * current * (R * pf + X * sinPhi);
  }

  function calculateDesignCurrent(power, voltage, connectionType, pf) {
    if (connectionType === 'three-phase') {
      return power / (Math.sqrt(3) * voltage * pf);
    }
    return power / (voltage * pf);
  }

  function selectBreaker(ib, iz) {
    var breakers = getBreakerList();
    for (var i = 0; i < breakers.length; i++) {
      if (breakers[i] >= ib && breakers[i] <= iz) return breakers[i];
    }
    for (var j = breakers.length - 1; j >= 0; j--) {
      if (breakers[j] <= iz) return breakers[j];
    }
    return breakers[0] || 6;
  }

  function getNextStandardSection(currentSection, material) {
    var sections = getStandardSections();
    var idx = sections.indexOf(currentSection);
    if (idx === -1) return currentSection;
    for (var i = idx + 1; i < sections.length; i++) {
      if (getAmpacity(material, 'PVC', 'B1', sections[i]) > 0) return sections[i];
    }
    return currentSection;
  }

  function getSafetyMarginSection(baseSection, material, marginLevel) {
    if (marginLevel === 'minimum') return baseSection;
    if (marginLevel === 'recommended') {
      var next = getNextStandardSection(baseSection, material);
      return next !== baseSection ? next : baseSection;
    }
    if (marginLevel === 'high') {
      var first = getNextStandardSection(baseSection, material);
      if (first === baseSection) return baseSection;
      var second = getNextStandardSection(first, material);
      return second !== first ? second : first;
    }
    return baseSection;
  }

  function evaluateThermalMargin(ib, iz) {
    if (iz <= 0) return { ratio: 1, marginPercent: 0, level: 'error', message: 'Capacidade do cabo inválida' };
    var ratio = ib / iz;
    var marginPercent = ((iz - ib) / iz) * 100;
    if (ratio <= 0.80) {
      return { ratio: ratio, marginPercent: marginPercent, level: 'safe', message: 'Boa margem de segurança entre corrente de projeto e capacidade do cabo.' };
    } else if (ratio <= 0.90) {
      return { ratio: ratio, marginPercent: marginPercent, level: 'attention', message: 'Condutor operando próximo da capacidade máxima. Considere aumentar a seção.' };
    } else if (ratio <= 1.00) {
      return { ratio: ratio, marginPercent: marginPercent, level: 'warning', message: 'Cabo atende à NBR 5410, porém trabalha próximo ao limite térmico.' };
    } else {
      return { ratio: ratio, marginPercent: marginPercent, level: 'error', message: 'Cabo não suporta a corrente de projeto.' };
    }
  }

  function evaluateVoltageDropMargin(vdPercent, maxDrop) {
    if (maxDrop - vdPercent <= 0.2) {
      return { withinLimit: true, lowMargin: true };
    }
    return { withinLimit: true, lowMargin: false };
  }

  function generateReason(selectedSection, ib, iz, vdPercent, maxDrop, minSize, rejectedSection, connectionType, breaker, alternativeSection, marginLevel, thermalEval) {
    var parts = [];
    var matLabel = materialSelect.value === 'copper' ? 'Cobre' : 'Alumínio';
    parts.push(selectedSection + ' mm² ' + matLabel + ' selecionado conforme NBR 5410');
    parts.push('Ib (' + ib.toFixed(1) + 'A) ≤ In (' + breaker + 'A) ≤ Iz (' + iz.toFixed(1) + 'A)');
    if (vdPercent <= maxDrop) {
      if (maxDrop - vdPercent <= 0.2) {
        parts.push('Queda de tensão ' + vdPercent.toFixed(2) + '% dentro do limite máximo (' + maxDrop + '%), porém com margem muito reduzida');
      } else {
        parts.push('Queda de tensão ' + vdPercent.toFixed(2) + '% ≤ ' + maxDrop + '%');
      }
    }
    if (minSize > 0 && selectedSection >= minSize) {
      parts.push('Seção ≥ mínima exigida (' + minSize + ' mm²)');
    }
    if (rejectedSection && rejectedSection < selectedSection) {
      parts.push(rejectedSection + ' mm² rejeitada por não atender todos os critérios simultaneamente');
    }
    if (marginLevel === 'recommended' || marginLevel === 'high') {
      parts.push('Margem de segurança aplicada: seção aumentada conforme preferência do usuário');
    }
    if (thermalEval) {
      parts.push('Margem térmica: ' + thermalEval.marginPercent.toFixed(1) + '% (' + thermalEval.message + ')');
    }
    if (alternativeSection && alternativeSection > selectedSection) {
      parts.push('Recomenda-se avaliar ' + alternativeSection + ' mm² para maior margem de segurança e flexibilidade futura');
    }
    return parts.join('; ') + '.';
  }

  function clearFieldErrors() {
    if (powerErrorEl) powerErrorEl.classList.remove('visible');
    if (lengthErrorEl) lengthErrorEl.classList.remove('visible');
    if (powerInput) powerInput.classList.remove('error');
    if (lengthInput) lengthInput.classList.remove('error');
  }

  function showFieldError(inputEl, errorEl, message) {
    if (inputEl) inputEl.classList.add('error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add('visible');
    }
  }

  function hideResults() {
    resultContainer.style.display = 'none';
    calcReport.style.display = 'none';
    reportAlternative.style.display = 'none';
    document.getElementById('res-current').textContent = '0';
    document.getElementById('res-cable').textContent = '--';
    document.getElementById('res-breaker').textContent = '--';
    document.getElementById('res-ampacity').textContent = '0';
    document.getElementById('res-drop-v').textContent = '0';
    document.getElementById('res-drop-pct').textContent = '0';
    document.getElementById('res-factors').textContent = '--';
    document.getElementById('res-status').textContent = '--';
    document.getElementById('safety-message').innerHTML = '';
  }

  function performCalculation(e) {
    if (e) e.preventDefault();
    if (!dbReady) {
      alert('Bases de dados ainda estão carregando. Aguarde.');
      return;
    }

    clearFieldErrors();

    var powerValue = powerInput.value.trim();
    var lengthValue = lengthInput.value.trim();
    var hasError = false;

    if (!powerValue || isNaN(parseFloat(powerValue)) || parseFloat(powerValue) <= 0) {
      showFieldError(powerInput, powerErrorEl, 'Informe a potência do equipamento.');
      hasError = true;
    }

    if (!lengthValue || isNaN(parseFloat(lengthValue)) || parseFloat(lengthValue) <= 0) {
      showFieldError(lengthInput, lengthErrorEl, 'Informe o comprimento do cabo.');
      hasError = true;
    }

    if (hasError) {
      hideResults();
      return;
    }

    var V = parseFloat(voltageInput.value);
    var P = parseFloat(powerValue);
    var L = parseFloat(lengthValue);
    var connectionType = connectionTypeSelect.value;
    var circuitType = circuitTypeSelect.value;
    var method = installMethodSelect.value;
    var marginLevel = safetyMarginSelect.value;
    var mat = materialSelect.value;
    var ambientCondition = ambientConditionSelect.value;
    var groupedCircuits = parseInt(groupedCircuitsInput.value) || 1;
    var loadedConductors = parseInt(loadedConductorsSelect.value) || 2;
    var maxDrop = parseFloat(maxDropInput.value);
    var pf = getUserPowerFactor();
    var Ta = getAmbientTemperature(ambientCondition);

    if (isNaN(V) || V <= 0 || isNaN(P) || P <= 0 || isNaN(L) || L <= 0) {
      hideResults();
      return;
    }

    var Ib = calculateDesignCurrent(P, V, connectionType, pf);
    if (Ib <= 0) {
      hideResults();
      return;
    }

    var insulation = 'PVC';
    var ft = getTemperatureFactor(Ta, insulation);
    var fg = getGroupingFactor(groupedCircuits);
    var fc = getLoadedConductorsFactor(loadedConductors);
    var ftotal = ft * fg * fc;
    var minSize = getMinCableSize(circuitType);

    var sections = getStandardSections();
    var selSizeByAmpacity = null;
    var baseAmpByAmpacity = 0;
    var correctedAmpByAmpacity = 0;

    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (s < minSize) continue;
      var ba = getAmpacity(mat, insulation, method, s);
      if (ba === 0) continue;
      var correctedAmp = ba * ftotal;
      if (correctedAmp >= Ib) {
        selSizeByAmpacity = s;
        baseAmpByAmpacity = ba;
        correctedAmpByAmpacity = correctedAmp;
        break;
      }
    }

    if (!selSizeByAmpacity) {
      selSizeByAmpacity = sections[sections.length - 1];
      baseAmpByAmpacity = getAmpacity(mat, insulation, method, selSizeByAmpacity);
      correctedAmpByAmpacity = baseAmpByAmpacity * ftotal;
    }

    var finalSection = selSizeByAmpacity;
    var finalBaseAmp = baseAmpByAmpacity;
    var finalCorrectedAmp = correctedAmpByAmpacity;
    var rejectedSection = null;

    var startIdx = sections.indexOf(selSizeByAmpacity);
    for (var k = startIdx; k < sections.length; k++) {
      var testSection = sections[k];
      var testBaseAmp = getAmpacity(mat, insulation, method, testSection);
      if (testBaseAmp === 0) continue;
      var testCorrectedAmp = testBaseAmp * ftotal;
      var vd = calculateVoltageDrop(Ib, L, mat, testSection, V, connectionType, pf);
      var dropPct = (vd / V) * 100;
      if (testCorrectedAmp >= Ib && dropPct <= maxDrop) {
        finalSection = testSection;
        finalBaseAmp = testBaseAmp;
        finalCorrectedAmp = testCorrectedAmp;
        break;
      }
      if (testSection < sections[sections.length - 1] && (testCorrectedAmp < Ib || dropPct > maxDrop)) {
        rejectedSection = testSection;
      }
    }

    if (finalSection === selSizeByAmpacity) {
      var vdFirst = calculateVoltageDrop(Ib, L, mat, finalSection, V, connectionType, pf);
      var dropFirst = (vdFirst / V) * 100;
      if (dropFirst > maxDrop || finalCorrectedAmp < Ib) {
        for (var m = sections.indexOf(finalSection) + 1; m < sections.length; m++) {
          var nextSection = sections[m];
          var nextBaseAmp = getAmpacity(mat, insulation, method, nextSection);
          if (nextBaseAmp === 0) continue;
          var nextCorrectedAmp = nextBaseAmp * ftotal;
          var vdNext = calculateVoltageDrop(Ib, L, mat, nextSection, V, connectionType, pf);
          var dropNext = (vdNext / V) * 100;
          if (nextCorrectedAmp >= Ib && dropNext <= maxDrop) {
            rejectedSection = finalSection;
            finalSection = nextSection;
            finalBaseAmp = nextBaseAmp;
            finalCorrectedAmp = nextCorrectedAmp;
            break;
          }
        }
      }
    }

    var safetySection = getSafetyMarginSection(finalSection, mat, marginLevel);
    if (safetySection > finalSection) {
      var safetyBaseAmp = getAmpacity(mat, insulation, method, safetySection);
      var safetyCorrectedAmp = safetyBaseAmp * ftotal;
      var safetyVd = calculateVoltageDrop(Ib, L, mat, safetySection, V, connectionType, pf);
      var safetyDropPct = (safetyVd / V) * 100;
      if (safetyCorrectedAmp >= Ib && safetyDropPct <= maxDrop) {
        if (marginLevel !== 'minimum') {
          rejectedSection = finalSection;
          finalSection = safetySection;
          finalBaseAmp = safetyBaseAmp;
          finalCorrectedAmp = safetyCorrectedAmp;
        }
      }
    }

    var vDrop = calculateVoltageDrop(Ib, L, mat, finalSection, V, connectionType, pf);
    var dropPct = (vDrop / V) * 100;
    var breaker = selectBreaker(Ib, finalCorrectedAmp);

    var thermalEval = evaluateThermalMargin(Ib, finalCorrectedAmp);
    var vdMargin = evaluateVoltageDropMargin(dropPct, maxDrop);

    var minSizeOk = finalSection >= minSize;
    var ibInIzOk = Ib <= breaker && breaker <= finalCorrectedAmp;
    var vdOk = dropPct <= maxDrop;

    var alternativeSection = null;
    var statusText = 'Seguro';
    var statusColor = '#2e7d32';
    var statusClass = 'safe';

    if (!ibInIzOk || !vdOk || !minSizeOk || thermalEval.level === 'error') {
      statusText = 'Alerta - O dimensionamento precisa ser revisado.';
      statusColor = '#c62828';
      statusClass = 'warning';
    } else if (thermalEval.level === 'warning') {
      statusText = 'Atenção - Margem de segurança reduzida';
      statusColor = '#e65100';
      statusClass = 'warning';
      alternativeSection = getNextStandardSection(finalSection, mat);
      if (alternativeSection === finalSection) alternativeSection = null;
    } else if (thermalEval.level === 'attention') {
      statusText = 'Atenção';
      statusColor = '#e65100';
      statusClass = 'warning';
      alternativeSection = getNextStandardSection(finalSection, mat);
      if (alternativeSection === finalSection) alternativeSection = null;
    } else if (vdMargin.lowMargin) {
      statusText = 'Atenção - Queda de tensão próxima ao limite';
      statusColor = '#e65100';
      statusClass = 'warning';
    } else {
      statusText = 'Seguro';
    }

    var circuitTypeLabel = '';
    if (circuitType === 'tue') circuitTypeLabel = 'TUE';
    else if (circuitType === 'tug') circuitTypeLabel = 'TUG';
    else circuitTypeLabel = 'Iluminação';

    var connLabel = '';
    if (connectionType === 'phase-neutral') connLabel = 'Fase-Neutro (FN)';
    else if (connectionType === 'phase-phase') connLabel = 'Fase-Fase (FF)';
    else connLabel = 'Trifásico (3F)';

    var phaseConductorsText = '';
    if (connectionType === 'phase-phase') {
      phaseConductorsText = '2 x ' + finalSection + ' mm² ' + (mat === 'copper' ? 'Cobre' : 'Alumínio');
    } else if (connectionType === 'three-phase') {
      phaseConductorsText = '3 x ' + finalSection + ' mm² ' + (mat === 'copper' ? 'Cobre' : 'Alumínio');
    } else {
      phaseConductorsText = '1 x ' + finalSection + ' mm² ' + (mat === 'copper' ? 'Cobre' : 'Alumínio');
    }

    var neutralSection = getNeutralSection(finalSection, connectionType);
    var neutralText = '';
    if (neutralSection === null) {
      neutralText = 'Não aplicável (ligação fase-fase)';
    } else {
      neutralText = neutralSection + ' mm² ' + (mat === 'copper' ? 'Cobre' : 'Alumínio');
    }

    var peSection = getPESection(finalSection);
    var peText = peSection + ' mm² ' + (mat === 'copper' ? 'Cobre' : 'Alumínio');

    var reasonText = generateReason(finalSection, Ib, finalCorrectedAmp, dropPct, maxDrop, minSize, rejectedSection, connectionType, breaker, alternativeSection, marginLevel, thermalEval);

    document.getElementById('res-current').textContent = Ib.toFixed(2) + ' A';
    document.getElementById('res-cable').textContent = phaseConductorsText + ' [' + circuitTypeLabel + '|' + connLabel.split(' ')[0] + ']';
    document.getElementById('res-breaker').textContent = breaker + ' A (Curva C)';
    document.getElementById('res-ampacity').textContent = finalCorrectedAmp.toFixed(2) + ' A';
    document.getElementById('res-drop-v').textContent = vDrop.toFixed(2) + ' V';
    document.getElementById('res-drop-pct').textContent = dropPct.toFixed(2) + ' %';
    document.getElementById('res-factors').textContent = 'Temp: ' + ft.toFixed(2) + ' | Agrup: ' + fg.toFixed(2) + ' | Cond: ' + fc.toFixed(2) + ' (Total: ' + ftotal.toFixed(2) + ')';

    var st = document.getElementById('res-status');
    st.textContent = statusText;
    st.style.color = statusColor;

    var msg = document.getElementById('safety-message');
    if (statusClass === 'safe') {
      msg.innerHTML = '<i class="fas fa-check-circle"></i> ' + thermalEval.message;
      msg.className = 'safety-message safe';
    } else if (thermalEval.level === 'warning') {
      msg.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + thermalEval.message;
      msg.className = 'safety-message warning';
    } else if (thermalEval.level === 'attention') {
      msg.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + thermalEval.message;
      msg.className = 'safety-message warning';
    } else {
      msg.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + thermalEval.message;
      msg.className = 'safety-message warning';
    }

    document.getElementById('report-connection-type').textContent = connLabel;
    document.getElementById('report-phase-conductors').textContent = phaseConductorsText;
    document.getElementById('report-neutral').textContent = neutralText;
    document.getElementById('report-pe').textContent = peText;
    document.getElementById('report-ib').textContent = Ib.toFixed(2) + ' A';
    document.getElementById('report-breaker').textContent = breaker + ' A (Curva C)';
    document.getElementById('report-iz').textContent = finalCorrectedAmp.toFixed(2) + ' A';
    document.getElementById('report-vd').textContent = dropPct.toFixed(2) + '% (' + vDrop.toFixed(2) + ' V)';
    document.getElementById('report-thermal-margin').textContent = thermalEval.marginPercent.toFixed(1) + '%';
    document.getElementById('report-status-text').textContent = statusText;
    document.getElementById('report-status-text').style.color = statusColor;
    document.getElementById('report-reason-text').textContent = reasonText;

    if (alternativeSection && (thermalEval.level === 'warning' || thermalEval.level === 'attention')) {
      reportAlternative.style.display = 'block';
      document.getElementById('report-alternative-text').textContent = 'Recomendação técnica: Considere utilizar ' + alternativeSection + ' mm² para obter maior margem de segurança térmica e flexibilidade para expansões futuras. O cabo atual de ' + finalSection + ' mm² atende aos critérios mínimos da NBR 5410, mas opera com margem reduzida (Ib = ' + Ib.toFixed(1) + 'A, Iz = ' + finalCorrectedAmp.toFixed(1) + 'A, margem = ' + thermalEval.marginPercent.toFixed(1) + '%).';
    } else {
      reportAlternative.style.display = 'none';
    }

    calcReport.style.display = 'block';
    resultContainer.style.display = 'block';
    resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  menuToggle.addEventListener('click', function() {
    navLinksContainer.classList.toggle('active');
  });

  navLinks.forEach(function(link) {
    link.addEventListener('click', function() {
      navLinksContainer.classList.remove('active');
      navLinks.forEach(function(l) { l.classList.remove('active'); });
      link.classList.add('active');
    });
  });

  window.addEventListener('scroll', function() {
    var sy = window.pageYOffset;
    document.querySelectorAll('section[id]').forEach(function(sec) {
      var top = sec.offsetTop - 100;
      var h = sec.offsetHeight;
      var id = sec.getAttribute('id');
      if (sy > top && sy <= top + h) {
        navLinks.forEach(function(l) {
          l.classList.remove('active');
          if (l.getAttribute('href') === '#' + id) l.classList.add('active');
        });
      }
    });
  });

  allInputs.forEach(function(inp) {
    inp.addEventListener('input', function() {
      hideResults();
      clearFieldErrors();
    });
    inp.addEventListener('change', function() {
      hideResults();
      clearFieldErrors();
    });
  });

  if (powerInput) {
    powerInput.addEventListener('input', function() {
      if (powerInput.value.trim() && parseFloat(powerInput.value) > 0) {
        powerInput.classList.remove('error');
        if (powerErrorEl) powerErrorEl.classList.remove('visible');
      }
    });
  }

  if (lengthInput) {
    lengthInput.addEventListener('input', function() {
      if (lengthInput.value.trim() && parseFloat(lengthInput.value) > 0) {
        lengthInput.classList.remove('error');
        if (lengthErrorEl) lengthErrorEl.classList.remove('visible');
      }
    });
  }

  form.addEventListener('submit', performCalculation);

  function resetState() {
    voltageInput.value = 220;
    powerInput.value = '';
    lengthInput.value = '';
    connectionTypeSelect.value = 'phase-neutral';
    circuitTypeSelect.value = 'tug';
    installMethodSelect.value = 'B1';
    safetyMarginSelect.value = 'recommended';
    materialSelect.value = 'copper';
    ambientConditionSelect.value = 'normal';
    groupedCircuitsInput.value = 1;
    loadedConductorsSelect.value = 2;
    maxDropInput.value = 4;
    if (powerFactorSelect) powerFactorSelect.value = '1.00';
    hideResults();
    clearFieldErrors();
  }

  var canvas = document.getElementById('loading-canvas');
  var textElement = document.getElementById('loading-text');

  async function initApp() {
    await loadAllDatabases();
    resetState();
    if (canvas && textElement) {
      var animation = new SpiralAnimation(canvas, textElement, function() {});
      animation.start();
    } else {
      document.getElementById('loading-overlay').style.display = 'none';
      document.body.classList.add('loaded');
    }
  }

  initApp();

})();
