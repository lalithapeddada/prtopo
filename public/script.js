// ============================================
// PROCUREMENT TRACKING SYSTEM - FRONTEND SCRIPT
// ============================================

// ============================================
// SECTION 1: CONFIGURATION & CONSTANTS
// ============================================

const API_URL = "http://localhost:3000";

// Current user and app state
let currentUser = null;
let currentRecord = null;
let allRecords = [];
let filteredRecords = [];
 
// Pagination variables
let currentPage = 1;
let recordsPerPage = 10;
let totalPages = 1;

// Inactivity timeout variables - 5 minutes auto-logout
let inactivityTimer;
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Server monitoring
let serverCheckInterval;

// User actions that require confirmation
let pendingStage = null;
let pendingStageName = null;
let pendingPOAdvanceSno = null;

// Session tracking
let sessionId = null;

// Stage icons mapping
const stageIcons = {
    "Purchase Requisition (PR)": "fa-file-invoice",
    "Request for Quotation (RFQ)/Invitation of Quote": "fa-envelope",
    "Technical Evaluation": "fa-microscope",
    "Comparisons": "fa-scale-balanced",
    "Negotiation": "fa-handshake",
    "Approval": "fa-check-double",
    "PO Creation": "fa-file-signature",
    "PO Release by finance / CSO": "fa-paper-plane",
    "Finance check": "fa-calculator",
    "GRN": "fa-boxes",
    "IR": "fa-file-invoice-dollar",
    "Payment against Invoice": "fa-credit-card"
};

// Stage order for validation
const stageOrder = [
    "Purchase Requisition (PR)",
    "Request for Quotation (RFQ)/Invitation of Quote",
    "Technical Evaluation",
    "Comparisons",
    "Negotiation",
    "Approval",
    "PO Creation",
    "PO Release by finance / CSO",
    "Finance check",
    "GRN",
    "IR",
    "Payment against Invoice"
];

// Role-based stage permissions
const stagePermissions = {
    "Purchase Requisition (PR)": ["purchaser", "admin"],
    "Request for Quotation (RFQ)/Invitation of Quote": ["purchaser", "admin"],
    "Technical Evaluation": ["purchaser", "admin"],
    "Comparisons": ["purchaser", "admin"],
    "Negotiation": ["purchaser", "admin"],
    "Approval": ["admin", "finance"],
    "PO Creation": ["purchaser", "admin"],
    "PO Release by finance / CSO": ["finance", "admin"],
    "Finance check": ["finance", "admin"],
    "GRN": ["purchaser", "admin"],
    "IR": ["finance", "admin"],
    "Payment against Invoice": ["finance", "admin"]
};

// Team/role descriptions
const roleDescriptions = {
    "purchaser": "Purchasing Team",
    "finance": "Finance Team",
    "admin": "Administrator",
    "viewer": "Viewer"
};

// Which stages belong to which team
const stageTeams = {
    "Purchase Requisition (PR)": "purchaser",
    "Request for Quotation (RFQ)/Invitation of Quote": "purchaser",
    "Technical Evaluation": "purchaser",
    "Comparisons": "purchaser",
    "Negotiation": "purchaser",
    "Approval": "finance",
    "PO Creation": "purchaser",
    "PO Release by finance / CSO": "finance",
    "Finance check": "finance",
    "GRN": "purchaser",
    "IR": "finance",
    "Payment against Invoice": "finance"
};

// ============================================
// SECTION 2: AUTHENTICATION & INITIALIZATION
// ============================================

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 Script.js: DOM Content Loaded");
    
    // Check if body is visible (debug)
    console.log("Body display style:", document.body.style.display);
    
    // Get user from session storage
    const userStr = sessionStorage.getItem("user");
    console.log("User in sessionStorage:", userStr ? "✅ YES" : "❌ NO");
    
    if (!userStr) {
        console.log("No user in session storage, redirecting to login");
        window.location.replace("/login.html");
        return;
    }
    
    try {
        currentUser = JSON.parse(userStr);
        console.log("User parsed successfully:", currentUser.username, "Role:", currentUser.role);
    } catch (e) {
        console.error("Error parsing user data:", e);
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("sessionId");
        window.location.replace("/login.html");
        return;
    }
    
    // Generate a new session ID for this page load
    sessionId = generateSessionId();
    sessionStorage.setItem('sessionId', sessionId);
    console.log("Session ID generated:", sessionId);
    
    // Show initial skeletons
    showStatsSkeletons();
    showStagesSkeletons();
    showTableSkeletons();
    
    // Verify with server
    console.log("Verifying with server...");
    const isAuthenticated = await verifyWithServer();
    
    if (!isAuthenticated) {
        console.log("❌ Server verification failed");
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("sessionId");
        window.location.replace("/login.html");
        return;
    }
    
    console.log("✅ Server verification successful");
    console.log("User logged in:", currentUser);
    
    // Update UI
    updateUIForRole();
    
    // Initialize components
    initAutocomplete();
    loadRecentRecords();
    loadDashboardStats();
    initializeStagesGrid();
    
    // Setup event listeners
    setupMenuCloseOnClickOutside();
    resetInactivityTimer();
    setupActivityTracking();
    startServerMonitoring();
    setupTabCloseDetection();
    
    console.log("✅ App initialization complete");
});

