(function () {
  const root = document.getElementById("reader-root");
  const statusNode = document.getElementById("reader-status");
  const viewportNode = document.getElementById("reader-viewport");
  const panStageNode = document.getElementById("reader-pan-stage");
  const zoomOutButton = document.getElementById("zoom-out-button");
  const zoomResetButton = document.getElementById("zoom-reset-button");
  const zoomInButton = document.getElementById("zoom-in-button");
  const fullscreenToggleButton = document.getElementById("fullscreen-toggle-button");

  if (!root || !statusNode || !viewportNode || !panStageNode) {
    return;
  }

  const pdfUrl = root.dataset.pdfUrl;
  const pagesNode = root.querySelector(".reader-pages");
  const modeButtons = Array.from(document.querySelectorAll(".mode-button[data-mode]"));
  let currentMode = "vertical";
  let pdfDocument = null;
  let renderVersion = 0;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragState = null;

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function updateStatus() {
    if (!pdfDocument) {
      return;
    }

    setStatus(`${pdfDocument.numPages} pages · ${Math.round(zoom * 100)}%`);
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

    let minX = viewportWidth - content.width;
    let maxX = 0;
    let minY = viewportHeight - content.height;
    let maxY = 0;

    if (content.width <= viewportWidth) {
      minX = maxX = (viewportWidth - content.width) / 2;
    }

    if (content.height <= viewportHeight) {
      minY = maxY = (viewportHeight - content.height) / 2;
    }

    return {
      x: Math.min(maxX, Math.max(minX, nextX)),
      y: Math.min(maxY, Math.max(minY, nextY)),
    };
  }

  function applyPan() {
    const clamped = clampOffsets(offsetX, offsetY);
    offsetX = clamped.x;
    offsetY = clamped.y;
    panStageNode.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    updateStatus();
  }

  function setMode(mode) {
    currentMode = mode === "horizontal" ? "horizontal" : "vertical";
    pagesNode.classList.remove("mode-vertical", "mode-horizontal");
    pagesNode.classList.add(currentMode === "horizontal" ? "mode-horizontal" : "mode-vertical");

    modeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === currentMode);
    });

    if (pdfDocument) {
      rerenderForViewport(false);
    }
  }

  function getFitScale(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const toolbarHeight = 58;

    if (currentMode === "horizontal") {
      const targetHeight = Math.max(window.innerHeight - toolbarHeight - 10, 280);
      return targetHeight / baseViewport.height;
    }

    const targetWidth = Math.min(Math.max(root.clientWidth, 320), 1180);
    return targetWidth / baseViewport.width;
  }

  async function renderPage(pdf, pageNumber, version) {
    if (version !== renderVersion) {
      return;
    }

    const page = await pdf.getPage(pageNumber);

    if (version !== renderVersion) {
      return;
    }

    const viewport = page.getViewport({ scale: getFitScale(page) * zoom });
    const outputScale = window.devicePixelRatio || 1;
    const wrapper = document.createElement("div");
    wrapper.className = "reader-sheet";

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D indisponible.");
    }

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

    wrapper.appendChild(canvas);
    pagesNode.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;
  }

  async function renderDocument(pdf) {
    const version = ++renderVersion;
    pagesNode.innerHTML = "";
    setStatus(`Chargement des pages... 0 / ${pdf.numPages}`);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      await renderPage(pdf, pageNumber, version);

      if (version !== renderVersion) {
        return;
      }

      setStatus(`Chargement des pages... ${pageNumber} / ${pdf.numPages}`);

      if (pageNumber < pdf.numPages) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    }

    applyPan();
  }

  function showFallback(message) {
    setStatus(message);
    pagesNode.innerHTML = "";
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

  async function rerenderForViewport(keepCenter) {
    if (!pdfDocument) {
      return;
    }

    let nextOffsetX = offsetX;
    let nextOffsetY = offsetY;

    if (keepCenter) {
      const viewportWidth = viewportNode.clientWidth;
      const viewportHeight = viewportNode.clientHeight;
      const anchorX = viewportWidth / 2;
      const anchorY = viewportHeight / 2;
      const logicalX = anchorX - offsetX;
      const logicalY = anchorY - offsetY;
      const previousZoom = rerenderForViewport.previousZoom || zoom;
      const ratio = zoom / previousZoom;

      nextOffsetX = anchorX - logicalX * ratio;
      nextOffsetY = anchorY - logicalY * ratio;
    }

    await renderDocument(pdfDocument);
    offsetX = nextOffsetX;
    offsetY = nextOffsetY;
    applyPan();
  }

  rerenderForViewport.previousZoom = zoom;

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
    });
  });

  function updateFullscreenButton() {
    if (!fullscreenToggleButton) {
      return;
    }

    fullscreenToggleButton.textContent = document.fullscreenElement ? "Quitter plein ecran" : "Plein ecran";
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

  async function changeZoom(nextZoom) {
    const boundedZoom = Math.min(4, Math.max(0.5, nextZoom));
    const previousZoom = zoom;

    if (Math.abs(boundedZoom - previousZoom) < 0.001) {
      return;
    }

    zoom = boundedZoom;
    rerenderForViewport.previousZoom = previousZoom;

    try {
      await rerenderForViewport(true);
    } catch (error) {
      showFallback(error instanceof Error ? error.message : "Impossible de recalculer le zoom.");
    }
  }

  if (zoomInButton) {
    zoomInButton.addEventListener("click", () => {
      void changeZoom(zoom * 1.2);
    });
  }

  if (zoomOutButton) {
    zoomOutButton.addEventListener("click", () => {
      void changeZoom(zoom / 1.2);
    });
  }

  if (zoomResetButton) {
    zoomResetButton.addEventListener("click", () => {
      void changeZoom(1);
    });
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
    applyPan();
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
      if (!pdfDocument || !event.ctrlKey) {
        return;
      }

      event.preventDefault();
      void changeZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
    },
    { passive: false },
  );

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!pdfDocument) {
      return;
    }

    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      rerenderForViewport.previousZoom = zoom;
      rerenderForViewport(true).catch((error) => {
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

      await renderDocument(pdfDocument);
    } catch (error) {
      showFallback(error instanceof Error ? error.message : "Impossible de charger le PDF.");
    }
  }

  setMode("vertical");
  boot();
})();
