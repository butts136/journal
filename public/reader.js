(function () {
  const root = document.getElementById("reader-root");
  const statusNode = document.getElementById("reader-status");
  const viewportNode = document.getElementById("reader-viewport");
  const panStageNode = document.getElementById("reader-pan-stage");
  const modeCycleButton = document.getElementById("mode-cycle-button");
  const zoomControl = document.getElementById("zoom-control");
  const zoomToggleButton = document.getElementById("zoom-toggle-button");
  const zoomButtonValue = document.getElementById("zoom-button-value");
  const zoomPanel = document.getElementById("zoom-panel");
  const zoomDecreaseButton = document.getElementById("zoom-decrease-button");
  const zoomIncreaseButton = document.getElementById("zoom-increase-button");
  const zoomRange = document.getElementById("zoom-range");
  const zoomValue = document.getElementById("zoom-value");
  const fullscreenToggleButton = document.getElementById("fullscreen-toggle-button");

  if (!root || !statusNode || !viewportNode || !panStageNode) {
    return;
  }

  const pdfUrl = root.dataset.pdfUrl;
  const pagesNode = root.querySelector(".reader-pages");
  const modes = [
    { key: "spread", label: "2 pages" },
    { key: "vertical", label: "Vertical" },
    { key: "horizontal", label: "Horizontal" },
  ];
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 2.5;
  const QUALITY_SCALE = Math.max(window.devicePixelRatio || 1, 2);

  let currentMode = "spread";
  let pdfDocument = null;
  let renderVersion = 0;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragState = null;
  let hasCompletedInitialRender = false;
  let resizeTimer = null;

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function updateStatus() {
    if (!pdfDocument) {
      return;
    }

    setStatus(`${pdfDocument.numPages} pages · ${Math.round(zoom * 100)}%`);
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

    if (zoomButtonValue) {
      zoomButtonValue.textContent = formattedZoom;
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

    let minX = viewportWidth - scaledWidth;
    let maxX = 0;
    let minY = viewportHeight - scaledHeight;
    let maxY = 0;

    if (scaledWidth <= viewportWidth) {
      minX = maxX = (viewportWidth - scaledWidth) / 2;
    }

    if (scaledHeight <= viewportHeight) {
      minY = maxY = (viewportHeight - scaledHeight) / 2;
    }

    return {
      x: Math.min(maxX, Math.max(minX, nextX)),
      y: Math.min(maxY, Math.max(minY, nextY)),
    };
  }

  function applyPanZoom() {
    const clamped = clampOffsets(offsetX, offsetY);
    offsetX = clamped.x;
    offsetY = clamped.y;
    panStageNode.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
    updateZoomUi();
    updateStatus();
  }

  function moveBy(deltaX, deltaY) {
    offsetX += deltaX;
    offsetY += deltaY;
    applyPanZoom();
  }

  function getBaseDisplayScale(page, pageNumber) {
    const baseViewport = page.getViewport({ scale: 1 });
    const viewportWidth = Math.max(viewportNode.clientWidth, 320);
    const viewportHeight = Math.max(viewportNode.clientHeight, 280);

    if (currentMode === "horizontal") {
      return viewportHeight / baseViewport.height;
    }

    if (currentMode === "spread") {
      if (pageNumber === 1) {
        return viewportWidth / baseViewport.width;
      }

      return (viewportWidth / 2) / baseViewport.width;
    }

    return viewportWidth / baseViewport.width;
  }

  function createSheet(pageNumber) {
    const wrapper = document.createElement("div");
    wrapper.className = "reader-sheet";
    wrapper.dataset.pageNumber = String(pageNumber);
    return wrapper;
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
    const sheets = Array.from(pagesNode.querySelectorAll(".reader-sheet"));

    pagesNode.textContent = "";

    if (currentMode === "spread") {
      pagesNode.appendChild(buildSpreadRows(sheets));
      return;
    }

    const fragment = document.createDocumentFragment();
    sheets.forEach((sheet) => fragment.appendChild(sheet));
    pagesNode.appendChild(fragment);
  }

  async function renderPage(pdf, pageNumber, version) {
    if (version !== renderVersion) {
      return null;
    }

    const page = await pdf.getPage(pageNumber);

    if (version !== renderVersion) {
      return null;
    }

    const displayScale = getBaseDisplayScale(page, pageNumber);
    const displayViewport = page.getViewport({ scale: displayScale });
    const renderViewport = page.getViewport({ scale: displayScale * QUALITY_SCALE });
    const wrapper = createSheet(pageNumber);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D indisponible.");
    }

    canvas.width = Math.max(1, Math.ceil(renderViewport.width));
    canvas.height = Math.max(1, Math.ceil(renderViewport.height));
    canvas.style.width = `${Math.ceil(displayViewport.width)}px`;
    canvas.style.height = `${Math.ceil(displayViewport.height)}px`;

    wrapper.appendChild(canvas);

    await page.render({
      canvasContext: context,
      viewport: renderViewport,
    }).promise;

    return wrapper;
  }

  async function renderDocument(pdf, options = {}) {
    const { recenter = !hasCompletedInitialRender, preserveOffsets = false } = options;
    const version = ++renderVersion;
    const savedOffsetX = offsetX;
    const savedOffsetY = offsetY;

    pagesNode.style.visibility = "hidden";
    pagesNode.textContent = "";
    setStatus(`Chargement des pages... 0 / ${pdf.numPages}`);

    const sheets = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const sheet = await renderPage(pdf, pageNumber, version);

      if (version !== renderVersion) {
        return;
      }

      if (sheet) {
        sheets.push(sheet);
      }

      setStatus(`Chargement des pages... ${pageNumber} / ${pdf.numPages}`);

      if (pageNumber < pdf.numPages) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    }

    const fragment = document.createDocumentFragment();
    sheets.forEach((sheet) => fragment.appendChild(sheet));
    pagesNode.textContent = "";
    pagesNode.appendChild(fragment);
    applyLayout();

    if (recenter) {
      offsetX = 0;
      offsetY = 0;
    } else if (preserveOffsets) {
      offsetX = savedOffsetX;
      offsetY = savedOffsetY;
    }

    pagesNode.style.visibility = "visible";
    applyPanZoom();
    hasCompletedInitialRender = true;
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

  function toggleZoomPanel(forceOpen) {
    if (!zoomPanel || !zoomToggleButton) {
      return;
    }

    const nextOpen = typeof forceOpen === "boolean" ? forceOpen : zoomPanel.hidden;
    zoomPanel.hidden = !nextOpen;
    zoomToggleButton.classList.toggle("is-active", nextOpen);
  }

  function changeZoom(nextZoom) {
    const boundedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

    if (Math.abs(boundedZoom - zoom) < 0.001) {
      return;
    }

    zoom = boundedZoom;
    applyPanZoom();
  }

  if (modeCycleButton) {
    modeCycleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycleMode();
    });
  }

  if (zoomToggleButton) {
    zoomToggleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleZoomPanel();
    });
  }

  if (zoomRange) {
    zoomRange.addEventListener("input", () => {
      changeZoom(Number(zoomRange.value) / 100);
    });
  }

  if (zoomDecreaseButton) {
    zoomDecreaseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      changeZoom(zoom - 0.1);
    });
  }

  if (zoomIncreaseButton) {
    zoomIncreaseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      changeZoom(zoom + 0.1);
    });
  }

  document.addEventListener("click", (event) => {
    if (!zoomControl || !zoomPanel || zoomPanel.hidden) {
      return;
    }

    if (zoomControl.contains(event.target)) {
      return;
    }

    toggleZoomPanel(false);
  });

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
        changeZoom(zoom * (event.deltaY < 0 ? 1.05 : 1 / 1.05));
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
      case "Escape":
        toggleZoomPanel(false);
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
  setMode("spread", { rerender: false });
  boot();
})();