// Verify with server
async function verifyWithServer() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${API_URL}/api/auth/me`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            console.log("Server auth response not OK:", response.status);
            return false;
        }
        
        const data = await response.json();
        
        if (data.success && data.user) {
            // Update currentUser with server data
            currentUser = data.user;
            // Update session storage
            sessionStorage.setItem('user', JSON.stringify(currentUser));
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Server verification error:', error);
        return false;
    }
}

// Generate a unique session ID
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Verify session before any action
function verifySession() {
    const storedSessionId = sessionStorage.getItem('sessionId');
    if (!storedSessionId || storedSessionId !== sessionId) {
        console.log("Session verification failed - redirecting");
        forceRedirectToLogin();
        return false;
    }
    return true;
}

// Force redirect to login with cleanup
function forceRedirectToLogin() {
    console.log("Force redirect to login");
    
    // Clear all intervals and timers
    if (serverCheckInterval) {
        clearInterval(serverCheckInterval);
        serverCheckInterval = null;
    }
    
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }
    
    // Clear session storage
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('sessionId');
    sessionStorage.clear();
    
    // Use replace instead of href to prevent back button
    window.location.replace('/login.html');
}

// Monitor server connection
function startServerMonitoring() {
    // Clear any existing interval
    if (serverCheckInterval) {
        clearInterval(serverCheckInterval);
    }
    
    // Check server health every 5 seconds
    serverCheckInterval = setInterval(async () => {
        // Don't check if we're already redirecting
        if (!sessionStorage.getItem('user')) {
            return;
        }
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            
            const response = await fetch(`${API_URL}/health`, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.log("Server health check failed");
                forceRedirectToLogin();
            }
        } catch (error) {
            console.log("Server unreachable");
            forceRedirectToLogin();
        }
    }, 5000);
}

// Setup tab close detection
function setupTabCloseDetection() {
    // Detect when tab becomes visible again
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            // Tab became visible again - check if we're still logged in
            const storedSessionId = sessionStorage.getItem('sessionId');
            const storedUser = sessionStorage.getItem('user');
            
            // If session data is missing or doesn't match, redirect to login
            if (!storedSessionId || !storedUser || storedSessionId !== sessionId) {
                console.log("Session mismatch on visibility change");
                forceRedirectToLogin();
            }
        }
    });
}

// ============================================
// SECTION 3: LOADING SKELETONS
// ============================================

// Show skeleton loaders for stats
function showStatsSkeletons() {
    const statsCards = document.querySelectorAll('.stat-card');
    statsCards.forEach(card => {
        card.classList.add('skeleton');
        const valueElement = card.querySelector('.stat-value');
        if (valueElement) {
            valueElement.setAttribute('data-original', valueElement.textContent);
            valueElement.innerHTML = '';
        }
    });
}

// Hide stats skeletons
function hideStatsSkeletons() {
    const statsCards = document.querySelectorAll('.stat-card');
    statsCards.forEach(card => {
        card.classList.remove('skeleton');
        const valueElement = card.querySelector('.stat-value');
        if (valueElement && valueElement.getAttribute('data-original')) {
            valueElement.textContent = valueElement.getAttribute('data-original');
            valueElement.removeAttribute('data-original');
        }
    });
}

// Show skeleton loaders for stages grid
function showStagesSkeletons() {
    const stagesGrid = document.getElementById('stagesGrid');
    if (!stagesGrid) return;
    
    let skeletonHtml = '';
    for (let i = 0; i < 12; i++) {
        skeletonHtml += `
            <div class="stage-item skeleton">
                <div class="stage-icon"></div>
                <div class="stage-name"></div>
                <div class="stage-time"></div>
                <div class="stage-team-badge"></div>
            </div>
        `;
    }
    stagesGrid.innerHTML = skeletonHtml;
}

// Show skeleton loaders for records table
function showTableSkeletons() {
    const tbody = document.getElementById('recentTableBody');
    if (!tbody) return;
    
    let skeletonRows = '';
    for (let i = 0; i < 10; i++) {
        skeletonRows += `
            <tr class="skeleton-row">
                <td><div class="skeleton-cell short"></div></td>
                <td><div class="skeleton-cell medium"></div></td>
                <td><div class="skeleton-cell medium"></div></td>
                <td><div class="skeleton-cell medium"></div></td>
                <td><div class="skeleton-cell xlong"></div></td>
                <td><div class="skeleton-cell medium"></div></td>
                <td><div class="skeleton-cell medium"></div></td>
                <td><div class="skeleton-cell medium"></div></td>
                <td><div class="skeleton-cell long"></div></td>
                <td><div class="skeleton-cell short"></div></td>
                <td><div class="skeleton-cell short"></div></td>
                <td><div class="skeleton-cell short"></div></td>
                <td><div class="skeleton-cell short"></div></td>
            </tr>
        `;
    }
    tbody.innerHTML = skeletonRows;
}

// ============================================
// SECTION 4: USER INTERFACE UPDATES
// ============================================

// Update UI based on user role
function updateUIForRole() {
    if (!currentUser) return;
    
    console.log("Updating UI for role:", currentUser.role);
    
    // Update user info in menu
    const menuUserInfo = document.getElementById('menuUserInfo');
    const menuDivider = document.getElementById('menuDivider');
    
    if (menuUserInfo) {
        menuUserInfo.innerHTML = `
            <div class="menu-user-info">
                <div class="menu-user-icon">
                    <i class="fas fa-user-circle"></i>
                </div>
                <div class="menu-user-details">
                    <div class="menu-user-name">${currentUser.username}</div>
                    <span class="menu-user-role ${currentUser.role}">${roleDescriptions[currentUser.role] || currentUser.role}</span>
                </div>
            </div>
        `;
    }
    
    if (menuDivider) {
        menuDivider.style.display = 'block';
    }
    
    // Hide create PR button for non-purchasers
    if (!['purchaser', 'admin'].includes(currentUser.role)) {
        const createBtn = document.querySelector('button[onclick="showCreateForm()"]');
        if (createBtn) createBtn.style.display = 'none';
    }
}

// Setup click outside to close menu
function setupMenuCloseOnClickOutside() {
    document.addEventListener('click', function(event) {
        const menu = document.getElementById('menuDropdown');
        const menuButton = document.querySelector('.menu-button');
        
        if (menu && menuButton) {
            if (!menuButton.contains(event.target) && !menu.contains(event.target)) {
                menu.classList.remove('show');
            }
        }
    });
}

// Toggle menu dropdown
function toggleMenu() {
    const menu = document.getElementById('menuDropdown');
    menu.classList.toggle('show');
}

// Logout function
async function logout() {
    console.log("Logging out...");
    
    // Clear intervals
    if (serverCheckInterval) {
        clearInterval(serverCheckInterval);
    }
    
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    
    // Clear session storage
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('sessionId');
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        await fetch(`${API_URL}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
    } catch (error) {
        // Ignore errors
    } finally {
        window.location.replace('/login.html');
    }
}

// Show permission denied
function showPermissionDenied() {
    alert('You don\'t have permission to perform this action');
}

// ============================================
// SECTION 5: STAGES GRID & DISPLAY
// ============================================

