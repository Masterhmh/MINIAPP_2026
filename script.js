/* ==========================================================================
   1. Cài đặt ban đầu (Initial Setup)
   Lấy thông số API, Sheet ID từ URL và khởi tạo các biến toàn cục.
   ========================================================================== */
const urlParams = new URLSearchParams(window.location.search);
const apiUrl = urlParams.get('api');
const sheetId = urlParams.get('sheetId');
const proxyUrl = 'https://testhmh.netlify.app/.netlify/functions/proxy?url=';

// Kiểm tra thông số API và Sheet ID
if (!apiUrl || !sheetId) {
  showToast("Thiếu thông tin API hoặc Sheet ID. Vui lòng kiểm tra lại URL!", "error");
}

// Biến toàn cục để lưu trữ dữ liệu cache và trạng thái phân trang
let cachedFinancialData = null;
let cachedChartData = null;
let cachedTransactions = null;
let cachedKeywords = null;
let currentPage = 1;
const transactionsPerPage = 10;
let cachedMonthlyExpenses = null;
let currentPageMonthly = 1;
const expensesPerPage = 10;
let cachedSearchResults = null;
let currentPageSearch = 1;
const searchPerPage = 10;
// Cache chi tiết cho từng category (để tránh load lại khi click vào legend nhiều lần)
let categoryDetailsCache = {};

// ⚡ Cache cho 3 chế độ lọc Tab 2 (Hàng tháng, Hàng năm, Tùy chọn)
let filterModeCache = {
  monthly: {},   // Cache cho chế độ "Hàng tháng" (key: "month")
  yearly: {},    // Cache cho chế độ "Hàng năm" (key: "1-currentMonth")
  custom: {}     // Cache cho chế độ "Tùy chọn" (key: "startMonth-endMonth")
};

// ⚡ Cache cho 3 chế độ tìm kiếm Tab 4 (Cả năm, Theo tháng, Khoảng thời gian)
let searchModeCache = {
  yearly: {},       // Cache cho chế độ "Cả năm" (key: "content-amount-category")
  monthly: {},      // Cache cho chế độ "Theo tháng" (key: "month-content-amount-category")
  custom: {}        // Cache cho chế độ "Khoảng thời gian" (key: "startMonth-endMonth-content-amount-category")
};

// ⚡ TỐI ƯU: Toast queue để tránh nhiều toast cùng lúc
let toastQueue = [];
let isShowingToast = false;

// ⚡ GIẢI PHÁP: Định nghĩa cấu hình cột cố định để đồng nhất giữa các biểu đồ
// Điều này đảm bảo độ rộng cột giữa biểu đồ TỔNG QUAN và biểu đồ Category Detail đồng nhất
const FIXED_BAR_CONFIG = {
  barPercentage: 0.8,        // Tỷ lệ cột so với khoảng trống (0.8 = 80% không gian)
  categoryPercentage: 0.9,   // Tỷ lệ nhóm cột so với category (0.9 = 90% không gian category)
  maxBarThickness: 60,       // Độ rộng tối đa của cột (pixel)
  minBarLength: 2            // Chiều cao tối thiểu để hiển thị cột
};

/* ==========================================================================
   2. Hàm tiện ích (Utility Functions)
   Các hàm hỗ trợ hiển thị thông báo, định dạng ngày giờ và quản lý giao diện.
   ========================================================================== */
/**
 * Hiển thị thông báo dạng toast với queue system và animations mượt.
 * ⚡ TỐI ƯU: Sử dụng queue để tránh nhiều toast cùng lúc, requestAnimationFrame cho animation mượt 60fps
 * @param {string} message - Nội dung thông báo.
 * @param {string} type - Loại thông báo (info, success, error, warning).
 */
function showToast(message, type = "info") {
  toastQueue.push({ message, type });
  if (!isShowingToast) {
    processToastQueue();
  }
}

function processToastQueue() {
  if (toastQueue.length === 0) {
    isShowingToast = false;
    return;
  }
  
  isShowingToast = true;
  const { message, type } = toastQueue.shift();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div>
      <span>${message}</span>
    </div>
  `;
  document.body.appendChild(toast);
  
  // ⚡ Sử dụng requestAnimationFrame cho animation mượt hơn
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
      processToastQueue(); // Xử lý toast tiếp theo trong queue
    }, 300);
  }, 3000);
}

/**
 * Hiển thị thông báo lỗi trong modal.
 * @param {string} modalId - ID của modal (edit, add).
 * @param {string} message - Nội dung thông báo lỗi.
 */
function showModalError(modalId, message) {
  const errorDiv = document.getElementById(`${modalId}Error`);
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => errorDiv.style.display = 'none', 5000);
  }
}

/**
 * Hiển thị hoặc ẩn biểu tượng loading cho tab.
 * @param {boolean} show - Hiển thị (true) hoặc ẩn (false).
 * @param {string} tabId - ID của tab (tab1, tab2, ...).
 */
function showLoading(show, tabId) {
  const loadingElement = document.getElementById(`loading${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
  if (loadingElement) loadingElement.style.display = show ? 'block' : 'none';
}

/**
 * Hiển thị hoặc ẩn popup loading toàn màn hình.
 * ⚡ TỐI ƯU: Thêm opacity và scale transitions mượt mà
 * @param {boolean} show - Hiển thị (true) hoặc ẩn (false).
 */
function showLoadingPopup(show) {
  let loadingPopup = document.getElementById('loadingPopup');
  if (!loadingPopup) {
    loadingPopup = document.createElement('div');
    loadingPopup.id = 'loadingPopup';
    loadingPopup.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 3000;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    loadingPopup.innerHTML = `
      <div style="
        background: #FFFFFF;
        padding: 2rem;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        transform: scale(0.9);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      ">
        <div style="
          border: 4px solid #16A34A;
          border-top: 4px solid transparent;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
        "></div>
        <span style="
          font-size: 1rem;
          color: #1F2A44;
          font-weight: 500;
        ">Đang xử lý...</span>
      </div>
    `;
    document.body.appendChild(loadingPopup);
  }
  
  // ⚡ Sử dụng requestAnimationFrame cho animation mượt
  if (show) {
    loadingPopup.style.display = 'flex';
    requestAnimationFrame(() => {
      loadingPopup.style.opacity = '1';
      loadingPopup.querySelector('div').style.transform = 'scale(1)';
    });
  } else {
    loadingPopup.style.opacity = '0';
    loadingPopup.querySelector('div').style.transform = 'scale(0.9)';
    setTimeout(() => {
      loadingPopup.style.display = 'none';
    }, 300);
  }
}

/**
 * Định dạng ngày từ DD/MM/YYYY thành DD/MM/YYYY.
 * @param {string} dateStr - Chuỗi ngày cần định dạng.
 * @returns {string} Chuỗi ngày đã định dạng.
 */
function formatDate(dateStr) {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const [day, month, year] = parts;
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
}

/**
 * Định dạng ngày thành YYYY-MM-DD.
 * @param {Date} date - Đối tượng Date.
 * @returns {string} Chuỗi ngày định dạng YYYY-MM-DD.
 */
function formatDateToYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Định dạng ngày thành DD/MM.
 * @param {Date} date - Đối tượng Date.
 * @returns {string} Chuỗi ngày định dạng DD/MM.
 */
function formatDateToDDMM(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/**
 * Định dạng số với dấu chấm ngăn cách hàng nghìn.
 * @param {string} value - Chuỗi số cần định dạng.
 * @returns {string} Chuỗi số đã định dạng.
 */
function formatNumberWithCommas(value) {
  if (!value) return '';
  const digitsOnly = value.replace(/[^0-9]/g, '');
  return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Chuyển đổi chuỗi số có dấu chấm thành số nguyên.
 * @param {string} value - Chuỗi số cần chuyển đổi.
 * @returns {number} Số nguyên.
 */
function parseNumber(value) {
  return parseInt(value.replace(/[^0-9]/g, '')) || 0;
}

/**
 * Debounce function để tối ưu input events.
 * ⚡ TỐI ƯU: Giảm số lần xử lý khi người dùng nhập liệu nhanh
 * @param {Function} func - Hàm cần debounce.
 * @param {number} wait - Thời gian chờ (ms).
 * @returns {Function} Hàm đã được debounce.
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/* ==========================================================================
   3. Hàm điều hướng (Navigation Functions)
   Hàm xử lý chuyển đổi giữa các tab trong ứng dụng.
   ========================================================================== */
/**
 * Mở tab được chọn và cập nhật giao diện.
 * ⚡ TỐI ƯU: Thêm smooth fade và scale transitions khi chuyển tab
 * @param {string} tabId - ID của tab cần mở (tab1, tab2, ...).
 */
window.openTab = function(tabId) {
  const tabs = document.querySelectorAll('.nav-item');
  const contents = document.querySelectorAll('.tab-content');
  
  // ⚡ Sử dụng requestAnimationFrame cho animation mượt
  requestAnimationFrame(() => {
    tabs.forEach(tab => tab.classList.remove('active'));
    
    contents.forEach(content => {
      if (content.classList.contains('active')) {
        content.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        content.style.opacity = '0';
        content.style.transform = 'scale(0.98)';
        setTimeout(() => {
          content.classList.remove('active');
        }, 200);
      }
    });
    
    setTimeout(() => {
      const targetTab = document.getElementById(tabId);
      targetTab.classList.add('active');
      targetTab.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      targetTab.style.opacity = '0';
      targetTab.style.transform = 'scale(0.98)';
      
      requestAnimationFrame(() => {
        targetTab.style.opacity = '1';
        targetTab.style.transform = 'scale(1)';
      });
      
      document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');
    }, 200);
  });
  
  if (tabId === 'tab3') {
    const container = document.getElementById('searchResultsContainer');
    const placeholderTab3 = document.getElementById('placeholderTab3');
    const paginationDiv = document.getElementById('paginationSearch');
    if (container && placeholderTab3) {
      if (cachedSearchResults && cachedSearchResults.transactions && cachedSearchResults.transactions.length > 0) {
        displaySearchResults(cachedSearchResults.transactions);
      } else {
        container.innerHTML = '';
        placeholderTab3.style.display = 'block';
        if (paginationDiv) paginationDiv.style.display = 'none';
      }
    }
  }
  
  if (tabId === 'tab4') {
    const container = document.getElementById('keywordsContainer');
    const placeholderTab4 = document.getElementById('placeholderTab4');
    if (container && placeholderTab4) {
      if (cachedKeywords && cachedKeywords.length > 0) {
        displayKeywords(cachedKeywords);
      } else {
        container.innerHTML = '';
        placeholderTab4.style.display = 'block';
      }
    }
  }
};

/* ==========================================================================
   4. Tab 1: Giao dịch (Transactions Tab)
   Các hàm liên quan đến lấy, hiển thị và quản lý giao dịch trong ngày.
   ========================================================================== */
/**
 * Lấy danh sách giao dịch theo ngày từ API.
 */
window.fetchTransactions = async function() {
  const transactionDate = document.getElementById('transactionDate').value;
  if (!transactionDate) return showToast("Vui lòng chọn ngày để xem giao dịch!", "warning");
  const dateForApi = transactionDate;
  const [year, month, day] = transactionDate.split('-');
  const formattedDateForDisplay = `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  const cacheKey = `${formattedDateForDisplay}`;

  if (cachedTransactions && cachedTransactions.cacheKey === cacheKey) {
    displayTransactions(cachedTransactions.data);
    return;
  }

  showLoading(true, 'tab1');
  try {
    const targetUrl = `${apiUrl}?action=getTransactionsByDate&date=${encodeURIComponent(dateForApi)}&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    const transactionData = await response.json();
    if (transactionData.error) throw new Error(transactionData.error);
    cachedTransactions = { cacheKey, data: transactionData };
    displayTransactions(transactionData);
  } catch (error) {
    showToast("Lỗi khi lấy dữ liệu giao dịch: " + error.message, "error");
    displayTransactions({ error: true });
  } finally {
    showLoading(false, 'tab1');
  }
};

/**
 * Hiển thị danh sách giao dịch và thống kê tổng quan.
 * @param {Object|Array} data - Dữ liệu giao dịch từ API.
 */
function displayTransactions(data) {
  const container = document.getElementById('transactionsContainer');
  const summaryContainer = document.getElementById('dailySummary');
  const pageInfo = document.getElementById('pageInfo');
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');
  const paginationDiv = document.getElementById('pagination');
  const placeholderTab1 = document.getElementById('placeholderTab1');
  container.innerHTML = '';

  if (!data || data.error || !Array.isArray(data) || data.length === 0) {
    container.innerHTML = '<div>Không có giao dịch nào trong ngày này</div>';
    summaryContainer.innerHTML = `
      <div class="stat-box income"><div class="title">Thu nhập</div><div class="amount no-data">Không có<br>dữ liệu</div></div>
      <div class="stat-box expense"><div class="title">Chi tiêu</div><div class="amount no-data">Không có<br>dữ liệu</div></div>
      <div class="stat-box balance"><div class="title">Số dư</div><div class="amount no-data">Không có<br>dữ liệu</div></div>
    `;
    pageInfo.textContent = '';
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    paginationDiv.style.display = 'none';
    placeholderTab1.style.display = 'block';
    return;
  }

  // Ẩn placeholder và hiển thị pagination
  placeholderTab1.style.display = 'none';
  paginationDiv.style.display = 'block';

  container.innerHTML = `<div class="notification">Bạn có ${data.length} giao dịch trong ngày</div>`;

  let totalIncome = 0, totalExpense = 0;
  data.forEach(item => {
    if (item.type === 'Thu nhập') totalIncome += item.amount;
    else if (item.type === 'Chi tiêu') totalExpense += item.amount;
  });
  const balance = totalIncome - totalExpense;

  summaryContainer.innerHTML = `
    <div class="stat-box income"><div class="title">Thu nhập</div><div class="amount">${totalIncome.toLocaleString('vi-VN')}đ</div></div>
    <div class="stat-box expense"><div class="title">Chi tiêu</div><div class="amount">${totalExpense.toLocaleString('vi-VN')}đ</div></div>
    <div class="stat-box balance"><div class="title">Số dư</div><div class="amount">${balance.toLocaleString('vi-VN')}đ</div></div>
  `;

  const totalPages = Math.ceil(data.length / transactionsPerPage);
  const startIndex = (currentPage - 1) * transactionsPerPage;
  const endIndex = startIndex + transactionsPerPage;
  const paginatedData = data.slice(startIndex, endIndex);

  paginatedData.forEach((item, index) => {
  const transactionBox = document.createElement('div');
  transactionBox.className = 'transaction-box';
  const amountColor = item.type === 'Thu nhập' ? 'var(--income-color)' : 'var(--expense-color)';
  const typeClass = item.type === 'Thu nhập' ? 'income' : 'expense';
  const transactionNumber = startIndex + index + 1;
  transactionBox.innerHTML = `
  <div class="layer-container" style="position: relative;">
    <div class="layer-top" style="position: absolute; top: 0; right: 0;">
      <div class="number">Giao dịch thứ: ${transactionNumber}</div>
      <div class="id">Mã giao dịch: ${item.id}</div>
    </div>
    <div class="layer-bottom" style="width: 100%;">
      <div class="date">${formatDate(item.date)}</div>
      <div class="amount" style="color: ${amountColor};">${item.amount.toLocaleString('vi-VN')}đ</div>
      <div class="content">Nội dung: ${item.content}${item.note ? ` (${item.note})` : ''}</div>
      <div class="type ${typeClass}">Phân loại: ${item.type}</div>
      <div class="category">Phân loại chi tiết: ${item.category}</div>
    </div>
  </div>
  <div style="margin-top: 0.5rem;">
    <button class="edit-btn edit" data-id="${item.id}"><i class="fas fa-edit"></i> Sửa</button>
    <button class="delete-btn delete" data-id="${item.id}"><i class="fas fa-trash"></i> Xóa</button>
  </div>
`;
  container.appendChild(transactionBox);
});

  pageInfo.textContent = `Trang ${currentPage} / ${totalPages}`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;

  document.querySelectorAll('.edit-btn').forEach(button => {
    const transactionId = button.getAttribute('data-id');
    const transaction = data.find(item => String(item.id) === String(transactionId));
    if (!transaction) return console.error(`Không tìm thấy giao dịch với ID: ${transactionId}`);
    button.addEventListener('click', () => openEditForm(transaction));
  });

  document.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteTransaction(button.getAttribute('data-id')));
  });
}

