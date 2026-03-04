const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
const PORT = 3000;
const JWT_SECRET = "your-secret-key-change-this-in-production";

// ============================================
// CORS Configuration - SIMPLIFIED for reliability
// ============================================
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());
app.use(cookieParser());

// Create necessary directories
const dirs = ['uploads', 'exports', 'files'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

// ============================================
// MySQL Connection with Reconnection Logic
// ============================================
let db;

function handleDisconnect() {
    db = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "root",
        database: "prtopo",
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    db.connect(err => {
        if (err) {
            console.error("❌ MySQL Connection Failed:", err.message);
            setTimeout(handleDisconnect, 2000);
        } else {
            console.log("✅ MySQL Connected Successfully");
        }
    });

    db.on('error', err => {
        console.error("❌ MySQL Error:", err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
            console.log("🔄 Reconnecting to MySQL...");
            handleDisconnect();
        }
    });
}

handleDisconnect();

// ============================================
// MULTER CONFIGURATION
// ============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'files/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg', 'image/png', 'image/jpg'];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    
    if (!token) {
        return res.status(401).json({ success: false, message: "No token provided" });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: "Invalid or expired token" });
    }
};

const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                message: `Access denied. Required roles: ${allowedRoles.join(', ')}` 
            });
        }
        
        next();
    };
};

// ============================================
// SERVE STATIC FILES - THIS MUST COME BEFORE ROUTES
// ============================================
app.use(express.static(path.join(__dirname, "public")));

// ============================================
// PUBLIC ROUTES (No Authentication Required)
// ============================================

// Serve login page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Health check (public)
app.get("/health", (req, res) => {
    if (!db || db.state === 'disconnected') {
        return res.status(503).json({ 
            status: "ERROR", 
            database: "disconnected",
            timestamp: new Date().toISOString()
        });
    }
    
    db.query("SELECT 1", (err) => {
        if (err) {
            return res.status(500).json({ 
                status: "ERROR", 
                database: "error",
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
        res.json({ 
            status: "OK", 
            database: "connected",
            timestamp: new Date().toISOString()
        });
    });
});

// Test route (public)
app.get("/api/test", (req, res) => {
    res.json({ 
        success: true, 
        message: "API is working",
        time: new Date().toISOString()
    });
});

// ============================================
// PROTECTED PAGE ROUTES
// ============================================
app.get("/index.html", (req, res) => {
    const token = req.cookies.token;
    
    if (!token) {
        console.log("No token, redirecting to login");
        return res.redirect('/login.html');
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        console.log("Token verified for user:", verified.username);
        res.sendFile(path.join(__dirname, "public", "index.html"));
    } catch (error) {
        console.log("Invalid token, redirecting to login");
        res.redirect('/login.html');
    }
});

app.get("/index", (req, res) => {
    res.redirect('/index.html');
});

// ============================================
// AUTHENTICATION API ROUTES
// ============================================

// Register
app.post("/api/auth/register", async (req, res) => {
    const { username, password, role = 'viewer' } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username and password required" });
    }
    
    const validRoles = ['admin', 'purchaser', 'finance', 'viewer'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, message: "Invalid role" });
    }
    
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        db.query(
            "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
            [username, hashedPassword, role],
            (err, result) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(400).json({ success: false, message: "Username already exists" });
                    }
                    console.error("Registration error:", err);
                    return res.status(500).json({ success: false, message: "Error creating user" });
                }
                
                res.json({ success: true, message: "User registered successfully" });
            }
        );
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// Login
app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;
    
    console.log(`Login attempt for user: ${username}`);
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username and password required" });
    }
    
    // For testing - hardcoded admin
    if (username === "admin" && password === "admin123") {
        console.log("Admin login successful");
        const token = jwt.sign(
            { id: 1, username: "admin", role: "admin" },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 8 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/'
        });
        
        return res.json({
            success: true,
            message: "Login successful",
            user: {
                id: 1,
                username: "admin",
                role: "admin"
            }
        });
    }
    
    // Database login
    db.query(
        "SELECT * FROM users WHERE username = ?",
        [username],
        async (err, results) => {
            if (err) {
                console.error("Login error:", err);
                return res.status(500).json({ success: false, message: "Server error" });
            }
            
            if (results.length === 0) {
                console.log("User not found:", username);
                return res.status(401).json({ success: false, message: "Invalid username or password" });
            }
            
            const user = results[0];
            
            try {
                const validPassword = await bcrypt.compare(password, user.password);
                if (!validPassword) {
                    console.log("Invalid password for user:", username);
                    return res.status(401).json({ success: false, message: "Invalid username or password" });
                }
                
                console.log("Login successful for user:", username);
                
                const token = jwt.sign(
                    { 
                        id: user.id, 
                        username: user.username, 
                        role: user.role 
                    },
                    JWT_SECRET,
                    { expiresIn: '8h' }
                );
                
                res.cookie('token', token, {
                    httpOnly: true,
                    maxAge: 8 * 60 * 60 * 1000,
                    sameSite: 'lax',
                    path: '/'
                });
                
                res.json({
                    success: true,
                    message: "Login successful",
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role
                    }
                });
            } catch (error) {
                console.error("Login error:", error);
                res.status(500).json({ success: false, message: "Server error" });
            }
        }
    );
});