// Initialize stages grid
function initializeStagesGrid() {
    const stagesGrid = document.getElementById('stagesGrid');
    if (!stagesGrid) return;
    
    let html = '';
    stageOrder.forEach(stage => {
        const stageKey = stage.replace(/[^a-zA-Z0-9]/g, '');
        const allowedRoles = stagePermissions[stage] || [];
        const hasPermission = currentUser && allowedRoles.includes(currentUser.role);
        const disabledClass = !hasPermission ? 'disabled' : '';
        const stageTeam = stageTeams[stage];
        
        // Get the correct team name for display
        let teamDisplayName = '';
        if (stageTeam === 'purchaser') {
            teamDisplayName = 'Purchasing Team';
        } else if (stageTeam === 'finance') {
            teamDisplayName = 'Finance Team';
        } else {
            teamDisplayName = roleDescriptions[stageTeam] || stageTeam;
        }
        
        html += `
            <div class="stage-item ${disabledClass} stage-team-${stageTeam}" 
                 onclick="${hasPermission ? `moveStage('${stage.replace(/'/g, "\\'")}')` : 'showPermissionDenied()'}"
                 title="${hasPermission ? '' : 'You don\'t have permission for this stage'}">
                <div class="stage-icon">
                    <i class="fas ${stageIcons[stage]}"></i>
                </div>
                <div class="stage-name">${stage}</div>
                <div class="stage-time" id="stage-${stageKey}">Not started</div>
                <div class="stage-team-badge">${teamDisplayName}</div>
            </div>
        `;
    });
    stagesGrid.innerHTML = html;
}

// Update stages display when record loaded
function updateStagesDisplay(record) {
    stageOrder.forEach(stage => {
        const stageKey = stage.replace(/[^a-zA-Z0-9]/g, '');
        const stageElement = document.getElementById(`stage-${stageKey}`);
        const stageItem = stageElement?.closest('.stage-item');
        
        let dbColumn = getStageColumn(stage);
        
        const timestamp = record[dbColumn];
        if (timestamp) {
            const date = new Date(timestamp);
            const formattedDate = date.toLocaleString();
            stageElement.textContent = formattedDate;
            if (stageItem) {
                stageItem.classList.add('completed');
                
                // Remove any waiting message
                const waitingMsg = stageItem.querySelector('.waiting-message');
                if (waitingMsg) waitingMsg.remove();
            }
        } else {
            stageElement.textContent = 'Not started';
            if (stageItem) {
                stageItem.classList.remove('completed');
                
                // Check if previous stages are completed
                const stageIndex = stageOrder.indexOf(stage);
                let previousCompleted = true;
                let waitingForTeam = null;
                
                if (stageIndex > 0) {
                    const prevStage = stageOrder[stageIndex - 1];
                    let prevDbColumn = getStageColumn(prevStage);
                    
                    previousCompleted = !!record[prevDbColumn];
                    
                    if (!previousCompleted) {
                        const prevStageTeam = stageTeams[prevStage];
                        waitingForTeam = roleDescriptions[prevStageTeam] || prevStageTeam;
                    }
                }
                
                // Add waiting message if needed
                const existingMsg = stageItem.querySelector('.waiting-message');
                if (existingMsg) existingMsg.remove();
                
                if (!previousCompleted && waitingForTeam) {
                    const waitingMsg = document.createElement('div');
                    waitingMsg.className = 'waiting-message';
                    waitingMsg.innerHTML = `<i class="fas fa-clock"></i> Waiting for ${waitingForTeam} to complete previous step`;
                    stageItem.appendChild(waitingMsg);
                }
            }
        }
    });
    
    updateProgress(record);
}

// Helper to get database column from stage name
function getStageColumn(stage) {
    if (stage === "Purchase Requisition (PR)") return "pr_date";
    if (stage === "Request for Quotation (RFQ)/Invitation of Quote") return "rfq_date";
    if (stage === "Technical Evaluation") return "technical_evaluation";
    if (stage === "Comparisons") return "comparisons";
    if (stage === "Negotiation") return "negotiation";
    if (stage === "Approval") return "approval";
    if (stage === "PO Creation") return "po_creation";
    if (stage === "PO Release by finance / CSO") return "po_release_finance";
    if (stage === "Finance check") return "finance_check";
    if (stage === "GRN") return "grn";
    if (stage === "IR") return "ir";
    if (stage === "Payment against Invoice") return "payment_against_invoice";
    return stage;
}

// Update progress bar
function updateProgress(record) {
    const totalStages = stageOrder.length;
    let completedStages = 0;
    
    stageOrder.forEach(stage => {
        const dbColumn = getStageColumn(stage);
        if (record[dbColumn]) {
            completedStages++;
        }
    });
    
    const progress = Math.round((completedStages / totalStages) * 100);
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = progress + '%';
    progressBar.textContent = progress + '%';
}

// ============================================
// SECTION 6: PR CREATION
// ============================================

// Show create PR form
function showCreateForm() {
    if (!currentUser || !['purchaser', 'admin'].includes(currentUser.role)) {
        alert('You don\'t have permission to create PRs');
        return;
    }
    
    // Verify session
    if (!verifySession()) return;
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('prDate').value = today;
    
    document.getElementById('createForm').style.display = 'flex';
}

// Hide create PR form
function hideCreateForm() {
    document.getElementById('createForm').style.display = 'none';
    document.getElementById('trackingNumber').value = '';
    document.getElementById('prDate').value = '';
    document.getElementById('plant').value = '';
    document.getElementById('itemDescription').value = '';
    document.getElementById('paymentType').value = '';
    document.getElementById('requestedBy').value = '';
    document.getElementById('remarks').value = '';
}

// Create new PR
async function createPR() {
    if (!currentUser || !['purchaser', 'admin'].includes(currentUser.role)) {
        alert('You don\'t have permission to create PRs');
        return;
    }
    
    if (!verifySession()) return;
    
    const trackingNumber = document.getElementById('trackingNumber').value;
    const prDate = document.getElementById('prDate').value;
    const plant = document.getElementById('plant').value;
    const itemDescription = document.getElementById('itemDescription').value;
    const paymentType = document.getElementById('paymentType').value;
    const requestedBy = document.getElementById('requestedBy').value;
    const remarks = document.getElementById('remarks').value;
    
    if (!trackingNumber || !prDate || !plant || !itemDescription || !paymentType || !requestedBy) {
        alert('Please fill all required fields');
        return;
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/create-pr`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                tracking_number: trackingNumber,
                pr_date: prDate,
                plant: plant,
                item_description: itemDescription,
                payment_type: paymentType,
                requested_by: requestedBy,
                remarks: remarks
            }),
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ PR Created! Tracking: ${trackingNumber}`);
            hideCreateForm();
            document.getElementById('searchTracking').value = trackingNumber;
            searchRecord();
            loadRecentRecords();
            loadDashboardStats();
        } else {
            alert('❌ ' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('❌ Failed to create PR');
        }
    }
}

// ============================================
// SECTION 7: RECORD SEARCH & DISPLAY
// ============================================

// Search for a record
async function searchRecord() {
    if (!verifySession()) return;
    
    const tracking = document.getElementById('searchTracking').value;
    if (!tracking) {
        alert('Please enter Tracking Number');
        return;
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/api/records/tracking/${tracking}`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            currentRecord = data.data;
            document.getElementById('selectedRecord').style.display = 'block';
            document.getElementById('currentTracking').textContent = tracking;
            
            document.getElementById('displayPrDate').textContent = data.data.pr_date ? new Date(data.data.pr_date).toLocaleDateString() : '-';
            document.getElementById('displayPlant').textContent = data.data.plant || '-';
            document.getElementById('displaySupplier').textContent = data.data.supplier_name || '-';
            document.getElementById('displayItemDescription').textContent = data.data.item_description || '-';
            document.getElementById('displayPaymentType').textContent = data.data.payment_type || '-';
            document.getElementById('displayPONumber').textContent = data.data.po_number || '-';
            document.getElementById('displayRequestedBy').textContent = data.data.requested_by || '-';
            document.getElementById('displayRemarks').textContent = data.data.remarks || '-';
            
            document.getElementById('fileCount').textContent = data.data.file_count || 0;
            
            updateStagesDisplay(data.data);
            loadTurnaroundTime(data.data.sno);
            
            return true;
        } else {
            alert('Record not found');
            document.getElementById('selectedRecord').style.display = 'none';
            return false;
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('Error loading record');
        }
        return false;
    }
}