/* ==========================================================================
   5. Quản lý giao dịch (Transaction Management)
   Các hàm để thêm, sửa, xóa giao dịch và lấy danh sách phân loại.
   ========================================================================== */
/**
 * Lấy danh sách phân loại chi tiết từ API.
 * @returns {Array} Danh sách phân loại.
 */
async function fetchCategories() {
  try {
    const targetUrl = `${apiUrl}?action=getCategories&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    const categoriesData = await response.json();
    if (categoriesData.error) throw new Error(categoriesData.error);
    return categoriesData;
  } catch (error) {
    showToast("Lỗi khi lấy danh sách phân loại: " + error.message, "error");
    return [];
  }
}

/**
 * Mở form chỉnh sửa giao dịch.
 * @param {Object} transaction - Dữ liệu giao dịch cần chỉnh sửa.
 */
async function openEditForm(transaction) {
  if (!transaction) return showToast('Dữ liệu giao dịch không hợp lệ!', "error");
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  const categorySelect = document.getElementById('editCategory');
  const amountInput = document.getElementById('editAmount');
  const modalContent = document.querySelector('#editModal .modal-content'); // Thêm dòng này để lấy modal-content

  document.getElementById('editTransactionId').value = transaction.id || '';
  document.getElementById('editContent').value = transaction.content || '';
  amountInput.value = formatNumberWithCommas(transaction.amount.toString());
  document.getElementById('editType').value = transaction.type || 'Thu nhập';
  document.getElementById('editNote').value = transaction.note || '';

  let dateValue = '';
  if (transaction.date && transaction.date.includes('/')) {
    const [day, month, year] = transaction.date.split('/');
    if (day && month && year && day.length === 2 && month.length === 2 && year.length === 4) {
      dateValue = `${year}-${month}-${day}`;
    } else {
      showToast("Định dạng ngày giao dịch không hợp lệ!", "error");
      return;
    }
  } else {
    showToast("Ngày giao dịch không hợp lệ!", "error");
    return;
  }
  document.getElementById('editDate').value = dateValue;

  const categories = await fetchCategories();
  categorySelect.innerHTML = '';
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    if (category === transaction.category) option.selected = true;
    categorySelect.appendChild(option);
  });

  amountInput.addEventListener('input', function() {
    const cursorPosition = this.selectionStart;
    const oldLength = this.value.length;
    this.value = formatNumberWithCommas(this.value);
    const newLength = this.value.length;
    this.selectionStart = this.selectionEnd = cursorPosition + (newLength - oldLength);
  });

  amountInput.addEventListener('keypress', function(e) {
    if (!/[0-9]/.test(e.key)) {
      e.preventDefault();
    }
  });

  modal.style.display = 'flex';

  // Điều chỉnh vị trí modal khi bàn phím mở
  const inputs = modalContent.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    input.addEventListener('focus', () => {
      setTimeout(() => {
        modal.scrollTop = input.offsetTop - 50; // Cuộn modal đến vị trí của ô đang nhập
        input.scrollIntoView({ behavior: 'smooth', block: 'center' }); // Đưa ô nhập liệu vào giữa màn hình
      }, 300); // Delay để bàn phím mở hoàn toàn
    });
  });

  form.onsubmit = async function(e) {
    e.preventDefault();
    const dateInput = document.getElementById('editDate').value;
    if (!dateInput) return showModalError('edit', 'Vui lòng chọn ngày!');
    const inputDate = new Date(dateInput);
    const today = new Date();
    if (inputDate > today) return showModalError('edit', 'Không thể chọn ngày trong tương lai!');
    const amount = parseNumber(document.getElementById('editAmount').value);
    if (amount <= 0) return showModalError('edit', 'Số tiền phải lớn hơn 0!');
    const [year, month, day] = dateInput.split('-');
    const formattedDate = `${day}/${month}/${year}`;
    const updatedTransaction = {
      id: document.getElementById('editTransactionId').value,
      content: document.getElementById('editContent').value,
      amount: amount,
      type: document.getElementById('editType').value,
      category: document.getElementById('editCategory').value,
      note: document.getElementById('editNote').value || '',
      date: formattedDate,
      action: 'updateTransaction'
    };
    await saveTransaction(updatedTransaction);
  };
}

/**
 * Mở form thêm giao dịch mới.
 */
async function openAddForm() {
  const modal = document.getElementById('addModal');
  const form = document.getElementById('addForm');
  const categorySelect = document.getElementById('addCategory');
  const amountInput = document.getElementById('addAmount');

  document.getElementById('addDate').value = formatDateToYYYYMMDD(new Date());
  document.getElementById('addContent').value = '';
  amountInput.value = '';
  document.getElementById('addType').value = 'Thu nhập';
  document.getElementById('addNote').value = '';

  const categories = await fetchCategories();
  categorySelect.innerHTML = '';
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });

  amountInput.addEventListener('input', function() {
    const cursorPosition = this.selectionStart;
    const oldLength = this.value.length;
    this.value = formatNumberWithCommas(this.value);
    const newLength = this.value.length;
    this.selectionStart = this.selectionEnd = cursorPosition + (newLength - oldLength);
  });

  amountInput.addEventListener('keypress', function(e) {
    if (!/[0-9]/.test(e.key)) {
      e.preventDefault();
    }
  });

  modal.style.display = 'flex';
  form.onsubmit = async function(e) {
    e.preventDefault();
    const dateInput = document.getElementById('addDate').value;
    const [year, month, day] = dateInput.split('-');
    const formattedDate = `${day}/${month}/${year}`;
    const today = new Date();
    const inputDate = new Date(year, month - 1, day);
    if (inputDate > today) return showModalError('add', 'Không thể chọn ngày trong tương lai!');
    const amount = parseNumber(document.getElementById('addAmount').value);
    if (amount <= 0) return showModalError('add', 'Số tiền phải lớn hơn 0!');
    const newTransaction = {
      content: document.getElementById('addContent').value,
      amount: amount,
      type: document.getElementById('addType').value,
      category: document.getElementById('addCategory').value,
      note: document.getElementById('addNote').value || '',
      date: formattedDate,
      action: 'addTransaction',
      sheetId: sheetId
    };
    await addTransaction(newTransaction);
  };
}

/**
 * Đóng form chỉnh sửa giao dịch.
 */
function closeEditForm() {
  document.getElementById('editModal').style.display = 'none';
}

/**
 * Đóng form thêm giao dịch.
 */
function closeAddForm() {
  document.getElementById('addModal').style.display = 'none';
}

/**
 * Lưu giao dịch đã chỉnh sửa vào Google Sheet.
 * @param {Object} updatedTransaction - Dữ liệu giao dịch cần cập nhật.
 */
async function saveTransaction(updatedTransaction) {
  if (!updatedTransaction.date || !updatedTransaction.date.includes('/')) {
    showToast("Ngày giao dịch không hợp lệ!", "error");
    return;
  }
  const dateParts = updatedTransaction.date.split('/');
  if (dateParts.length !== 3) {
    showToast("Định dạng ngày không hợp lệ!", "error");
    return;
  }
  const transactionMonth = dateParts[1].padStart(2, '0');
  updatedTransaction.month = transactionMonth;
  updatedTransaction.sheetId = sheetId;

  showLoadingPopup(true);
  try {
    const finalUrl = proxyUrl + encodeURIComponent(apiUrl);
    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedTransaction)
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    showToast("Cập nhật giao dịch thành công!", "success");
    closeEditForm();
    
    // Clear cache
    cachedTransactions = null;
    cachedMonthlyExpenses = null;
    cachedSearchResults = null;
    
    // ⚡ Clear cache Tab 2 (filter modes)
    filterModeCache.monthly = {};
    filterModeCache.yearly = {};
    filterModeCache.custom = {};
    
    const activeTab = document.querySelector('.tab-content.active')?.id;
    if (activeTab === 'tab1') {
      await window.fetchTransactions();
    } else if (activeTab === 'tab3') {
      await window.searchTransactions();
    }
  } catch (error) {
    showToast("Lỗi khi cập nhật giao dịch: " + error.message, "error");
    console.error("Save transaction error:", error);
  } finally {
    showLoadingPopup(false);
  }
}

/**
 * Thêm giao dịch mới vào Google Sheet.
 * @param {Object} newTransaction - Dữ liệu giao dịch mới.
 */
async function addTransaction(newTransaction) {
  showLoadingPopup(true);
  try {
    // Kiểm tra định dạng ngày
    if (!newTransaction.date || !/^\d{2}\/\d{2}\/\d{4}$/.test(newTransaction.date)) {
      throw new Error("Định dạng ngày không hợp lệ!");
    }

    const finalUrl = proxyUrl + encodeURIComponent(apiUrl);
    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTransaction)
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    showToast(`Đã thêm giao dịch và tải dữ liệu cho ngày ${newTransaction.date}`, "success");
    closeAddForm();
    
    // Clear cache
    cachedTransactions = null;
    cachedMonthlyExpenses = null;
    cachedSearchResults = null;
    
    // ⚡ Clear cache Tab 2 (filter modes)
    filterModeCache.monthly = {};
    filterModeCache.yearly = {};
    filterModeCache.custom = {};
    
    const activeTab = document.querySelector('.tab-content.active')?.id;

    // Lấy ngày từ giao dịch vừa thêm
    const transactionDate = newTransaction.date; // Định dạng DD/MM/YYYY
    const [day, month, year] = transactionDate.split('/');
    const formattedDateForInput = `${year}-${month}-${day}`; // Định dạng YYYY-MM-DD

    // Cập nhật input ngày trong Tab 1 và tải dữ liệu cho ngày đó
    if (activeTab === 'tab1') {
      const transactionDateInput = document.getElementById('transactionDate');
      transactionDateInput.value = formattedDateForInput; // Cập nhật giá trị input
      await window.fetchTransactions(); // Tải dữ liệu cho ngày được chọn
    } else if (activeTab === 'tab3') {
      await window.searchTransactions();
    }
  } catch (error) {
    showToast("Lỗi khi thêm giao dịch: " + error.message, "error");
    console.error("Add transaction error:", error);
  } finally {
    showLoadingPopup(false);
  }
}

/**
 * Xóa giao dịch từ Google Sheet.
 * @param {string} transactionId - ID của giao dịch cần xóa.
 */
async function deleteTransaction(transactionId) {
  const modal = document.getElementById('confirmDeleteModal');
  if (!modal) {
    showToast("Lỗi giao diện: Không tìm thấy modal xác nhận!", "error");
    return;
  }

  const activeTab = document.querySelector('.tab-content.active')?.id;
  let cacheData = null;

  if (activeTab === 'tab1') {
    cacheData = cachedTransactions;
  } else if (activeTab === 'tab2') {
    cacheData = cachedMonthlyExpenses;
  } else if (activeTab === 'tab3') {
    cacheData = cachedSearchResults;
  }

  if (!cacheData && activeTab) {
    showToast("Không tìm thấy dữ liệu giao dịch!", "error");
    console.error("No cache data for active tab:", activeTab);
    return;
  }

  modal.style.display = 'flex';
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  confirmBtn.onclick = async () => {
    modal.style.display = 'none';
    showLoadingPopup(true);
    try {
      const transaction = cacheData?.data
        ? cacheData.data.find(item => String(item.id) === String(transactionId))
        : cacheData?.transactions
        ? cacheData.transactions.find(item => String(item.id) === String(transactionId))
        : null;

      if (!transaction) throw new Error("Không tìm thấy giao dịch để xóa!");

      if (!transaction.date || !transaction.date.includes('/')) {
        throw new Error("Ngày giao dịch không hợp lệ!");
      }
      const dateParts = transaction.date.split('/');
      if (dateParts.length !== 3) throw new Error("Định dạng ngày không hợp lệ!");
      const transactionMonth = dateParts[1].padStart(2, '0');

      const finalUrl = proxyUrl + encodeURIComponent(apiUrl);
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteTransaction',
          id: transactionId,
          month: transactionMonth,
          sheetId: sheetId
        })
      });

      const result = await response.json();
      if (result.error) throw new Error(result.error);
      showToast("Xóa giao dịch thành công!", "success");
      
      // Clear cache
      cachedTransactions = null;
      cachedMonthlyExpenses = null;
      cachedSearchResults = null;
      
      // ⚡ Clear cache Tab 2 (filter modes)
      filterModeCache.monthly = {};
      filterModeCache.yearly = {};
      filterModeCache.custom = {};
      
      if (activeTab === 'tab1') {
        await window.fetchTransactions();
      } else if (activeTab === 'tab3') {
        await window.searchTransactions();
      }
    } catch (error) {
      showToast("Lỗi khi xóa giao dịch: " + error.message, "error");
      console.error("Delete transaction error:", error);
    } finally {
      showLoadingPopup(false);
    }
  };
}

/**
 * Đóng modal xác nhận xóa giao dịch.
 */
function closeConfirmDeleteModal() {
  document.getElementById('confirmDeleteModal').style.display = 'none';
}


/* ==========================================================================
   7. Tab 2: Biểu đồ (Charts Tab)
   Các hàm lấy và hiển thị biểu đồ thu chi theo tháng.
   ========================================================================== */

/**
 * Định dạng Date thành chuỗi YYYY-Www cho input[type=week].
 */
function formatWeekInput(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Tính ngày đầu tuần (T2) và cuối tuần (CN) từ chuỗi tuần ISO "YYYY-Www".
 */
function getWeekDateRange(weekStr) {
  const [yearStr, weekPart] = weekStr.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekPart);
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const start = new Date(simple);
  if (dow <= 4) {
    start.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    start.setDate(simple.getDate() + 8 - simple.getDay());
  }
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  function fmt(d) {
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  return { startDate: start, endDate: end, startDateStr: fmt(start), endDateStr: fmt(end) };
}

/**
 * Lọc và hiển thị dữ liệu tài chính theo tuần.
 */
window.fetchWeeklyData = async function(weekStr) {
  const { startDate, endDate, startDateStr, endDateStr } = getWeekDateRange(weekStr);
  const year = new Date().getFullYear();
  const today = new Date(); today.setHours(23,59,59,999);
  if (startDate > today) return showToast("Không thể chọn tuần trong tương lai!", "warning");

  showLoading(true, 'tab2');
  try {
    const monthsNeeded = new Set([startDate.getMonth() + 1, endDate.getMonth() + 1]);
    let allTransactions = [];
    for (const month of monthsNeeded) {
      const targetUrl = `${apiUrl}?action=getTransactionsByMonth&month=${month}&year=${year}&sheetId=${sheetId}`;
      const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
      const response = await fetch(finalUrl);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      allTransactions = allTransactions.concat(data);
    }

    const weekTransactions = allTransactions.filter(item => {
      if (!item.date || !item.date.includes('/')) return false;
      const [d, m, y] = item.date.split('/');
      const txDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      txDate.setHours(0,0,0,0);
      const s = new Date(startDate); s.setHours(0,0,0,0);
      const e = new Date(endDate); e.setHours(23,59,59,999);
      return txDate >= s && txDate <= e;
    });

    const dayNames = ['CN','T2','T3','T4','T5','T6','T7'];
    const dayLabels = [], incomeByDay = [], expenseByDay = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate); d.setDate(startDate.getDate() + i);
      dayLabels.push(`${dayNames[d.getDay()]}\n${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`);
      const dayTx = weekTransactions.filter(item => {
        const [dd, mm] = item.date.split('/');
        return parseInt(dd) === d.getDate() && parseInt(mm) === d.getMonth() + 1;
      });
      let inc = 0, exp = 0;
      dayTx.forEach(t => { if (t.type === 'Thu nhập') inc += t.amount; else if (t.type === 'Chi tiêu') exp += t.amount; });
      incomeByDay.push(inc); expenseByDay.push(exp);
    }

    const totalIncome = incomeByDay.reduce((a,b) => a+b, 0);
    const totalExpense = expenseByDay.reduce((a,b) => a+b, 0);
    const categoryMap = {};
    weekTransactions.forEach(t => { if (t.type === 'Chi tiêu') categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount; });
    const expenseCategoryData = Object.entries(categoryMap).map(([category, amount]) => ({ category, amount }));

    const placeholderTab2 = document.getElementById('placeholderTab2');
    const chartTitleTab2 = document.getElementById('chartTitleTab2');
    const pieChartTitleTab2 = document.getElementById('pieChartTitleTab2');
    const chartContainer = document.querySelector('#tab2 .chart-container');
    if (placeholderTab2) placeholderTab2.style.display = 'none';
    if (chartTitleTab2) { chartTitleTab2.style.display = 'block'; chartTitleTab2.textContent = `TỔNG QUAN TUẦN (${startDateStr} – ${endDateStr})`; }
    if (pieChartTitleTab2) pieChartTitleTab2.style.display = 'block';
    if (chartContainer) chartContainer.classList.add('show');

    document.getElementById('monthlyStatsContainer').innerHTML = `
      <div class="stat-box income"><div class="title">Thu nhập</div><div class="amount">${totalIncome.toLocaleString('vi-VN')}đ</div></div>
      <div class="stat-box expense"><div class="title">Chi tiêu</div><div class="amount">${totalExpense.toLocaleString('vi-VN')}đ</div></div>
      <div class="stat-box balance"><div class="title">Số dư</div><div class="amount">${(totalIncome - totalExpense).toLocaleString('vi-VN')}đ</div></div>
    `;

    const ctx = document.getElementById('monthlyChart').getContext('2d');
    const monthlyChartElement = document.getElementById('monthlyChart');
    if (window.monthlyChartInstance) window.monthlyChartInstance.destroy();
    window.monthlyChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [
          { label: 'Thu nhập', data: incomeByDay, backgroundColor: 'rgba(16,185,129,0.8)', borderColor: 'rgba(16,185,129,1)', borderWidth: 1 },
          { label: 'Chi tiêu', data: expenseByDay, backgroundColor: 'rgba(244,63,94,0.8)', borderColor: 'rgba(244,63,94,1)', borderWidth: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 65, bottom: 10 } },
        barPercentage: FIXED_BAR_CONFIG.barPercentage,
        categoryPercentage: FIXED_BAR_CONFIG.categoryPercentage,
        maxBarThickness: FIXED_BAR_CONFIG.maxBarThickness,
        scales: {
          x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 45, font: { family: 'Nunito, sans-serif', size: 11 } }, grid: { color: 'rgba(148,163,184,0.1)' } },
          y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString('vi-VN') + 'đ', font: { family: 'Nunito, sans-serif' } }, grid: { color: 'rgba(148,163,184,0.1)' } }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toLocaleString('vi-VN')}đ` }, titleFont: { family: 'Nunito, sans-serif' }, bodyFont: { family: 'Nunito, sans-serif' } },
          datalabels: { anchor: 'end', align: 'end', color: '#94A3B8', font: { weight: 'bold', size: 9 }, rotation: -90, formatter: v => v === 0 ? '' : v.toLocaleString('vi-VN') + 'đ' }
        }
      },
      plugins: [ChartDataLabels]
    });
    monthlyChartElement.classList.add('show');
    drawMonthlyPieChart(expenseCategoryData);

    cachedChartData = { monthlyData: [], expenseCategoryData, startMonth: startDate.getMonth()+1, endMonth: endDate.getMonth()+1, isWeekly: true, weekTransactions };
    categoryDetailsCache = {};

  } catch (error) {
    showToast("Lỗi khi lấy dữ liệu theo tuần: " + error.message, "error");
  } finally {
    showLoading(false, 'tab2');
  }
};
/**
 * Lấy dữ liệu thu chi theo tháng từ API.
 */