// Logout
app.post("/api/auth/logout", (req, res) => {
    res.clearCookie('token', { path: '/' });
    res.json({ success: true, message: "Logged out successfully" });
});

// Get current user
app.get("/api/auth/me", authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// ============================================
// STAGE CONFIGURATION
// ============================================

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

function getStageColumn(stageName) {
    const stageMap = {
        "Purchase Requisition (PR)": "pr_date",
        "Request for Quotation (RFQ)/Invitation of Quote": "rfq_date",
        "Technical Evaluation": "technical_evaluation",
        "Comparisons": "comparisons",
        "Negotiation": "negotiation",
        "Approval": "approval",
        "PO Creation": "po_creation",
        "PO Release by finance / CSO": "po_release_finance",
        "Finance check": "finance_check",
        "GRN": "grn",
        "IR": "ir",
        "Payment against Invoice": "payment_against_invoice"
    };
    return stageMap[stageName];
}

function formatDurationString(totalHours) {
    if (!totalHours) return null;
    const hoursNum = parseFloat(totalHours);
    const days = Math.floor(hoursNum / 24);
    const hours = Math.floor(hoursNum % 24);
    const minutes = Math.round((hoursNum % 1) * 60);
    return `${days} days, ${hours} hours, ${minutes} mins`;
}

// ============================================
// API ROUTES (All protected)
// ============================================

// Auto-complete search
app.get("/api/search/autocomplete", authenticateToken, (req, res) => {
    const { q } = req.query;

    const pattern = /^PR-\d+$/;

    if (!q || !pattern.test(q)) {
        return res.json({ success: true, suggestions: [] });
    }

    const sql = `
        SELECT tracking_number
        FROM pr_po_details
        WHERE tracking_number LIKE ?
        ORDER BY tracking_number ASC
        LIMIT 10
    `;

    db.query(sql, [`${q}%`], (err, results) => {
        if (err) {
            console.error("Autocomplete DB error:", err);
            return res.status(500).json({ success: false, message: "Database error" });
        }

        res.json({
            success: true,
            suggestions: results.map(r => r.tracking_number)
        });
    });
});

// Update PO Advance
app.post("/update-po-advance", 
    authenticateToken,
    authorizeRole('finance', 'admin'),
    (req, res) => {
        const { sno, po_advance } = req.body;
        
        if (!sno || !po_advance) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }
        
        if (!['Yes', 'No'].includes(po_advance)) {
            return res.status(400).json({ success: false, message: "Invalid PO Advance value" });
        }
        
        const sql = `UPDATE pr_po_details SET po_advance = ? WHERE sno = ?`;
        
        db.query(sql, [po_advance, sno], (err, result) => {
            if (err) {
                console.error("Error updating PO Advance:", err);
                return res.status(500).json({ success: false, message: "Error updating PO Advance" });
            }
            
            console.log(`User ${req.user.username} set PO Advance to ${po_advance} for PR #${sno}`);
            
            res.json({ 
                success: true, 
                message: `PO Advance set to ${po_advance}` 
            });
        });
});

