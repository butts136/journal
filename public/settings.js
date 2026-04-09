(function () {
  const root = document.querySelector(".settings-library-card");

  if (!root) {
    return;
  }

  const checkboxes = Array.from(root.querySelectorAll('input[type="checkbox"][name="ids"]'));
  const countNode = root.querySelector("[data-selected-count]");
  const selectAllButton = root.querySelector("[data-select-all-journals]");
  const clearAllButton = root.querySelector("[data-clear-all-journals]");
  const groupSelectButtons = Array.from(root.querySelectorAll("[data-select-group]"));
  const groupClearButtons = Array.from(root.querySelectorAll("[data-clear-group]"));

  function updateCount() {
    const count = checkboxes.filter((checkbox) => checkbox.checked).length;
    if (!countNode) {
      return;
    }

    countNode.textContent = count <= 1 ? `${count} selection` : `${count} selections`;
  }

  function setGroup(groupKey, checked) {
    checkboxes.forEach((checkbox) => {
      if (checkbox.dataset.groupKey === groupKey) {
        checkbox.checked = checked;
      }
    });
    updateCount();
  }

  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", updateCount);
  });

  if (selectAllButton) {
    selectAllButton.addEventListener("click", () => {
      checkboxes.forEach((checkbox) => {
        checkbox.checked = true;
      });
      updateCount();
    });
  }

  if (clearAllButton) {
    clearAllButton.addEventListener("click", () => {
      checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });
      updateCount();
    });
  }

  groupSelectButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setGroup(button.dataset.selectGroup || "", true);
    });
  });

  groupClearButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setGroup(button.dataset.clearGroup || "", false);
    });
  });

  updateCount();
})();