window.fetchMonthlyData = async function() {
  const startMonth = parseInt(document.getElementById('startMonth').value);
  const endMonth = parseInt(document.getElementById('endMonth').value);
  if (startMonth > endMonth) return showToast("Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc!", "warning");

  showLoading(true, 'tab2');
  try {
    // Gọi API cho bar chart (thu/chi theo tháng)
    const targetUrl = `${apiUrl}?action=getMonthlyData&startMonth=${startMonth}&endMonth=${endMonth}&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    const monthlyData = await response.json();
    if (monthlyData.error) throw new Error(monthlyData.error);

    // Gọi API cho pie chart
    const expenseCategoryData = await fetchExpensesByCategoryForMonths(startMonth, endMonth);
    
    // Lưu vào cache chung
    cachedChartData = {
      monthlyData: monthlyData,
      expenseCategoryData: expenseCategoryData,
      startMonth: startMonth,
      endMonth: endMonth
    };
    
    // Xóa cache category cũ khi lọc lại dữ liệu
    categoryDetailsCache = {};
    
    // Render UI
    renderMonthlyDataUI(monthlyData, expenseCategoryData, startMonth, endMonth);
    
  } catch (error) {
    showToast("Lỗi khi lấy dữ liệu: " + error.message, "error");
  } finally {
    showLoading(false, 'tab2');
  }
};

/**
 * ⚡ Hàm mới: Load dữ liệu với cache cho các chế độ lọc
 * @param {string} mode - Chế độ lọc: 'monthly', 'yearly', 'custom'
 * @param {number} startMonth - Tháng bắt đầu
 * @param {number} endMonth - Tháng kết thúc
 */
window.fetchMonthlyDataWithCache = async function(mode, startMonth, endMonth) {
  // Tạo cache key thống nhất cho tất cả chế độ
  const cacheKey = `${startMonth}-${endMonth}`;
  
  // Kiểm tra cache
  let cachedData = null;
  if (mode === 'monthly') {
    cachedData = filterModeCache.monthly[cacheKey];
  } else if (mode === 'yearly') {
    cachedData = filterModeCache.yearly[cacheKey];
  } else if (mode === 'custom') {
    cachedData = filterModeCache.custom[cacheKey];
  }
  
  // Nếu có cache, sử dụng luôn
  if (cachedData) {
    console.log(`📦 Sử dụng cache cho chế độ ${mode}`);
    renderMonthlyDataUI(
      cachedData.monthlyData, 
      cachedData.expenseCategoryData, 
      cachedData.startMonth, 
      cachedData.endMonth
    );
    
    // Cập nhật cachedChartData để click legend hoạt động
    cachedChartData = cachedData;
    return;
  }
  
  // Nếu chưa có cache, gọi API
  console.log(`🌐 Gọi API cho chế độ ${mode}`);
  showLoading(true, 'tab2');
  
  try {
    // Gọi API cho bar chart
    const targetUrl = `${apiUrl}?action=getMonthlyData&startMonth=${startMonth}&endMonth=${endMonth}&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    const monthlyData = await response.json();
    if (monthlyData.error) throw new Error(monthlyData.error);

    // Gọi API cho pie chart
    const expenseCategoryData = await fetchExpensesByCategoryForMonths(startMonth, endMonth);
    
    // Tạo object cache
    const cacheObject = {
      monthlyData: monthlyData,
      expenseCategoryData: expenseCategoryData,
      startMonth: startMonth,
      endMonth: endMonth
    };
    
    // Lưu vào cache theo chế độ
    if (mode === 'monthly') {
      filterModeCache.monthly[cacheKey] = cacheObject;
    } else if (mode === 'yearly') {
      filterModeCache.yearly[cacheKey] = cacheObject;
    } else if (mode === 'custom') {
      filterModeCache.custom[cacheKey] = cacheObject;
    }
    
    // Lưu vào cache chung để click legend hoạt động
    cachedChartData = cacheObject;
    
    // Xóa cache category cũ
    categoryDetailsCache = {};
    
    // Render UI
    renderMonthlyDataUI(monthlyData, expenseCategoryData, startMonth, endMonth);
    
  } catch (error) {
    showToast("Lỗi khi lấy dữ liệu: " + error.message, "error");
  } finally {
    showLoading(false, 'tab2');
  }
};

/**
 * ⚡ Hàm helper: Render UI cho dữ liệu monthly
 */