// Create PR
app.post("/create-pr", 
    authenticateToken, 
    authorizeRole('purchaser', 'admin'),
    (req, res) => {
        const { 
            tracking_number, 
            pr_date,
            plant,
            item_description,
            payment_type,
            requested_by,
            remarks
        } = req.body;
        
        if (!tracking_number || !pr_date || !plant || !item_description || !payment_type || !requested_by) {
            return res.status(400).json({ 
                success: false, 
                message: "Please fill all required fields" 
            });
        }
        
        db.query("SELECT sno FROM pr_po_details WHERE tracking_number = ?", [tracking_number], (err, results) => {
            if (err) {
                return res.status(500).json({ success: false, message: "Database error" });
            }
            if (results.length > 0) {
                return res.status(400).json({ success: false, message: "Tracking number already exists" });
            }
            
            const sql = `
                INSERT INTO pr_po_details (
                    tracking_number, pr_date, plant, item_description, 
                    payment_type, requested_by, remarks
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            
            db.query(sql, [
                tracking_number, 
                pr_date,
                plant, 
                item_description, 
                payment_type, 
                requested_by, 
                remarks || null
            ], (err, result) => {
                if (err) {
                    console.error("Create PR Error:", err);
                    return res.status(500).json({ success: false, message: "Error creating PR" });
                }
                
                console.log(`User ${req.user.username} created PR: ${tracking_number}`);
                
                res.json({ 
                    success: true, 
                    message: "PR Created Successfully", 
                    sno: result.insertId 
                });
            });
        });
});

// Update stage
app.post("/update-stage", 
    authenticateToken,
    (req, res) => {
        const { sno, stage, po_number, supplier_name } = req.body;
        
        if (!sno || !stage) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }
        
        const allowedRoles = stagePermissions[stage];
        if (!allowedRoles) {
            return res.status(400).json({ success: false, message: "Invalid stage name" });
        }
        
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                message: `You don't have permission to perform ${stage}. Required roles: ${allowedRoles.join(', ')}` 
            });
        }
        
        const dbColumn = getStageColumn(stage);
        
        db.query("SELECT * FROM pr_po_details WHERE sno = ?", [sno], (err, records) => {
            if (err) {
                return res.status(500).json({ success: false, message: "Database error" });
            }
            if (records.length === 0) {
                return res.status(404).json({ success: false, message: "Record not found" });
            }
            
            const currentRecord = records[0];
            const stageIndex = stageOrder.indexOf(stage);
            
            if (stageIndex > 0) {
                const prevStage = stageOrder[stageIndex - 1];
                const prevDbColumn = getStageColumn(prevStage);
                if (!currentRecord[prevDbColumn]) {
                    return res.json({
                        success: false,
                        message: `Please complete "${prevStage}" first`,
                        requiredStage: prevStage
                    });
                }
            }
            
            let updateSql;
            let params;
            let historyDetails = {};
            
            if (stage === "Approval") {
                if (!supplier_name) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "Supplier name is required at Approval stage" 
                    });
                }
                updateSql = `UPDATE pr_po_details SET approval = NOW(), supplier_name = ? WHERE sno = ?`;
                params = [supplier_name, sno];
                historyDetails = { supplier_name };
            } 
            else if (stage === "PO Creation") {
                if (!po_number) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "PO Number is required at PO Creation stage" 
                    });
                }
                updateSql = `UPDATE pr_po_details SET po_creation = NOW(), po_number = ? WHERE sno = ?`;
                params = [po_number, sno];
                historyDetails = { po_number };
            }
            else {
                updateSql = `UPDATE pr_po_details SET \`${dbColumn}\` = NOW() WHERE sno = ?`;
                params = [sno];
            }
            
            db.query(updateSql, params, (err) => {
                if (err) {
                    console.error("Error updating stage:", err);
                    return res.status(500).json({ success: false, message: "Error updating stage" });
                }
                
                const historySql = `
                    INSERT INTO stage_history 
                    (pr_sno, tracking_number, stage_name, performed_by, user_role, details) 
                    VALUES (?, ?, ?, ?, ?, ?)
                `;
                
                const details = JSON.stringify({
                    ...historyDetails,
                    timestamp: new Date().toISOString()
                });
                
                db.query(historySql, [
                    sno, 
                    currentRecord.tracking_number, 
                    stage, 
                    req.user.username, 
                    req.user.role,
                    details
                ], (historyErr) => {
                    if (historyErr) {
                        console.error("Error logging history:", historyErr);
                    }
                });
                
                console.log(`User ${req.user.username} completed stage: ${stage} for PR #${sno}`);
                
                if (stage === "PO Release by finance / CSO") {
                    return res.json({ 
                        success: true, 
                        message: `${stage} completed successfully. Please set PO Advance before Finance Check.`,
                        nextAction: "po_advance_required"
                    });
                }
                
                res.json({ success: true, message: `${stage} completed successfully` });
            });
        });
});

