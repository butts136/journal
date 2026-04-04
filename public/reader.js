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
  const statusNode = root.querySelector(".reader-status");
  const pagesNode = root.querySelector(".reader-pages");
  const buttons = Array.from(document.querySelectorAll(".mode-button"));

  function setMode(mode) {
    pagesNode.classList.remove("mode-vertical", "mode-horizontal");
    pagesNode.classList.add(mode === "horizontal" ? "mode-horizontal" : "mode-vertical");

    buttons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
    });
  });

  async function render() {
    try {
      const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
      statusNode.textContent = `${pdf.numPages} pages`;

      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale: 1.4 });
        const wrapper = document.createElement("article");
        wrapper.className = "reader-page";

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        const label = document.createElement("span");
        label.className = "page-index";
        label.textContent = `Page ${index}`;

        wrapper.appendChild(canvas);
        wrapper.appendChild(label);
        pagesNode.appendChild(wrapper);
      }
    } catch (error) {
      statusNode.textContent =
        error instanceof Error ? error.message : "Impossible de charger le PDF.";
    }
  }

  setMode("vertical");
  render();
})();
