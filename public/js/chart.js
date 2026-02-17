const Chart = {
  line(canvas, data, options = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 10, right: 10, bottom: 25, left: 50 };
    const color = options.color || '#40b8aa';

    const values = data.values;
    const labels = data.labels || [];

    if (!values || values.length === 0) {
      ctx.fillStyle = '#55556a';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data yet', w / 2, h / 2);
      return;
    }

    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    const filteredVals = values.filter((v) => v !== null);
    const minVal = Math.min(...filteredVals);
    const maxVal = Math.max(...filteredVals);
    const range = maxVal - minVal || 1;

    function xPos(i) {
      return padding.left + (i / (values.length - 1 || 1)) * plotW;
    }

    function yPos(val) {
      return padding.top + plotH - ((val - minVal) / range) * plotH;
    }

    // Grid lines
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = minVal + (range / ySteps) * i;
      const y = yPos(val);
      ctx.fillStyle = '#55556a';
      ctx.fillText(Math.round(val) + 'ms', padding.left - 8, y + 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    // X-axis labels
    ctx.fillStyle = '#55556a';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(labels.length / 6));
    for (let i = 0; i < labels.length; i += labelStep) {
      ctx.fillText(labels[i], xPos(i), h - 4);
    }

    // Gradient fill under line
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
    gradient.addColorStop(0, 'rgba(42, 157, 143, 0.18)');
    gradient.addColorStop(1, 'rgba(42, 157, 143, 0)');

    // Draw filled area
    ctx.beginPath();
    let firstX = null;
    let lastX = null;
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) continue;
      const x = xPos(i);
      const y = yPos(values[i]);
      if (firstX === null) {
        firstX = x;
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      lastX = x;
    }
    if (firstX !== null) {
      ctx.lineTo(lastX, padding.top + plotH);
      ctx.lineTo(firstX, padding.top + plotH);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) continue;
      const x = xPos(i);
      const y = yPos(values[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Dots with glow
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) continue;
      const x = xPos(i);
      const y = yPos(values[i]);
      // Glow
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(42, 157, 143, 0.25)';
      ctx.fill();
      // Dot
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  },

  sparkline(canvas, values, options = {}) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const color = options.color || '#40b8aa';
    const failColor = options.failColor || '#f43f5e';

    if (!values || values.length === 0) return;

    const pad = 2;

    function xPos(i) {
      return pad + (i / (values.length - 1 || 1)) * (w - pad * 2);
    }

    // Draw failure bars first (always, even if all checks failed)
    for (let i = 0; i < values.length; i++) {
      if (!values[i].isSuccess) {
        ctx.fillStyle = failColor;
        ctx.globalAlpha = 0.15;
        const bw = Math.max(2, (w - pad * 2) / values.length);
        ctx.fillRect(xPos(i) - bw / 2, 0, bw, h);
        ctx.globalAlpha = 1;
      }
    }

    // Draw success line and gradient only if there are successful checks
    const successVals = values.map((v) => (v.isSuccess ? v.responseTimeMs : null));
    const filtered = successVals.filter((v) => v !== null);
    if (filtered.length === 0) return;

    const minVal = Math.min(...filtered);
    const maxVal = Math.max(...filtered);
    const range = maxVal - minVal || 1;

    function yPos(val) {
      return pad + (h - pad * 2) - ((val - minVal) / range) * (h - pad * 2);
    }

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(42, 157, 143, 0.15)');
    gradient.addColorStop(1, 'rgba(42, 157, 143, 0)');

    ctx.beginPath();
    let firstX = null;
    let lastX = null;
    for (let i = 0; i < values.length; i++) {
      if (successVals[i] === null) continue;
      const x = xPos(i);
      const y = yPos(successVals[i]);
      if (firstX === null) {
        firstX = x;
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      lastX = x;
    }
    if (firstX !== null) {
      ctx.lineTo(lastX, h);
      ctx.lineTo(firstX, h);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < values.length; i++) {
      if (successVals[i] === null) continue;
      const x = xPos(i);
      const y = yPos(successVals[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  },
};