function renderMonthlyDataUI(monthlyData, expenseCategoryData, startMonth, endMonth) {
  // Ẩn placeholder và hiển thị tiêu đề
  const placeholderTab2 = document.getElementById('placeholderTab2');
  const chartTitleTab2 = document.getElementById('chartTitleTab2');
  const pieChartTitleTab2 = document.getElementById('pieChartTitleTab2');
  const chartContainer = document.querySelector('#tab2 .chart-container');
  if (placeholderTab2) placeholderTab2.style.display = 'none';
  if (chartTitleTab2) { chartTitleTab2.style.display = 'block'; chartTitleTab2.textContent = 'TỔNG QUAN TÀI CHÍNH'; }
  if (pieChartTitleTab2) pieChartTitleTab2.style.display = 'block';
  if (chartContainer) chartContainer.classList.add('show');

  // Tính tổng thu, tổng chi, số dư
  let totalIncome = 0;
  let totalExpense = 0;
  monthlyData.forEach(item => {
    totalIncome += item.income || 0;
    totalExpense += item.expense || 0;
  });
  const totalBalance = totalIncome - totalExpense;

  // Hiển thị tổng thu/chi/số dư
  const statsContainer = document.getElementById('monthlyStatsContainer');
  statsContainer.innerHTML = `
    <div class="stat-box income"><div class="title">Thu nhập</div><div class="amount">${totalIncome.toLocaleString('vi-VN')}đ</div></div>
    <div class="stat-box expense"><div class="title">Chi tiêu</div><div class="amount">${totalExpense.toLocaleString('vi-VN')}đ</div></div>
    <div class="stat-box balance"><div class="title">Số dư</div><div class="amount">${totalBalance.toLocaleString('vi-VN')}đ</div></div>
  `;

  // Vẽ bar chart
  const ctx = document.getElementById('monthlyChart').getContext('2d');
  const monthlyChartElement = document.getElementById('monthlyChart');
  if (window.monthlyChartInstance) window.monthlyChartInstance.destroy();
  
  // Tạo mảng tháng từ startMonth đến endMonth
  const monthRange = [];
  for (let m = startMonth; m <= endMonth; m++) {
    monthRange.push(m);
  }
  
  const labels = monthRange.map(month => `Tháng ${month}`);
  
  // Tạo map từ data hiện có
  const dataMap = {};
  monthlyData.forEach(item => {
    dataMap[item.month] = item;
  });
  
  // Fill data cho các tháng trong range (0 nếu không có data)
  const incomeData = monthRange.map(month => dataMap[month]?.income || 0);
  const expenseData = monthRange.map(month => dataMap[month]?.expense || 0);
  
  window.monthlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Thu nhập',
        data: incomeData,
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
        borderColor: 'rgba(16, 185, 129, 1)',
        borderWidth: 1
      }, {
        label: 'Chi tiêu',
        data: expenseData,
        backgroundColor: 'rgba(244, 63, 94, 0.8)',
        borderColor: 'rgba(244, 63, 94, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 65
        }
      },
      // ⚡ TỐI ƯU: Sử dụng cấu hình cột cố định để đồng nhất với biểu đồ Category Detail
      // Thay vì tính toán động dựa trên số tháng, sử dụng giá trị cố định
      barPercentage: FIXED_BAR_CONFIG.barPercentage,
      categoryPercentage: FIXED_BAR_CONFIG.categoryPercentage,
      maxBarThickness: FIXED_BAR_CONFIG.maxBarThickness,
      scales: {
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 45,
            minRotation: 0,
            font: {
              family: 'Nunito, sans-serif',
              size: 11
            }
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.1)'
          }
        },
        y: { 
          beginAtZero: true, 
          ticks: { 
            callback: value => value.toLocaleString('vi-VN') + 'đ',
            font: {
              family: 'Nunito, sans-serif'
            }
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.1)'
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { 
          callbacks: { 
            label: context => `${context.dataset.label}: ${context.raw.toLocaleString('vi-VN')}đ` 
          },
          titleFont: {
            family: 'Nunito, sans-serif'
          },
          bodyFont: {
            family: 'Nunito, sans-serif'
          }
        },
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#94A3B8',
          font: {
            weight: 'bold',
            size: 9
          },
          rotation: -90,
          formatter: (value) => {
            if (value === 0) return '';
            return value.toLocaleString('vi-VN') + 'đ';
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
  
  // Hiển thị canvas sau khi vẽ xong
  monthlyChartElement.classList.add('show');

  // Vẽ pie chart
  drawMonthlyPieChart(expenseCategoryData);

  // Thông báo số giao dịch
  const totalCount = monthlyData.reduce((sum, item) => sum + (item.count || 0), 0);
  const periodText = startMonth === endMonth
    ? `tháng ${startMonth}`
    : `tháng ${startMonth} – ${endMonth}`;

}
/**
 * Lấy dữ liệu chi tiêu theo phân loại cho khoảng tháng từ API.
 * @param {number} startMonth - Tháng bắt đầu.
 * @param {number} endMonth - Tháng kết thúc.
 * @returns {Promise<Array>} Dữ liệu expense by category.
 */
async function fetchExpensesByCategoryForMonths(startMonth, endMonth) {
  const targetUrl = `${apiUrl}?action=getExpensesByCategoryForMonths&startMonth=${startMonth}&endMonth=${endMonth}&sheetId=${sheetId}`;
  const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
  const response = await fetch(finalUrl);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * Vẽ pie chart % chi tiêu theo phân loại (giống tab2).
 * @param {Array} data - Dữ liệu expense by category.
 */
function drawMonthlyPieChart(data) {
  const ctxPie = document.getElementById('monthlyPieChart').getContext('2d');
  if (window.monthlyPieChartInstance) window.monthlyPieChartInstance.destroy();

  const labels = data.map(item => item.category);
  const amounts = data.map(item => item.amount);
  const totalExpense = amounts.reduce((sum, amount) => sum + amount, 0);
  const backgroundColors = data.map((_, index) => getColorByIndex(index));

  // Định dạng tổng chi tiêu
  let centerText = totalExpense.toLocaleString('vi-VN') + 'đ';

  window.monthlyPieChartInstance = new Chart(ctxPie, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: amounts,
        backgroundColor: backgroundColors,
        borderColor: '#FFFFFF',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'nearest',
          intersect: true,
          position: 'nearest',
          caretPadding: 20,
          padding: 12,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          titleFont: { size: 13 },
          bodyFont: { size: 12 },
          callbacks: {
            label: function(tooltipItem) {
              const category = tooltipItem.label;
              const amount = tooltipItem.raw;
              const percentage = ((amount / totalExpense) * 100).toFixed(1);
              return `${category}: ${amount.toLocaleString('vi-VN')}đ (${percentage}%)`;
            }
          }
        },
        datalabels: {
          formatter: (value, context) => {
            const percentage = ((value / totalExpense) * 100).toFixed(1);
            return percentage >= 1 ? `${percentage}%` : '';
          },
          color: '#fff',
          font: { weight: 'bold', size: 10 },
          anchor: 'end',
          align: 'end',
          clamp: true
        }
      }
    },
    plugins: [{
      id: 'centerTotalText',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        const expenseColor = getComputedStyle(document.documentElement).getPropertyValue('--expense-color').trim() || '#F43F5E';
        // ⚡ FIX: Lấy text-primary thay vì text-color để hiển thị tốt trong dark mode
        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1E293B';
        const centerX = chart.width / 2;
        const centerY = chart.height / 2;
        ctx.font = '600 14px Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = textColor;
        ctx.fillText('Tổng chi tiêu', centerX, centerY - 15);
        ctx.font = '800 18px Nunito, sans-serif';
        ctx.fillStyle = expenseColor;
        ctx.fillText(centerText, centerX, centerY + 12);
        ctx.restore();
      }
    }]
  });

  // Tạo custom legend với icon
  const customLegend = document.getElementById('monthlyCustomLegend');
  customLegend.innerHTML = '';
  
  // Map icon cho từng danh mục (18 danh mục)
const categoryIcons = {
  'Ăn uống':                          'fa-utensils',
  'Bảo hiểm & Tài chính cá nhân':     'fa-shield-halved',
  'Công nghệ & Thiết bị điện tử':     'fa-laptop',
  'Công việc & Kinh doanh':           'fa-briefcase',
  'Dịch vụ giặt ủi':                  'fa-shirt',
  'Dịch vụ sửa chữa & Bảo trì':       'fa-screwdriver-wrench',
  'Đi lại':                           'fa-car',
  'Giải trí':                         'fa-film',
  'Giáo dục':                         'fa-graduation-cap',
  'Gia đình':                         'fa-house-user',
  'Hóa đơn & Tiện ích':               'fa-file-invoice',
  'Làm đẹp & Chăm sóc cá nhân':       'fa-spa',
  'Mua sắm':                          'fa-shopping-bag',
  'Quà tặng & Sự kiện':               'fa-gift',
  'Sức khỏe & Thể thao':              'fa-heart-pulse',
  'Tiết kiệm & Đầu tư':               'fa-piggy-bank',
  'Y tế':                             'fa-stethoscope',
  'Khác':                             'fa-circle-question'
};
  
  data.forEach((item, index) => {
    const percentage = ((item.amount / totalExpense) * 100).toFixed(1);
    const iconClass = categoryIcons[item.category] || 'fa-circle';
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.style.cursor = 'pointer';
    legendItem.innerHTML = `
      <div class="legend-color" style="background-color: ${backgroundColors[index]};">
        <i class="fas ${iconClass}" style="color: white;"></i>
      </div>
      <div class="legend-info">
        <div class="legend-text">${item.category}</div>
        <div class="legend-value">
          <span class="legend-amount" style="color: ${backgroundColors[index]};">${item.amount.toLocaleString('vi-VN')}đ</span>
          <span class="legend-percentage">${percentage}%</span>
        </div>
      </div>
      <div style="margin-left: auto; color: var(--text-secondary);">
        <i class="fas fa-chevron-right"></i>
      </div>
    `;
    
    // Thêm event listener để click vào legend
    legendItem.addEventListener('click', () => {
      showCategoryDetail(item.category, item.amount, backgroundColors[index]);
    });
    
    customLegend.appendChild(legendItem);
  });
  
  // Hiển thị canvas pie chart sau khi vẽ xong
  const monthlyPieChartElement = document.getElementById('monthlyPieChart');
  monthlyPieChartElement.classList.add('show');
}

// Hàm hỗ trợ lấy màu theo index (cho pie chart)
function getColorByIndex(index) {
  const colors = [
    '#FF6B6B', '#FF8E53', '#FFC107', '#4CAF50', '#40C4FF', '#3F51B5', '#AB47BC', '#EC407A',
    '#EF5350', '#FF7043', '#FDD835', '#66BB6A', '#29B6F6', '#5C6BC0', '#D81B60', '#F06292',
    '#26A69A', '#FFA726', '#E91E63', '#7CB342', '#0288D1', '#8E24AA', '#FFCA28', '#FF5252',
    '#FFB300', '#689F38', '#039BE5', '#9575CD', '#F48FB1', '#FFAB91', '#4DD0E1', '#D4E157',
    '#EF9A9A', '#80DEEA', '#CE93D8'
  ];
  return colors[index % colors.length];
}
/* ==========================================================================
   8. Tab 3: Chi tiêu trong tháng (Monthly Expenses Tab)
   Các hàm lấy và hiển thị giao dịch trong tháng.
   ========================================================================== */
/**
 * Lấy danh sách giao dịch trong tháng từ API.
 */
