(function () {
  const root = document.getElementById("reader-root");
  const statusNode = document.getElementById("reader-status");
  const viewportNode = document.getElementById("reader-viewport");
  const panStageNode = document.getElementById("reader-pan-stage");
  const modeCycleButton = document.getElementById("mode-cycle-button");
  const zoomRange = document.getElementById("zoom-range");
  const zoomValue = document.getElementById("zoom-value");
  const fullscreenToggleButton = document.getElementById("fullscreen-toggle-button");

  if (!root || !statusNode || !viewportNode || !panStageNode) {
    return;
  }

  const pdfUrl = root.dataset.pdfUrl;
  const MODE_COOKIE = "journal_reader_mode";
  const pagesNode = root.querySelector(".reader-pages");
  const modes = [
    { key: "spread", label: "2 pages" },
    { key: "vertical", label: "Vertical" },
    { key: "horizontal", label: "Horizontal" },
  ];
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 2.5;
  const VISIBLE_MARGIN = 720;
  const RETAIN_MARGIN = 1800;
  const MAX_CONCURRENT_RENDERS = 1;
  const QUALITY_SCALE = Math.min(
    Math.max(window.devicePixelRatio || 1, 1.25),
    window.devicePixelRatio && window.devicePixelRatio > 2 ? 2 : 1.8,
  );

  let currentMode = "spread";
  let pdfDocument = null;
  let renderVersion = 0;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragState = null;
  let hasCompletedInitialRender = false;
  let resizeTimer = null;
  let pageEntries = [];
  let renderQueue = [];
  let scheduledVisibilityPass = 0;
  let activeRenders = 0;

  function readCookie(name) {
    const entries = document.cookie ? document.cookie.split(/;\s*/) : [];
    for (const entry of entries) {
      const index = entry.indexOf("=");
      if (index === -1) {
        continue;
      }
      const key = entry.slice(0, index);
      const value = entry.slice(index + 1);
      if (key === name) {
        return decodeURIComponent(value);
      }
    }
    return "";
  }

  function writeCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value || "")}; path=/; SameSite=Lax; Max-Age=315360000`;
  }

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function updateStatus() {
    if (!pdfDocument) {
      return;
    }

    const readyCount = pageEntries.filter((entry) => entry.rendered).length;
    setStatus(`${pdfDocument.numPages} pages · ${Math.round(zoom * 100)}% · ${readyCount} chargees`);
  }

  function updateModeButton() {
    if (!modeCycleButton) {
      return;
    }

    const current = modes.find((mode) => mode.key === currentMode) || modes[0];
    modeCycleButton.textContent = current.label;
  }

  function updateZoomUi() {
    const formattedZoom = `${Math.round(zoom * 100)}%`;

    if (zoomRange) {
      zoomRange.value = String(Math.round(zoom * 100));
    }

    if (zoomValue) {
      zoomValue.textContent = formattedZoom;
    }
  }

  function getContentSize() {
    return {
      width: pagesNode.offsetWidth,
      height: pagesNode.offsetHeight,
    };
  }

  function clampOffsets(nextX, nextY) {
    const viewportWidth = viewportNode.clientWidth;
    const viewportHeight = viewportNode.clientHeight;
    const content = getContentSize();
    const scaledWidth = content.width * zoom;
    const scaledHeight = content.height * zoom;
    const visibleWidth = Math.max(40, Math.min(96, scaledWidth * 0.2));
    const visibleHeight = Math.max(40, Math.min(96, scaledHeight * 0.2));

    const minX = -scaledWidth + visibleWidth;
    const maxX = viewportWidth - visibleWidth;
    const minY = -scaledHeight + visibleHeight;
    const maxY = viewportHeight - visibleHeight;

    return {
      x: Math.min(maxX, Math.max(minX, nextX)),
      y: Math.min(maxY, Math.max(minY, nextY)),
    };
  }

  function queueVisibilityPass() {
    if (scheduledVisibilityPass) {
      return;
    }

    scheduledVisibilityPass = window.requestAnimationFrame(() => {
      scheduledVisibilityPass = 0;
      scheduleVisibleRenders();
    });
  }

  function applyPanZoom() {
    const clamped = clampOffsets(offsetX, offsetY);
    offsetX = clamped.x;
    offsetY = clamped.y;
    panStageNode.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
    updateZoomUi();
    updateStatus();
    queueVisibilityPass();
  }

  function moveBy(deltaX, deltaY) {
    offsetX += deltaX;
    offsetY += deltaY;
    applyPanZoom();
  }

  function getBaseDisplayScale(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const viewportWidth = Math.max(viewportNode.clientWidth, 320);
    const viewportHeight = Math.max(viewportNode.clientHeight, 280);

    if (currentMode === "horizontal") {
      return viewportHeight / baseViewport.height;
    }

    if (currentMode === "spread") {
      return viewportWidth / (baseViewport.width * 2);
    }

    return viewportWidth / baseViewport.width;
  }

  function createSheet(pageNumber) {
    const wrapper = document.createElement("div");
    wrapper.className = "reader-sheet is-placeholder";
    wrapper.dataset.pageNumber = String(pageNumber);
    return wrapper;
  }

  function createPlaceholder(entry) {
    const placeholder = document.createElement("div");
    placeholder.className = "reader-sheet-placeholder";
    placeholder.style.width = `${Math.ceil(entry.displayWidth)}px`;
    placeholder.style.height = `${Math.ceil(entry.displayHeight)}px`;
    return placeholder;
  }

  function buildSpreadRows(sheets) {
    const fragment = document.createDocumentFragment();

    if (sheets[0]) {
      const coverRow = document.createElement("div");
      coverRow.className = "reader-spread-row is-cover";
      coverRow.appendChild(sheets[0]);
      fragment.appendChild(coverRow);
    }

    for (let index = 1; index < sheets.length; index += 2) {
      const row = document.createElement("div");
      row.className = "reader-spread-row";
      row.appendChild(sheets[index]);

      if (sheets[index + 1]) {
        row.appendChild(sheets[index + 1]);
      }

      fragment.appendChild(row);
    }

    return fragment;
  }

  function applyLayout() {
    const sheets = pageEntries.map((entry) => entry.wrapper);

    pagesNode.textContent = "";

    if (currentMode === "spread") {
      pagesNode.appendChild(buildSpreadRows(sheets));
      return;
    }

    const fragment = document.createDocumentFragment();
    sheets.forEach((sheet) => fragment.appendChild(sheet));
    pagesNode.appendChild(fragment);
  }

  function getEntryRect(entry) {
    return {
      left: offsetX + entry.wrapper.offsetLeft * zoom,
      top: offsetY + entry.wrapper.offsetTop * zoom,
      width: entry.displayWidth * zoom,
      height: entry.displayHeight * zoom,
    };
  }

  function getViewportDistance(entry) {
    const rect = getEntryRect(entry);
    const viewportCenterX = viewportNode.clientWidth / 2;
    const viewportCenterY = viewportNode.clientHeight / 2;
    const entryCenterX = rect.left + rect.width / 2;
    const entryCenterY = rect.top + rect.height / 2;
    return Math.abs(viewportCenterX - entryCenterX) + Math.abs(viewportCenterY - entryCenterY);
  }

  function isEntryNearViewport(entry, margin) {
    const rect = getEntryRect(entry);
    return (
      rect.left + rect.width >= -margin &&
      rect.left <= viewportNode.clientWidth + margin &&
      rect.top + rect.height >= -margin &&
      rect.top <= viewportNode.clientHeight + margin
    );
  }

  async function renderEntry(entry, version) {
    if (!pdfDocument || version !== renderVersion || entry.rendered || entry.rendering) {
      return;
    }

    entry.rendering = true;
    activeRenders += 1;

    try {
      const page = entry.page || (await pdfDocument.getPage(entry.pageNumber));
      entry.page = page;

      if (version !== renderVersion) {
        return;
      }

      const renderViewport = page.getViewport({ scale: entry.displayScale * QUALITY_SCALE });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });

      if (!context) {
        throw new Error("Canvas 2D indisponible.");
      }

      canvas.width = Math.max(1, Math.ceil(renderViewport.width));
      canvas.height = Math.max(1, Math.ceil(renderViewport.height));
      canvas.style.width = `${Math.ceil(entry.displayWidth)}px`;
      canvas.style.height = `${Math.ceil(entry.displayHeight)}px`;

      entry.wrapper.textContent = "";
      entry.wrapper.appendChild(canvas);
      entry.wrapper.classList.remove("is-placeholder");

      await page.render({
        canvasContext: context,
        viewport: renderViewport,
      }).promise;

      entry.canvas = canvas;
      entry.rendered = true;
      updateStatus();
    } finally {
      entry.rendering = false;
      activeRenders = Math.max(0, activeRenders - 1);
      processRenderQueue(version);
    }
  }

  function releaseEntry(entry) {
    if (!entry.rendered || entry.rendering) {
      return;
    }

    entry.rendered = false;
    entry.canvas = null;
    entry.wrapper.textContent = "";
    entry.wrapper.appendChild(createPlaceholder(entry));
    entry.wrapper.classList.add("is-placeholder");

    if (entry.page && typeof entry.page.cleanup === "function") {
      try {
        entry.page.cleanup();
      } catch {}
    }
  }

  function processRenderQueue(version) {
    if (version !== renderVersion || !pdfDocument) {
      renderQueue = [];
      return;
    }

    while (activeRenders < MAX_CONCURRENT_RENDERS && renderQueue.length) {
      const nextEntry = renderQueue.shift();
      if (!nextEntry || nextEntry.rendered || nextEntry.rendering) {
        continue;
      }
      renderEntry(nextEntry, version).catch((error) => {
        if (version === renderVersion) {
          showFallback(error instanceof Error ? error.message : "Impossible de rendre la page.");
        }
      });
    }
  }

  function scheduleVisibleRenders() {
    if (!pdfDocument || !pageEntries.length) {
      return;
    }

    const version = renderVersion;
    const visibleEntries = [];

    pageEntries.forEach((entry) => {
      if (isEntryNearViewport(entry, VISIBLE_MARGIN)) {
        visibleEntries.push(entry);
      } else if (!isEntryNearViewport(entry, RETAIN_MARGIN)) {
        releaseEntry(entry);
      }
    });

    visibleEntries.sort((left, right) => getViewportDistance(left) - getViewportDistance(right));
    renderQueue = visibleEntries.filter((entry) => !entry.rendered && !entry.rendering);
    processRenderQueue(version);
    updateStatus();
  }

  async function prepareEntry(pageNumber, version) {
    if (version !== renderVersion) {
      return null;
    }

    const page = await pdfDocument.getPage(pageNumber);
    if (version !== renderVersion) {
      return null;
    }

    const displayScale = getBaseDisplayScale(page);
    const displayViewport = page.getViewport({ scale: displayScale });
    const entry = {
      pageNumber,
      page,
      displayScale,
      displayWidth: Math.ceil(displayViewport.width),
      displayHeight: Math.ceil(displayViewport.height),
      wrapper: createSheet(pageNumber),
      canvas: null,
      rendered: false,
      rendering: false,
    };

    entry.wrapper.style.width = `${entry.displayWidth}px`;
    entry.wrapper.style.height = `${entry.displayHeight}px`;
    entry.wrapper.appendChild(createPlaceholder(entry));
    return entry;
  }

  async function renderDocument(pdf, options = {}) {
    const { recenter = !hasCompletedInitialRender, preserveOffsets = false } = options;
    const version = ++renderVersion;
    const savedOffsetX = offsetX;
    const savedOffsetY = offsetY;

    renderQueue = [];
    pageEntries = [];
    pagesNode.style.visibility = "hidden";
    pagesNode.textContent = "";
    setStatus(`Preparation des pages... 0 / ${pdf.numPages}`);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const entry = await prepareEntry(pageNumber, version);

      if (version !== renderVersion) {
        return;
      }

      if (entry) {
        pageEntries.push(entry);
      }

      setStatus(`Preparation des pages... ${pageNumber} / ${pdf.numPages}`);

      if (pageNumber < pdf.numPages) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    }

    applyLayout();

    if (recenter) {
      const contentWidth = pagesNode.offsetWidth;
      const contentHeight = pagesNode.offsetHeight;
      offsetX = Math.max(0, (viewportNode.clientWidth - contentWidth * zoom) / 2);
      offsetY = Math.max(0, (viewportNode.clientHeight - contentHeight * zoom) / 2);
    } else if (preserveOffsets) {
      offsetX = savedOffsetX;
      offsetY = savedOffsetY;
    }

    pagesNode.style.visibility = "visible";
    hasCompletedInitialRender = true;
    applyPanZoom();
    scheduleVisibleRenders();
  }

  function showFallback(message) {
    setStatus(message);
    pagesNode.style.visibility = "visible";
    pagesNode.textContent = "";
    panStageNode.style.transform = "";

    const fallback = document.createElement("div");
    fallback.className = "reader-fallback";
    fallback.innerHTML = `
      <strong>Le rendu personnalise n'a pas pu s'ouvrir.</strong>
      <p>${message}</p>
      <a class="button-secondary compact-button" href="${pdfUrl}" target="_blank" rel="noreferrer">Ouvrir le PDF</a>
    `;
    pagesNode.appendChild(fallback);
  }

  function setMode(mode, options = {}) {
    currentMode = modes.some((entry) => entry.key === mode) ? mode : "spread";
    writeCookie(MODE_COOKIE, currentMode);
    pagesNode.classList.remove("mode-vertical", "mode-horizontal", "mode-spread");
    pagesNode.classList.add(
      currentMode === "horizontal"
        ? "mode-horizontal"
        : currentMode === "vertical"
          ? "mode-vertical"
          : "mode-spread",
    );
    updateModeButton();

    if (pdfDocument && options.rerender !== false) {
      renderDocument(pdfDocument, {
        recenter: true,
        preserveOffsets: false,
      }).catch((error) => {
        showFallback(error instanceof Error ? error.message : "Impossible de changer le mode.");
      });
    }
  }

  function cycleMode() {
    const currentIndex = modes.findIndex((mode) => mode.key === currentMode);
    const nextMode = modes[(currentIndex + 1) % modes.length] || modes[0];
    setMode(nextMode.key);
  }

  function changeZoom(nextZoom, anchorX, anchorY) {
    const boundedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

    if (Math.abs(boundedZoom - zoom) < 0.001) {
      return;
    }

    const viewportWidth = viewportNode.clientWidth;
    const viewportHeight = viewportNode.clientHeight;
    const pivotX = typeof anchorX === "number" ? anchorX : viewportWidth / 2;
    const pivotY = typeof anchorY === "number" ? anchorY : viewportHeight / 2;
    const logicalX = (pivotX - offsetX) / zoom;
    const logicalY = (pivotY - offsetY) / zoom;

    zoom = boundedZoom;
    offsetX = pivotX - logicalX * zoom;
    offsetY = pivotY - logicalY * zoom;
    applyPanZoom();
  }

  if (modeCycleButton) {
    modeCycleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycleMode();
    });
  }

  if (zoomRange) {
    zoomRange.addEventListener("input", () => {
      changeZoom(Number(zoomRange.value) / 100);
    });
  }

  function updateFullscreenButton() {
    if (!fullscreenToggleButton) {
      return;
    }

    fullscreenToggleButton.classList.toggle("is-active", Boolean(document.fullscreenElement));
  }

  if (fullscreenToggleButton) {
    fullscreenToggleButton.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        setStatus("Plein ecran indisponible");
      }
    });

    document.addEventListener("fullscreenchange", updateFullscreenButton);
    updateFullscreenButton();
  }

  viewportNode.addEventListener("pointerdown", (event) => {
    if (!pdfDocument) {
      return;
    }

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetX,
      originY: offsetY,
    };

    viewportNode.classList.add("is-dragging");
    viewportNode.setPointerCapture(event.pointerId);
  });

  viewportNode.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    offsetX = dragState.originX + (event.clientX - dragState.startX);
    offsetY = dragState.originY + (event.clientY - dragState.startY);
    applyPanZoom();
  });

  function stopDrag(event) {
    if (!dragState || (event && dragState.pointerId !== event.pointerId)) {
      return;
    }

    dragState = null;
    viewportNode.classList.remove("is-dragging");
  }

  viewportNode.addEventListener("pointerup", stopDrag);
  viewportNode.addEventListener("pointercancel", stopDrag);
  viewportNode.addEventListener("lostpointercapture", stopDrag);

  viewportNode.addEventListener(
    "wheel",
    (event) => {
      if (!pdfDocument) {
        return;
      }

      if (event.ctrlKey) {
        event.preventDefault();
        changeZoom(zoom * (event.deltaY < 0 ? 1.05 : 1 / 1.05), event.clientX, event.clientY);
        return;
      }

      event.preventDefault();

      if (currentMode === "horizontal") {
        moveBy(-(event.deltaY + event.deltaX), 0);
        return;
      }

      moveBy(0, -event.deltaY);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    if (!pdfDocument) {
      return;
    }

    const target = event.target;
    if (target && /input|textarea|select/i.test(target.tagName || "")) {
      return;
    }

    const step = event.shiftKey ? 180 : 72;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveBy(0, step);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveBy(0, -step);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveBy(step, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveBy(-step, 0);
        break;
      default:
        break;
    }
  });

  window.addEventListener("resize", () => {
    if (!pdfDocument) {
      return;
    }

    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      renderDocument(pdfDocument, {
        recenter: true,
        preserveOffsets: false,
      }).catch((error) => {
        showFallback(error instanceof Error ? error.message : "Impossible de recharger le PDF.");
      });
    }, 140);
  });

  async function boot() {
    if (!window.pdfjsLib) {
      showFallback("pdf.js n'est pas disponible dans ce navigateur.");
      return;
    }

    if (!pdfUrl) {
      showFallback("Le chemin du PDF est manquant.");
      return;
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    try {
      setStatus("Ouverture du PDF...");
      pdfDocument = await window.pdfjsLib.getDocument({
        url: pdfUrl,
        rangeChunkSize: 262144,
        disableAutoFetch: false,
        disableStream: false,
        useSystemFonts: true,
      }).promise;

      await renderDocument(pdfDocument, {
        recenter: true,
        preserveOffsets: false,
      });
    } catch (error) {
      showFallback(error instanceof Error ? error.message : "Impossible de charger le PDF.");
    }
  }

  updateModeButton();
  updateZoomUi();
  setMode(readCookie(MODE_COOKIE) || "spread", { rerender: false });
  boot();
})();