// Load specific record (for table click)
function loadRecordFromTable(trackingNumber) {
    if (!verifySession()) return;
    
    document.getElementById('searchTracking').value = trackingNumber;
    searchRecord();
    
    // Scroll to the top of the selected record section
    setTimeout(() => {
        const selectedRecordElement = document.getElementById('selectedRecord');
        if (selectedRecordElement && selectedRecordElement.style.display !== 'none') {
            selectedRecordElement.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }
    }, 300);
}

// ============================================
// SECTION 8: STAGE MOVEMENT & UPDATES
// ============================================

// Move to next stage
async function moveStage(stageName) {
    if (!verifySession()) return;
    
    if (!currentUser) {
        forceRedirectToLogin();
        return;
    }
    
    const allowedRoles = stagePermissions[stageName] || [];
    if (!allowedRoles.includes(currentUser.role)) {
        alert(`You don't have permission to perform ${stageName}`);
        return;
    }
    
    if (!currentRecord) {
        alert('Please load a record first');
        return;
    }
    
    // Check if stage is already completed
    const dbColumn = getStageColumn(stageName);
    
    if (currentRecord[dbColumn]) {
        alert(`⚠️ ${stageName} already completed`);
        return;
    }
    
    // Check if previous stage is completed
    const stageIndex = stageOrder.indexOf(stageName);
    if (stageIndex > 0) {
        const prevStage = stageOrder[stageIndex - 1];
        const prevDbColumn = getStageColumn(prevStage);
        
        if (!currentRecord[prevDbColumn]) {
            const prevStageTeam = stageTeams[prevStage];
            const teamName = roleDescriptions[prevStageTeam] || prevStageTeam;
            alert(`⏳ Please wait for ${teamName} to complete "${prevStage}" first`);
            return;
        }
    }
    
    // Handle special stages that need additional input
    if (stageName === "Approval") {
        pendingStage = currentRecord.sno;
        pendingStageName = stageName;
        showSupplierModal();
        return;
    }
    
    if (stageName === "PO Creation") {
        pendingStage = currentRecord.sno;
        pendingStageName = stageName;
        showPONumberModal();
        return;
    }
    
    if (stageName === "PO Release by finance / CSO") {
        performStageUpdate(stageName);
        return;
    }
    
    // For regular stages, proceed with update
    performStageUpdate(stageName);
}

// Perform stage update
async function performStageUpdate(stageName) {
    if (!verifySession()) return;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/update-stage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                sno: currentRecord.sno,
                stage: stageName
            }),
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${stageName} completed!`);
    
            // If this is PO Release, show PO Advance modal
            if (stageName === "PO Release by finance / CSO") {
                setTimeout(() => {
                    showPOAdvanceModal(currentRecord.sno);
                }, 1000);
            }
    
            // Refresh the record
            await searchRecord();
            loadRecentRecords();
            loadDashboardStats();
        } else {
            alert('❌ ' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('❌ Failed to update stage');
        }
    }
}

// ============================================
// SECTION 9: MODAL HANDLERS
// ============================================

// --- Supplier Modal (for Approval stage) ---
function showSupplierModal() {
    document.getElementById('supplierName').value = '';
    document.getElementById('supplierModal').style.display = 'flex';
}

function hideSupplierModal() {
    document.getElementById('supplierModal').style.display = 'none';
    pendingStage = null;
    pendingStageName = null;
}

async function confirmSupplier() {
    if (!verifySession()) return;
    
    const supplierName = document.getElementById('supplierName').value;
    
    if (!supplierName) {
        alert('Please enter supplier name');
        return;
    }
    
    const requestBody = { 
        sno: pendingStage,
        stage: pendingStageName,
        supplier_name: supplierName
    };
    
    hideSupplierModal();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/update-stage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ Approval completed with supplier: ${supplierName}`);
            await searchRecord();
            loadRecentRecords();
            loadDashboardStats();
        } else {
            alert('❌ ' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('❌ Failed to update stage');
        }
    }
    
    pendingStage = null;
    pendingStageName = null;
}

// --- PO Number Modal (for PO Creation stage) ---
function showPONumberModal() {
    document.getElementById('poNumber').value = '';
    document.getElementById('poNumberModal').style.display = 'flex';
}

function hidePONumberModal() {
    document.getElementById('poNumberModal').style.display = 'none';
    pendingStage = null;
    pendingStageName = null;
}

