(function () {
  const root = document.getElementById("reader-root");
  const statusNode = document.getElementById("reader-status");

  if (!root || !statusNode) {
    return;
  }

  const pdfUrl = root.dataset.pdfUrl;
  const pagesNode = root.querySelector(".reader-pages");
  const nativeFrame = root.querySelector(".reader-native-frame");
  const buttons = Array.from(document.querySelectorAll(".mode-button"));
  let currentMode = "vertical";
  let pdfDocument = null;
  let renderVersion = 0;
  let firstPageRendered = false;

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function enableCustomReader() {
    firstPageRendered = true;
    root.classList.add("is-custom-ready");
  }

  function showNativeFallback(message) {
    root.classList.remove("is-custom-ready");
    pagesNode.innerHTML = "";
    setStatus(message || "Affichage PDF natif");
  }

  function setMode(mode) {
    currentMode = mode === "horizontal" ? "horizontal" : "vertical";
    pagesNode.classList.remove("mode-vertical", "mode-horizontal");
    pagesNode.classList.add(currentMode === "horizontal" ? "mode-horizontal" : "mode-vertical");

    buttons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === currentMode);
    });

    if (pdfDocument) {
      renderDocument(pdfDocument);
    }
  }

  function getScale(page) {
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

    const viewport = page.getViewport({ scale: getScale(page) });
    const wrapper = document.createElement("div");
    wrapper.className = "reader-sheet";

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D indisponible.");
    }

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    wrapper.appendChild(canvas);
    pagesNode.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    if (!firstPageRendered) {
      enableCustomReader();
    }
  }

  async function renderDocument(pdf) {
    const version = ++renderVersion;
    pagesNode.innerHTML = "";
    firstPageRendered = false;
    setStatus(`Chargement des pages... 0 / ${pdf.numPages}`);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      await renderPage(pdf, pageNumber, version);

      if (version !== renderVersion) {
        return;
      }

      setStatus(`${pdf.numPages} pages · ${pageNumber}/${pdf.numPages}`);

      if (pageNumber < pdf.numPages) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    }

    setStatus(`${pdf.numPages} pages`);
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
    });
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!pdfDocument) {
      return;
    }

    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      renderDocument(pdfDocument).catch(() => {
        showNativeFallback("Lecteur natif actif");
      });
    }, 120);
  });

  async function boot() {
    if (!window.pdfjsLib) {
      showNativeFallback("Lecteur natif actif");
      return;
    }

    if (!pdfUrl) {
      showNativeFallback("Chemin PDF manquant");
      return;
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const nativeTimer = window.setTimeout(() => {
      if (!firstPageRendered) {
        showNativeFallback("Lecteur natif actif");
      }
    }, 2200);

    try {
      setStatus("Ouverture du PDF...");
      pdfDocument = await window.pdfjsLib.getDocument({
        url: pdfUrl,
        rangeChunkSize: 262144,
        disableAutoFetch: false,
        disableStream: false,
        useSystemFonts: true,
      }).promise;

      setStatus(`${pdfDocument.numPages} pages`);
      await renderDocument(pdfDocument);
      window.clearTimeout(nativeTimer);
    } catch {
      window.clearTimeout(nativeTimer);
      showNativeFallback("Lecteur natif actif");
    }
  }

  if (nativeFrame) {
    nativeFrame.addEventListener("load", () => {
      if (!firstPageRendered) {
        setStatus("Lecteur natif actif");
      }
    });
  }

  setMode("vertical");
  boot();
})();