window.fetchMonthlyExpenses = async function() {
  const month = document.getElementById('monthSelect').value;
  if (!month) return showToast("Vui lòng chọn tháng để xem giao dịch!", "warning");
  const year = new Date().getFullYear();
  const cacheKey = `${year}-${month}`;

  if (cachedMonthlyExpenses && cachedMonthlyExpenses.cacheKey === cacheKey) {
    displayMonthlyExpenses(cachedMonthlyExpenses.data);
    return;
  }

  showLoading(true, 'tab2');
  try {
    const targetUrl = `${apiUrl}?action=getTransactionsByMonth&month=${month}&year=${year}&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    const transactionData = await response.json();
    if (transactionData.error) throw new Error(transactionData.error);
    cachedMonthlyExpenses = { cacheKey, data: transactionData };
    displayMonthlyExpenses(transactionData);
  } catch (error) {
    showToast("Lỗi khi lấy dữ liệu giao dịch: " + error.message, "error");
    displayMonthlyExpenses({ error: true });
  } finally {
    showLoading(false, 'tab2');
  }
};

/**
 * Hiển thị danh sách giao dịch trong tháng và thống kê tổng quan.
 * @param {Object|Array} data - Dữ liệu giao dịch trong tháng.
 */
function displayMonthlyExpenses(data) {
  const container = document.getElementById('monthlyExpensesContainer');
  const summaryContainer = document.getElementById('monthlyExpenseSummary');
  const pageInfo = document.getElementById('pageInfoMonthly');
  const prevPageBtn = document.getElementById('prevPageMonthly');
  const nextPageBtn = document.getElementById('nextPageMonthly');
  const paginationDiv = document.getElementById('paginationMonthly');
  const placeholderTab3 = document.getElementById('placeholderTab3');
  container.innerHTML = '';

  if (!data || data.error || !Array.isArray(data) || data.length === 0) {
    container.innerHTML = '<div>Không có giao dịch trong tháng này</div>';
    summaryContainer.innerHTML = `
      <div class="stat-box income"><div class="title">Thu nhập</div><div class="amount no-data">Không có<br>dữ liệu</div></div>
      <div class="stat-box expense"><div class="title">Chi tiêu</div><div class="amount no-data">Không có<br>dữ liệu</div></div>
      <div class="stat-box balance"><div class="title">Số dư</div><div class="amount no-data">Không có<br>dữ liệu</div></div>
    `;
    pageInfo.textContent = '';
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    paginationDiv.style.display = 'none';
    placeholderTab3.style.display = 'block';
    return;
  }

  // Ẩn placeholder và hiển thị pagination
  placeholderTab3.style.display = 'none';
  paginationDiv.style.display = 'block';

  let totalIncome = 0, totalExpense = 0;
  data.forEach(item => {
    if (item.type === 'Thu nhập') totalIncome += item.amount;
    else if (item.type === 'Chi tiêu') totalExpense += item.amount;
  });
  const balance = totalIncome - totalExpense;

  summaryContainer.innerHTML = `
    <div class="stat-box income"><div class="title">Thu nhập</div><div class="amount">${totalIncome.toLocaleString('vi-VN')}đ</div></div>
    <div class="stat-box expense"><div class="title">Chi tiêu</div><div class="amount">${totalExpense.toLocaleString('vi-VN')}đ</div></div>
    <div class="stat-box balance"><div class="title">Số dư</div><div class="amount">${balance.toLocaleString('vi-VN')}đ</div></div>
  `;

  const totalTransactions = data.length;
  container.innerHTML = `<div class="notification">Bạn có ${totalTransactions} giao dịch trong tháng</div>`;

  const totalPages = Math.ceil(data.length / expensesPerPage);
  const startIndex = (currentPageMonthly - 1) * expensesPerPage;
  const endIndex = startIndex + expensesPerPage;
  const paginatedData = data.slice(startIndex, endIndex);

  paginatedData.forEach((item, index) => {
  const transactionBox = document.createElement('div');
  transactionBox.className = 'transaction-box';
  const amountColor = item.type === 'Thu nhập' ? 'var(--income-color)' : 'var(--expense-color)';
  const typeClass = item.type === 'Thu nhập' ? 'income' : 'expense';
  const transactionNumber = startIndex + index + 1;
  transactionBox.innerHTML = `
  <div class="layer-container" style="position: relative;">
    <div class="layer-top" style="position: absolute; top: 0; right: 0;">
      <div class="number">Giao dịch thứ: ${transactionNumber}</div>
      <div class="id">Mã giao dịch: ${item.id}</div>
    </div>
    <div class="layer-bottom" style="width: 100%;">
      <div class="date">${formatDate(item.date)}</div>
      <div class="amount" style="color: ${amountColor};">${item.amount.toLocaleString('vi-VN')}đ</div>
      <div class="content">Nội dung: ${item.content}${item.note ? ` (${item.note})` : ''}</div>
      <div class="type ${typeClass}">Phân loại: ${item.type}</div>
      <div class="category">Phân loại chi tiết: ${item.category}</div>
    </div>
  </div>
  <div style="margin-top: 0.5rem;">
    <button class="edit-btn edit" data-id="${item.id}"><i class="fas fa-edit"></i> Sửa</button>
    <button class="delete-btn delete" data-id="${item.id}"><i class="fas fa-trash"></i> Xóa</button>
  </div>
`;
  container.appendChild(transactionBox);
});

  pageInfo.textContent = `Trang ${currentPageMonthly} / ${totalPages}`;
  prevPageBtn.disabled = currentPageMonthly === 1;
  nextPageBtn.disabled = currentPageMonthly === totalPages;

  document.querySelectorAll('.edit-btn').forEach(button => {
    const transactionId = button.getAttribute('data-id');
    const transaction = data.find(item => String(item.id) === String(transactionId));
    if (!transaction) return console.error(`Không tìm thấy giao dịch với ID: ${transactionId}`);
    button.addEventListener('click', () => openEditForm(transaction));
  });

  document.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteTransaction(button.getAttribute('data-id')));
  });
}

/* ==========================================================================
   9. Tab 3: Tìm kiếm giao dịch (Search Transactions Tab)
   Các hàm tìm kiếm và hiển thị kết quả giao dịch.
   ========================================================================== */
/**
 * Điền danh sách phân loại chi tiết vào dropdown tìm kiếm.
 */
async function populateSearchCategories() {
  const categorySelect = document.getElementById('searchCategory');
  const categories = await fetchCategories();
  categorySelect.innerHTML = '<option value="">Tất cả</option>';
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });
}

/**
 * Tìm kiếm giao dịch dựa trên các tiêu chí (tháng, nội dung, số tiền, phân loại).
 */
window.searchTransactions = async function() {
  const content = document.getElementById('searchContent').value.trim();
  let amount = document.getElementById('searchAmount').value;
  amount = amount ? parseNumber(amount).toString() : '';
  const category = document.getElementById('searchCategory').value;
  const year = new Date().getFullYear();

  if (!content && !amount && !category) {
    return showToast("Vui lòng nhập ít nhất một tiêu chí: nội dung, số tiền, hoặc phân loại chi tiết!", "warning");
  }

  // Xác định chế độ tìm kiếm dựa vào nút active
  let searchMode = 'yearly'; // mặc định
  let startMonth = 1;
  let endMonth = new Date().getMonth() + 1;
  
  if (document.getElementById('searchYearlyBtn').classList.contains('active')) {
    searchMode = 'yearly';
    startMonth = 1;
    endMonth = 12; // Tìm cả năm
  } else if (document.getElementById('searchMonthlyBtn').classList.contains('active')) {
    searchMode = 'monthly';
    const singleMonth = parseInt(document.getElementById('searchSingleMonth').value);
    startMonth = singleMonth;
    endMonth = singleMonth;
  } else if (document.getElementById('searchCustomBtn').classList.contains('active')) {
    searchMode = 'custom';
    startMonth = parseInt(document.getElementById('searchStartMonth').value);
    endMonth = parseInt(document.getElementById('searchEndMonth').value);
    
    if (startMonth > endMonth) {
      return showToast("Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc!", "warning");
    }
  }

  // Tạo cacheKey dựa trên chế độ và tiêu chí tìm kiếm
  let cacheKey;
  if (searchMode === 'yearly') {
    cacheKey = `${content || ''}-${amount || ''}-${category || ''}`;
  } else if (searchMode === 'monthly') {
    cacheKey = `${startMonth}-${content || ''}-${amount || ''}-${category || ''}`;
  } else {
    cacheKey = `${startMonth}-${endMonth}-${content || ''}-${amount || ''}-${category || ''}`;
  }

  // Kiểm tra cache theo chế độ
  const cachedData = searchModeCache[searchMode][cacheKey];
  if (cachedData) {
    console.log(`📦 Sử dụng cache cho chế độ ${searchMode}, key: ${cacheKey}`);
    displaySearchResults(cachedData.transactions);
    cachedSearchResults = cachedData; // Cập nhật cachedSearchResults cho pagination
    currentPageSearch = cachedData.currentPage || 1;
    return;
  }

  console.log(`🌐 Gọi API cho chế độ ${searchMode}, key: ${cacheKey}`);
  showLoading(true, 'tab3');
  try {
    let targetUrl = `${apiUrl}?action=searchTransactions&sheetId=${sheetId}&page=${currentPageSearch}&limit=${searchPerPage}&year=${year}`;
    
    // Thêm tham số tháng
    if (searchMode === 'monthly') {
      targetUrl += `&month=${startMonth}`;
    } else if (searchMode === 'custom' || searchMode === 'yearly') {
      targetUrl += `&startMonth=${startMonth}&endMonth=${endMonth}`;
    }
    
    if (content) targetUrl += `&content=${encodeURIComponent(content)}`;
    if (amount) targetUrl += `&amount=${encodeURIComponent(amount)}`;
    if (category) targetUrl += `&category=${encodeURIComponent(category)}`;

    console.log("API URL:", targetUrl);
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    const searchData = await response.json();
    console.log("API Response:", searchData);
    if (searchData.error) throw new Error(searchData.error);

    // Tạo object cache
    const cacheObject = {
      transactions: searchData.transactions || [],
      totalTransactions: searchData.totalTransactions || 0,
      totalPages: searchData.totalPages || 1,
      currentPage: searchData.currentPage || 1,
      cacheKey: cacheKey
    };
    
    // Lưu vào cache theo chế độ
    searchModeCache[searchMode][cacheKey] = cacheObject;
    console.log(`💾 Đã lưu cache cho chế độ ${searchMode}, key: ${cacheKey}`);
    
    // Cập nhật cachedSearchResults cho pagination
    cachedSearchResults = cacheObject;
    currentPageSearch = searchData.currentPage || 1;

    displaySearchResults(searchData.transactions);
  } catch (error) {
    showToast("Lỗi khi tìm kiếm giao dịch: " + error.message, "error");
    displaySearchResults({ error: true });
  } finally {
    showLoading(false, 'tab3');
  }
};

/**
 * Hiển thị kết quả tìm kiếm giao dịch.
 * @param {Array} data - Danh sách giao dịch tìm được.
 */
function displaySearchResults(data) {
  const container = document.getElementById('searchResultsContainer');
  const pageInfo = document.getElementById('pageInfoSearch');
  const prevPageBtn = document.getElementById('prevPageSearch');
  const nextPageBtn = document.getElementById('nextPageSearch');
  const paginationDiv = document.getElementById('paginationSearch');
  const placeholderTab4 = document.getElementById('placeholderTab4');
  container.innerHTML = '';

  if (!data || data.error || !Array.isArray(data) || data.length === 0) {
    container.innerHTML = '<div>Không tìm thấy giao dịch nào phù hợp</div>';
    pageInfo.textContent = '';
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    paginationDiv.style.display = 'none';
    placeholderTab4.style.display = 'block';
    return;
  }

  // Ẩn placeholder và hiển thị pagination
  placeholderTab4.style.display = 'none';
  paginationDiv.style.display = 'block';

  const totalTransactions = cachedSearchResults?.totalTransactions || data.length;
  container.innerHTML = `<div class="notification">Tìm thấy ${totalTransactions} giao dịch phù hợp</div>`;

  const totalPages = cachedSearchResults?.totalPages || Math.ceil(totalTransactions / searchPerPage);
  const startIndex = (currentPageSearch - 1) * searchPerPage;
  const endIndex = startIndex + searchPerPage;
  const paginatedData = data.slice(startIndex, endIndex);

  paginatedData.forEach((item, index) => {
    const transactionBox = document.createElement('div');
    transactionBox.className = 'transaction-box';
    const amountColor = item.type === 'Thu nhập' ? 'var(--income-color)' : 'var(--expense-color)';
    const typeClass = item.type === 'Thu nhập' ? 'income' : 'expense';
    const transactionNumber = startIndex + index + 1;
    transactionBox.innerHTML = `
  <div class="layer-container" style="position: relative;">
    <div class="layer-top" style="position: absolute; top: 0; right: 0;">
      <div class="number">Giao dịch thứ: ${transactionNumber}</div>
      <div class="id">Mã giao dịch: ${item.id}</div>
    </div>
    <div class="layer-bottom" style="width: 100%;">
      <div class="date">${formatDate(item.date)}</div>
      <div class="amount" style="color: ${amountColor};">${item.amount.toLocaleString('vi-VN')}đ</div>
      <div class="content">Nội dung: ${item.content}${item.note ? ` (${item.note})` : ''}</div>
      <div class="type ${typeClass}">Phân loại: ${item.type}</div>
      <div class="category">Phân loại chi tiết: ${item.category}</div>
    </div>
  </div>
  <div style="margin-top: 0.5rem;">
    <button class="edit-btn edit" data-id="${item.id}"><i class="fas fa-edit"></i> Sửa</button>
    <button class="delete-btn delete" data-id="${item.id}"><i class="fas fa-trash"></i> Xóa</button>
  </div>
`;
    container.appendChild(transactionBox);
  });

  pageInfo.textContent = `Trang ${currentPageSearch} / ${totalPages}`;
  prevPageBtn.disabled = currentPageSearch === 1;
  nextPageBtn.disabled = currentPageSearch >= totalPages;

  document.querySelectorAll('.edit-btn').forEach(button => {
    const transactionId = button.getAttribute('data-id');
    const transaction = data.find(item => String(item.id) === String(transactionId));
    if (!transaction) return console.error(`Không tìm thấy giao dịch với ID: ${transactionId}`);
    button.addEventListener('click', () => openEditForm(transaction));
  });

  document.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteTransaction(button.getAttribute('data-id')));
  });
}

/* ==========================================================================
   10. Tab 4: Quản lý từ khóa (Keywords Tab)
   Các hàm lấy, hiển thị, thêm và xóa từ khóa.
   ========================================================================== */
/**
 * Lấy danh sách từ khóa từ API.
 */
window.fetchKeywords = async function() {
  showLoading(true, 'tab4');
  try {
    const targetUrl = `${apiUrl}?action=getKeywords&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    const keywordsData = await response.json();
    if (keywordsData.error) throw new Error(keywordsData.error);
    cachedKeywords = keywordsData;
    displayKeywords(keywordsData);
  } catch (error) {
    showToast("Lỗi khi lấy dữ liệu từ khóa: " + error.message, "error");
    displayKeywords({ error: true });
  } finally {
    showLoading(false, 'tab4');
  }
};

/**
 * Hiển thị danh sách từ khóa.
 * @param {Array} data - Dữ liệu từ khóa từ API.
 */