async function confirmPONumber() {
    if (!verifySession()) return;
    
    const poNumber = document.getElementById('poNumber').value;
    
    if (!poNumber) {
        alert('Please enter PO number');
        return;
    }
    
    const requestBody = { 
        sno: pendingStage,
        stage: pendingStageName,
        po_number: poNumber
    };
    
    hidePONumberModal();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/update-stage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ PO Created: ${poNumber}`);
            await searchRecord();
            loadRecentRecords();
            loadDashboardStats();
        } else {
            alert('❌ ' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('❌ Failed to create PO');
        }
    }
    
    pendingStage = null;
    pendingStageName = null;
}

// --- PO Advance Modal (after PO Release) ---
function showPOAdvanceModal(sno) {
    if (!verifySession()) return;
    
    if (!sno && currentRecord) {
        sno = currentRecord.sno;
    }
    
    if (!sno) {
        alert('Error: Cannot identify record');
        return;
    }
    
    pendingPOAdvanceSno = sno;
    document.getElementById('poAdvance').value = '';
    document.getElementById('poAdvanceModal').style.display = 'flex';
}

function hidePOAdvanceModal() {
    document.getElementById('poAdvanceModal').style.display = 'none';
    pendingPOAdvanceSno = null;
}

async function confirmPOAdvance() {
    if (!verifySession()) return;
    
    const poAdvance = document.getElementById('poAdvance').value;
    
    if (!poAdvance) {
        alert('Please select PO Advance option');
        return;
    }
    
    if (!pendingPOAdvanceSno) {
        alert('Error: No record selected');
        return;
    }
    
    const requestBody = { 
        sno: pendingPOAdvanceSno,
        po_advance: poAdvance
    };
    
    hidePOAdvanceModal();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/update-po-advance`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody),
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ PO Advance set to: ${poAdvance}`);
            await searchRecord();
            loadRecentRecords();
        } else {
            alert('❌ ' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('❌ Failed to update PO Advance');
        }
    }
    
    pendingPOAdvanceSno = null;
}

// ============================================
// SECTION 10: DASHBOARD STATS
// ============================================

// Load dashboard stats
async function loadDashboardStats() {
    if (!verifySession()) return;
    
    // Show skeletons
    showStatsSkeletons();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/api/dashboard/stats`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Update Total PRs
            const totalElement = document.querySelector('#statTotal .stat-value');
            if (totalElement) {
                totalElement.textContent = data.data.totalRecords || 0;
            }
            
            // Update Completed
            const completedElement = document.querySelector('#statCompleted .stat-value');
            if (completedElement) {
                completedElement.textContent = data.data.completedRecords || 0;
            }
            
            // Update Average Time based on user role
            const avgElement = document.querySelector('#statAvgTime .stat-value');
            const avgLabel = document.querySelector('#statAvgTime .stat-label');
            
            if (avgElement && avgLabel) {
                let avgValue = 0;
                let labelText = '';
                
                if (currentUser.role === 'purchaser') {
                    labelText = 'PR → PO Release (Days)';
                    avgValue = data.data.overallAvgDays || 0;
                } 
                else if (currentUser.role === 'finance') {
                    labelText = 'PO Release → Payment (Days)';
                    avgValue = data.data.financeAvgDays || 0;
                } 
                else {
                    const overall = data.data.overallAvgDays || 0;
                    const finance = data.data.financeAvgDays || 0;
                    const combinedAvg = Math.round((overall + finance) / 2);
                    labelText = 'Combined Process Avg (Days)';
                    avgValue = combinedAvg;
                }
                
                avgLabel.textContent = labelText;
                avgElement.textContent = avgValue;
            }
            
            // Hide skeletons after data is loaded
            hideStatsSkeletons();
        }
    } catch (error) {
        console.error('Error loading stats:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            hideStatsSkeletons();
        }
    }
}

// ============================================
// SECTION 11: RECORDS TABLE WITH PAGINATION
// ============================================

// Load recent records
async function loadRecentRecords() {
    if (!verifySession()) return;
    
    // Show table skeletons
    showTableSkeletons();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/api/records`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                forceRedirectToLogin();
                return;
            }
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Sort records by sno in descending order
            allRecords = data.data.sort((a, b) => {
                return (b.sno || 0) - (a.sno || 0);
            });
            
            filteredRecords = [...allRecords];
            
            // Reset to first page when loading new data
            currentPage = 1;
            displayRecords();
        } else {
            const tbody = document.getElementById('recentTableBody');
            tbody.innerHTML = `<tr><td colspan="13" class="text-center">Error: ${data.message}</td></tr>`;
        }
    } catch (error) {
        console.error('Error loading records:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            const tbody = document.getElementById('recentTableBody');
            tbody.innerHTML = `<tr><td colspan="13" class="text-center">Error loading records</td></tr>`;
        }
    }
}

// Display records in table with pagination
function displayRecords() {
    const tbody = document.getElementById('recentTableBody');
    
    if (!tbody) {
        console.error("Table body not found!");
        return;
    }
    
    if (filteredRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="text-center">No records found</td></tr>';
        renderPagination();
        return;
    }
    
    // Calculate pagination
    totalPages = Math.ceil(filteredRecords.length / recordsPerPage);
    if (currentPage > totalPages) currentPage = 1;
    
    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = Math.min(startIndex + recordsPerPage, filteredRecords.length);
    const paginatedRecords = filteredRecords.slice(startIndex, endIndex);
    
    let html = '';
    paginatedRecords.forEach(record => {
        const currentStage = getCurrentStage(record);
        const status = getRecordStatus(record);
        const hasFiles = record.file_count > 0;
        const prDate = record.pr_date 
            ? new Date(record.pr_date).toLocaleDateString()
            : '-';
        
        html += `
            <tr onclick="loadRecordFromTable('${record.tracking_number}')" style="cursor: pointer;">
                <td><strong>#${record.sno || '-'}</strong></td>
                <td><span class="tracking-badge">${record.tracking_number || '-'}</span></td>
                <td>${prDate}</td>
                <td>${record.plant || '-'}</td>
                <td>${truncateText(record.item_description || '-', 30)}</td>
                <td>${record.payment_type || '-'}</td>
                <td>${record.po_number || '-'}</td>
                <td>${record.requested_by || '-'}</td>
                <td>${currentStage}</td>
                <td>${record.po_advance || 'No'}</td>
                <td><span class="status-badge ${status}">${status}</span></td>
                <td>
                    <span class="file-indicator ${hasFiles ? 'has-files' : ''}">
                        <i class="fas ${hasFiles ? 'fa-file' : 'fa-file-alt'}"></i>
                        ${record.file_count || 0}
                    </span>
                </td>
                <td>
                    <button class="btn btn-small btn-info" onclick="event.stopPropagation(); viewFilesInNewTab(${record.sno})" ${!hasFiles ? 'disabled' : ''}>
                        <i class="fas ${hasFiles ? 'fa-eye' : 'fa-file-alt'}"></i>
                        <span>View</span>
                    </button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    renderPagination();
    initResizableTable();
}

