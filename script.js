/* Get references to DOM elements */
const productSearch = document.getElementById("productSearch");
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendBtn");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearSelectionsButton = document.getElementById("clearSelections");
const generateRoutineButton = document.getElementById("generateRoutine");

/* Keep product data and selection state in memory */
let allProducts = [];
let visibleProducts = [];
let selectedProducts = [];
let generatedRoutine = "";
let selectedProductsAtGeneration = [];
let conversationHistory = [];
let activeCategory = "";
let searchQuery = "";

const SELECTED_PRODUCTS_STORAGE_KEY = "selectedProductIds";
const OPENAI_PROXY_URL = "https://loreal-chatbot.ymira026.workers.dev/";

/* Save selected product IDs so selections survive page reloads */
function saveSelectedProductsToStorage() {
  const selectedProductIds = selectedProducts.map((product) => product.id);
  localStorage.setItem(
    SELECTED_PRODUCTS_STORAGE_KEY,
    JSON.stringify(selectedProductIds),
  );
}

/* Restore selected products by reading IDs from localStorage */
function restoreSelectedProductsFromStorage() {
  const rawValue = localStorage.getItem(SELECTED_PRODUCTS_STORAGE_KEY);

  if (!rawValue) {
    selectedProducts = [];
    return;
  }

  try {
    const parsedIds = JSON.parse(rawValue);

    if (!Array.isArray(parsedIds)) {
      selectedProducts = [];
      return;
    }

    selectedProducts = parsedIds
      .map((id) => allProducts.find((product) => product.id === Number(id)))
      .filter(Boolean);
  } catch (error) {
    selectedProducts = [];
  }
}

/* Remove all selected products and update storage */
function clearAllSelections() {
  selectedProducts = [];
  saveSelectedProductsToStorage();
  renderSelectedProducts();
  displayProducts(visibleProducts);
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category or search for a product to view results
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Filter products by category and search text */
function getFilteredProducts() {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  return allProducts.filter((product) => {
    const matchesCategory =
      !activeCategory || product.category === activeCategory;

    if (!matchesCategory) {
      return false;
    }

    if (!normalizedSearchQuery) {
      return true;
    }

    const searchableText = [
      product.name,
      product.brand,
      product.category,
      product.description,
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedSearchQuery);
  });
}

/* Refresh the visible products using the current filters */
function updateDisplayedProducts() {
  const normalizedSearchQuery = searchQuery.trim();

  if (!activeCategory && normalizedSearchQuery === "") {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Select a category or search for a product to view results
      </div>
    `;
    return;
  }

  const filteredProducts = getFilteredProducts();
  displayProducts(filteredProducts);
}

/* Create tags shown in the Selected Products section */
function renderSelectedProducts() {
  clearSelectionsButton.disabled = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `<p class="empty-selected">No products selected yet.</p>`;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
    <div class="selected-product-item">
      <span>${product.name}</span>
      <button
        type="button"
        class="remove-selected-btn"
        data-product-id="${product.id}"
        aria-label="Remove ${product.name}"
      >
        Remove
      </button>
    </div>
  `,
    )
    .join("");
}

/* Add or remove a product from the selected list */
function toggleProductSelection(product) {
  const existingIndex = selectedProducts.findIndex(
    (selectedProduct) => selectedProduct.id === product.id,
  );

  if (existingIndex === -1) {
    selectedProducts.push(product);
  } else {
    selectedProducts.splice(existingIndex, 1);
  }

  saveSelectedProductsToStorage();
  renderSelectedProducts();
  displayProducts(visibleProducts);
}

/* Show a placeholder when there are no chat messages yet */
function renderChatPlaceholder() {
  chatWindow.innerHTML = `<p class="chat-placeholder">Generate a routine, then ask follow-up questions here.</p>`;
}

/* Add one chat message bubble */
function appendChatMessage(role, message) {
  if (chatWindow.querySelector(".chat-placeholder")) {
    chatWindow.innerHTML = "";
  }

  const messageElement = document.createElement("div");
  messageElement.className = `chat-message ${role}`;
  messageElement.textContent = message;
  chatWindow.appendChild(messageElement);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Build a clean array with only routine-relevant product data */
function getSelectedProductPayload() {
  return selectedProducts.map((product) => ({
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
  }));
}

/* Build system message for follow-up chat */
function getFollowUpSystemMessage() {
  return `You are a skincare and beauty advisor.
You must only answer questions that are:
1) About the generated routine, or
2) About related beauty topics such as skincare, haircare, makeup, fragrance, and product usage.
If a question is outside those topics, politely refuse and ask the user to stay within routine/beauty topics.

Generated routine:
${generatedRoutine}

Selected products used to generate the routine:
${JSON.stringify(selectedProductsAtGeneration, null, 2)}

Keep answers clear, beginner-friendly, and concise.`;
}

/* Send chat messages through the Cloudflare Worker */
async function requestChatCompletion(systemMessage, messages) {
  const response = await fetch(OPENAI_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "system", content: systemMessage }, ...messages],
      temperature: 0.7,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Request failed.");
  }

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No response content was returned.");
  }

  return content;
}

