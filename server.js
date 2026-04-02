const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const PORT = 3000;
const ML_SERVICE_PORT = 5001;

let pythonProcess = null;

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
        let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

        // Security: prevent directory traversal
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }

        // Default to index.html for routes without extensions
        if (!path.extname(filePath)) {
            filePath = path.join(__dirname, 'index.html');
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

    server.listen(PORT, () => {
        console.log(`\n🏥 Clinical Support System Web Server running at http://localhost:${PORT}`);
        console.log('Press Ctrl+C to stop\n');
    });

    return server;
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