// Render pagination controls
function renderPagination() {
    const paginationContainer = document.getElementById('paginationControls');
    if (!paginationContainer) return;
    
    if (filteredRecords.length === 0 || totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    let paginationHtml = '<div class="pagination">';
    
    // Previous button
    paginationHtml += `
        <button class="pagination-btn" onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i>
        </button>
    `;
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // First page
    if (startPage > 1) {
        paginationHtml += `<button class="pagination-btn" onclick="changePage(1)">1</button>`;
        if (startPage > 2) {
            paginationHtml += `<span class="pagination-ellipsis">...</span>`;
        }
    }
    
    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
        paginationHtml += `
            <button class="pagination-btn ${i === currentPage ? 'active' : ''}" 
                    onclick="changePage(${i})">
                ${i}
            </button>
        `;
    }
    
    // Last page
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHtml += `<span class="pagination-ellipsis">...</span>`;
        }
        paginationHtml += `<button class="pagination-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    paginationHtml += `
        <button class="pagination-btn" onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
            <i class="fas fa-chevron-right"></i>
        </button>
    `;
    
    paginationHtml += '</div>';
    
    // Add page info
    const start = (currentPage - 1) * recordsPerPage + 1;
    const end = Math.min(currentPage * recordsPerPage, filteredRecords.length);
    paginationHtml += `
        <div class="page-info">
            Showing ${start} to ${end} of ${filteredRecords.length} records
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHtml;
}

// Change page
function changePage(page) {
    if (!verifySession()) return;
    
    if (page < 1 || page > totalPages || page === currentPage) return;
    
    currentPage = page;
    displayRecords();
    
    // Scroll to top of records section smoothly
    document.querySelector('.recent-records').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Get current stage from record
function getCurrentStage(record) {
    const stages = [
        { name: "Payment against Invoice", field: "payment_against_invoice" },
        { name: "IR", field: "ir" },
        { name: "GRN", field: "grn" },
        { name: "Finance check", field: "finance_check" },
        { name: "PO Release by finance / CSO", field: "po_release_finance" },
        { name: "PO Creation", field: "po_creation" },
        { name: "Approval", field: "approval" },
        { name: "Negotiation", field: "negotiation" },
        { name: "Comparisons", field: "comparisons" },
        { name: "Technical Evaluation", field: "technical_evaluation" },
        { name: "Request for Quotation (RFQ)/Invitation of Quote", field: "rfq_date" },
        { name: "Purchase Requisition (PR)", field: "pr_date" }
    ];
    
    for (let stage of stages) {
        if (record[stage.field]) {
            return stage.name;
        }
    }
    return 'PR Created';
}

// Get record status
function getRecordStatus(record) {
    if (record.payment_against_invoice) return 'completed';
    let hasProgress = false;
    if (record.rfq_date || record.technical_evaluation || record.comparisons || 
        record.negotiation || record.approval || record.po_creation || 
        record.po_release_finance || record.finance_check || record.grn || 
        record.ir) {
        hasProgress = true;
    }
    return hasProgress ? 'in-progress' : 'pending';
}

// ============================================
// SECTION 12: FILE MANAGEMENT
// ============================================

// Show file upload modal
function showFileUpload() {
    if (!verifySession()) return;
    
    if (!currentUser) {
        forceRedirectToLogin();
        return;
    }
    
    if (!currentRecord) {
        alert('Please load a record first');
        return;
    }
    
    document.getElementById('fileUploadModal').style.display = 'flex';
    document.getElementById('fileInput').value = '';
    document.getElementById('fileList').innerHTML = '';
}

function hideFileUpload() {
    document.getElementById('fileUploadModal').style.display = 'none';
}

// Handle file selection
document.getElementById('fileInput')?.addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    const fileList = document.getElementById('fileList');
    
    fileList.innerHTML = files.map(file => `
        <div class="file-item">
            <span>
                <i class="fas ${getFileIcon(file.type)}"></i>
                ${file.name}
            </span>
            <span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>
        </div>
    `).join('');
});

// Get file icon based on type
function getFileIcon(mimeType) {
    if (mimeType.includes('pdf')) return 'fa-file-pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word';
    if (mimeType.includes('excel') || mimeType.includes('sheet')) return 'fa-file-excel';
    if (mimeType.includes('image')) return 'fa-file-image';
    return 'fa-file';
}

// Upload files
async function uploadFiles() {
    if (!verifySession()) return;
    
    if (!currentUser) {
        forceRedirectToLogin();
        return;
    }
    
    if (!currentRecord) {
        alert('No record selected');
        return;
    }
    
    const files = document.getElementById('fileInput').files;
    if (files.length === 0) {
        alert('Please select files');
        return;
    }
    
    const formData = new FormData();
    formData.append('sno', currentRecord.sno);
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        const response = await fetch(`${API_URL}/api/upload-files`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.count} files uploaded`);
            hideFileUpload();
            document.getElementById('fileCount').textContent = (parseInt(document.getElementById('fileCount').textContent) || 0) + data.count;
            loadRecentRecords();
        } else {
            alert('❌ Upload failed: ' + data.message);
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('❌ Upload failed');
        }
    }
}

// View files
async function viewFiles() {
    if (!verifySession()) return;
    
    if (!currentUser) {
        forceRedirectToLogin();
        return;
    }
    
    if (!currentRecord) {
        alert('Please load a record first');
        return;
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/api/files/${currentRecord.sno}`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            const container = document.getElementById('filesContainer');
            if (data.files.length === 0) {
                container.innerHTML = '<p class="text-center">No files uploaded</p>';
            } else {
                container.innerHTML = data.files.map(file => `
                    <div class="file-card" onclick="downloadFile(${file.id})">
                        <i class="fas ${getFileIcon(file.file_type)}"></i>
                        <div class="file-name">${truncateText(file.file_name, 20)}</div>
                        <div class="file-date">${new Date(file.uploaded_at).toLocaleDateString()}</div>
                    </div>
                `).join('');
            }
            document.getElementById('filesViewModal').style.display = 'flex';
        } else {
            alert('Failed to load files');
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('Failed to load files');
        }
    }
}

// View files in new tab
async function viewFilesInNewTab(sno) {
    if (!verifySession()) return;
    
    try {
        const response = await fetch(`${API_URL}/api/files/${sno}`, {
            credentials: 'include'
        });
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success && data.files.length > 0) {
            data.files.forEach(file => {
                window.open(`${API_URL}/api/download/${file.id}`, '_blank');
            });
        } else {
            alert('No files found');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to open files');
    }
}