function displayKeywords(data) {
  const container = document.getElementById('keywordsContainer');
  const placeholder = document.getElementById('placeholderTab5');
  container.innerHTML = '';

  if (!data || data.error || !Array.isArray(data) || data.length === 0) {
    container.innerHTML = '<div class="notification">Không có từ khóa nào</div>';
    if (placeholder) placeholder.style.display = 'block';
    return;
  }

  // Ẩn placeholder khi có dữ liệu
  if (placeholder) placeholder.style.display = 'none';

  data.forEach(item => {
    const keywordBox = document.createElement('div');
    keywordBox.className = 'keyword-box';
    const keywordCount = item.keywords ? item.keywords.split(',').length : 0;
    keywordBox.innerHTML = `
      <div class="category">${item.category} (${keywordCount} từ khóa)</div>
      <div class="keywords"><span style="font-weight: bold;">Từ khóa:</span> ${item.keywords}</div>
    `;
    container.appendChild(keywordBox);
  });
}

/**
 * Điền danh sách phân loại chi tiết vào dropdown từ khóa.
 */
async function populateKeywordCategories() {
  const categorySelect = document.getElementById('keywordCategory');
  const categories = await fetchCategories();
  categorySelect.innerHTML = '<option value="">Chọn phân loại</option>';
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });
}

/**
 * Thêm từ khóa mới vào Google Sheet.
 */
window.addKeyword = async function() {
  const category = document.getElementById('keywordCategory').value;
  const keywordsInput = document.getElementById('keywordInput').value.trim();

  if (!category) {
    return showToast("Vui lòng chọn phân loại chi tiết!", "warning");
  }
  if (!keywordsInput) {
    return showToast("Vui lòng nhập từ khóa!", "warning");
  }

  const keywordsArray = keywordsInput.split(',').map(keyword => keyword.trim()).filter(keyword => keyword);
  const formattedKeywords = keywordsArray.join(', ');

  showLoading(true, 'tab4');
  try {
    const finalUrl = proxyUrl + encodeURIComponent(apiUrl);
    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addKeyword',
        category: category,
        keywords: formattedKeywords,
        sheetId: sheetId
      })
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    showToast("Thêm từ khóa thành công!", "success");
    document.getElementById('keywordInput').value = '';
    window.fetchKeywords();
  } catch (error) {
    showToast("Lỗi khi thêm từ khóa: " + error.message, "error");
  } finally {
    showLoading(false, 'tab4');
  }
};

/**
 * Xóa từ khóa khỏi Google Sheet.
 */