/* Ask OpenAI to generate a routine from selected products */
async function generateRoutineFromSelectedProducts() {
  const selectedProductPayload = getSelectedProductPayload();

  if (selectedProductPayload.length === 0) {
    appendChatMessage(
      "assistant",
      "Select at least one product before generating a routine.",
    );
    return;
  }

  appendChatMessage("assistant", "Generating your routine...");

  const systemMessage =
    "You are a skincare and beauty advisor. Create a clear daily routine using only the provided selected products. Organize into Morning and Evening steps. Keep the answer beginner-friendly and concise.";

  const userMessage = `Here are the selected products as JSON:\n${JSON.stringify(
    selectedProductPayload,
    null,
    2,
  )}\n\nBuild a routine with numbered steps and include short usage notes.`;

  try {
    const routine = await requestChatCompletion(systemMessage, [
      { role: "user", content: userMessage },
    ]);

    generatedRoutine = routine;
    selectedProductsAtGeneration = selectedProductPayload;

    /* Start a fresh thread for the new routine so follow-ups stay relevant */
    conversationHistory = [
      { role: "user", content: userMessage },
      { role: "assistant", content: routine },
    ];

    appendChatMessage("assistant", routine);
  } catch (error) {
    appendChatMessage(
      "assistant",
      error.message ||
        "Network error. Please check your connection and try again.",
    );
  }
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  visibleProducts = products;

  if (products.length === 0) {
    const hasCategory = Boolean(activeCategory);
    const hasSearch = searchQuery.trim() !== "";
    let emptyMessage = "No products found.";

    if (hasCategory && hasSearch) {
      emptyMessage = "No products found for that category and search term.";
    } else if (hasCategory) {
      emptyMessage = "No products found for this category.";
    } else if (hasSearch) {
      emptyMessage = "No products match your search.";
    }

    productsContainer.innerHTML = `
      <div class="placeholder-message">
        ${emptyMessage}
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div
      class="product-card ${
        selectedProducts.some(
          (selectedProduct) => selectedProduct.id === product.id,
        )
          ? "selected"
          : ""
      }"
      data-product-id="${product.id}"
    >
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
        <button
          type="button"
          class="toggle-description-btn"
          data-description-id="product-description-${product.id}"
          aria-expanded="false"
          aria-controls="product-description-${product.id}"
        >
          Show Description
        </button>
        <p id="product-description-${product.id}" class="product-description" hidden>
          ${product.description}
        </p>
      </div>
    </div>
  `,
    )
    .join("");
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  activeCategory = e.target.value;
  updateDisplayedProducts();
});

/* Filter products as the user types in the search field */
productSearch.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  updateDisplayedProducts();
});

/* Toggle selection when user clicks a product card */
productsContainer.addEventListener("click", (e) => {
  const descriptionButton = e.target.closest(".toggle-description-btn");

  if (descriptionButton) {
    const descriptionId = descriptionButton.dataset.descriptionId;
    const descriptionElement = document.getElementById(descriptionId);

    if (!descriptionElement) {
      return;
    }

    const isExpanded =
      descriptionButton.getAttribute("aria-expanded") === "true";

    descriptionButton.setAttribute("aria-expanded", String(!isExpanded));
    descriptionButton.textContent = isExpanded
      ? "Show Description"
      : "Hide Description";
    descriptionElement.hidden = isExpanded;

    return;
  }

  const productCard = e.target.closest(".product-card");

  if (!productCard) {
    return;
  }

  const productId = Number(productCard.dataset.productId);
  const product = allProducts.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  toggleProductSelection(product);
});

/* Remove directly from the Selected Products section */
selectedProductsList.addEventListener("click", (e) => {
  const removeButton = e.target.closest(".remove-selected-btn");

  if (!removeButton) {
    return;
  }

  const productId = Number(removeButton.dataset.productId);
  const product = allProducts.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  toggleProductSelection(product);
});

/* Generate routine button handler */
generateRoutineButton.addEventListener("click", async () => {
  await generateRoutineFromSelectedProducts();
});

/* Clear all selections button handler */
clearSelectionsButton.addEventListener("click", () => {
  clearAllSelections();
});

/* Load products once when page starts */
async function init() {
  allProducts = await loadProducts();
  restoreSelectedProductsFromStorage();
  renderSelectedProducts();
  renderChatPlaceholder();
  updateDisplayedProducts();
}

init();

/* Chat form submission handler for follow-up questions */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const question = userInput.value.trim();

  if (!question) {
    return;
  }

  if (!generatedRoutine) {
    appendChatMessage(
      "assistant",
      "Generate a routine first, then ask follow-up questions about it.",
    );
    userInput.value = "";
    return;
  }

  appendChatMessage("user", question);
  conversationHistory.push({ role: "user", content: question });
  userInput.value = "";

  sendButton.disabled = true;
  sendButton.setAttribute("aria-busy", "true");

  try {
    const assistantReply = await requestChatCompletion(
      getFollowUpSystemMessage(),
      conversationHistory,
    );

    conversationHistory.push({ role: "assistant", content: assistantReply });
    appendChatMessage("assistant", assistantReply);
  } catch (error) {
    appendChatMessage(
      "assistant",
      error.message || "Could not answer right now. Please try again.",
    );
  } finally {
    sendButton.disabled = false;
    sendButton.removeAttribute("aria-busy");
  }
});