// Download file
function downloadFile(fileId) {
    window.location.href = `${API_URL}/api/download/${fileId}`;
}

function hideFilesView() {
    document.getElementById('filesViewModal').style.display = 'none';
}

// ============================================
// SECTION 13: HISTORY FUNCTIONS
// ============================================

// Show all history (for header button) - with role check
async function showAllHistory() {
    if (!verifySession()) return;
    
    if (!currentUser || currentUser.role === 'viewer') {
        alert('Viewers cannot access history');
        return;
    }
    
    // Close menu after clicking
    document.getElementById('menuDropdown')?.classList.remove('show');
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/api/all-history`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            displayAllHistory(data.data);
        } else {
            alert('Failed to load history');
        }
    } catch (error) {
        console.error('Error loading history:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('Error loading history');
        }
    }
}

// Display all history
function displayAllHistory(historyData) {
    const content = document.getElementById('historyContent');
    
    if (!historyData || historyData.length === 0) {
        content.innerHTML = '<p class="text-center">No history available</p>';
        document.getElementById('historyModal').style.display = 'flex';
        return;
    }
    
    let html = '<div class="history-timeline">';
    
    historyData.forEach((item, index) => {
        const date = new Date(item.timestamp);
        const formattedDate = date.toLocaleDateString();
        const formattedTime = date.toLocaleTimeString();
        
        let details = '';
        if (item.details) {
            try {
                const detailsObj = JSON.parse(item.details);
                if (detailsObj.supplier_name) {
                    details = `<span class="history-detail">Supplier: ${detailsObj.supplier_name}</span>`;
                } else if (detailsObj.po_number) {
                    details = `<span class="history-detail">PO: ${detailsObj.po_number}</span>`;
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }
        
        html += `
            <div class="history-item ${index === 0 ? 'latest' : ''}">
                <div class="history-icon">
                    <i class="fas ${getStageIconForHistory(item.stage_name)}"></i>
                </div>
                <div class="history-content">
                    <div class="history-header">
                        <span class="history-stage">${item.stage_name}</span>
                        <span class="history-time">${formattedDate} at ${formattedTime}</span>
                    </div>
                    <div class="history-user">
                        <i class="fas fa-user-circle"></i> ${item.performed_by} (${item.user_role})
                    </div>
                    ${details}
                    <div class="history-pr">
                        <small>PR: ${item.tracking_number || 'N/A'}</small>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    content.innerHTML = html;
    document.getElementById('historyModal').style.display = 'flex';
}

