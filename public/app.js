(function () {
  const THUMB_CACHE_PREFIX = "journal-thumb:v1:";
  const thumbMemoryCache = new Map();

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const cards = Array.from(document.querySelectorAll(".journal-card[data-pdf-url]"));

  function getThumbCacheKey(pdfUrl) {
    return `${THUMB_CACHE_PREFIX}${pdfUrl}`;
  }

  function readCachedThumb(pdfUrl) {
    const key = getThumbCacheKey(pdfUrl);

    if (thumbMemoryCache.has(key)) {
      return thumbMemoryCache.get(key);
    }

    try {
      const cached = window.localStorage.getItem(key);
      if (cached) {
        thumbMemoryCache.set(key, cached);
        return cached;
      }
    } catch {}

    return null;
  }

  function writeCachedThumb(pdfUrl, dataUrl) {
    const key = getThumbCacheKey(pdfUrl);
    thumbMemoryCache.set(key, dataUrl);

    try {
      window.localStorage.setItem(key, dataUrl);
    } catch {}
  }

  function paintThumbImage(card, dataUrl) {
    const canvas = card.querySelector("canvas");
    const fallback = card.querySelector(".journal-thumb-fallback");
    const existingImage = card.querySelector("img");

    if (existingImage) {
      existingImage.src = dataUrl;
    } else {
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.src = dataUrl;
      if (canvas) {
        canvas.replaceWith(image);
      }
    }

    if (fallback) {
      fallback.style.display = "none";
    }

    card.dataset.thumbReady = "1";
  }

  async function renderCard(card) {
    const pdfUrl = card.dataset.pdfUrl;
    const canvas = card.querySelector("canvas");
    const fallback = card.querySelector(".journal-thumb-fallback");

    if (!pdfUrl || !canvas || !window.pdfjsLib) {
      return;
    }

    const cachedThumb = readCachedThumb(pdfUrl);
    if (cachedThumb) {
      paintThumbImage(card, cachedThumb);
      return;
    }

    try {
      const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.4, 280 / viewport.width);
      const scaledViewport = page.getViewport({ scale });
      const context = canvas.getContext("2d");

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
      }).promise;

      const dataUrl = canvas.toDataURL("image/webp", 0.82);
      writeCachedThumb(pdfUrl, dataUrl);
      paintThumbImage(card, dataUrl);
    } catch {
      if (fallback) {
        fallback.textContent = "Miniature indisponible";
      }
    }
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        observer.unobserve(entry.target);
        renderCard(entry.target);
      });
    }, { rootMargin: "150px" });

    cards.forEach((card) => observer.observe(card));
  } else {
    cards.forEach(renderCard);
  }

  if (window.EventSource) {
    const stream = new EventSource("/events");
    let timer = null;

    const softReload = () => {
      if (timer) {
        return;
      }

      timer = window.setTimeout(() => {
        window.location.reload();
      }, 900);
    };

    stream.addEventListener("journal-updated", softReload);
    stream.addEventListener("journal-error", softReload);
  }
})();
