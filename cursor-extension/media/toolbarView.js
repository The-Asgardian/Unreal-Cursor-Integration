(function() {
    const vscode = acquireVsCodeApi();
    
    let currentState = {
        connected: false,
        buildInProgress: false,
        pieRunning: false,
        piePaused: false,
        liveCodingCompiling: false,
        capabilities: {}
    };

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
            case 'updateState':
                currentState = message.state;
                updateButtonStates();
                break;
        }
    });

    function updateButtonStates() {
        const connected = currentState.connected;
        const buildInProgress = currentState.buildInProgress;
        const pieRunning = currentState.pieRunning;
        const piePaused = currentState.piePaused;

        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.classList.toggle('disabled', !connected);
        }

        // Play button
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.classList.toggle('disabled', !connected || pieRunning);
            playBtn.classList.toggle('running', pieRunning && !piePaused);
        }

        // Pause button
        const pauseBtn = document.getElementById('pauseBtn');
        if (pauseBtn) {
            pauseBtn.classList.toggle('disabled', !connected || !pieRunning);
            pauseBtn.classList.toggle('active', piePaused);
        }

        // Stop button
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.classList.toggle('disabled', !connected || !pieRunning);
        }

        // Settings button - always enabled
        const settingsBtn = document.getElementById('settingsBtn');
        // Settings is always enabled

        // Build button
        const buildBtn = document.getElementById('buildBtn');
        if (buildBtn) {
            buildBtn.classList.toggle('disabled', !connected || buildInProgress);
            buildBtn.classList.toggle('building', buildInProgress);
            buildBtn.classList.toggle('active', buildInProgress);
        }

        // Configuration dropdown
        const configBtn = document.getElementById('configBtn');
        if (configBtn) {
            configBtn.classList.toggle('disabled', !connected);
        }

        // Run config dropdown
        const runConfigBtn = document.getElementById('runConfigBtn');
        if (runConfigBtn) {
            runConfigBtn.classList.toggle('disabled', !connected);
        }

        // Run button
        const runBtn = document.getElementById('runBtn');
        if (runBtn) {
            runBtn.classList.toggle('disabled', !connected || pieRunning);
            runBtn.classList.toggle('running', pieRunning && !piePaused);
        }

        // Debug button
        const debugBtn = document.getElementById('debugBtn');
        if (debugBtn) {
            debugBtn.classList.toggle('disabled', !connected || pieRunning);
        }

        // More actions button - always enabled
        const moreBtn = document.getElementById('moreBtn');
        // More actions is always enabled
    }

    // Set up button click handlers
    document.addEventListener('DOMContentLoaded', () => {
        // Regular command buttons
        document.querySelectorAll('.toolbar-button[data-command]').forEach(button => {
            button.addEventListener('click', () => {
                if (!button.classList.contains('disabled')) {
                    const command = button.getAttribute('data-command');
                    vscode.postMessage({
                        command: 'executeCommand',
                        commandId: command
                    });
                }
            });
        });

        // Configuration dropdown
        const configBtn = document.getElementById('configBtn');
        if (configBtn) {
            configBtn.addEventListener('click', () => {
                if (!configBtn.classList.contains('disabled')) {
                    vscode.postMessage({
                        command: 'selectConfiguration'
                    });
                }
            });
        }

        // Run config dropdown
        const runConfigBtn = document.getElementById('runConfigBtn');
        if (runConfigBtn) {
            runConfigBtn.addEventListener('click', () => {
                if (!runConfigBtn.classList.contains('disabled')) {
                    vscode.postMessage({
                        command: 'selectRunConfig'
                    });
                }
            });
        }

        // More actions dropdown
        const moreBtn = document.getElementById('moreBtn');
        if (moreBtn) {
            moreBtn.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'showMoreActions'
                });
            });
        }

        // Initial state update
        updateButtonStates();
    });
})();

