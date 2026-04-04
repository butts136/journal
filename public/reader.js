(function () {
  if (!window.pdfjsLib) {
    return;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const root = document.getElementById("reader-root");
  if (!root) {
    return;
  }

  const pdfUrl = root.dataset.pdfUrl;
  const statusNode = document.getElementById("reader-status");
  const pagesNode = root.querySelector(".reader-pages");
  const buttons = Array.from(document.querySelectorAll(".mode-button"));
  let currentMode = "vertical";
  let pdfDocument = null;

  function setMode(mode) {
    currentMode = mode === "horizontal" ? "horizontal" : "vertical";
    pagesNode.classList.remove("mode-vertical", "mode-horizontal");
    pagesNode.classList.add(currentMode === "horizontal" ? "mode-horizontal" : "mode-vertical");

    buttons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === currentMode);
    });

    if (pdfDocument) {
      renderPages(pdfDocument);
    }
  }

  function getScale(page) {
    const viewport = page.getViewport({ scale: 1 });
    const toolbarHeight = 58;

    if (currentMode === "horizontal") {
      const targetHeight = Math.max(window.innerHeight - toolbarHeight - 6, 320);
      return targetHeight / viewport.height;
    }

    const targetWidth = Math.max(root.clientWidth, 320);
    return targetWidth / viewport.width;
  }

  async function renderPages(pdf) {
    pagesNode.innerHTML = "";

    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const scale = getScale(page);
      const viewport = page.getViewport({ scale });

      const wrapper = document.createElement("div");
      wrapper.className = "reader-sheet";

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      wrapper.appendChild(canvas);
      pagesNode.appendChild(wrapper);
    }
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
      renderPages(pdfDocument);
    }, 120);
  });

  async function render() {
    try {
      pdfDocument = await window.pdfjsLib.getDocument(pdfUrl).promise;
      statusNode.textContent = `${pdfDocument.numPages} pages`;
      await renderPages(pdfDocument);
    } catch (error) {
      statusNode.textContent =
        error instanceof Error ? error.message : "Impossible de charger le PDF.";
    }
  }

  setMode("vertical");
  render();
})();