// History routes
app.get("/api/history/:sno", authenticateToken, (req, res) => {
    const { sno } = req.params;
    
    const sql = `
        SELECT * FROM stage_history 
        WHERE pr_sno = ? 
        ORDER BY timestamp DESC
    `;
    
    db.query(sql, [sno], (err, results) => {
        if (err) {
            console.error("Error fetching history:", err);
            return res.status(500).json({ success: false, message: "Error fetching history" });
        }
        
        res.json({ success: true, data: results });
    });
});

app.get("/api/all-history", authenticateToken, (req, res) => {
    let sql = `
        SELECT h.*, p.tracking_number, p.item_description 
        FROM stage_history h
        JOIN pr_po_details p ON h.pr_sno = p.sno
        ORDER BY h.timestamp DESC
        LIMIT 50
    `;
    
    if (req.user.role !== 'admin') {
        sql = `
            SELECT h.*, p.tracking_number, p.item_description 
            FROM stage_history h
            JOIN pr_po_details p ON h.pr_sno = p.sno
            WHERE h.user_role = ? OR h.user_role = 'admin'
            ORDER BY h.timestamp DESC
            LIMIT 50
        `;
    }
    
    db.query(sql, [req.user.role], (err, results) => {
        if (err) {
            console.error("Error fetching all history:", err);
            return res.status(500).json({ success: false, message: "Error fetching history" });
        }
        
        res.json({ success: true, data: results });
    });
});

