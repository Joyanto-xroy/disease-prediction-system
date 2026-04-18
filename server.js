const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const url = require('url');

let PDFGenerator = null;
try {
    PDFGenerator = require('./src/services/pdf/pdf-generator.js');
} catch (_) {
    console.warn('⚠️ PDF generator module not found. PDF endpoints will be disabled.');
}

const PORT = 3000;
const ML_SERVICE_PORT = 5001;
const pdfDir = path.join(__dirname, 'temp-pdfs');

let pythonProcess = null;

// ─── Initialize temp directory for PDFs ────────────────────────────────────
if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir, { recursive: true });
}

// ─── Start Python Disease Prediction Service ──────────────────────────────
function startPythonService() {
    return new Promise((resolve, reject) => {
        // Check if already running
        checkServiceHealth()
            .then(isHealthy => {
                if (isHealthy) {
                    console.log('✅ Disease Prediction Service already running on port ' + ML_SERVICE_PORT);
                    resolve();
                    return;
                }

                console.log('🚀 Starting Disease Prediction Service...');

                // Determine if running on Windows or Unix
                const isWindows = os.platform() === 'win32';
                const pythonCmd = isWindows ? 'python' : 'python3';

                pythonProcess = spawn(pythonCmd, ['disease_prediction_service.py'], {
                    cwd: __dirname,
                    stdio: 'inherit',
                    shell: false,
                    windowsHide: true
                });

                pythonProcess.on('error', (err) => {
                    console.error('❌ Failed to start Python service:', err.message);
                    reject(err);
                });

                // Give Python service time to start
                setTimeout(() => {
                    checkServiceHealth()
                        .then(isHealthy => {
                            if (isHealthy) {
                                console.log('✅ Disease Prediction Service started successfully!');
                                resolve();
                            } else {
                                console.warn('⚠️ Python service started but health check failed. It may still be initializing...');
                                resolve();
                            }
                        })
                        .catch(err => {
                            console.warn('⚠️ Health check error (service may still be starting):', err.message);
                            resolve(); // Don't reject - service might be starting
                        });
                }, 5000); // Increased from 3000 to 5000
            })
            .catch(err => {
                console.warn('⚠️ Could not verify service status:', err.message);
                reject(err);
            });
    });
}

// ─── Check if Python Service is Healthy ────────────────────────────────────
function checkServiceHealth() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: ML_SERVICE_PORT,
            path: '/health',
            method: 'GET',
            timeout: 2000
        };

        const req = http.request(options, (res) => {
            resolve(res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.abort();
            resolve(false);
        });

        req.end();
    });
}

// ─── HTTP Server for Web App ────────────────────────────────────────────────
function startWebServer() {
    const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        const query = parsedUrl.query;

        // Handle API routes
        if (pathname === '/api/generate-prescription' && req.method === 'POST') {
            handleGeneratePrescription(req, res);
            return;
        }

        if (pathname === '/api/generate-report' && req.method === 'POST') {
            handleGenerateReport(req, res);
            return;
        }

        if (pathname.startsWith('/api/download-pdf/') && req.method === 'GET') {
            handleDownloadPDF(req, res, pathname);
            return;
        }

        // Handle CORS preflight requests
        if ((pathname === '/api/generate-prescription' || pathname === '/api/generate-report') && req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400'
            });
            res.end();
            return;
        }

        // Handle static files — serve from public/ directory
        const publicDir = path.join(__dirname, 'public');
        let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

        // Security: prevent directory traversal
        if (!filePath.startsWith(publicDir)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        // Default to index.html for routes without extensions
        if (!path.extname(filePath)) {
            filePath = path.join(publicDir, 'index.html');
        }

        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
                return;
            }

            const ext = path.extname(filePath);
            let contentType = 'text/html';

            switch (ext) {
                case '.js': contentType = 'application/javascript'; break;
                case '.css': contentType = 'text/css'; break;
                case '.json': contentType = 'application/json'; break;
                case '.svg': contentType = 'image/svg+xml'; break;
                case '.png': contentType = 'image/png'; break;
                case '.jpg': contentType = 'image/jpeg'; break;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use. Please stop the process using this port or change PORT in server.js.`);
            process.exit(1);
        } else {
            console.error('Web server error:', err);
            process.exit(1);
        }
    });

    server.listen(PORT, () => {
        console.log(`\n🏥 Clinical Support System Web Server running at http://localhost:${PORT}`);
        console.log('Press Ctrl+C to stop\n');
    });

    return server;
}

// ─── API Route Handlers ─────────────────────────────────────────────────────

/**
 * Handle prescription PDF generation request
 */
function handleGeneratePrescription(req, res) {
    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            if (!PDFGenerator) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'PDF generation module not available' }));
                return;
            }
            const data = JSON.parse(body);
            const pdfGenerator = new PDFGenerator();
            const fileName = `prescription-${Date.now()}.pdf`;
            const filePath = path.join(pdfDir, fileName);

            await pdfGenerator.generatePrescription(data, filePath);

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
                success: true,
                fileName: fileName,
                downloadUrl: `/api/download-pdf/${fileName}`
            }));
        } catch (error) {
            console.error('Error generating prescription:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
}

/**
 * Handle medical report PDF generation request
 */
function handleGenerateReport(req, res) {
    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            if (!PDFGenerator) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'PDF generation module not available' }));
                return;
            }
            const data = JSON.parse(body);
            const pdfGenerator = new PDFGenerator();
            const fileName = `report-${Date.now()}.pdf`;
            const filePath = path.join(pdfDir, fileName);

            await pdfGenerator.generateMedicalReport(data, filePath);

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
                success: true,
                fileName: fileName,
                downloadUrl: `/api/download-pdf/${fileName}`
            }));
        } catch (error) {
            console.error('Error generating report:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
}

/**
 * Handle PDF download request
 */
function handleDownloadPDF(req, res, pathname) {
    try {
        const fileName = pathname.replace('/api/download-pdf/', '');
        
        // Security: prevent directory traversal
        if (fileName.includes('..') || fileName.includes('/')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        const filePath = path.join(pdfDir, fileName);

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
            return;
        }

        const stream = fs.createReadStream(filePath);
        res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Access-Control-Allow-Origin': '*'
        });

        stream.pipe(res);

        // Clean up file after download (after 5 minutes)
        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {
                console.warn('Could not delete temporary PDF file:', e.message);
            }
        }, 5 * 60 * 1000);
    } catch (error) {
        console.error('Error downloading PDF:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
    }
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');

    if (pythonProcess) {
        console.log('Stopping Disease Prediction Service...');
        pythonProcess.kill();
    }

    process.exit(0);
});

process.on('exit', () => {
    if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill();
    }
});

// ─── Start Everything ───────────────────────────────────────────────────────
console.log('🏥 Clinical Support System - Starting Up...\n');

startPythonService()
    .then(() => {
        startWebServer();
    })
    .catch((err) => {
        console.error('Failed to start Python service:', err.message);
        console.log('⚠️ Starting web server anyway... (Disease Prediction will not work until service is started)\n');
        startWebServer();
    });