// Show history for current record
async function showHistory() {
    if (!verifySession()) return;
    
    if (!currentRecord) {
        alert('Please load a record first');
        return;
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/api/history/${currentRecord.sno}`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            displayHistory(data.data);
        } else {
            alert('Failed to load history');
        }
    } catch (error) {
        console.error('Error loading history:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        } else {
            alert('Error loading history');
        }
    }
}

// Display history for single record
function displayHistory(historyData) {
    const content = document.getElementById('historyContent');
    
    if (!historyData || historyData.length === 0) {
        content.innerHTML = '<p class="text-center">No history available for this record</p>';
        document.getElementById('historyModal').style.display = 'flex';
        return;
    }
    
    let html = '<div class="history-timeline">';
    
    historyData.forEach((item, index) => {
        const date = new Date(item.timestamp);
        const formattedDate = date.toLocaleDateString();
        const formattedTime = date.toLocaleTimeString();
        
        let details = '';
        if (item.details) {
            try {
                const detailsObj = JSON.parse(item.details);
                if (detailsObj.supplier_name) {
                    details = `<span class="history-detail">Supplier: ${detailsObj.supplier_name}</span>`;
                } else if (detailsObj.po_number) {
                    details = `<span class="history-detail">PO: ${detailsObj.po_number}</span>`;
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }
        
        html += `
            <div class="history-item ${index === 0 ? 'latest' : ''}">
                <div class="history-icon">
                    <i class="fas ${getStageIconForHistory(item.stage_name)}"></i>
                </div>
                <div class="history-content">
                    <div class="history-header">
                        <span class="history-stage">${item.stage_name}</span>
                        <span class="history-time">${formattedDate} at ${formattedTime}</span>
                    </div>
                    <div class="history-user">
                        <i class="fas fa-user-circle"></i> ${item.performed_by} (${item.user_role})
                    </div>
                    ${details}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    content.innerHTML = html;
    document.getElementById('historyModal').style.display = 'flex';
}

// Helper function to get icon for history
function getStageIconForHistory(stage) {
    return stageIcons[stage] || "fa-history";
}

// Hide history modal
function hideHistoryModal() {
    document.getElementById('historyModal').style.display = 'none';
}

// ============================================
// SECTION 14: TURNAROUND TIME
// ============================================

// Load turnaround time for current record
async function loadTurnaroundTime(sno) {
    if (!verifySession()) return;
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${API_URL}/api/turnaround/${sno}`, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 401 || response.status === 403) {
            forceRedirectToLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            const tatInfo = document.getElementById('tatInfo');
            const tat = data.data;
            let tatHtml = '<div class="tat-details">';
            
            if (tat.prToPoDisplay) {
                tatHtml += `
                    <div class="tat-item">
                        <strong>PR → PO:</strong> ${tat.prToPoDisplay}
                    </div>
                `;
            }
            
            if (tat.paymentTatDisplay) {
                tatHtml += `
                    <div class="tat-item">
                        <strong>Payment TAT:</strong> ${tat.paymentTatDisplay}
                    </div>
                `;
            }
            
            if (!tat.prToPoHours && !tat.paymentTatHours) {
                tatHtml += '<div class="tat-item">Process in progress</div>';
            }
            
            tatHtml += '</div>';
            tatInfo.innerHTML = tatHtml;
        }
    } catch (error) {
        console.error('Error loading TAT:', error);
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            forceRedirectToLogin();
        }
    }
}

// ============================================
// SECTION 15: AUTO SEARCH
// ============================================
function initAutocomplete() {
    const searchInput = document.getElementById("searchTracking");
    const dropdown = document.getElementById("autocompleteDropdown");

    if (!searchInput) return;

    let debounceTimer;
    let selectedIndex = -1;

    searchInput.addEventListener("input", function () {
        if (!verifySession()) return;
        
        const value = this.value.trim();
        const pattern = /^PR-\d+$/;

        if (!pattern.test(value)) {
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        clearTimeout(debounceTimer);

        debounceTimer = setTimeout(async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                
                const response = await fetch(
                    `${API_URL}/api/search/autocomplete?q=${value}`,
                    { 
                        credentials: "include",
                        signal: controller.signal
                    }
                );
                
                clearTimeout(timeoutId);

                if (response.status === 401 || response.status === 403) {
                    forceRedirectToLogin();
                    return;
                }

                const data = await response.json();

                if (data.success && data.suggestions.length > 0) {
                    renderDropdown(data.suggestions);
                } else {
                    dropdown.style.display = "none";
                }
            } catch (err) {
                console.error("Autocomplete error:", err);
                dropdown.style.display = "none";
            }
        }, 300);
    });

    // RENDER FUNCTION
    function renderDropdown(items) {
        dropdown.innerHTML = items.map(item => `
            <div class="autocomplete-item" data-value="${item}">
                ${item}
            </div>
        `).join("");

        dropdown.style.display = "block";
        selectedIndex = -1;
    }

    // SELECT ITEM
    window.selectAutocompleteItem = function(value) {
        searchInput.value = value;
        dropdown.style.display = "none";
        searchRecord();
    }

    // KEYBOARD NAVIGATION
    searchInput.addEventListener("keydown", function (e) {
        const items = dropdown.querySelectorAll(".autocomplete-item");

        if (!items.length) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            selectedIndex++;
            if (selectedIndex >= items.length) selectedIndex = 0;
            updateActive(items);
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            selectedIndex--;
            if (selectedIndex < 0) selectedIndex = items.length - 1;
            updateActive(items);
        }

        if (e.key === "Enter" && selectedIndex >= 0) {
            e.preventDefault();
            selectAutocompleteItem(items[selectedIndex].dataset.value);
        }
    });

    // ACTIVE HIGHLIGHT
    function updateActive(items) {
        items.forEach(i => i.classList.remove("active"));
        items[selectedIndex].classList.add("active");
    }

    // HIDE WHEN CLICKING OUTSIDE
    document.addEventListener("click", function (e) {
        if (!e.target.closest(".search-box")) {
            dropdown.style.display = "none";
        }
    });

    // Add click handler for autocomplete items
    document.addEventListener('click', function(e) {
        const autocompleteItem = e.target.closest('.autocomplete-item');
        if (autocompleteItem) {
            const trackingNumber = autocompleteItem.dataset.value;
            if (trackingNumber) {
                selectAutocompleteItem(trackingNumber);
            }
        }
    });
}

// ============================================
// SECTION 16: UTILITY FUNCTIONS
// ============================================

// Helper function to truncate text
function truncateText(text, maxLength) {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// Export to Excel
async function exportToExcel() {
    if (!verifySession()) return;
    
    if (!currentUser) {
        forceRedirectToLogin();
        return;
    }
    
    if (currentUser.role === 'viewer') {
        alert('Viewers cannot export data');
        return;
    }
    
    // Close menu after clicking
    document.getElementById('menuDropdown')?.classList.remove('show');
    
    try {
        window.location.href = `${API_URL}/download-excel`;
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to download Excel');
    }
}

// ============================================
// SECTION 17: INACTIVITY TIMEOUT MANAGEMENT
// ============================================

// Reset inactivity timer
function resetInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    
    if (currentUser && verifySession()) {
        inactivityTimer = setTimeout(logout, INACTIVITY_TIMEOUT);
    }
}

// Setup activity tracking
function setupActivityTracking() {
    const events = ['mousedown', 'keydown', 'scroll', 'mousemove', 'touchstart'];
    
    events.forEach(event => {
        document.addEventListener(event, resetInactivityTimer);
    });
}

// ============================================
// SECTION 18: EXCEL-STYLE COLUMN RESIZING
// ============================================

function initResizableTable() {
    const tables = document.getElementsByTagName('table');
    for (let i = 0; i < tables.length; i++) {
        resizableGrid(tables[i]);
    }
}

function resizableGrid(table) {
    const row = table.getElementsByTagName('tr')[0];
    const cols = row ? row.children : undefined;
    if (!cols) return;

    table.style.overflow = 'hidden';

    for (let i = 0; i < cols.length; i++) {
        const div = createDiv(table.offsetHeight);
        cols[i].appendChild(div);
        cols[i].style.position = 'relative';
        setEvents(div);
    }

    function setEvents(div) {
        let pageX, curCol, nxtCol, curColWidth, nxtColWidth;

        div.addEventListener('mousedown', function (e) {
            curCol = e.target.parentElement;
            nxtCol = curCol.nextElementSibling;
            pageX = e.pageX;

            const padding = paddingDiff(curCol);
            curColWidth = curCol.offsetWidth - padding;
            if (nxtCol) nxtColWidth = nxtCol.offsetWidth - padding;
        });

        div.addEventListener('mouseover', function (e) {
            e.target.style.borderRight = '3px solid #2ecc71';
        });

        div.addEventListener('mouseout', function (e) {
            e.target.style.borderRight = '';
        });

        document.addEventListener('mousemove', function (e) {
            if (curCol) {
                const diffX = e.pageX - pageX;
                if (nxtCol) nxtCol.style.width = (nxtColWidth - diffX) + 'px';
                curCol.style.width = (curColWidth + diffX) + 'px';
            }
        });

        document.addEventListener('mouseup', function (e) {
            curCol = undefined;
            nxtCol = undefined;
            pageX = undefined;
            nxtColWidth = undefined;
            curColWidth = undefined;
        });
    }

    function createDiv(height) {
        const div = document.createElement('div');
        div.style.top = 0;
        div.style.right = 0;
        div.style.width = '5px';
        div.style.position = 'absolute';
        div.style.cursor = 'col-resize';
        div.style.userSelect = 'none';
        div.style.height = height + 'px';
        return div;
    }

    function paddingDiff(col) {
        if (getStyleVal(col, 'box-sizing') === 'border-box') return 0;
        const padLeft = getStyleVal(col, 'padding-left');
        const padRight = getStyleVal(col, 'padding-right');
        return (parseInt(padLeft) + parseInt(padRight));
    }

    function getStyleVal(el, prop) {
        return window.getComputedStyle(el, null).getPropertyValue(prop);
    }
}

// ============================================
// CLEAN UP ON PAGE UNLOAD
// ============================================
window.addEventListener('beforeunload', function() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    if (serverCheckInterval) {
        clearInterval(serverCheckInterval);
    }
});