// Records routes
app.get("/api/records", authenticateToken, (req, res) => {
    const sql = `
        SELECT p.*, 
               COUNT(f.id) as file_count
        FROM pr_po_details p
        LEFT JOIN file_uploads f ON p.sno = f.sno
        GROUP BY p.sno
        ORDER BY p.pr_date DESC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching records:", err);
            return res.status(500).json({ success: false, message: "Error fetching records" });
        }
        res.json({ success: true, data: results });
    });
});

app.get("/api/records/tracking/:tracking", authenticateToken, (req, res) => {
    const { tracking } = req.params;
    const sql = `
        SELECT p.*, 
               COUNT(f.id) as file_count
        FROM pr_po_details p
        LEFT JOIN file_uploads f ON p.sno = f.sno
        WHERE p.tracking_number = ?
        GROUP BY p.sno
    `;
    db.query(sql, [tracking], (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: "Error fetching record" });
        }
        if (results.length === 0) {
            return res.status(404).json({ success: false, message: "Record not found" });
        }
        res.json({ success: true, data: results[0] });
    });
});

// File upload routes
app.post("/api/upload-files", 
    authenticateToken,
    upload.array('files', 5), 
    (req, res) => {
        const { sno } = req.body;
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "No files uploaded" });
        }
        
        const values = req.files.map(file => [
            sno,
            file.originalname,
            file.path,
            file.mimetype
        ]);
        
        const sql = `
            INSERT INTO file_uploads (sno, file_name, file_path, file_type, uploaded_at)
            VALUES ?
        `;
        
        db.query(sql, [values], (err, result) => {
            if (err) {
                console.error("File upload error:", err);
                return res.status(500).json({ success: false, message: "Error saving file info" });
            }
            
            res.json({ 
                success: true, 
                message: "Files uploaded successfully",
                count: req.files.length
            });
        });
});

app.get("/api/files/:sno", authenticateToken, (req, res) => {
    const { sno } = req.params;
    db.query(
        "SELECT * FROM file_uploads WHERE sno = ? ORDER BY uploaded_at DESC",
        [sno],
        (err, results) => {
            if (err) {
                return res.status(500).json({ success: false, message: "Error fetching files" });
            }
            res.json({ success: true, files: results });
        }
    );
});

app.get("/api/download/:fileId", authenticateToken, (req, res) => {
    const { fileId } = req.params;
    db.query("SELECT * FROM file_uploads WHERE id = ?", [fileId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ success: false, message: "File not found" });
        }
        
        const file = results[0];
        const filePath = path.resolve(file.file_path);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: "File not found on server" });
        }
        
        const viewableTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        
        if (viewableTypes.includes(file.file_type)) {
            res.setHeader('Content-Type', file.file_type);
            res.setHeader('Content-Disposition', `inline; filename="${file.file_name}"`);
            res.sendFile(filePath);
        } else {
            res.download(filePath, file.file_name);
        }
    });
});

// Turnaround time
app.get("/api/turnaround/:sno", authenticateToken, (req, res) => {
    const { sno } = req.params;
    db.query("SELECT * FROM pr_po_details WHERE sno = ?", [sno], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).json({ success: false, message: "Record not found" });
        }
        
        const record = results[0];
        let prToPoHours = null;
        let paymentTatHours = null;
        
        if (record.pr_date && record.po_release_finance) {
            const prTime = new Date(record.pr_date).getTime();
            const poTime = new Date(record.po_release_finance).getTime();
            prToPoHours = (poTime - prTime) / (1000 * 60 * 60);
        }
        
        if (record.grn && record.payment_against_invoice) {
            const grnTime = new Date(record.grn).getTime();
            const payTime = new Date(record.payment_against_invoice).getTime();
            if (!isNaN(grnTime) && !isNaN(payTime) && payTime > grnTime) {
                paymentTatHours = (payTime - grnTime) / (1000 * 60 * 60);
            }
        }
        
        res.json({
            success: true,
            data: {
                sno: record.sno,
                prToPoDisplay: formatDurationString(prToPoHours),
                paymentTatDisplay: formatDurationString(paymentTatHours),
                prToPoHours: prToPoHours ? prToPoHours.toFixed(2) : null,
                paymentTatHours: paymentTatHours ? paymentTatHours.toFixed(2) : null
            }
        });
    });
});

// Dashboard stats
app.get("/api/dashboard/stats", authenticateToken, (req, res) => {
    console.log("Calculating dashboard stats for user:", req.user.role);
    
    db.query("SELECT COUNT(*) as count FROM pr_po_details", (err, totalResult) => {
        if (err) {
            return res.status(500).json({ success: false, message: "Error fetching stats" });
        }
        
        db.query(
            "SELECT COUNT(*) as count FROM pr_po_details WHERE payment_against_invoice IS NOT NULL",
            (err, completedResult) => {
                if (err) {
                    return res.status(500).json({ success: false, message: "Error fetching stats" });
                }
                
                db.query(`
                    SELECT 
                        COALESCE(AVG(DATEDIFF(po_creation, pr_date)), 0) as avg_days,
                        COUNT(*) as record_count
                    FROM pr_po_details 
                    WHERE pr_date IS NOT NULL 
                    AND po_creation IS NOT NULL
                `, (err, purchaserResult) => {
                    
                    db.query(`
                        SELECT 
                            COALESCE(AVG(DATEDIFF(payment_against_invoice, po_release_finance)), 0) as avg_days,
                            COUNT(*) as record_count
                        FROM pr_po_details 
                        WHERE po_release_finance IS NOT NULL 
                        AND payment_against_invoice IS NOT NULL
                    `, (err, financeResult) => {
                        
                        db.query(`
                            SELECT 
                                COALESCE(AVG(DATEDIFF(po_release_finance, pr_date)), 0) as avg_days,
                                COUNT(*) as record_count
                            FROM pr_po_details 
                            WHERE pr_date IS NOT NULL 
                            AND po_release_finance IS NOT NULL
                        `, (err, overallResult) => {
                            
                            const purchaserAvg = Math.round(purchaserResult?.[0]?.avg_days || 0);
                            const financeAvg = Math.round(financeResult?.[0]?.avg_days || 0);
                            const overallAvg = Math.round(overallResult?.[0]?.avg_days || 0);
                            
                            res.json({
                                success: true,
                                data: {
                                    totalRecords: totalResult[0].count,
                                    completedRecords: completedResult[0].count,
                                    purchaserAvgDays: purchaserAvg,
                                    financeAvgDays: financeAvg,
                                    overallAvgDays: overallAvg
                                }
                            });
                        });
                    });
                });
            }
        );
    });
});

// Excel download
app.get("/download-excel", authenticateToken, authorizeRole('admin', 'purchaser', 'finance'), (req, res) => {
    const sql = `
        SELECT 
            sno,
            tracking_number,
            plant,
            item_description,
            supplier_name,
            payment_type,
            po_number,
            remarks,
            pr_date,
            rfq_date,
            technical_evaluation,
            comparisons,
            negotiation,
            approval,
            po_creation,
            po_release_finance,
            po_advance,
            finance_check,
            grn,
            ir,
            payment_against_invoice
        FROM pr_po_details 
        ORDER BY sno DESC
    `;
    
    db.query(sql, (err, rows) => {
        if (err) {
            console.error("Error fetching data for Excel:", err);
            return res.status(500).json({ success: false, message: "Error generating Excel" });
        }
        
        const excelData = rows.map(row => ({
            'S.No': row.sno,
            'Tracking Number': row.tracking_number || '',
            'Plant': row.plant || '',
            'Item Description': row.item_description || '',
            'Supplier Name': row.supplier_name || '',
            'Payment Type': row.payment_type || '',
            'PO Number': row.po_number || '',
            'Remarks': row.remarks || '',
            'PR Date': row.pr_date ? formatDateForExcel(row.pr_date) : '',
            'RFQ Date': row.rfq_date ? formatDateForExcel(row.rfq_date) : '',
            'Technical Evaluation': row.technical_evaluation ? formatDateForExcel(row.technical_evaluation) : '',
            'Comparisons': row.comparisons ? formatDateForExcel(row.comparisons) : '',
            'Negotiation': row.negotiation ? formatDateForExcel(row.negotiation) : '',
            'Approval': row.approval ? formatDateForExcel(row.approval) : '',
            'PO Creation': row.po_creation ? formatDateForExcel(row.po_creation) : '',
            'PO Release Finance': row.po_release_finance ? formatDateForExcel(row.po_release_finance) : '',
            'PO Advance': row.po_advance || 'No',
            'Finance Check': row.finance_check ? formatDateForExcel(row.finance_check) : '',
            'GRN': row.grn ? formatDateForExcel(row.grn) : '',
            'IR': row.ir ? formatDateForExcel(row.ir) : '',
            'Payment against Invoice': row.payment_against_invoice ? formatDateForExcel(row.payment_against_invoice) : ''
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        
        const colWidths = [
            { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 30 }, { wch: 20 },
            { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
            { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
            { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
            { wch: 12 }
        ];
        worksheet['!cols'] = colWidths;
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Procurement Report");
        
        const filePath = path.join(__dirname, "exports", `procurement_report_${Date.now()}.xlsx`);
        XLSX.writeFile(workbook, filePath);
        
        res.download(filePath, "procurement_report.xlsx", (err) => {
            if (err) {
                console.error("Error downloading file:", err);
            }
            fs.unlink(filePath, (err) => {
                if (err) console.error("Error deleting temp file:", err);
            });
        });
    });
});

function formatDateForExcel(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString();
}

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================
app.use((err, req, res, next) => {
    console.error("Server Error:", err);
    
    if (err.message === 'Invalid file type') {
        return res.status(400).json({ 
            success: false, 
            message: "Invalid file type. Allowed: PDF, Word, Excel, Images" 
        });
    }
    
    if (err.message.includes('CORS')) {
        return res.status(403).json({ 
            success: false, 
            message: "CORS error: Origin not allowed" 
        });
    }
    
    res.status(500).json({ 
        success: false, 
        message: "Internal server error"
    });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log("\n" + "=".repeat(50));
    console.log(`✅ SERVER STARTED SUCCESSFULLY`);
    console.log("=".repeat(50));
    console.log(`📍 Server running on: http://localhost:${PORT}`);
    //console.log(`📍 Login page: http://localhost:${PORT}/login.html`);
    //console.log(`📍 Dashboard: http://localhost:${PORT}/index.html`);
    //console.log("\n🔐 DEFAULT ADMIN LOGIN:");
    //console.log(`   Username: admin`);
    //console.log(`   Password: admin123`);
    console.log("=".repeat(50) + "\n");
});