window.deleteKeyword = async function() {
  if (!apiUrl || !proxyUrl || !sheetId) {
    console.error("Lỗi: apiUrl, proxyUrl hoặc sheetId không được định nghĩa!");
    showToast("Lỗi hệ thống: Thiếu thông tin cấu hình!", "error");
    return;
  }

  const category = document.getElementById('keywordCategory')?.value;
  const keywordInput = document.getElementById('keywordInput')?.value?.trim();

  if (!category) {
    showToast("Vui lòng chọn phân loại chi tiết!", "warning");
    return;
  }
  if (!keywordInput) {
    showToast("Vui lòng nhập từ khóa cần xóa!", "warning");
    return;
  }

  try {
    showLoading(true, 'tab4');
    const targetUrl = `${apiUrl}?action=getKeywords&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    const response = await fetch(finalUrl);
    if (!response.ok) {
      throw new Error(`Lỗi khi lấy danh sách từ khóa: HTTP status ${response.status}`);
    }

    const keywordsData = await response.json();
    if (keywordsData.error) {
      throw new Error(keywordsData.error);
    }

    const categoryData = keywordsData.find(item => item.category === category);
    if (!categoryData) {
      showToast(`Danh mục '${category}' không tồn tại.`, "warning");
      return;
    }

    const keywordsArray = categoryData.keywords.split(", ").map(k => k.trim().toLowerCase());
    const keywordToDelete = keywordInput.trim().toLowerCase();

    if (!keywordsArray.includes(keywordToDelete)) {
      showToast(`Từ khóa '${keywordInput}' không tồn tại trong danh mục '${category}'.`, "warning");
      return;
    }

    const deleteUrl = proxyUrl + encodeURIComponent(apiUrl);
    const responseDelete = await fetch(deleteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'deleteKeyword',
        category: category,
        keyword: keywordInput,
        sheetId: sheetId
      })
    });

    if (!responseDelete.ok) {
      throw new Error(`Lỗi khi xóa từ khóa: HTTP status ${responseDelete.status}`);
    }

    const result = await responseDelete.json();
    if (result.error) {
      throw new Error(result.error);
    }

    showToast("Xóa từ khóa thành công!", "success");
    document.getElementById('keywordInput').value = '';
    window.fetchKeywords();
  } catch (error) {
    console.error("Lỗi trong deleteKeyword:", error);
    showToast("Lỗi khi xóa từ khóa: " + error.message, "error");
  } finally {
    showLoading(false, 'tab4');
  }
};

/* ==========================================================================
   11. Khởi tạo ứng dụng (Application Initialization)
   Thiết lập sự kiện và giá trị mặc định khi tải trang.
   ========================================================================== */
document.addEventListener('DOMContentLoaded', function() {
  // Gán sự kiện cho các tab điều hướng
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      window.openTab(item.getAttribute('data-tab'));
    });
  });

  // Gán sự kiện cho các nút chức năng
  document.getElementById('fetchTransactionsBtn').addEventListener('click', window.fetchTransactions);
  document.getElementById('addTransactionBtn').addEventListener('click', openAddForm);
  document.getElementById('searchTransactionsBtn').addEventListener('click', window.searchTransactions);
  document.getElementById('fetchKeywordsBtn').addEventListener('click', window.fetchKeywords);
  document.getElementById('addKeywordBtn').addEventListener('click', window.addKeyword);
  document.getElementById('deleteKeywordBtn').addEventListener('click', window.deleteKeyword);
  
  // Gán sự kiện cho các nút filter mode trong Tab 2
  const filterMonthlyBtn = document.getElementById('filterMonthlyBtn');
  const filterWeeklyBtn = document.getElementById('filterWeeklyBtn');
  const filterYearlyBtn = document.getElementById('filterYearlyBtn');
  const filterCustomBtn = document.getElementById('filterCustomBtn');
  const singleMonthSelector = document.getElementById('singleMonthSelector');
  const weeklySelector = document.getElementById('weeklySelector');
  const monthRangeSelector = document.getElementById('monthRangeSelector');
  
  // Gán sự kiện cho các nút filter mode trong Tab 4 (Search)
  const searchYearlyBtn = document.getElementById('searchYearlyBtn');
  const searchMonthlyBtn = document.getElementById('searchMonthlyBtn');
  const searchCustomBtn = document.getElementById('searchCustomBtn');
  const searchMonthSelector = document.getElementById('searchMonthSelector');
  const searchRangeSelector = document.getElementById('searchRangeSelector');
  
  // Hàm helper để set active button cho Tab 2
  function setActiveFilterButton(activeBtn) {
    [filterMonthlyBtn, filterWeeklyBtn, filterYearlyBtn, filterCustomBtn].forEach(btn => {
      btn.classList.remove('active');
    });
    activeBtn.classList.add('active');
  }
  
  // Hàm helper để set active button cho Tab 4
  function setActiveSearchButton(activeBtn) {
    [searchYearlyBtn, searchMonthlyBtn, searchCustomBtn].forEach(btn => {
      btn.classList.remove('active');
    });
    activeBtn.classList.add('active');
  }
  
  // Xử lý nút "Theo tuần"
  filterWeeklyBtn.addEventListener('click', function() {
    setActiveFilterButton(this);
    weeklySelector.style.display = 'flex';
    singleMonthSelector.style.display = 'none';
    document.getElementById('yearlyFilterBtn').style.display = 'none';
    monthRangeSelector.style.display = 'none';
  });

  // Xử lý nút "Theo tháng" - hiển thị dropdown chọn tháng đơn
  filterMonthlyBtn.addEventListener('click', function() {
    setActiveFilterButton(this);
    weeklySelector.style.display = 'none';
    singleMonthSelector.style.display = 'flex';
    document.getElementById('yearlyFilterBtn').style.display = 'none';
    monthRangeSelector.style.display = 'none';
    
    // Set giá trị mặc định là tháng hiện tại
    const currentMonth = new Date().getMonth() + 1;
    document.getElementById('singleMonth').value = currentMonth;
    
    // Không tự động lọc, chờ người dùng chọn và nhấn nút "Lọc"
  });
  
  // Xử lý nút "Cả năm" - lọc từ tháng 1 đến tháng hiện tại
  filterYearlyBtn.addEventListener('click', function() {
    setActiveFilterButton(this);
    weeklySelector.style.display = 'none';
    singleMonthSelector.style.display = 'none';
    document.getElementById('yearlyFilterBtn').style.display = 'flex';
    monthRangeSelector.style.display = 'none';
    
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    
    // Set startMonth = 1, endMonth = tháng hiện tại
    document.getElementById('startMonth').value = 1;
    document.getElementById('endMonth').value = currentMonth;
    
    // Không tự động lọc, chờ người dùng nhấn nút "Lọc"
  });
  
  // Xử lý nút "Tùy chọn" - hiển thị dropdown để người dùng chọn
  filterCustomBtn.addEventListener('click', function() {
    setActiveFilterButton(this);
    weeklySelector.style.display = 'none';
    singleMonthSelector.style.display = 'none';
    document.getElementById('yearlyFilterBtn').style.display = 'none';
    monthRangeSelector.style.display = 'flex';
    
    // Set giá trị mặc định
    const currentMonth = new Date().getMonth() + 1;
    document.getElementById('startMonth').value = '1';
    document.getElementById('endMonth').value = currentMonth;
    
    // Không tự động lọc, chờ người dùng chọn và nhấn nút "Lọc"
  });
  
  // Cập nhật event cho nút "Lọc" trong chế độ tùy chọn để sử dụng cache
  document.getElementById('fetchMonthlyDataBtn').addEventListener('click', function() {
    const startMonth = parseInt(document.getElementById('startMonth').value);
    const endMonth = parseInt(document.getElementById('endMonth').value);
    
    if (startMonth > endMonth) {
      showToast("Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc!", "warning");
      return;
    }
    
    resetCategoryDetailView();
    // Sử dụng cache cho chế độ custom
    window.fetchMonthlyDataWithCache('custom', startMonth, endMonth);
  });
  
  // Event cho nút "Lọc" trong chế độ "Theo tháng"
  document.getElementById('fetchSingleMonthBtn').addEventListener('click', function() {
    const selectedMonth = parseInt(document.getElementById('singleMonth').value);
    
    resetCategoryDetailView();
    // Lọc dữ liệu của tháng được chọn
    window.fetchMonthlyDataWithCache('monthly', selectedMonth, selectedMonth);
  });
  
  // Event cho nút "Lọc" trong chế độ "Cả năm"
  document.getElementById('fetchYearlyDataBtn').addEventListener('click', function() {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    
    resetCategoryDetailView();
    // Lọc dữ liệu từ tháng 1 đến tháng hiện tại
    window.fetchMonthlyDataWithCache('yearly', 1, currentMonth);
  });

  // Event cho nút "Lọc" theo tuần
  document.getElementById('fetchWeeklyDataBtn').addEventListener('click', function() {
    const weekValue = document.getElementById('weekPicker').value;
    if (!weekValue) return showToast("Vui lòng chọn tuần cần xem!", "warning");
    resetCategoryDetailView();
    window.fetchWeeklyData(weekValue);
  });

  // Nút "Tuần này"
  document.getElementById('quickThisWeekBtn').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('quickLastWeekBtn').classList.remove('active');
    document.getElementById('weekPicker').value = formatWeekInput(new Date());
  });

  // Nút "Tuần trước"
  document.getElementById('quickLastWeekBtn').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('quickThisWeekBtn').classList.remove('active');
    const lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7);
    document.getElementById('weekPicker').value = formatWeekInput(lastWeek);
  });

  // Khi chọn tuần thủ công thì bỏ active 2 nút quick
  document.getElementById('weekPicker').addEventListener('change', function() {
    document.getElementById('quickThisWeekBtn').classList.remove('active');
    document.getElementById('quickLastWeekBtn').classList.remove('active');
  });
  
  // Xử lý nút "Cả năm" trong Tab 4 (Search)
  searchYearlyBtn.addEventListener('click', function() {
    setActiveSearchButton(this);
    searchMonthSelector.style.display = 'none';
    searchRangeSelector.style.display = 'none';
  });
  
  // Xử lý nút "Theo tháng" trong Tab 4 (Search)
  searchMonthlyBtn.addEventListener('click', function() {
    setActiveSearchButton(this);
    searchMonthSelector.style.display = 'flex';
    searchRangeSelector.style.display = 'none';
    
    // Set giá trị mặc định là tháng hiện tại
    const currentMonth = new Date().getMonth() + 1;
    document.getElementById('searchSingleMonth').value = currentMonth;
  });
  
  // Xử lý nút "Khoảng thời gian" trong Tab 4 (Search)
  searchCustomBtn.addEventListener('click', function() {
    setActiveSearchButton(this);
    searchMonthSelector.style.display = 'none';
    searchRangeSelector.style.display = 'flex';
    
    // Set giá trị mặc định
    const currentMonth = new Date().getMonth() + 1;
    document.getElementById('searchStartMonth').value = '1';
    document.getElementById('searchEndMonth').value = currentMonth;
  });
  
   // Gán sự kiện cho các nút phân trang
  document.getElementById('prevPage').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      window.fetchTransactions();
    }
  });
  document.getElementById('nextPage').addEventListener('click', () => {
    const data = cachedTransactions?.data || [];
    const totalPages = Math.ceil(data.length / transactionsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      window.fetchTransactions();
    }
  });
  document.getElementById('prevPageSearch').addEventListener('click', () => {
  if (currentPageSearch > 1) {
    currentPageSearch--;
    if (cachedSearchResults && cachedSearchResults.transactions) {
      displaySearchResults(cachedSearchResults.transactions);
    } else {
      window.searchTransactions();
    }
  }
});

document.getElementById('nextPageSearch').addEventListener('click', () => {
  const totalPages = cachedSearchResults?.totalPages || 1;
  if (currentPageSearch < totalPages) {
    currentPageSearch++;
    if (cachedSearchResults && cachedSearchResults.transactions) {
      displaySearchResults(cachedSearchResults.transactions);
    } else {
      window.searchTransactions();
    }
  }
});

  // Thiết lập tháng mặc định cho biểu đồ và chi tiêu
  const currentMonth = new Date().getMonth() + 1;
  const startMonthInput = document.getElementById('startMonth');
  const endMonthInput = document.getElementById('endMonth');
  if (startMonthInput && endMonthInput) {
    startMonthInput.value = 1;
    endMonthInput.value = currentMonth;
  }

  const expenseMonthInput = document.getElementById('expenseMonth');
  if (expenseMonthInput) {
    expenseMonthInput.value = currentMonth;
  }

  // Thiết lập định dạng số cho ô tìm kiếm số tiền
  const searchAmountInput = document.getElementById('searchAmount');
  if (searchAmountInput) {
    searchAmountInput.addEventListener('input', function() {
      const cursorPosition = this.selectionStart;
      const oldLength = this.value.length;
      this.value = formatNumberWithCommas(this.value);
      const newLength = this.value.length;
      this.selectionStart = this.selectionEnd = cursorPosition + (newLength - oldLength);
    });

    searchAmountInput.addEventListener('keypress', function(e) {
      if (!/[0-9]/.test(e.key)) {
        e.preventDefault();
      }
    });
  }

  // Thiết lập ngày mặc định cho các ô nhập
  const today = new Date();
  const formattedToday = formatDateToYYYYMMDD(today);
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const formattedFirstDay = formatDateToYYYYMMDD(firstDayOfMonth);

  console.log('Setting transaction date to:', formattedToday);
  const transactionDateInput = document.getElementById('transactionDate');
  if (transactionDateInput) {
    transactionDateInput.value = formattedToday;
    console.log('Transaction date input value set:', transactionDateInput.value);
  } else {
    console.error('transactionDate input not found!');
  }

  // Khởi tạo dropdown phân loại
  populateSearchCategories();
  populateKeywordCategories();

  // Khởi tạo hiển thị "Theo tuần" mặc định cho Tab 2 (Báo Cáo)
  if (weeklySelector) {
    weeklySelector.style.display = 'flex';
    document.getElementById('weekPicker').value = formatWeekInput(new Date());
  }
  if (singleMonthSelector) singleMonthSelector.style.display = 'none';
  if (document.getElementById('yearlyFilterBtn')) document.getElementById('yearlyFilterBtn').style.display = 'none';
  if (monthRangeSelector) monthRangeSelector.style.display = 'none';
  if (document.getElementById('singleMonth')) document.getElementById('singleMonth').value = new Date().getMonth() + 1;

  // Khởi tạo hiển thị dropdown "Theo tháng" mặc định cho Tab 4 (Search)
  if (searchMonthSelector && searchRangeSelector) {
    searchMonthSelector.style.display = 'flex';
    searchRangeSelector.style.display = 'none';
    // Set giá trị mặc định là tháng hiện tại
    const currentMonth = new Date().getMonth() + 1;
    const searchSingleMonthInput = document.getElementById('searchSingleMonth');
    if (searchSingleMonthInput) {
      searchSingleMonthInput.value = currentMonth;
    }
  }

  // Mở tab mặc định
  window.openTab('tab1');
  
  // Tự động điều chỉnh font size cho stat-box amount khi có thay đổi DOM
  setupStatBoxObserver();
});

/**
 * Tự động điều chỉnh font size của .stat-box .amount dựa trên độ dài
 * Sử dụng logic nhất quán cho tất cả kích thước màn hình
 */
function adjustStatBoxFontSize() {
  const amountElements = document.querySelectorAll('.stat-box .amount:not(.no-data)');
  amountElements.forEach(el => {
    const text = el.textContent;
    const length = text.length;
    
    // Xóa style cũ
    el.style.fontSize = '';
    
    // Tính toán kích thước màn hình
    const screenWidth = window.innerWidth;
    
    // Điều chỉnh font size dựa trên độ dài text và kích thước màn hình
    if (screenWidth <= 480) {
      // Màn hình rất nhỏ
      if (length > 15) {
        el.style.fontSize = '0.65rem';
      } else if (length > 12) {
        el.style.fontSize = '0.7rem';
      } else if (length > 9) {
        el.style.fontSize = '0.75rem';
      } else {
        el.style.fontSize = '0.8rem';
      }
    } else if (screenWidth <= 768) {
      // Màn hình nhỏ
      if (length > 15) {
        el.style.fontSize = '0.7rem';
      } else if (length > 12) {
        el.style.fontSize = '0.75rem';
      } else if (length > 9) {
        el.style.fontSize = '0.8rem';
      } else {
        el.style.fontSize = '0.85rem';
      }
    } else if (screenWidth <= 1023) {
      // Màn hình trung bình
      if (length > 15) {
        el.style.fontSize = '0.75rem';
      } else if (length > 12) {
        el.style.fontSize = '0.8rem';
      } else if (length > 9) {
        el.style.fontSize = '0.85rem';
      } else {
        el.style.fontSize = '0.9rem';
      }
    } else {
      // Màn hình lớn
      if (length > 15) {
        el.style.fontSize = '0.8rem';
      } else if (length > 12) {
        el.style.fontSize = '0.85rem';
      } else if (length > 9) {
        el.style.fontSize = '0.9rem';
      } else {
        el.style.fontSize = '0.95rem';
      }
    }
  });
}

/**
 * Setup MutationObserver để theo dõi thay đổi DOM
 */
function setupStatBoxObserver() {
  // Gọi lần đầu
  adjustStatBoxFontSize();
  
  // Theo dõi thay đổi
  const observer = new MutationObserver(() => {
    adjustStatBoxFontSize();
  });
  
  // Observe các container có stat-box
  const containers = document.querySelectorAll('#dailySummary, #monthlyStatsContainer');
  containers.forEach(container => {
    if (container) {
      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  });
  
  // Điều chỉnh lại khi resize
  window.addEventListener('resize', adjustStatBoxFontSize);
}

/* ==========================================================================
   13. Khởi tạo ứng dụng (Application Initialization)
   Thiết lập các sự kiện và giá trị ban đầu khi trang được load.
   ========================================================================== */
document.addEventListener('DOMContentLoaded', function() {
  // Set ngày hiện tại cho date inputs
  const today = new Date().toISOString().split('T')[0];
  const transactionDateInput = document.getElementById('transactionDate');
  if (transactionDateInput) {
    transactionDateInput.value = today;
  }
  
  // Set tháng mặc định: Từ tháng 1 đến tháng hiện tại
  const currentMonth = new Date().getMonth() + 1;
  const startMonthSelect = document.getElementById('startMonth');
  const endMonthSelect = document.getElementById('endMonth');
  
  // ⚡ THAY ĐỔI: Luôn bắt đầu từ tháng 1, kết thúc ở tháng hiện tại
  if (startMonthSelect) startMonthSelect.value = '1';
  if (endMonthSelect) endMonthSelect.value = currentMonth.toString();
  
  // Setup stat box observer
  setupStatBoxObserver();
  
  console.log('MiniApp Tài Chính đã sẵn sàng! ✨');
});

/**
 * Reset về view tổng quan nếu đang ở trang chi tiết category
 * Gọi trước mỗi lần lọc dữ liệu mới
 */
function resetCategoryDetailView() {
  const detailView = document.getElementById('categoryDetailView');
  if (detailView && detailView.style.display !== 'none') {
    detailView.style.display = 'none';
    document.querySelector('.chart-container').style.display = 'flex';
    currentCategoryDetailPage = 1;
    cachedCategoryTransactions = null;
    currentCategory = null;
    currentCategoryData = null;
    if (window.categoryMonthlyChartInstance) {
      window.categoryMonthlyChartInstance.destroy();
      window.categoryMonthlyChartInstance = null;
    }
    document.getElementById('categoryTransactionsContainer').innerHTML = '';
    document.getElementById('paginationCategoryDetail').style.display = 'none';
  }
  categoryDetailsCache = {};
}

/* ==========================================================================
   CATEGORY DETAIL VIEW - Click vào legend để xem chi tiết
   ========================================================================== */
let currentCategoryDetailPage = 1;
const categoryDetailPerPage = 10;
let cachedCategoryTransactions = null;
let currentCategory = null;
let currentCategoryData = null;

/**
 * Hiển thị trang chi tiết của một category
 */
async function showCategoryDetail(categoryName, categoryAmount, categoryColor) {
  currentCategory = categoryName;
  
  try {
    // Ẩn chart container
    document.querySelector('.chart-container').style.display = 'none';
    const detailView = document.getElementById('categoryDetailView');
    
    // Kiểm tra cache trước
    const cacheKey = categoryName;
    if (categoryDetailsCache[cacheKey]) {
      console.log(`✅ Sử dụng cache cho category: ${categoryName}`);
      
      // Hiển thị detail view
      detailView.style.display = 'block';
      
      // Cập nhật tiêu đề
      document.getElementById('categoryDetailTitle').textContent = categoryName;
      document.getElementById('categoryDetailTitle').style.color = categoryColor;
      
      // Lấy dữ liệu từ cache
      const cachedData = categoryDetailsCache[cacheKey];
      currentCategoryData = cachedData.chartData;
      cachedCategoryTransactions = cachedData.transactions;
      
      // Hiển thị canvas
      const chartContainer = document.querySelector('#categoryDetailView > div:nth-child(3)');
      chartContainer.innerHTML = '<canvas id="categoryMonthlyChart"></canvas>';
      
      // Vẽ biểu đồ từ cache
      drawCategoryMonthlyChart(cachedData.chartData, categoryName, categoryColor);
      
      // Hiển thị danh sách giao dịch từ cache
      displayCategoryTransactions(cachedData.transactions);
      
    } else {
      console.log(`🔄 Loading dữ liệu mới cho category: ${categoryName}`);
      
      // Hiển thị detail view với loading
      detailView.style.display = 'block';
      detailView.style.opacity = '0.5';
      
      // Cập nhật tiêu đề
      document.getElementById('categoryDetailTitle').textContent = categoryName;
      document.getElementById('categoryDetailTitle').style.color = categoryColor;
      
      // Hiển thị loading indicator
      const chartContainer = document.querySelector('#categoryDetailView > div:nth-child(3)');
      chartContainer.innerHTML = `
        <div class="category-loading">
          <i class="fas fa-spinner fa-spin"></i>
          <div class="category-loading-text">Đang tải dữ liệu, vui lòng chờ...</div>
        </div>
      `;
      
      // Ẩn danh sách giao dịch tạm thời
      const transactionsContainer = document.getElementById('categoryTransactionsContainer');
      transactionsContainer.innerHTML = '';
      transactionsContainer.style.opacity = '0';
      document.getElementById('paginationCategoryDetail').style.display = 'none';
      
      // Lấy dữ liệu song song (parallel) để nhanh hơn
      await Promise.all([
        fetchCategoryMonthlyData(categoryName, categoryColor),
        fetchCategoryTransactions(categoryName)
      ]);
      
      // Xóa loading và hiển thị canvas
      chartContainer.innerHTML = '<canvas id="categoryMonthlyChart"></canvas>';
      
      // Vẽ biểu đồ
      drawCategoryMonthlyChart(currentCategoryData, categoryName, categoryColor);
      
      // Hiển thị danh sách giao dịch
      displayCategoryTransactions(cachedCategoryTransactions);
      
      // Fade in transactions container
      transactionsContainer.style.opacity = '1';
      transactionsContainer.style.transition = 'opacity 0.3s ease-in-out';
      
      // Fade in toàn bộ detail view
      detailView.style.opacity = '1';
      detailView.style.transition = 'opacity 0.3s ease-in-out';
      
      // Lưu vào cache
      categoryDetailsCache[cacheKey] = {
        chartData: currentCategoryData,
        transactions: cachedCategoryTransactions
      };
      console.log(`💾 Đã lưu cache cho category: ${categoryName}`);
    }
    
  } catch (error) {
    console.error('Lỗi khi hiển thị chi tiết category:', error);
    showToast('Lỗi khi tải dữ liệu: ' + error.message, 'error');
    backToCategoryList();
  }
}

/**
 * Quay lại view chính (KHÔNG xóa cache để tái sử dụng)
 */
function backToCategoryList() {
  document.getElementById('categoryDetailView').style.display = 'none';
  document.querySelector('.chart-container').style.display = 'flex';
  
  // Reset UI state (KHÔNG xóa categoryDetailsCache)
  currentCategoryDetailPage = 1;
  cachedCategoryTransactions = null;
  currentCategory = null;
  currentCategoryData = null;
  
  // Xóa chart instance
  if (window.categoryMonthlyChartInstance) {
    window.categoryMonthlyChartInstance.destroy();
    window.categoryMonthlyChartInstance = null;
  }
  
  // Xóa container
  document.getElementById('categoryTransactionsContainer').innerHTML = '';
  document.getElementById('paginationCategoryDetail').style.display = 'none';
}

/**
 * Lấy dữ liệu theo tháng (hoặc theo ngày nếu đang ở chế độ tuần) cho một category cụ thể
 */
async function fetchCategoryMonthlyData(categoryName, categoryColor) {
  try {
    if (!cachedChartData) {
      throw new Error('Không có dữ liệu biểu đồ. Vui lòng lọc dữ liệu trước.');
    }

    // ⚡ FIX: Nếu đang ở chế độ tuần, tổng hợp dữ liệu theo từng ngày từ weekTransactions
    if (cachedChartData.isWeekly && cachedChartData.weekTransactions) {
      const weekTx = cachedChartData.weekTransactions;
      const dayNames = ['CN','T2','T3','T4','T5','T6','T7'];
      const dayMap = {};
      weekTx.forEach(t => {
        if (t.category === categoryName && t.type === 'Chi tiêu') {
          const [d, m] = t.date.split('/');
          const key = String(d).padStart(2,'0') + '/' + String(m).padStart(2,'0');
          dayMap[key] = (dayMap[key] || 0) + t.amount;
        }
      });
      // Tính ngày đầu tuần từ danh sách giao dịch
      const allDates = weekTx.map(t => {
        const [d, m, y] = t.date.split('/');
        return new Date(parseInt(y), parseInt(m)-1, parseInt(d));
      });
      if (allDates.length === 0) { currentCategoryData = []; return; }
      const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
      const dow = minDate.getDay();
      const startDate = new Date(minDate);
      if (dow === 0) startDate.setDate(minDate.getDate() - 6);
      else startDate.setDate(minDate.getDate() - (dow - 1));
      const result = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const key = String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
        result.push({ month: dayNames[d.getDay()] + ' ' + key, amount: dayMap[key] || 0 });
      }
      currentCategoryData = result;
      return;
    }
    
    const startMonth = cachedChartData.startMonth;
    const endMonth = cachedChartData.endMonth;
    const year = new Date().getFullYear();
    
    // Gọi API để lấy dữ liệu theo tháng cho category
    const targetUrl = `${apiUrl}?action=getCategoryMonthlyData&category=${encodeURIComponent(categoryName)}&startMonth=${startMonth}&endMonth=${endMonth}&year=${year}&sheetId=${sheetId}`;
    const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
    
    console.log('Fetching category monthly data:', targetUrl);
    
    const response = await fetch(finalUrl);
    const data = await response.json();
    
    console.log('Category monthly data response:', data);
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    // Data đã có format đúng từ API: [{month: 1, amount: 1000}, ...]
    currentCategoryData = data;
    
    // KHÔNG vẽ biểu đồ ở đây nữa, để showCategoryDetail điều khiển
    
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu category monthly:', error);
    throw error;
  }
}

/**
 * Vẽ biểu đồ cột theo tháng cho category
 */
function drawCategoryMonthlyChart(data, categoryName, categoryColor) {
  console.log('=== drawCategoryMonthlyChart START ===');
  console.log('Category:', categoryName);
  console.log('Color:', categoryColor);
  console.log('Data:', data);
  
  const canvas = document.getElementById('categoryMonthlyChart');
  if (!canvas) {
    console.error('Canvas categoryMonthlyChart not found!');
    return;
  }
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('Cannot get 2d context from canvas!');
    return;
  }
  
  console.log('Canvas:', canvas);
  console.log('Context:', ctx);
  
  // Xóa chart cũ nếu có
  if (window.categoryMonthlyChartInstance) {
    console.log('Destroying old chart instance');
    window.categoryMonthlyChartInstance.destroy();
  }
  
  // ⚡ FIX: Nếu ở chế độ tuần, item.month đã là chuỗi label (vd: "T2 23/02")
  const labels = data.map(item =>
    (cachedChartData && cachedChartData.isWeekly) ? item.month : `Tháng ${item.month}`
  );
  const amounts = data.map(item => item.amount);
  
  console.log('Labels:', labels);
  console.log('Amounts:', amounts);
  
  try {
    window.categoryMonthlyChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: categoryName,
          data: amounts,
          backgroundColor: categoryColor + 'CC',
          borderColor: categoryColor,
          borderWidth: 2,
          borderRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 60
          }
        },
        plugins: {
          legend: {
            display: false
          },
          datalabels: {
            anchor: 'end',
            align: 'end',
            color: '#94A3B8',
            font: {
              weight: 'bold',
              size: 10
            },
            rotation: -90,
            formatter: (value) => {
              if (value === 0) return '';
              return value.toLocaleString('vi-VN') + 'đ';
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return value.toLocaleString('vi-VN') + 'đ';
              }
            },
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            }
          },
          x: {
            grid: {
              display: false
            },
            ticks: {
              autoSkip: false,
              maxRotation: 45,
              minRotation: 45
            }
          }
        },
        // ⚡ TỐI ƯU: Sử dụng cấu hình cột cố định để đồng nhất với biểu đồ TỔNG QUAN
        // Giờ đây cả 2 biểu đồ sẽ có cùng độ rộng cột bất kể số lượng dữ liệu
        barPercentage: FIXED_BAR_CONFIG.barPercentage,
        categoryPercentage: FIXED_BAR_CONFIG.categoryPercentage,
        maxBarThickness: FIXED_BAR_CONFIG.maxBarThickness
      },
      plugins: [ChartDataLabels]
    });
    
    console.log('Chart created successfully:', window.categoryMonthlyChartInstance);
    console.log('=== drawCategoryMonthlyChart END ===');
  } catch (error) {
    console.error('Error creating chart:', error);
  }
}

/**
 * Lấy danh sách giao dịch của category trong khoảng thời gian đã lọc
 */
async function fetchCategoryTransactions(categoryName) {
  try {
    // Lấy khoảng thời gian từ cachedChartData
    if (!cachedChartData) {
      throw new Error('Không có dữ liệu biểu đồ. Vui lòng lọc dữ liệu trước.');
    }

    // ⚡ FIX: Nếu đang ở chế độ lọc theo tuần, lọc trực tiếp từ weekTransactions đã có sẵn
    if (cachedChartData.isWeekly && cachedChartData.weekTransactions) {
      cachedCategoryTransactions = cachedChartData.weekTransactions.filter(t => t.category === categoryName);
      return;
    }
    
    const startMonth = cachedChartData.startMonth;
    const endMonth = cachedChartData.endMonth;
    const currentYear = new Date().getFullYear();
    
    // Nếu chỉ lọc 1 tháng
    if (startMonth === endMonth) {
      const targetUrl = `${apiUrl}?action=getTransactionsByMonth&month=${startMonth}&year=${currentYear}&sheetId=${sheetId}`;
      const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
      const response = await fetch(finalUrl);
      const transactions = await response.json();
      
      if (transactions.error) throw new Error(transactions.error);
      
      // Lọc giao dịch theo category
      const categoryTransactions = transactions.filter(t => t.category === categoryName);
      cachedCategoryTransactions = categoryTransactions;
      // KHÔNG hiển thị ở đây nữa
    } 
    // Nếu lọc nhiều tháng
    else {
      let allTransactions = [];
      
      // Lấy giao dịch từng tháng
      for (let month = startMonth; month <= endMonth; month++) {
        const targetUrl = `${apiUrl}?action=getTransactionsByMonth&month=${month}&year=${currentYear}&sheetId=${sheetId}`;
        const finalUrl = proxyUrl + encodeURIComponent(targetUrl);
        const response = await fetch(finalUrl);
        const transactions = await response.json();
        
        if (transactions.error) throw new Error(transactions.error);
        
        // Thêm vào danh sách tổng
        allTransactions = allTransactions.concat(transactions);
      }
      
      // Lọc giao dịch theo category
      const categoryTransactions = allTransactions.filter(t => t.category === categoryName);
      cachedCategoryTransactions = categoryTransactions;
      // KHÔNG hiển thị ở đây nữa
    }
    
  } catch (error) {
    console.error('Lỗi khi lấy giao dịch category:', error);
    showToast('Lỗi khi lấy danh sách giao dịch: ' + error.message, 'error');
  }
}

/**
 * Hiển thị danh sách giao dịch của category
 */
function displayCategoryTransactions(transactions) {
  const container = document.getElementById('categoryTransactionsContainer');
  const paginationDiv = document.getElementById('paginationCategoryDetail');
  const pageInfo = document.getElementById('pageInfoCategoryDetail');
  const prevBtn = document.getElementById('prevPageCategoryDetail');
  const nextBtn = document.getElementById('nextPageCategoryDetail');
  
  container.innerHTML = '';
  
  if (!transactions || transactions.length === 0) {
    container.innerHTML = '<div class="notification">Không có giao dịch nào trong khoảng thời gian đã lọc</div>';
    paginationDiv.style.display = 'none';
    return;
  }
  
  // Lấy thông tin khoảng thời gian từ cachedChartData
  const startMonth = cachedChartData ? cachedChartData.startMonth : null;
  const endMonth = cachedChartData ? cachedChartData.endMonth : null;
  
  let periodText = 'trong khoảng thời gian đã lọc';
  if (cachedChartData && cachedChartData.isWeekly) {
    const titleEl = document.getElementById('chartTitleTab2');
    const titleText = titleEl ? titleEl.textContent : '';
    const match = titleText.match(/\((.+)\)/);
    periodText = match ? `trong <strong>tuần ${match[1]}</strong>` : 'trong tuần đã lọc';
  } else if (startMonth && endMonth) {
    if (startMonth === endMonth) {
      periodText = `trong <strong>tháng ${startMonth}</strong>`;
    } else {
      periodText = `từ <strong>tháng ${startMonth}</strong> đến <strong>tháng ${endMonth}</strong>`;
    }
  }
  
  container.innerHTML = `<div class="notification">Có ${transactions.length} giao dịch ${periodText}</div>`;
  
  // Pagination
  const totalPages = Math.ceil(transactions.length / categoryDetailPerPage);
  const startIndex = (currentCategoryDetailPage - 1) * categoryDetailPerPage;
  const endIndex = startIndex + categoryDetailPerPage;
  const paginatedData = transactions.slice(startIndex, endIndex);
  
  paginatedData.forEach((item, index) => {
    const transactionBox = document.createElement('div');
    transactionBox.className = 'transaction-box';
    const amountColor = item.type === 'Thu nhập' ? 'var(--income-color)' : 'var(--expense-color)';
    const typeClass = item.type === 'Thu nhập' ? 'income' : 'expense';
    const transactionNumber = startIndex + index + 1;
    
    transactionBox.innerHTML = `
      <div class="layer-container" style="position: relative;">
        <div class="layer-top" style="position: absolute; top: 0; right: 0;">
          <div class="number">Giao dịch thứ: ${transactionNumber}</div>
          <div class="id">Mã giao dịch: ${item.id}</div>
        </div>
        <div class="layer-bottom" style="width: 100%;">
          <div class="date">${formatDate(item.date)}</div>
          <div class="amount" style="color: ${amountColor};">${item.amount.toLocaleString('vi-VN')}đ</div>
          <div class="content">Nội dung: ${item.content}${item.note ? ` (${item.note})` : ''}</div>
          <div class="type ${typeClass}">Phân loại: ${item.type}</div>
          <div class="category">Phân loại chi tiết: ${item.category}</div>
        </div>
      </div>
      <div style="margin-top: 0.5rem;">
        <button class="edit-btn edit" data-id="${item.id}"><i class="fas fa-edit"></i> Sửa</button>
        <button class="delete-btn delete" data-id="${item.id}"><i class="fas fa-trash"></i> Xóa</button>
      </div>
    `;
    container.appendChild(transactionBox);
  });
  
  // Setup pagination
  pageInfo.textContent = `Trang ${currentCategoryDetailPage} / ${totalPages}`;
  prevBtn.disabled = currentCategoryDetailPage === 1;
  nextBtn.disabled = currentCategoryDetailPage === totalPages;
  paginationDiv.style.display = 'flex';
  
  // Add event listeners for edit/delete buttons
  document.querySelectorAll('.edit-btn').forEach(button => {
    const transactionId = button.getAttribute('data-id');
    const transaction = transactions.find(item => String(item.id) === String(transactionId));
    if (transaction) {
      button.addEventListener('click', () => openEditForm(transaction));
    }
  });
  
  document.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteTransaction(button.getAttribute('data-id')));
  });
}

// Event listeners cho category detail pagination
document.addEventListener('DOMContentLoaded', function() {
  // Back button
  const backBtn = document.getElementById('backToCategoryBtn');
  if (backBtn) {
    backBtn.addEventListener('click', backToCategoryList);
  }
  
  // Pagination buttons
  const prevBtn = document.getElementById('prevPageCategoryDetail');
  const nextBtn = document.getElementById('nextPageCategoryDetail');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentCategoryDetailPage > 1) {
        currentCategoryDetailPage--;
        displayCategoryTransactions(cachedCategoryTransactions);
      }
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(cachedCategoryTransactions.length / categoryDetailPerPage);
      if (currentCategoryDetailPage < totalPages) {
        currentCategoryDetailPage++;
        displayCategoryTransactions(cachedCategoryTransactions);
      }
    });
  }
});
